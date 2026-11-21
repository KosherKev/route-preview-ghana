// Resolves a rider's typed place name to one point for routing, or says why it will not guess.
import { LANDMARK_MIN_SCORE } from "../patterns/geocodeChain";
import { haversineM } from "../geo/local";
import type { Candidate, GeocodeFn } from "../geo/geocode";

/** Top two candidates closer than this in score (and further apart than DISAMBIGUATION_MIN_DISTANCE_M) are ambiguous. Configurable. */
export const DEFAULT_DISAMBIGUATION_MARGIN = 0.05;
export const DISAMBIGUATION_MIN_DISTANCE_M = 500;
export const RESOLVE_CANDIDATE_LIMIT = 5;

export type Resolution =
  | { ok: true; candidate: Candidate; degraded: boolean }
  | { ok: false; reason: "not_found" | "low_confidence" | "ambiguous"; candidates: Candidate[]; degraded: boolean };

export async function resolvePlace(geocode: GeocodeFn, q: string, margin = DEFAULT_DISAMBIGUATION_MARGIN): Promise<Resolution> {
  const g = await geocode({ q, limit: RESOLVE_CANDIDATE_LIMIT });
  const [best, second] = g.candidates;
  if (!best) return { ok: false, reason: "not_found", candidates: [], degraded: g.degraded };
  // Coordinates are exact (score 1), so the claim threshold only matters for names.
  if (best.score < LANDMARK_MIN_SCORE) return { ok: false, reason: "low_confidence", candidates: g.candidates, degraded: g.degraded };
  if (second && best.score - second.score < margin && haversineM(best, second) > DISAMBIGUATION_MIN_DISTANCE_M) {
    return { ok: false, reason: "ambiguous", candidates: g.candidates, degraded: g.degraded };
  }
  return { ok: true, candidate: best, degraded: g.degraded };
}
