// Smallest possible HTTP surface for the approach extractor. Node's built-in http only; loopback only.
//   GET  /health
//   GET  /landmarks/search?q=..&near=lat,lon&limit=..   (only when a landmarkSearch function is supplied; errors are RFC 9457 problem JSON)
//   GET  /geocode?q=..&near=lat,lon&limit=..   (only when a geocode function is supplied; same validation and problem JSON; Photon trouble => degraded:true, never 5xx)
//   GET|HEAD /clips/<edge_id>/<direction>.mp4  (DEV ONLY: 404 unless PROTOTYPE_CLIP_SERVING=1 and loopback-bound; see src/clips/serve.ts)
//   POST /preview/bundle  (only when a bundler is supplied; writes a local prototype bundle file, returns its description; nothing is served or uploaded)
//   POST /preview  (only when a preview builder is supplied; same input rules, disambiguation and problem JSON as /approach; see docs/api/preview-manifest.md)
//   POST /approach  (every error is RFC 9457 problem JSON: type, title, status, detail; a 422 adds field, query, degraded, candidates)  {"origin":{"lat":..,"lon":..} | "origin_query":"place name","destination":{..} | "destination_query":"..","costing":"motor_scooter"|"auto",
//                    "approach_length_m"?: 50..5000, "decision_window_m"?: 10..500}
import http from "node:http";
import { ArgumentError, extractApproach, type ApproachOptions, type ApproachResult } from "./approach";
import type { Costing, LatLon } from "./valhalla";
import { parseSearchParams, SearchInputError, type LandmarkMatch, type SearchParams } from "../geo/landmarkSearch";
import type { Candidate, GeocodeFn } from "../geo/geocode";
import { DEFAULT_DISAMBIGUATION_MARGIN, resolvePlace } from "./resolve";
import { BundleError, type BundleResult } from "../preview/bundle";
import { handleClipRequest, type ClipServing } from "../clips/serve";
import type { NamedEnd, PreviewBuilder, PreviewRequest } from "../preview/build";

export const MAX_BODY_BYTES = 4096;
export const REQUEST_DEADLINE_MS = 60_000;
/** Rough Ghana bounding box: the local Valhalla tiles only cover Ghana, so anything outside is rejected up front. */
export const GHANA_BOUNDS = { minLat: 4.5, maxLat: 11.5, minLon: -3.5, maxLon: 1.5 };

export interface ApproachRequest {
  origin: LatLon; destination: LatLon; costing: Costing; approachLengthM?: number; decisionWindowM?: number;
}

export class ValidationError extends Error {}

function point(v: unknown, name: string): LatLon {
  const o = v as { lat?: unknown; lon?: unknown } | null;
  if (!o || typeof o !== "object" || typeof o.lat !== "number" || typeof o.lon !== "number" || !Number.isFinite(o.lat) || !Number.isFinite(o.lon)) {
    throw new ValidationError(`${name} must be {"lat": number, "lon": number}`);
  }
  const b = GHANA_BOUNDS;
  if (o.lat < b.minLat || o.lat > b.maxLat || o.lon < b.minLon || o.lon > b.maxLon) {
    throw new ValidationError(`${name} is outside Ghana (lat ${b.minLat}..${b.maxLat}, lon ${b.minLon}..${b.maxLon})`);
  }
  return { lat: o.lat, lon: o.lon };
}

function ranged(v: unknown, name: string, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new ValidationError(`${name} must be a number between ${min} and ${max}`);
  return v;
}

export function parseApproachRequest(body: unknown): ApproachRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("body must be a JSON object");
  const b = body as Record<string, unknown>;
  if (b.costing !== "motor_scooter" && b.costing !== "auto") throw new ValidationError('costing must be "motor_scooter" or "auto"');
  return {
    origin: point(b.origin, "origin"),
    destination: point(b.destination, "destination"),
    costing: b.costing,
    approachLengthM: ranged(b.approach_length_m, "approach_length_m", 50, 5000),
    decisionWindowM: ranged(b.decision_window_m, "decision_window_m", 10, 500),
  };
}

/** The only body fields POST /preview accepts. Anything else is a 400: there is deliberately no field for any live or device position. */
export const PREVIEW_REQUEST_FIELDS = [
  "origin", "destination", "origin_query", "destination_query", "costing",
  "approach_length_m", "decision_window_m", "landmark_max_distance_m", "landmark_max_per_100m",
] as const;

function parsePreviewFields(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return; // reported by the normal parser
  const allowed: readonly string[] = PREVIEW_REQUEST_FIELDS;
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) throw new ValidationError(`unknown field ${JSON.stringify(k.slice(0, 40))}`);
  }
}

export function parsePreviewRequest(body: unknown): PreviewRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("body must be a JSON object");
  const b = body as Record<string, unknown>;
  parsePreviewFields(b);
  const base = parseApproachRequest(b);
  const per100 = ranged(b.landmark_max_per_100m, "landmark_max_per_100m", 1, 10);
  if (per100 !== undefined && !Number.isInteger(per100)) throw new ValidationError("landmark_max_per_100m must be an integer between 1 and 10");
  return { ...base, landmarkMaxDistanceM: ranged(b.landmark_max_distance_m, "landmark_max_distance_m", 5, 200), landmarkMaxPer100m: per100 };
}

const publicCandidate = (c: Candidate) => ({ name: c.name, lat: c.lat, lon: c.lon, source: c.source, score: c.score });

/** Thrown when a typed place cannot be resolved to one point; carries a problem+json body with the candidate list. */
class Unresolved extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super("unresolved place"); }
}

/** Replaces origin_query / destination_query in the body with a resolved point; returns what was used for each. */
async function resolveQueries(
  body: unknown, geocode: GeocodeFn | undefined, margin: number,
): Promise<{ body: unknown; resolved: Record<string, unknown> }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { body, resolved: {} };
  const b = { ...(body as Record<string, unknown>) };
  const resolved: Record<string, unknown> = {};
  for (const end of ["origin", "destination"] as const) {
    const key = `${end}_query`;
    if (b[key] === undefined) continue;
    if (b[end] !== undefined) throw new ValidationError(`give either ${end} or ${key}, not both`);
    if (typeof b[key] !== "string") throw new ValidationError(`${key} must be a string`);
    if (!geocode) throw new ValidationError(`${key} is not available: name lookup is not enabled on this server`);
    let q: string;
    try { q = parseSearchParams(new URLSearchParams({ q: b[key] as string })).q; } catch (e) {
      if (e instanceof SearchInputError) throw new ValidationError(`${key}: ${e.message}`);
      throw e;
    }
    const r = await resolvePlace(geocode, q, margin);
    if (!r.ok) {
      const title = r.reason === "ambiguous" ? "Ambiguous place" : r.reason === "low_confidence" ? "No confident match" : "Place not found";
      const detail = r.reason === "ambiguous" ? `"${q}" matches several different places; choose one and send its coordinates as ${end}`
        : r.reason === "low_confidence" ? `no candidate for "${q}" is confident enough to use; choose one and send its coordinates as ${end}`
        : `nothing found for "${q}"`;
      throw new Unresolved(422, { type: "about:blank", title, status: 422, detail, field: key, query: q, degraded: r.degraded, candidates: r.candidates.map(publicCandidate) });
    }
    b[end] = { lat: r.candidate.lat, lon: r.candidate.lon };
    delete b[key];
    resolved[end] = { query: q, ...publicCandidate(r.candidate), degraded: r.degraded };
  }
  return { body: b, resolved };
}

export type Extractor = (c: Costing, o: LatLon, d: LatLon, opts: ApproachOptions) => Promise<ApproachResult>;

export interface ServerOptions {
  extractor?: Extractor;
  extractOptions?: ApproachOptions;
  deadlineMs?: number;
  /** Enables GET /landmarks/search. Injected so the server itself holds no database connection. */
  landmarkSearch?: (p: SearchParams) => Promise<LandmarkMatch[]>;
  /** Enables GET /geocode (coordinates, landmarks, then Photon). Injected like landmarkSearch. */
  geocode?: GeocodeFn;
  /** Enables POST /preview. Injected like the others so the server holds no database connection. */
  preview?: PreviewBuilder;
  /** Dev-only clip door (GET|HEAD /clips/<edge>/<direction>.mp4). Needs PROTOTYPE_CLIP_SERVING=1 AND a loopback-bound server; see src/clips/serve.ts. */
  clipServing?: ClipServing;
  /** Enables POST /preview/bundle (same body as /preview): builds the preview, packages the offline bundle into a local gitignored file and returns its description. */
  bundle?: (r: PreviewRequest, ctx: { signal?: AbortSignal; resolved?: Record<string, NamedEnd>; degraded?: boolean }) => Promise<BundleResult>;
  /** Name-based routing: top two candidates with scores closer than this (and > 500 m apart) are returned for disambiguation. Default 0.05. */
  disambiguationMargin?: number;
  /** Receives full error details for every non-2xx outcome. Clients only ever see generic messages. Default: console.error (message only). */
  onError?: (err: unknown, info: { status: number; path: string }) => void;
}

/** Client-facing messages: never Valhalla response bodies or internal details. */
const GENERIC: Record<number, string> = {
  400: "invalid request", 413: "body too large", 415: 'content-type must be application/json', 502: "upstream routing failure", 504: "deadline exceeded",
};
const TITLES: Record<number, string> = {
  400: "Invalid request", 404: "Not Found", 405: "Method Not Allowed", 413: "Payload Too Large", 415: "Unsupported Media Type",
  502: "Bad Gateway", 504: "Gateway Timeout",
};

function sendProblem(res: http.ServerResponse, status: number, title: string, detail?: string) {
  if (res.headersSent) return;
  const text = JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) });
  res.writeHead(status, { "content-type": "application/problem+json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function sendProblem422(res: http.ServerResponse, body: Record<string, unknown>) {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(422, { "content-type": "application/problem+json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function send(res: http.ServerResponse, status: number, obj: unknown) {
  if (res.headersSent) return;
  const text = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createApproachServer(opts: ServerOptions = {}): http.Server {
  const extractor = opts.extractor ?? extractApproach;
  const deadline = opts.deadlineMs ?? REQUEST_DEADLINE_MS;
  const margin = opts.disambiguationMargin ?? DEFAULT_DISAMBIGUATION_MARGIN;
  if (!Number.isFinite(margin) || margin < 0 || margin > 1) throw new Error("disambiguationMargin must be a number between 0 and 1");
  const onError = opts.onError ?? ((e: unknown, i: { status: number; path: string }) => console.error(`[approach-server] ${i.status} ${i.path}: ${(e as Error)?.message ?? e}`));
  const server: http.Server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // the raw request path is inspected (the URL parser above would normalise "/clips/../x" away)
      if ((req.url ?? "").split("?")[0]!.startsWith("/clips")) return await handleClipRequest(req, res, server, opts.clipServing);
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
      if (url.pathname === "/landmarks/search" && opts.landmarkSearch) {
        if (req.method !== "GET") return sendProblem(res, 405, "Method Not Allowed", "use GET");
        let params: SearchParams;
        try { params = parseSearchParams(url.searchParams); } catch (e) {
          if (e instanceof SearchInputError) return sendProblem(res, 400, "Invalid request", e.message);
          throw e;
        }
        try {
          return send(res, 200, { query: params.q, results: await opts.landmarkSearch(params) });
        } catch (e) {
          onError(e, { status: 500, path: url.pathname });
          return sendProblem(res, 500, "Internal Server Error");
        }
      }
      if (url.pathname === "/geocode" && opts.geocode) {
        if (req.method !== "GET") return sendProblem(res, 405, "Method Not Allowed", "use GET");
        let params: SearchParams;
        try { params = parseSearchParams(url.searchParams); } catch (e) {
          if (e instanceof SearchInputError) return sendProblem(res, 400, "Invalid request", e.message);
          throw e;
        }
        try {
          const g = await opts.geocode(params);
          return send(res, 200, {
            query: g.query, degraded: g.degraded,
            candidates: g.candidates.map(({ distance_m, ...c }) => (params.near ? { ...c, distance_m } : c)),
          });
        } catch (e) {
          onError(e, { status: 500, path: url.pathname });
          return sendProblem(res, 500, "Internal Server Error");
        }
      }
      const isBundle = url.pathname === "/preview/bundle" && !!opts.bundle;
      const isPreview = (url.pathname === "/preview" && !!opts.preview) || isBundle;
      if (url.pathname !== "/approach" && !isPreview) return sendProblem(res, 404, TITLES[404]!);
      if (req.method !== "POST") return sendProblem(res, 405, TITLES[405]!, "use POST");
      const ct = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (ct !== "application/json") {
        req.resume(); // discard whatever the client sends; the body is never read
        return sendProblem(res, 415, TITLES[415]!, GENERIC[415]);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(await readBody(req)); } catch (e) {
        if ((e as { status?: number }).status === 413) {
          // stop the client sending more: answer, close the connection, then destroy the request stream
          res.setHeader("connection", "close");
          res.once("finish", () => req.destroy());
          return sendProblem(res, 413, TITLES[413]!, GENERIC[413]);
        }
        return sendProblem(res, 400, TITLES[400]!, "body is not valid JSON");
      }
      if (isPreview) {
        // unknown fields are refused before any name lookup, so a stray field can never be silently ignored
        parsePreviewFields(parsed);
      }
      const named = await resolveQueries(parsed, opts.geocode, margin);
      const ac = new AbortController();
      // abort() also cancels the in-flight Valhalla fetches (signal passed to the extractor)
      const timer = setTimeout(() => ac.abort(), deadline);
      const race = async <T>(work: Promise<T>): Promise<T> => {
        const timeout = new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(Object.assign(new Error("deadline exceeded"), { status: 504 }))));
        work.catch(() => {}); // an aborted worker rejects after the race is settled: do not leave it unhandled
        return Promise.race([work, timeout]);
      };
      try {
        if (isPreview) {
          const r = parsePreviewRequest(named.body);
          const resolved = named.resolved as Record<string, NamedEnd>;
          const degraded = Object.values(resolved).some((v) => v.degraded === true);
          if (isBundle) {
            const b = await race(opts.bundle!(r, { signal: ac.signal, resolved, degraded }));
            const { clips, files, attribution: _a, ...env } = b.envelope;
            void _a;
            return send(res, 200, { file: b.file, sizeBytes: b.sizeBytes, ...env, clipCount: clips.length, files });
          }
          return send(res, 200, await race(opts.preview!(r, { signal: ac.signal, resolved, degraded })));
        }
        const r = parseApproachRequest(named.body);
        const result = await race(extractor(r.costing, r.origin, r.destination, {
          ...opts.extractOptions, signal: ac.signal, approachLengthM: r.approachLengthM, decisionWindowM: r.decisionWindowM,
        }));
        return send(res, 200, Object.keys(named.resolved).length > 0 ? { ...result, resolved: named.resolved } : result);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      // our own validation messages are safe to echo; everything else is logged server-side and answered generically
      if (e instanceof Unresolved) return sendProblem422(res, e.body);
      if (e instanceof BundleError) { if (e.status >= 500) onError(e, { status: e.status, path: url.pathname }); return sendProblem(res, e.status, e.title, e.status >= 500 ? undefined : e.message); }
      if (e instanceof ValidationError) return sendProblem(res, 400, TITLES[400]!, e.message);
      if (e instanceof ArgumentError) { onError(e, { status: 400, path: url.pathname }); return sendProblem(res, 400, TITLES[400]!, GENERIC[400]); }
      const status = (e as { status?: number }).status === 504 ? 504 : 502;
      onError(e, { status, path: url.pathname });
      return sendProblem(res, status, TITLES[status]!, GENERIC[status]);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

/** Loopback only: refuse to bind anything else. */
export function listenLoopback(server: http.Server, port: number, host = "127.0.0.1"): Promise<void> {
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") throw new Error(`refusing to bind ${host}: loopback only`);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}
