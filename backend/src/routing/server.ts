// Smallest possible HTTP surface for the approach extractor. Node's built-in http only; loopback only.
//   GET  /health
//   GET  /landmarks/search?q=..&near=lat,lon&limit=..   (only when a landmarkSearch function is supplied; errors are RFC 9457 problem JSON)
//   POST /approach  {"origin":{"lat":..,"lon":..},"destination":{..},"costing":"motor_scooter"|"auto",
//                    "approach_length_m"?: 50..5000, "decision_window_m"?: 10..500}
import http from "node:http";
import { ArgumentError, extractApproach, type ApproachOptions, type ApproachResult } from "./approach";
import type { Costing, LatLon } from "./valhalla";
import { parseSearchParams, SearchInputError, type LandmarkMatch, type SearchParams } from "../geo/landmarkSearch";

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

export type Extractor = (c: Costing, o: LatLon, d: LatLon, opts: ApproachOptions) => Promise<ApproachResult>;

export interface ServerOptions {
  extractor?: Extractor;
  extractOptions?: ApproachOptions;
  deadlineMs?: number;
  /** Enables GET /landmarks/search. Injected so the server itself holds no database connection. */
  landmarkSearch?: (p: SearchParams) => Promise<LandmarkMatch[]>;
  /** Receives full error details for every non-2xx outcome. Clients only ever see generic messages. Default: console.error (message only). */
  onError?: (err: unknown, info: { status: number; path: string }) => void;
}

/** Client-facing messages: never Valhalla response bodies or internal details. */
const GENERIC: Record<number, string> = {
  400: "invalid request", 413: "body too large", 415: 'content-type must be application/json', 502: "upstream routing failure", 504: "deadline exceeded",
};

function sendProblem(res: http.ServerResponse, status: number, title: string, detail?: string) {
  if (res.headersSent) return;
  const text = JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) });
  res.writeHead(status, { "content-type": "application/problem+json", "content-length": Buffer.byteLength(text) });
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
  const onError = opts.onError ?? ((e: unknown, i: { status: number; path: string }) => console.error(`[approach-server] ${i.status} ${i.path}: ${(e as Error)?.message ?? e}`));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
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
      if (url.pathname !== "/approach") return send(res, 404, { error: "not found" });
      if (req.method !== "POST") return send(res, 405, { error: "use POST" });
      const ct = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (ct !== "application/json") {
        req.resume(); // discard whatever the client sends; the body is never read
        return send(res, 415, { error: GENERIC[415] });
      }
      let parsed: unknown;
      try { parsed = JSON.parse(await readBody(req)); } catch (e) {
        if ((e as { status?: number }).status === 413) {
          // stop the client sending more: answer, close the connection, then destroy the request stream
          res.setHeader("connection", "close");
          res.once("finish", () => req.destroy());
          return send(res, 413, { error: GENERIC[413] });
        }
        return send(res, 400, { error: "body is not valid JSON" });
      }
      const r = parseApproachRequest(parsed);
      const ac = new AbortController();
      // abort() also cancels the in-flight Valhalla fetches (signal passed to the extractor)
      const timer = setTimeout(() => ac.abort(), deadline);
      try {
        const work = extractor(r.costing, r.origin, r.destination, {
          ...opts.extractOptions, signal: ac.signal, approachLengthM: r.approachLengthM, decisionWindowM: r.decisionWindowM,
        });
        const timeout = new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(Object.assign(new Error("deadline exceeded"), { status: 504 }))));
        work.catch(() => {}); // an aborted extractor rejects after the race is settled: do not leave it unhandled
        return send(res, 200, await Promise.race([work, timeout]));
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      // our own validation messages are safe to echo; everything else is logged server-side and answered generically
      if (e instanceof ValidationError) return send(res, 400, { error: e.message });
      if (e instanceof ArgumentError) { onError(e, { status: 400, path: url.pathname }); return send(res, 400, { error: GENERIC[400] }); }
      const status = (e as { status?: number }).status === 504 ? 504 : 502;
      onError(e, { status, path: url.pathname });
      return send(res, status, { error: GENERIC[status] });
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
