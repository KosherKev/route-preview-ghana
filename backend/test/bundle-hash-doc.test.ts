// Verifies docs/api/bundle-content-hash.md. The verifier below is written from that document and deliberately imports NOTHING
// from the production hash code: it only uses node:crypto and reads the finished tar, as a client importing a bundle would.
// All bytes are invented (no clips, no imagery, no Mapillary-derived data).
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { PreviewManifest } from "../src/preview/build";
import { buildBundle } from "../src/preview/bundle";

const SYNTHETIC_MANIFEST = {
  segments: [
    { clip: { edge_id: 2, direction: "backward", key: "2/backward.mp4" } },
    { clip: { edge_id: 1, direction: "forward", key: "1/forward.mp4" } },
  ],
  manifestVersion: 1,
  attribution: { sources: ["synthetic"], requiresLogoAndLink: true },
  prototype: true,
  note: "café",
} as unknown as PreviewManifest;
const CLIP_1 = Buffer.from("synthetic clip one"); // not video
const CLIP_2 = Buffer.from("synthetic clip two, a bit longer"); // not video

// --- independent implementation of the documented algorithm ---
const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
function documentedHash(manifest: unknown, clips: { key: string; data: Buffer }[]): string {
  const lines = [...clips].sort((a, b) => (a.key < b.key ? -1 : 1)).map((c) => `${c.key} ${c.data.length} ${hex(c.data)}`);
  return hex(["rpg-bundle-v1", canonical(manifest), ...lines].join("\n"));
}
/** Sequential ustar read: name -> bytes. */
function untar(buf: Buffer): Map<string, Buffer> {
  const m = new Map<string, Buffer>();
  for (let off = 0; buf[off] !== 0; ) {
    const name = buf.toString("utf8", off, off + 100).replace(/\0.*$/, "");
    const size = parseInt(buf.toString("ascii", off + 124, off + 135), 8);
    if (buf[off + 156] !== 0x35) m.set(name, buf.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return m;
}

const tmp: string[] = [];
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

describe("documented content hash (docs/api/bundle-content-hash.md)", () => {
  it("a client following the document reproduces the builder's contentHash from bundle.json, preview.json and the clips", async () => {
    const clipsDir = mkdtempSync(path.join(tmpdir(), "rpg-hashdoc-clips-")); const outDir = mkdtempSync(path.join(tmpdir(), "rpg-hashdoc-out-"));
    tmp.push(clipsDir, outDir);
    mkdirSync(path.join(clipsDir, "1")); mkdirSync(path.join(clipsDir, "2"));
    writeFileSync(path.join(clipsDir, "1", "forward.mp4"), CLIP_1); writeFileSync(path.join(clipsDir, "2", "backward.mp4"), CLIP_2);
    const rec = (k: string) => ({ video_url: `local:${k}`, source_summary: [{ source: "synthetic", creators: [], license: "none", sourceUrls: [] }] });
    const clips = { lookup: async (e: number, d: string) => rec(`${e}/${d}.mp4`) };
    const r = await buildBundle(SYNTHETIC_MANIFEST, { clipsDir, clips, outDir, now: new Date("2026-11-21T12:00:00.000Z") });

    // client side: open the tar, read the envelope, then recompute from the files alone
    const t = untar(readFileSync(r.file));
    const envelope = JSON.parse(t.get("bundle.json")!.toString("utf8"));
    const manifest = JSON.parse(t.get("preview.json")!.toString("utf8")); // parsed, not hashed as raw bytes
    expect(manifest).not.toHaveProperty("contentHash"); // the hash is in the envelope, not the manifest
    expect(envelope.hashAlgorithm).toBe("sha256");
    const files = envelope.clips.map((c: { key: string; path: string }) => ({ key: c.key, data: Buffer.from(t.get(c.path)!) }));
    expect(files).toHaveLength(2);

    expect(documentedHash(manifest, files)).toBe(envelope.contentHash);
    // pinned worked-example value from the document
    expect(envelope.contentHash).toBe("ea88eabd2d678e39d37ebfc2e658b08f1d35960883ff63005b95d27cb9da5446");
  });
});
