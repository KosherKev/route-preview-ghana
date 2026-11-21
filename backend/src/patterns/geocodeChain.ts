// Shared pieces of the geocode chain: the coordinate parser and the landmark claim threshold.
// The chain itself (coordinates, local landmarks, then the self-hosted Photon on loopback only) lives in createGeocoder (src/geo/geocode.ts).
// No public Nominatim or Photon server is ever contacted (spec v2 4.2): photonClient refuses non-loopback URLs.
// Informed by the Photon/Nominatim adapters in gods-eye-view (MIT, see THIRD_PARTY_NOTICES.md); no code copied.

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

/**
 * Minimum trigram similarity for the landmark stage to claim an answer (below this it falls through to the geocoder).
 * At 0.3, "Kotoka International Airport" resolved to "Opportunity International" (0.41); correct matches measured >= 0.52.
 */
export const LANDMARK_MIN_SCORE = 0.5;
