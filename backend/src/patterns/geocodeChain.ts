// Original sketch. Pattern: keyless geocoding fallback chain
// local landmark/coordinate lookup -> Photon -> Nominatim.
// Informed by the Photon/Nominatim adapters in gods-eye-view (MIT, see
// THIRD_PARTY_NOTICES.md); no code copied.

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

/** Wrap any HTTP provider with a timeout. Parsing is injected, so no endpoint config lives here. */
export function httpGeocoder(
  name: string,
  fetchPlace: (q: string, signal: AbortSignal) => Promise<Place | null>,
  timeoutMs = 6000,
): Geocoder {
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

// Intended order: [coordinateGeocoder(), landmarkGeocoder(...), httpGeocoder("photon", ...), httpGeocoder("nominatim", ...)]
// Nominatim needs a rate gate (~1 req/s), a real User-Agent and a cache; add in Phase 2.
