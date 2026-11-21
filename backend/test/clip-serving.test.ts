import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { clipServingEnabled, handleClipRequest, hasProxyHeader, parseRange, type ClipServeRecord } from "../src/clips/serve";
import { isClipServable } from "../src/imagery/sources";
import { createApproachServer, listenLoopback } from "../src/routing/server";

// NOT imagery: 1000 deterministic bytes standing in for an mp4.
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const SRC = [{ source: "mapillary", creators: ["x"], license: "CC-BY-SA-4.0", sourceUrls: [] }];
let dir: string, outside: string;
const rows = new Map<string, ClipServeRecord>();
let lookups: string[] = [];

const server = createApproachServer({
  onError: () => {},
  clipServing: { get clipsDir() { return dir; }, lookup: async (e, d) => { lookups.push(`${e}/${d}`); return rows.get(`${e}/${d}`) ?? null; } },
});
let base = "", port = 0;
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "rpg-clips-"));
  outside = mkdtempSync(path.join(tmpdir(), "rpg-outside-"));
  mkdirSync(path.join(dir, "111"), { recursive: true });
  writeFileSync(path.join(dir, "111", "forward.mp4"), BYTES);
  writeFileSync(path.join(outside, "secret.mp4"), "SECRET");
  mkdirSync(path.join(dir, "222"));
  symlinkSync(path.join(outside, "secret.mp4"), path.join(dir, "222", "forward.mp4"));
  rows.set("111/forward", { video_url: "local:111/forward.mp4", source_summary: SRC });
  rows.set("222/forward", { video_url: "local:222/forward.mp4", source_summary: SRC });
  rows.set("333/forward", { video_url: "local:../../etc/passwd", source_summary: SRC });
  rows.set("444/forward", { video_url: "local:111/forward.mp4", source_summary: SRC }); // key does not match the requested edge
  rows.set("555/forward", { video_url: "local:555/forward.mp4", source_summary: SRC }); // registered, file missing
  rows.set("666/forward", { video_url: "https://example.invalid/x.mp4", source_summary: SRC });
  await listenLoopback(server, 0);
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
afterEach(() => { delete process.env.PROTOTYPE_CLIP_SERVING; delete process.env.IMAGERY_SOURCES_DISABLED; lookups = []; });

/** Raw request so the path reaches the server untouched (fetch would normalise ".."). */
const raw = (p: string, method = "GET", headers: http.OutgoingHttpHeaders = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port, path: p, method, headers }, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (c) => chunks.push(c as Buffer));
    res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  r.on("error", reject);
  r.end();
});

describe("flag off (default)", () => {
  it("is off unless the variable is exactly 1", () => {
    for (const v of [undefined, "", "0", "true", "yes", "on", " 1", "1 "]) expect(clipServingEnabled({ PROTOTYPE_CLIP_SERVING: v }), String(v)).toBe(false);
    expect(clipServingEnabled({ PROTOTYPE_CLIP_SERVING: "1" })).toBe(true);
  });
  it("every /clips path is a plain 404 and the store is never consulted", async () => {
    for (const v of [undefined, "0", "true"]) {
      if (v === undefined) delete process.env.PROTOTYPE_CLIP_SERVING; else process.env.PROTOTYPE_CLIP_SERVING = v;
      const r = await raw("/clips/111/forward.mp4");
      expect(r.status).toBe(404);
      expect(r.headers["x-prototype"]).toBeUndefined();
      expect(r.body.equals(BYTES)).toBe(false);
    }
    expect((await raw("/clips/../../etc/passwd")).status).toBe(404);
    expect(lookups).toEqual([]);
  });
  it("a server with no clip store behaves the same even with the flag on", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    const s = createApproachServer({ onError: () => {} });
    await listenLoopback(s, 0);
    const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/clips/111/forward.mp4`);
    expect(r.status).toBe(404);
    await new Promise<void>((res) => s.close(() => res()));
  });
});

describe("flag on, loopback", () => {
  it("serves a registered clip with X-Prototype: true, byte-exact", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    const r = await raw("/clips/111/forward.mp4");
    expect(r.status).toBe(200);
    expect(r.headers["x-prototype"]).toBe("true");
    expect(r.headers["content-type"]).toBe("video/mp4");
    expect(r.headers["accept-ranges"]).toBe("bytes");
    expect(r.headers["content-length"]).toBe("1000");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body.equals(BYTES)).toBe(true);
  });
  it("HEAD returns the headers and no body", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    const r = await raw("/clips/111/forward.mp4", "HEAD");
    expect(r.status).toBe(200);
    expect(r.headers["content-length"]).toBe("1000");
    expect(r.headers["x-prototype"]).toBe("true");
    expect(r.body.length).toBe(0);
  });
  it("supports byte ranges: closed, open-ended, suffix; 416 for unsatisfiable, malformed and multiple", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    const closed = await raw("/clips/111/forward.mp4", "GET", { range: "bytes=10-19" });
    expect(closed.status).toBe(206);
    expect(closed.headers["content-range"]).toBe("bytes 10-19/1000");
    expect(closed.headers["content-length"]).toBe("10");
    expect(closed.headers["x-prototype"]).toBe("true");
    expect(closed.body.equals(BYTES.subarray(10, 20))).toBe(true);
    const open = await raw("/clips/111/forward.mp4", "GET", { range: "bytes=990-" });
    expect(open.status).toBe(206);
    expect(open.body.equals(BYTES.subarray(990))).toBe(true);
    const suffix = await raw("/clips/111/forward.mp4", "GET", { range: "bytes=-5" });
    expect(suffix.headers["content-range"]).toBe("bytes 995-999/1000");
    expect(suffix.body.equals(BYTES.subarray(995))).toBe(true);
    const clampedEnd = await raw("/clips/111/forward.mp4", "GET", { range: "bytes=900-99999" });
    expect(clampedEnd.headers["content-range"]).toBe("bytes 900-999/1000");
    for (const bad of ["bytes=1000-", "bytes=5-2", "bytes=abc", "bytes=0-1,5-6", "items=0-1", "bytes=-"]) {
      const r = await raw("/clips/111/forward.mp4", "GET", { range: bad });
      expect(r.status, bad).toBe(416);
      expect(r.headers["content-range"], bad).toBe("bytes */1000");
    }
  });
  it("refuses path traversal attempts and never consults the store for them", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    const attempts = [
      "/clips/../etc/passwd", "/clips/111/../../etc/passwd", "/clips/%2e%2e/etc/passwd", "/clips/111%2f..%2f..%2fsecret/forward.mp4",
      "/clips/111/forward.mp4/../..", "/clips/111\\..\\forward.mp4", "/clips/111/..%5cforward.mp4", "/clips/./111/forward.mp4", "/clips//111/forward.mp4",
      "/clips/111/forward.mp4%00.png", "/clips/abc/forward.mp4", "/clips/111/FORWARD.mp4", "/clips/111/forward.mkv", "/clips/", "/clips", "/clips/1111111111111111/forward.mp4",
      "/clips/111/forward/x.mp4", "/clips/-1/forward.mp4",
    ];
    for (const a of attempts) {
      const r = await raw(a);
      expect([400, 404], a).toContain(r.status);
      expect(r.body.includes("SECRET"), a).toBe(false);
      expect(r.headers["x-prototype"], a).toBeUndefined();
    }
    expect(lookups).toEqual([]);
  });
  it("refuses unregistered keys, keys that do not match the request, escaping keys, symlinks out of the cache, non-local and missing files", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    for (const p of ["/clips/999/forward.mp4", "/clips/333/forward.mp4", "/clips/444/forward.mp4", "/clips/222/forward.mp4", "/clips/555/forward.mp4", "/clips/666/forward.mp4", "/clips/111/reverse.mp4"]) {
      const r = await raw(p);
      expect(r.status, p).toBe(404);
      expect(r.body.includes("SECRET"), p).toBe(false);
    }
  });
  it("only GET and HEAD", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    expect((await fetch(`${base}/clips/111/forward.mp4`, { method: "POST", body: "x" })).status).toBe(405);
  });
  it("the kill switch refuses a clip whose source is disabled, and lifts when unset", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    process.env.IMAGERY_SOURCES_DISABLED = "mapillary";
    const r = await raw("/clips/111/forward.mp4");
    expect(r.status).toBe(403);
    expect(r.headers["x-prototype"]).toBeUndefined();
    expect(r.body.equals(BYTES)).toBe(false);
    delete process.env.IMAGERY_SOURCES_DISABLED;
    expect((await raw("/clips/111/forward.mp4")).status).toBe(200);
  });
  it("fails closed on a malformed source summary", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    rows.set("111/forward", { video_url: "local:111/forward.mp4", source_summary: "[]" });
    expect((await raw("/clips/111/forward.mp4")).status).toBe(403);
    rows.set("111/forward", { video_url: "local:111/forward.mp4", source_summary: SRC });
  });
  it("does NOT change isClipServable: a prototype clip is still unservable for every public path", () => {
    expect(isClipServable({ status: "prototype", source_summary: SRC })).toBe(false);
    expect(isClipServable({ render_params: { prototype: true }, source_summary: SRC })).toBe(false);
  });
});

describe("loopback binding", () => {
  it("refuses with 403 when the server is not bound to loopback, even with the flag on", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    const fakeServer = { address: () => ({ address: "0.0.0.0", family: "IPv4", port: 1 }) } as unknown as http.Server;
    let status = 0; let body = "";
    const res = { headersSent: false, writeHead(s: number) { status = s; }, end(b?: string) { body = String(b ?? ""); } } as unknown as http.ServerResponse;
    const req = { method: "GET", url: "/clips/111/forward.mp4", headers: {}, socket: { remoteAddress: "127.0.0.1" } } as unknown as http.IncomingMessage;
    await handleClipRequest(req, res, fakeServer, { clipsDir: dir, lookup: async () => { throw new Error("must not be reached"); } });
    expect(status).toBe(403);
    expect(body).toContain("loopback");
  });
  it("refuses a non-loopback caller even on a loopback-bound server", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    const fakeServer = { address: () => ({ address: "127.0.0.1", family: "IPv4", port: 1 }) } as unknown as http.Server;
    let status = 0;
    const res = { headersSent: false, writeHead(s: number) { status = s; }, end() {} } as unknown as http.ServerResponse;
    const req = { method: "GET", url: "/clips/111/forward.mp4", headers: {}, socket: { remoteAddress: "192.168.1.20" } } as unknown as http.IncomingMessage;
    await handleClipRequest(req, res, fakeServer, { clipsDir: dir, lookup: async () => { throw new Error("must not be reached"); } });
    expect(status).toBe(403);
  });
});

describe("proxy / tailnet headers (tailscale serve makes every caller look like loopback)", () => {
  const cases: Array<[string, string]> = [
    ["X-Forwarded-For", "100.64.0.9"], ["x-forwarded-for", "100.64.0.9"], ["X-FORWARDED-FOR", "100.64.0.9"],
    ["X-Forwarded-Host", "servermac.tail607401.ts.net"], ["X-Forwarded-Proto", "https"],
    ["Forwarded", "for=100.64.0.9;proto=https"], ["Via", "1.1 tailscale"],
    ["Tailscale-User-Login", "someone@example.invalid"], ["tailscale-user-name", "x"], ["Tailscale-Headers-Info", "x"],
    ["X-Real-IP", "100.64.0.9"], ["x-real-ip", "100.64.0.9"], ["X-REAL-IP", "100.64.0.9"],
    ["CF-Connecting-IP", "100.64.0.9"], ["cf-connecting-ip", "100.64.0.9"], ["Cf-Connecting-Ip", "100.64.0.9"],
    ["True-Client-IP", "100.64.0.9"], ["true-client-ip", "100.64.0.9"],
    ["X-Client-IP", "100.64.0.9"], ["x-client-ip", "100.64.0.9"],
    ["Forwarded-For", "100.64.0.9"], ["forwarded-for", "100.64.0.9"],
    ["X-Forwarded-Server", "x"], ["X-Original-Forwarded-For", "x"], ["X-Forwarded-Port", "443"], ["Forwarded-Proto", "https"], ["xFORWARDEDx", "x"],
    ["X-Real-IP", ""], ["Forwarded", ""],
  ];
  for (const flag of [undefined, "1"]) {
    for (const [name, value] of cases) {
      it(`${name} is refused with problem JSON (flag ${flag ?? "unset"})`, async () => {
        if (flag) process.env.PROTOTYPE_CLIP_SERVING = flag;
        const r = await raw("/clips/111/forward.mp4", "GET", { [name]: value });
        expect(r.status).toBe(403);
        expect(r.headers["content-type"]).toBe("application/problem+json");
        expect(lookups).toEqual([]);
        expect(r.body.toString()).not.toMatch(/127\.0\.0\.1|loopback|PROTOTYPE|\/tmp|rpg-clips/);
      });
    }
  }
  it("refuses duplicate headers, a proxy header mixed in among harmless ones, and the forms with two lines of the same name", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    for (const h of [
      { "X-Forwarded-For": ["1.2.3.4", "5.6.7.8"] }, { "X-Real-IP": ["1.2.3.4", "5.6.7.8"] }, { "CF-Connecting-IP": ["a", "b"] },
      { Accept: "*/*", "X-Client-IP": "1.2.3.4", "User-Agent": "x" }, { "x-real-ip": "1.1.1.1", "X-Real-Ip": "2.2.2.2" },
    ] as http.OutgoingHttpHeaders[]) {
      const r = await raw("/clips/111/forward.mp4", "GET", h);
      expect(r.status, JSON.stringify(h)).toBe(403);
      expect(lookups).toEqual([]);
    }
  });
  it("hasProxyHeader: matches case-insensitively, any name containing forwarded, and does not flag ordinary headers", () => {
    for (const n of ["x-real-ip", "X-Real-IP", "CF-Connecting-IP", "True-Client-IP", "X-Client-IP", "Forwarded-For", "Forwarded", "Via", "X-FoRwArDeD-Anything", "Tailscale-User", "TAILSCALE-X"]) {
      expect(hasProxyHeader({ [n]: "v" }), n).toBe(true);
    }
    expect(hasProxyHeader({ [`x-real-ip`]: "" })).toBe(true);
    for (const n of ["host", "accept", "range", "user-agent", "x-requested-with", "x-forward", "cf-ray", "connection", "x-client-version"]) {
      expect(hasProxyHeader({ [n]: "v" }), n).toBe(false);
    }
    expect(hasProxyHeader({})).toBe(false);
  });
  it("also refuses HEAD and malformed paths that carry such a header", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    expect((await raw("/clips/111/forward.mp4", "HEAD", { Via: "1.1 x" })).status).toBe(403);
    expect((await raw("/clips/../x", "GET", { "X-Forwarded-For": "1.2.3.4" })).status).toBe(403);
  });
  it("a request without those headers still works with the flag on", async () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    expect((await raw("/clips/111/forward.mp4")).status).toBe(200);
  });
});

describe("parseRange", () => {
  it("handles the edge cases", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-0", 100)).toEqual({ start: 0, end: 0 });
    expect(parseRange("bytes=99-", 100)).toEqual({ start: 99, end: 99 });
    expect(parseRange("bytes=-200", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=9007199254740993-", 100)).toBe("unsatisfiable");
  });
});
