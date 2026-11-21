// DEV-ONLY clip door: GET|HEAD /clips/<edge>/<direction>.mp4 for the app running on a simulator or emulator on the SAME machine.
// This is not a serving feature. Nothing is uploaded or published anywhere, and it does NOT change isClipServable (which stays
// false for every prototype clip, so no public path may serve them). It answers only when ALL hold, checked per request:
//   1. PROTOTYPE_CLIP_SERVING=1 (default off; any other value, or unset, makes every /clips/ path a plain 404),
//   2. the server socket is bound to loopback and the caller is on loopback,
//   3. the key is registered in the clips table (never a file-system lookup by caller-supplied name),
//   4. the clip's imagery sources are not disabled by the kill switch (IMAGERY_SOURCES_DISABLED).
import { createReadStream, promises as fsp } from "node:fs";
import type http from "node:http";
import path from "node:path";
import { isClipServable } from "../imagery/sources";

export const CLIP_SERVING_VAR = "PROTOTYPE_CLIP_SERVING";
/** Only an exact "1" turns the door on. */
export const clipServingEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env[CLIP_SERVING_VAR] === "1";

export interface ClipServeRecord { video_url: unknown; source_summary: unknown }
export interface ClipServing {
  /** Registered clip row for (edge_id, direction), or null. */
  lookup(edgeId: number, direction: string): Promise<ClipServeRecord | null>;
  clipsDir: string;
}

/** Kill switch check for the dev door. Deliberately NOT isClipServable(clip): that is false for prototype clips by design. Same fail-closed source check. */
export const clipSourcesAllowed = (rec: Pick<ClipServeRecord, "source_summary">, env: NodeJS.ProcessEnv = process.env): boolean =>
  isClipServable({ source_summary: rec.source_summary }, env);

const PATH_RE = /^\/clips\/([0-9]{1,15})\/([a-z]{1,16})\.mp4$/;
const KEY_RE = /^([0-9]{1,15})\/([a-z]{1,16})\.mp4$/;
const isLoopback = (a: string | undefined) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";

function problem(res: http.ServerResponse, status: number, title: string, detail?: string, extra: Record<string, string> = {}) {
  if (res.headersSent) return;
  const text = JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) });
  res.writeHead(status, { "content-type": "application/problem+json", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...extra });
  res.end(text);
}

export type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/** Single `bytes=` range only. null = no (or ignorable) Range header; "unsatisfiable" = 416 (also for multiple ranges and malformed specs). */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "unsatisfiable";
  const [, a, b] = m;
  if (a === "" && b === "") return "unsatisfiable";
  if (a === "") { // suffix: last N bytes
    const n = Number(b);
    if (!(n > 0) || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

/** Handles any request whose raw path starts with /clips. Never throws to the caller for expected refusals. */
export async function handleClipRequest(
  req: http.IncomingMessage, res: http.ServerResponse, server: http.Server, serving: ClipServing | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // 1. default off (also when no clip store is wired): indistinguishable from a path that does not exist
  if (!serving || !clipServingEnabled(env)) return problem(res, 404, "Not Found");
  // 2. loopback only
  const addr = server.address();
  const bound = addr && typeof addr === "object" ? addr.address : undefined;
  if (!isLoopback(bound) || !isLoopback(req.socket.remoteAddress)) {
    return problem(res, 403, "Forbidden", `clip serving works only on a loopback-bound server; ${CLIP_SERVING_VAR} is ignored otherwise`);
  }
  if (req.method !== "GET" && req.method !== "HEAD") return problem(res, 405, "Method Not Allowed", "use GET or HEAD", { allow: "GET, HEAD" });
  // The RAW path is checked, not the WHATWG-normalised one (which would silently resolve ".." segments).
  const raw = (req.url ?? "").split("?")[0]!.split("#")[0]!;
  const m = PATH_RE.exec(raw);
  if (!m) return problem(res, 400, "Invalid request", "clip path must be /clips/<edge_id>/<direction>.mp4");
  const edgeId = Number(m[1]), direction = m[2]!;
  if (!Number.isSafeInteger(edgeId)) return problem(res, 400, "Invalid request", "bad edge id");
  // 3. registered keys only
  let rec: ClipServeRecord | null;
  try { rec = await serving.lookup(edgeId, direction); } catch { return problem(res, 500, "Internal Server Error"); }
  const video = rec?.video_url;
  const key = typeof video === "string" && video.startsWith("local:") ? video.slice(6) : null;
  const km = key ? KEY_RE.exec(key) : null;
  if (!rec || !key || !km || Number(km[1]) !== edgeId || km[2] !== direction) return problem(res, 404, "Not Found", "no such registered clip");
  // 4. kill switch
  if (!clipSourcesAllowed(rec, env)) return problem(res, 403, "Forbidden", "the imagery source of this clip is disabled");
  // the file must be a regular file that really lives inside the clip cache (realpath, so a symlink cannot point out of it)
  let full: string, size: number;
  try {
    const base = await fsp.realpath(serving.clipsDir);
    full = await fsp.realpath(path.resolve(base, key));
    if (!full.startsWith(base + path.sep)) return problem(res, 404, "Not Found", "no such registered clip");
    const st = await fsp.stat(full);
    if (!st.isFile()) return problem(res, 404, "Not Found", "no such registered clip");
    size = st.size;
  } catch { return problem(res, 404, "Not Found", "clip file is not in the local cache"); }

  const headers: Record<string, string | number> = {
    "content-type": "video/mp4", "accept-ranges": "bytes", "x-prototype": "true", "cache-control": "no-store", "x-content-type-options": "nosniff",
  };
  const range = parseRange(req.headers.range, size);
  if (range === "unsatisfiable") { res.writeHead(416, { ...headers, "content-range": `bytes */${size}`, "content-length": 0 }); return void res.end(); }
  const [start, end, status] = range ? [range.start, range.end, 206] : [0, size - 1, 200];
  headers["content-length"] = size === 0 ? 0 : end - start + 1;
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  if (req.method === "HEAD" || size === 0) return void res.end();
  const stream = createReadStream(full, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
