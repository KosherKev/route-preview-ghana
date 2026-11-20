// Smallest possible HTTP surface for the approach extractor. Node's built-in http only; loopback only.
//   GET  /health
//   POST /approach  {"origin":{"lat":..,"lon":..},"destination":{..},"costing":"motor_scooter"|"auto",
//                    "approach_length_m"?: 50..5000, "decision_window_m"?: 10..500}
import http from "node:http";
import { extractApproach, type ApproachOptions, type ApproachResult } from "./approach";
import type { Costing, LatLon } from "./valhalla";

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
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
      if (url.pathname !== "/approach") return send(res, 404, { error: "not found" });
      if (req.method !== "POST") return send(res, 405, { error: "use POST" });
      let parsed: unknown;
      try { parsed = JSON.parse(await readBody(req)); } catch (e) {
        if ((e as { status?: number }).status === 413) return send(res, 413, { error: "body too large" });
        return send(res, 400, { error: "body is not valid JSON" });
      }
      const r = parseApproachRequest(parsed);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), deadline);
      try {
        const work = extractor(r.costing, r.origin, r.destination, {
          ...opts.extractOptions, approachLengthM: r.approachLengthM, decisionWindowM: r.decisionWindowM,
        });
        const timeout = new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(Object.assign(new Error("deadline exceeded"), { status: 504 }))));
        return send(res, 200, await Promise.race([work, timeout]));
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (e instanceof ValidationError) return send(res, 400, { error: e.message });
      const status = (e as { status?: number }).status === 504 ? 504 : 502;
      // Valhalla failures (including "no path") are upstream problems, not client crashes; message carries no secrets.
      return send(res, status, { error: (e as Error).message });
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
