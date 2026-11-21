// Offline preview bundle (Phase 5A): one local tar file holding the preview manifest, the READY clips and a reserved empty
// tiles section, for the app on a simulator or emulator. A bundle is a PROTOTYPE artefact and is not shareable: it is
// written to a gitignored local directory and returned as a path. Nothing is uploaded or served, and no endpoint renders.
//
// Layout of the tar:
//   bundle.json            envelope: versions, prototype/shareable flags, expiry, content hash, file list, attribution, tiles
//   preview.json           the preview manifest, verbatim (docs/api/preview-manifest.md)
//   clips/<edge>_<dir>.mp4 each ready clip
//   tiles/                 reserved, empty (PMTiles slices come later)
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { clipSourcesAllowed, type ClipServing } from "../clips/serve";
import { isSourceEnabled } from "../imagery/sources";
import type { PreviewBuilder, PreviewManifest, PreviewRequest } from "./build";

export const BUNDLE_VERSION = 1;
export const DEFAULT_BUNDLE_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_BUNDLE_TTL_DAYS = 7;

/** An expected refusal: carries the HTTP status and title the server answers with (RFC 9457 problem JSON). */
export class BundleError extends Error {
  constructor(readonly status: number, readonly title: string, message: string) { super(message); this.name = "BundleError"; }
}

export interface BundleOptions {
  clipsDir: string;
  /** Registered-clip lookup (the same store the dev clip door uses), for the kill-switch check on each clip's recorded sources. */
  clips: Pick<ClipServing, "lookup">;
  outDir: string;
  now?: Date;
  /** Hard cap on the size of the finished archive in bytes. Default 25 MB. */
  maxBytes?: number;
  /** Lifetime before the bundle expires. Default 7 days. */
  ttlDays?: number;
}

export interface BundleFile { path: string; bytes: number; sha256: string }
export interface BundleEnvelope {
  bundleVersion: typeof BUNDLE_VERSION;
  prototype: true;
  /** Always false: a prototype bundle must not be passed on or published. */
  shareable: false;
  createdAt: string;
  expiresAt: string;
  /** sha256 over the preview manifest and every clip (see contentHash). A client compares it to detect changed imagery. */
  contentHash: string;
  hashAlgorithm: "sha256";
  manifestVersion: number;
  files: BundleFile[];
  clips: { key: string; path: string }[];
  attribution: PreviewManifest["attribution"];
  requiresLogoAndLink: boolean;
  tiles: { reserved: true; files: [] };
  notice: string;
}
export interface BundleResult { file: string; sizeBytes: number; envelope: BundleEnvelope }

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** JSON with object keys sorted at every level, so the same data always hashes the same. */
export function canonicalJson(x: unknown): string {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, val]) => [k, norm(val)]))
    : v;
  return JSON.stringify(norm(x));
}

/** sha256 over the canonical manifest and, for each clip sorted by key, `key bytes sha256(clip)`. Excludes every timestamp.
 *  Stored in the bundle.json envelope, never in the manifest it covers (that would be circular). Spec for clients: docs/api/bundle-content-hash.md. */
export function contentHash(manifest: unknown, clips: readonly { key: string; bytes: number; sha256: string }[]): string {
  const lines = [...clips].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((c) => `${c.key} ${c.bytes} ${c.sha256}`);
  return sha256(["rpg-bundle-v1", canonicalJson(manifest), ...lines].join("\n"));
}

// --- minimal ustar writer (names up to 100 bytes; fixed mtime so the archive is reproducible) ---
const BLOCK = 512;
const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";
function tarEntry(name: string, data: Buffer | null, mtimeSec: number): Buffer[] {
  if (Buffer.byteLength(name) > 100) throw new BundleError(500, "Internal Server Error", `bundle path too long: ${name}`);
  const h = Buffer.alloc(BLOCK);
  const isDir = data === null;
  h.write(name, 0, "utf8");
  h.write(isDir ? "0000755\0" : "0000644\0", 100);
  h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(octal(isDir ? 0 : data.length, 12), 124);
  h.write(octal(mtimeSec, 12), 136);
  h.write("        ", 148); // checksum placeholder (8 spaces)
  h.write(isDir ? "5" : "0", 156);
  h.write("ustar\0", 257); h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  if (isDir) return [h];
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
  return [h, data, Buffer.alloc(pad)];
}
function tar(entries: { name: string; data: Buffer | null }[], mtimeSec: number): Buffer {
  return Buffer.concat([...entries.flatMap((e) => tarEntry(e.name, e.data, mtimeSec)), Buffer.alloc(BLOCK * 2)]);
}

const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;

export async function buildBundle(manifest: PreviewManifest, o: BundleOptions): Promise<BundleResult> {
  const now = o.now ?? new Date();
  const maxBytes = o.maxBytes ?? DEFAULT_BUNDLE_MAX_BYTES;
  const ttlDays = o.ttlDays ?? DEFAULT_BUNDLE_TTL_DAYS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive integer");
  if (!(ttlDays > 0) || !Number.isFinite(ttlDays)) throw new RangeError("ttlDays must be a positive number");

  // belt and braces: a manifest that names a disabled source is refused outright
  const disabledNamed = manifest.attribution.sources.filter((s) => !isSourceEnabled(s));
  if (disabledNamed.length) throw new BundleError(403, "Imagery source disabled", `refusing to bundle imagery from a disabled source: ${disabledNamed.join(", ")}`);

  const ready = manifest.segments.flatMap((s) => (s.clip ? [s.clip] : []));
  const base = await fsp.realpath(o.clipsDir);
  const found: { key: string; bundlePath: string; full: string; size: number }[] = [];
  for (const c of ready) {
    // every clip must be registered, must come only from enabled sources, and must sit inside the clip cache
    const rec = await o.clips.lookup(c.edge_id, c.direction);
    if (!rec || rec.video_url !== `local:${c.key}`) throw new BundleError(409, "Clip not registered", `clip ${c.key} is not registered`);
    if (!clipSourcesAllowed(rec)) throw new BundleError(403, "Imagery source disabled", `the imagery source of clip ${c.key} is disabled; refusing to bundle it`);
    let full: string, size: number;
    try {
      full = await fsp.realpath(path.resolve(base, c.key));
      if (!full.startsWith(base + path.sep)) throw new Error("outside cache");
      const st = await fsp.stat(full);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch { throw new BundleError(409, "Clip not cached", `clip ${c.key} is not in the local clip cache`); }
    found.push({ key: c.key, bundlePath: `clips/${c.key.replace("/", "_")}`, full, size });
  }
  // cheap pre-check before reading anything: the clips alone already exceed the cap
  const clipTotal = found.reduce((n, f) => n + f.size, 0);
  const tooLarge = (n: number) => new BundleError(413, "Bundle too large", `bundle would be ${mb(n)} (${n} bytes), over the ${mb(maxBytes)} cap (${maxBytes} bytes); raise BUNDLE_MAX_BYTES or preview a shorter route`);
  if (clipTotal > maxBytes) throw tooLarge(clipTotal);

  const clipData = await Promise.all(found.map(async (f) => ({ ...f, data: await fsp.readFile(f.full) })));
  const clipFiles = clipData.map((f) => ({ key: f.key, bytes: f.data.length, sha256: sha256(f.data) }));
  const hash = contentHash(manifest, clipFiles);
  const previewJson = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const files: BundleFile[] = [
    { path: "preview.json", bytes: previewJson.length, sha256: sha256(previewJson) },
    ...clipData.map((f, i) => ({ path: f.bundlePath, bytes: clipFiles[i]!.bytes, sha256: clipFiles[i]!.sha256 })),
  ];
  const envelope: BundleEnvelope = {
    bundleVersion: BUNDLE_VERSION, prototype: true, shareable: false,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlDays * 86_400_000).toISOString(),
    contentHash: hash, hashAlgorithm: "sha256", manifestVersion: manifest.manifestVersion, files,
    clips: clipData.map((f) => ({ key: f.key, path: f.bundlePath })),
    attribution: manifest.attribution, requiresLogoAndLink: manifest.attribution.requiresLogoAndLink,
    tiles: { reserved: true, files: [] },
    notice: "PROTOTYPE bundle for local development only. Not shareable: do not upload, publish or pass it on. Expired bundles must be discarded.",
  };
  const envelopeJson = Buffer.from(JSON.stringify(envelope, null, 2) + "\n");
  const archive = tar([
    { name: "bundle.json", data: envelopeJson }, { name: "preview.json", data: previewJson },
    ...clipData.map((f) => ({ name: f.bundlePath, data: f.data })), { name: "tiles/", data: null },
  ], Math.floor(now.getTime() / 1000));
  if (archive.length > maxBytes) throw tooLarge(archive.length);

  await fsp.mkdir(o.outDir, { recursive: true });
  const file = path.join(o.outDir, `${hash.slice(0, 16)}.rpgbundle.tar`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, archive, { mode: 0o600 });
  await fsp.rename(tmp, file);
  return { file, sizeBytes: archive.length, envelope };
}

/** POST /preview/bundle handler: build the manifest, then package it. */
export function createBundler(buildPreview: PreviewBuilder, o: BundleOptions) {
  return async (r: PreviewRequest, ctx: Parameters<PreviewBuilder>[1] = {}): Promise<BundleResult> => buildBundle(await buildPreview(r, ctx), o);
}
