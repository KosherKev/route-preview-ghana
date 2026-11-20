// Hardened client for the self-hosted Photon geocoder (docker compose --profile geocoder).
// Loopback only, fixed origin, no redirects, bounded time/size/shape. Throws PhotonError on any problem;
// callers treat that as "Photon unavailable", never as "no results".

export const SELF_HOSTED_PHOTON_URL = "http://127.0.0.1:2322";
export const PHOTON_TIMEOUT_MS = 3000;
export const PHOTON_PROBE_TIMEOUT_MS = 500;
export const PHOTON_PROBE_TTL_MS = 10_000;
export const PHOTON_MAX_BODY_BYTES = 256 * 1024;
export const PHOTON_MAX_FEATURES = 20;
const MAX_FIELD_CHARS = 200;

export class PhotonError extends Error {}

export interface PhotonPlace { name: string; label: string; lat: number; lon: number }

/** True only for loopback hosts: the self-hosted geocoder must never be a public server. */
export function isLoopbackUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

export interface SearchOpts { limit?: number; near?: { lat: number; lon: number }; signal?: AbortSignal }

export interface PhotonClient {
  readonly name: "photon-local";
  search(q: string, opts?: SearchOpts): Promise<PhotonPlace[]>;
  /** Cheap reachability check, cached for PHOTON_PROBE_TTL_MS. Never throws. */
  available(): Promise<boolean>;
}

async function readCapped(r: Response): Promise<string> {
  const declared = Number(r.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PHOTON_MAX_BODY_BYTES) throw new PhotonError("photon response too large");
  if (!r.body) throw new PhotonError("photon response has no body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
    size += c.length;
    if (size > PHOTON_MAX_BODY_BYTES) { void r.body.cancel().catch(() => {}); throw new PhotonError("photon response too large"); }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, MAX_FIELD_CHARS) : undefined);

/** Validates a Photon GeoJSON body; features with unusable geometry are dropped, a wrong overall shape throws. */
export function parsePhotonBody(body: unknown, q: string): PhotonPlace[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new PhotonError("photon response has unexpected shape");
  const out: PhotonPlace[] = [];
  for (const f of features.slice(0, PHOTON_MAX_FEATURES)) {
    const coords = (f as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const p = ((f as { properties?: unknown }).properties ?? {}) as Record<string, unknown>;
    const name = str(p.name) ?? str(p.street) ?? q;
    const label = [p.name, p.street, p.district ?? p.suburb, p.city].map(str).filter((x): x is string => !!x).join(", ");
    out.push({ name, label: label || q, lat, lon });
  }
  return out;
}

export function photonClient(baseUrl = SELF_HOSTED_PHOTON_URL, timeoutMs = PHOTON_TIMEOUT_MS): PhotonClient {
  if (!isLoopbackUrl(baseUrl)) throw new Error('geocoder "photon-local": refusing non-loopback URL; only self-hosted providers are allowed');
  const origin = new URL(baseUrl).origin;

  /** One GET against the configured origin: redirects are errors, other origins are refused, time and size are bounded. */
  async function get(pathAndQuery: string, ms: number, signal?: AbortSignal): Promise<Response> {
    const u = new URL(pathAndQuery, origin);
    if (u.origin !== origin) throw new PhotonError("photon request left the configured origin");
    const deadline = AbortSignal.timeout(ms);
    let r: Response;
    try {
      r = await fetch(u, { redirect: "manual", signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      throw new PhotonError(`photon unreachable: ${(e as Error).name}`);
    }
    if (r.status >= 300 && r.status < 400) { void r.body?.cancel().catch(() => {}); throw new PhotonError("photon redirected; redirects are not followed"); }
    if (!r.ok) { void r.body?.cancel().catch(() => {}); throw new PhotonError(`photon ${r.status}`); }
    return r;
  }

  let probe: { at: number; ok: boolean } | undefined;
  return {
    name: "photon-local",
    async search(q, opts = {}) {
      const u = new URL("/api", origin);
      u.searchParams.set("q", q);
      u.searchParams.set("limit", String(Math.min(Math.max(opts.limit ?? 1, 1), PHOTON_MAX_FEATURES)));
      if (opts.near) { u.searchParams.set("lat", String(opts.near.lat)); u.searchParams.set("lon", String(opts.near.lon)); }
      const r = await get(u.pathname + u.search, timeoutMs, opts.signal);
      let body: unknown;
      try { body = JSON.parse(await readCapped(r)); } catch (e) {
        if (e instanceof PhotonError) throw e;
        throw new PhotonError("photon response is not valid JSON");
      }
      return parsePhotonBody(body, q);
    },
    async available() {
      if (probe && Date.now() - probe.at < PHOTON_PROBE_TTL_MS) return probe.ok;
      let ok = false;
      try { (await get("/status", PHOTON_PROBE_TIMEOUT_MS)).body?.cancel().catch(() => {}); ok = true; } catch { ok = false; }
      probe = { at: Date.now(), ok };
      return ok;
    },
  };
}
