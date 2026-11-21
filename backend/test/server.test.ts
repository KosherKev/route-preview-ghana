import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApproachServer, listenLoopback, parseApproachRequest, ValidationError, MAX_BODY_BYTES } from "../src/routing/server";
import { ArgumentError, type ApproachResult } from "../src/routing/approach";

const OK = { origin: { lat: 5.6361, lon: -0.175 }, destination: { lat: 5.5502, lon: -0.2174 }, costing: "auto" };
let calls: unknown[] = [];
let slow = false;
let failWith: Error | null = null;
let sawSignal: AbortSignal | undefined;
const logged: { message: string; status: number }[] = [];
const server = createApproachServer({
  deadlineMs: 200,
  onError: (e, i) => logged.push({ message: (e as Error).message, status: i.status }),
  extractor: async (c, o, d, opts) => {
    calls.push({ c, o, d, opts });
    sawSignal = opts.signal;
    if (failWith) throw failWith;
    if (slow) await new Promise((r) => setTimeout(r, 1000));
    return { costing: c, unpaved_fallback: false } as unknown as ApproachResult;
  },
});
let base = "";
beforeAll(async () => { await listenLoopback(server, 0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(() => new Promise<void>((r) => server.close(() => r())));
const post = (body: string, contentType = "application/json") => fetch(`${base}/approach`, { method: "POST", body, headers: contentType ? { "content-type": contentType } : {} });

describe("approach HTTP service", () => {
  it("binds loopback only", async () => {
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    expect(() => listenLoopback(createApproachServer(), 0, "0.0.0.0")).toThrow(/loopback only/);
  });
  it("serves /health and POST /approach", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    const r = await post(JSON.stringify({ ...OK, approach_length_m: 300 }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ costing: "auto", unpaved_fallback: false });
    expect(calls.at(-1)).toMatchObject({ c: "auto", opts: { approachLengthM: 300 } });
  });
  it("validates input", async () => {
    const bad = [
      "not json", "[]", JSON.stringify({ ...OK, costing: "bike" }), JSON.stringify({ ...OK, origin: { lat: "5", lon: 0 } }),
      JSON.stringify({ ...OK, destination: { lat: 51.5, lon: -0.1 } }), JSON.stringify({ ...OK, approach_length_m: 1e9 }),
      JSON.stringify({ ...OK, decision_window_m: -1 }), JSON.stringify({ ...OK, origin: null }),
    ];
    const n = calls.length;
    for (const b of bad) expect((await post(b)).status, b).toBe(400);
    expect(calls.length).toBe(n);
  });
  it("input errors are problem JSON with no internals: bad JSON, empty body, missing coordinates", async () => {
    const cases: [string, string][] = [
      ["not json", "body is not valid JSON"],
      ["", "body is not valid JSON"],
      [JSON.stringify({ costing: "auto" }), 'origin must be {"lat": number, "lon": number}'],
      [JSON.stringify({ ...OK, origin: {} }), 'origin must be {"lat": number, "lon": number}'],
    ];
    for (const [b, detail] of cases) {
      const r = await post(b);
      expect(r.status, b).toBe(400);
      expect(r.headers.get("content-type")).toBe("application/problem+json");
      const j = (await r.json()) as Record<string, unknown>;
      expect(Object.keys(j).sort(), b).toEqual(["detail", "status", "title", "type"]);
      expect(j).toMatchObject({ type: "about:blank", title: "Invalid request", status: 400 });
      expect(j.detail, b).toContain(detail);
      expect(JSON.stringify(j)).not.toMatch(/at \S+\.ts|node_modules|SyntaxError|Unexpected token|stack/);
    }
  });
  it("rejects oversized bodies, wrong methods and unknown paths", async () => {
    expect((await post("x".repeat(MAX_BODY_BYTES + 10))).status).toBe(413);
    expect((await fetch(`${base}/approach`)).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
  it("times out slow upstream work with 504", async () => {
    slow = true;
    expect((await post(JSON.stringify(OK))).status).toBe(504);
    slow = false;
  });
  it("requires Content-Type application/json (415 otherwise, extractor not called); charset parameter is fine", async () => {
    const n = calls.length;
    expect((await post(JSON.stringify(OK), "text/plain")).status).toBe(415);
    expect((await post(JSON.stringify(OK), "")).status).toBe(415);
    expect(calls.length).toBe(n);
    expect((await post(JSON.stringify(OK), "Application/JSON; charset=utf-8")).status).toBe(200);
  });
  it("413 closes the connection instead of draining the oversized body", async () => {
    const r = await post("x".repeat(MAX_BODY_BYTES * 50));
    expect(r.status).toBe(413);
    expect(r.headers.get("connection")).toBe("close");
    expect(await r.json()).toEqual({ type: "about:blank", title: "Payload Too Large", status: 413, detail: "body too large" });
  });
  it("returns generic client errors; details go only to the server-side log", async () => {
    logged.length = 0;
    failWith = new Error("Valhalla /trace_attributes -> HTTP 400: {\"error\":\"secret body\"} edge shape indices outside");
    const r = await post(JSON.stringify(OK));
    expect(r.status).toBe(502);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ type: "about:blank", title: "Bad Gateway", status: 502, detail: "upstream routing failure" });
    expect(r.headers.get("content-type")).toBe("application/problem+json");
    expect(text).not.toMatch(/Valhalla|shape|secret/);
    expect(logged).toEqual([{ message: expect.stringContaining("secret body"), status: 502 }]);
    failWith = null;
  });
  it("maps argument errors to 400, not 502", async () => {
    logged.length = 0;
    failWith = new ArgumentError("approachLengthM must be > 0");
    const r = await post(JSON.stringify(OK));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ type: "about:blank", title: "Invalid request", status: 400, detail: "invalid request" });
    expect(logged[0]!.status).toBe(400);
    failWith = null;
  });
  it("aborts the extractor's signal (and so the Valhalla fetches) when the deadline fires", async () => {
    slow = true;
    const r = await post(JSON.stringify(OK));
    expect(r.status).toBe(504);
    expect(await r.json()).toEqual({ type: "about:blank", title: "Gateway Timeout", status: 504, detail: "deadline exceeded" });
    expect(sawSignal?.aborted).toBe(true);
    slow = false;
  });
  it("parseApproachRequest throws ValidationError", () => {
    expect(() => parseApproachRequest(null)).toThrow(ValidationError);
    expect(parseApproachRequest(OK).costing).toBe("auto");
  });
});
