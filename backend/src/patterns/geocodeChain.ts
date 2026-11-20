// Original sketch. Pattern: geocoding fallback chain, self-hosted only.
// coordinate parse -> PostGIS landmark search -> (optional) self-hosted geocoder on loopback.
// No public Nominatim or Photon server is ever contacted (spec v2 4.2): httpGeocoder refuses non-loopback URLs.
// Informed by the Photon/Nominatim adapters in gods-eye-view (MIT, see
// THIRD_PARTY_NOTICES.md); no code copied.
import type { LandmarkMatch, Queryable } from "../geo/landmarkSearch";
import { searchLandmarks } from "../geo/landmarkSearch";

export interface Place { lat: number; lon: number; label: string; source: string }

/** "answered" separates a real not-found from a provider failure, so failures are never cached as misses. */
export type Outcome = { answered: true; place: Place | null } | { answered: false };

export interface Geocoder {
  readonly name: string;
  geocode(query: string, signal?: AbortSignal): Promise<Outcome>;
}

/** Matches "5.6037, -0.1870" style input; no network needed. */
export function coordinateGeocoder(): Geocoder {
  return {
    name: "coordinates",
    async geocode(q) {
      const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
      if (!m) return { answered: true, place: null };
      const [lat, lon] = [Number(m[1]), Number(m[2])];
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { answered: true, place: null };
      return { answered: true, place: { lat, lon, label: q.trim(), source: "coordinates" } };
    },
  };
}

/** Curated landmarks (e.g. dispatch hubs) keyed by lowercase name. */
export function landmarkGeocoder(landmarks: ReadonlyMap<string, Place>): Geocoder {
  return {
    name: "landmarks",
    async geocode(q) {
      return { answered: true, place: landmarks.get(q.trim().toLowerCase()) ?? null };
    },
  };
}

/**
 * Minimum trigram similarity for the landmark stage to claim an answer (below this it falls through to the geocoder).
 * At 0.3, "Kotoka International Airport" resolved to "Opportunity International" (0.41); correct matches measured >= 0.52.
 */
export const LANDMARK_MIN_SCORE = 0.5;

/** Landmark stage: fuzzy PostGIS search (pg_trgm), best match wins. `near` biases exact ties toward the rider. */
export function landmarkSearchGeocoder(
  db: Queryable,
  near?: { lat: number; lon: number },
  search: typeof searchLandmarks = searchLandmarks,
): Geocoder {
  return {
    name: "landmarks",
    async geocode(q) {
      const q2 = q.trim();
      if (q2.length === 0 || [...q2].length > 100) return { answered: true, place: null };
      try {
        const [m] = (await search(db, { q: q2, near, limit: 1 })) as LandmarkMatch[];
        if (!m || m.score < LANDMARK_MIN_SCORE) return { answered: true, place: null };
        return { answered: true, place: { lat: m.lat, lon: m.lon, label: m.name, source: "landmarks" } };
      } catch {
        return { answered: false }; // a DB failure is not a miss
      }
    },
  };
}

/** True only for loopback hosts: the self-hosted geocoder must never be a public server. */
export function isLoopbackUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

/** Wrap a self-hosted HTTP provider (loopback only) with a timeout. Parsing is injected. */
export function httpGeocoder(
  name: string,
  baseUrl: string,
  fetchPlace: (q: string, signal: AbortSignal) => Promise<Place | null>,
  timeoutMs = 6000,
): Geocoder {
  if (!isLoopbackUrl(baseUrl)) throw new Error(`geocoder "${name}": refusing non-loopback URL; only self-hosted providers are allowed`);
  return {
    name,
    async geocode(q, signal) {
      try {
        const deadline = AbortSignal.timeout(timeoutMs);
        const s = signal ? AbortSignal.any([signal, deadline]) : deadline;
        return { answered: true, place: await fetchPlace(q, s) };
      } catch {
        if (signal?.aborted) throw signal.reason;
        return { answered: false };
      }
    },
  };
}

export const SELF_HOSTED_PHOTON_URL = "http://127.0.0.1:2322";

/** Second stage: the self-hosted Ghana-only Photon (docker compose --profile geocoder). Loopback only, enforced by httpGeocoder. */
export function photonGeocoder(baseUrl = SELF_HOSTED_PHOTON_URL, timeoutMs = 3000): Geocoder {
  return httpGeocoder("photon-local", baseUrl, async (q, signal) => {
    const u = new URL("/api", baseUrl);
    u.searchParams.set("q", q);
    u.searchParams.set("limit", "1");
    const r = await fetch(u, { signal });
    if (!r.ok) throw new Error(`photon ${r.status}`);
    const body = (await r.json()) as { features?: Array<{ geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> }> };
    const f = body.features?.[0];
    const [lon, lat] = f?.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const p = f!.properties ?? {};
    const label = [p.name, p.street, p.district ?? p.suburb, p.city].filter((x): x is string => typeof x === "string" && x.length > 0).join(", ");
    return { lat, lon, label: label || q, source: "photon-local" };
  }, timeoutMs);
}

/** The production chain: landmarks first (coordinates are a pure parse and sit ahead of it), then an optional self-hosted geocoder. */
export function buildGeocodeChain(opts: { db: Queryable; near?: { lat: number; lon: number }; selfHosted?: Geocoder }): Geocoder[] {
  return [coordinateGeocoder(), landmarkSearchGeocoder(opts.db, opts.near), ...(opts.selfHosted ? [opts.selfHosted] : [])];
}

/** First provider with a place wins; providers that fail or find nothing fall through. */
export async function geocodeWithFallback(
  chain: readonly Geocoder[],
  query: string,
  signal?: AbortSignal,
): Promise<{ place: Place | null; answeredBy: string | null }> {
  for (const g of chain) {
    const out = await g.geocode(query, signal);
    if (out.answered && out.place) return { place: out.place, answeredBy: g.name };
  }
  return { place: null, answeredBy: null };
}
