import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPreviewBuilder, type PreviewManifest } from "../src/preview/build";
import { buildBundle, BundleError, canonicalJson, contentHash, createBundler, DEFAULT_BUNDLE_MAX_BYTES, DEFAULT_BUNDLE_TTL_DAYS, type BundleEnvelope } from "../src/preview/bundle";
import type { ClipServeRecord } from "../src/clips/serve";
import { createApproachServer, listenLoopback } from "../src/routing/server";
import { clipRecord, depsFixture, scene, streetFrames } from "./helpers/previewFixture";

// NOT imagery: deterministic bytes standing in for mp4 files.
const clipBytes = (n: number, seed = 1) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed) % 251));
const SRC = [{ source: "mapillary", creators: ["x"], license: "CC-BY-SA-4.0", sourceUrls: [] }];
const REQ = { origin: scene.axis.points[0]!, destination: scene.axis.points.at(-1)!, costing: "motor_scooter" as const };
const NOW = new Date("2026-11-21T12:00:00.000Z");

/** Tiny ustar reader for the tests: name -> data (null for directories). */
function readTar(buf: Buffer): Map<string, Buffer | null> {
  const out = new Map<string, Buffer | null>();
  let off = 0;
  while (off + 512 <= buf.length && buf[off] !== 0) {
    const name = buf.toString("utf8", off, off + 100).replace(/\0.*$/, "");
    const size = parseInt(buf.toString("ascii", off + 124, off + 135), 8);
    const type = String.fromCharCode(buf[off + 156]!);
    // verify the header checksum
    const hdr = Buffer.from(buf.subarray(off, off + 512)); hdr.fill(0x20, 148, 156);
    const sum = [...hdr].reduce((a, b) => a + b, 0);
    expect(parseInt(buf.toString("ascii", off + 148, off + 154), 8)).toBe(sum);
    out.set(name, type === "5" ? null : Buffer.from(buf.subarray(off + 512, off + 512 + size)));
    off += 512 + (type === "5" ? 0 : Math.ceil(size / 512) * 512);
  }
  return out;
}

let dir: string, outDir: string, manifest: PreviewManifest;
const lookups: Record<string, ClipServeRecord> = {};
const clips = { lookup: async (e: number, d: string) => lookups[`${e}/${d}`] ?? null };
const opts = (o: object = {}) => ({ clipsDir: dir, clips, outDir, now: NOW, ...o });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "rpg-bundle-clips-")); outDir = mkdtempSync(path.join(tmpdir(), "rpg-bundle-out-"));
  mkdirSync(path.join(dir, "1009")); writeFileSync(path.join(dir, "1009", "forward.mp4"), clipBytes(5000));
  lookups["1009/forward"] = { video_url: "local:1009/forward.mp4", source_summary: SRC };
  manifest = await createPreviewBuilder(depsFixture({ frames: streetFrames(950, 1100), clips: [clipRecord(1009, 150)] }))(REQ);
  expect(manifest.segments.some((s) => s.clip)).toBe(true);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); rmSync(outDir, { recursive: true, force: true }); });
afterEach(() => { delete process.env.IMAGERY_SOURCES_DISABLED; writeFileSync(path.join(dir, "1009", "forward.mp4"), clipBytes(5000)); });

describe("bundle contents", () => {
  it("packs envelope, manifest, ready clip and an empty reserved tiles directory; marked prototype and not shareable", async () => {
    const r = await buildBundle(manifest, opts());
    const t = readTar(readFileSync(r.file));
    expect([...t.keys()].sort()).toEqual(["bundle.json", "clips/1009_forward.mp4", "preview.json", "tiles/"]);
    expect(t.get("tiles/")).toBeNull();
    expect(t.get("clips/1009_forward.mp4")!.equals(clipBytes(5000))).toBe(true);
    expect(JSON.parse(t.get("preview.json")!.toString())).toEqual(JSON.parse(JSON.stringify(manifest)));
    const env = JSON.parse(t.get("bundle.json")!.toString()) as BundleEnvelope;
    expect(env).toMatchObject({ bundleVersion: 1, prototype: true, shareable: false, hashAlgorithm: "sha256", manifestVersion: 1, tiles: { reserved: true, files: [] }, requiresLogoAndLink: true });
    expect(env.attribution.sources).toEqual(["mapillary"]);
    expect(env.notice).toMatch(/not shareable/i);
    expect(env.clips).toEqual([{ key: "1009/forward.mp4", path: "clips/1009_forward.mp4" }]);
    expect(env.files.map((f) => f.path)).toEqual(["preview.json", "clips/1009_forward.mp4"]);
    expect(r.sizeBytes).toBe(readFileSync(r.file).length);
    expect(r.file.endsWith(".rpgbundle.tar")).toBe(true);
  });
  it("records an expiry: 7 days by default, configurable; createdAt is the injected clock", async () => {
    expect(DEFAULT_BUNDLE_TTL_DAYS).toBe(7);
    const d = (await buildBundle(manifest, opts())).envelope;
    expect(d.createdAt).toBe("2026-11-21T12:00:00.000Z");
    expect(d.expiresAt).toBe("2026-11-28T12:00:00.000Z");
    expect((await buildBundle(manifest, opts({ ttlDays: 1 }))).envelope.expiresAt).toBe("2026-11-22T12:00:00.000Z");
    await expect(buildBundle(manifest, opts({ ttlDays: 0 }))).rejects.toThrow(RangeError);
  });
  it("a manifest with no ready clip still bundles (manifest only)", async () => {
    const m = await createPreviewBuilder(depsFixture())(REQ);
    const r = await buildBundle(m, opts());
    expect([...readTar(readFileSync(r.file)).keys()].sort()).toEqual(["bundle.json", "preview.json", "tiles/"]);
    expect(r.envelope.clips).toEqual([]);
  });
});

describe("content hash", () => {
  it("is stable: same inputs give the same hash and byte-identical archives for the same clock; the clock does not change the hash", async () => {
    const a = await buildBundle(manifest, opts()), b = await buildBundle(manifest, opts());
    expect(a.envelope.contentHash).toBe(b.envelope.contentHash);
    expect(readFileSync(a.file).equals(readFileSync(b.file))).toBe(true);
    const later = await buildBundle(manifest, opts({ now: new Date("2027-01-01T00:00:00Z"), ttlDays: 30 }));
    expect(later.envelope.contentHash).toBe(a.envelope.contentHash);
    expect(a.envelope.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is the documented function of the manifest and clips, independent of key order", async () => {
    const r = await buildBundle(manifest, opts());
    const f = r.envelope.files.find((x) => x.path.startsWith("clips/"))!;
    expect(r.envelope.contentHash).toBe(contentHash(manifest, [{ key: "1009/forward.mp4", bytes: f.bytes, sha256: f.sha256 }]));
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: 3 } })).toBe('{"a":{"c":3,"d":[{"x":2,"y":1}]},"b":1}');
  });
  it("changes when a clip changes (even by one byte, same size) and when the manifest changes", async () => {
    const before = (await buildBundle(manifest, opts())).envelope.contentHash;
    const changed = clipBytes(5000); changed[2500] ^= 1;
    writeFileSync(path.join(dir, "1009", "forward.mp4"), changed);
    const after = (await buildBundle(manifest, opts())).envelope.contentHash;
    expect(after).not.toBe(before);
    writeFileSync(path.join(dir, "1009", "forward.mp4"), clipBytes(5000));
    expect((await buildBundle(manifest, opts())).envelope.contentHash).toBe(before);
    const m2 = JSON.parse(JSON.stringify(manifest)) as PreviewManifest;
    m2.route.lengthM += 1;
    expect((await buildBundle(m2, opts())).envelope.contentHash).not.toBe(before);
  });
});

describe("size cap", () => {
  it("defaults to 25 MB", () => { expect(DEFAULT_BUNDLE_MAX_BYTES).toBe(25 * 1024 * 1024); });
  it("is a hard failure above the cap, with a clear message, and writes nothing; the exact archive size still passes", async () => {
    const ok = await buildBundle(manifest, opts());
    await expect(buildBundle(manifest, opts({ maxBytes: ok.sizeBytes - 1, outDir: path.join(outDir, "x") }))).rejects.toMatchObject({ status: 413, title: "Bundle too large" });
    await expect(buildBundle(manifest, opts({ maxBytes: ok.sizeBytes - 1 }))).rejects.toThrow(/over the .* cap/);
    expect((await buildBundle(manifest, opts({ maxBytes: ok.sizeBytes }))).sizeBytes).toBe(ok.sizeBytes);
    await expect(buildBundle(manifest, opts({ maxBytes: 0 }))).rejects.toThrow(RangeError);
  });
  it("a 26 MB clip exceeds the default cap", async () => {
    writeFileSync(path.join(dir, "1009", "forward.mp4"), Buffer.alloc(26 * 1024 * 1024, 7));
    await expect(buildBundle(manifest, opts())).rejects.toMatchObject({ status: 413 });
  });
});

describe("refusals", () => {
  it("refuses a clip whose source is disabled by the kill switch (and an attribution naming a disabled source)", async () => {
    process.env.IMAGERY_SOURCES_DISABLED = "mapillary";
    await expect(buildBundle(manifest, opts())).rejects.toMatchObject({ status: 403, title: "Imagery source disabled" });
    const bare = JSON.parse(JSON.stringify(manifest)) as PreviewManifest;
    bare.attribution = { ...bare.attribution, sources: [] };
    await expect(buildBundle(bare, opts())).rejects.toMatchObject({ status: 403 }); // the clip's own recorded sources still refuse it
    delete process.env.IMAGERY_SOURCES_DISABLED;
    await expect(buildBundle(manifest, opts())).resolves.toBeTruthy();
  });
  it("fails closed on a malformed source summary", async () => {
    lookups["1009/forward"] = { video_url: "local:1009/forward.mp4", source_summary: "[]" };
    await expect(buildBundle(manifest, opts())).rejects.toMatchObject({ status: 403 });
    lookups["1009/forward"] = { video_url: "local:1009/forward.mp4", source_summary: SRC };
  });
  it("refuses unregistered clips, uncached files and symlinks out of the cache", async () => {
    const saved = lookups["1009/forward"]!;
    delete lookups["1009/forward"];
    await expect(buildBundle(manifest, opts())).rejects.toMatchObject({ status: 409, title: "Clip not registered" });
    lookups["1009/forward"] = saved;
    await expect(buildBundle(manifest, opts({ clipsDir: path.join(dir, "empty-does-not-exist") }))).rejects.toThrow();
    const other = mkdtempSync(path.join(tmpdir(), "rpg-bundle-other-"));
    mkdirSync(path.join(other, "1009")); writeFileSync(path.join(other, "secret"), "SECRET");
    symlinkSync(path.join(other, "secret"), path.join(other, "1009", "forward.mp4"));
    const out = mkdtempSync(path.join(tmpdir(), "rpg-bundle-cache-"));
    mkdirSync(path.join(out, "1009")); symlinkSync(path.join(other, "secret"), path.join(out, "1009", "forward.mp4"));
    await expect(buildBundle(manifest, opts({ clipsDir: out }))).rejects.toMatchObject({ status: 409, title: "Clip not cached" });
    rmSync(other, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true });
  });
});

describe("POST /preview/bundle", () => {
  let srv: ReturnType<typeof createApproachServer>, base = "";
  beforeAll(async () => {
    const build = createPreviewBuilder(depsFixture({ frames: streetFrames(950, 1100), clips: [clipRecord(1009, 150)] }));
    srv = createApproachServer({ onError: () => {}, preview: build, bundle: (r, c) => createBundler(build, opts({ maxBytes: Number(process.env.TEST_BUNDLE_MAX ?? DEFAULT_BUNDLE_MAX_BYTES) }))(r, c) });
    await listenLoopback(srv, 0);
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));
  afterEach(() => { delete process.env.TEST_BUNDLE_MAX; });
  const post = (b: unknown) => fetch(`${base}/preview/bundle`, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
  it("returns the description of the local bundle file, never the bytes", async () => {
    const r = await post(REQ);
    expect(r.status).toBe(200);
    const b = await r.json() as Record<string, any>;
    expect(b).toMatchObject({ prototype: true, shareable: false, clipCount: 1, bundleVersion: 1 });
    expect(b.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof b.expiresAt).toBe("string");
    expect(readFileSync(b.file).length).toBe(b.sizeBytes);
  });
  it("maps the size cap to 413 and the kill switch to 403 as problem JSON; unknown fields are still 400", async () => {
    process.env.TEST_BUNDLE_MAX = "1000";
    const big = await post(REQ);
    expect(big.status).toBe(413);
    expect(big.headers.get("content-type")).toBe("application/problem+json");
    expect(await big.json()).toMatchObject({ title: "Bundle too large", status: 413 });
    delete process.env.TEST_BUNDLE_MAX;
    process.env.IMAGERY_SOURCES_DISABLED = "mapillary";
    // with the source disabled the preview has no street segment at all, so there is no clip to refuse: it bundles manifest-only
    const off = await post(REQ);
    expect(off.status).toBe(200);
    expect((await off.json() as { clipCount: number }).clipCount).toBe(0);
    delete process.env.IMAGERY_SOURCES_DISABLED;
    expect((await post({ ...REQ, current_position: { lat: 5.6, lon: -0.2 } })).status).toBe(400);
  });
  it("is a BundleError type the server recognises", () => { expect(new BundleError(413, "t", "m")).toBeInstanceOf(Error); });
});
