// Production geocode chain returning ranked candidates: coordinates, then local landmarks (claim at score >= 0.5),
// then the self-hosted Photon if reachable. Photon being down or slow degrades to local results (degraded: true), never an error.
import { coordinateGeocoder, LANDMARK_MIN_SCORE } from "../patterns/geocodeChain";
import { haversineM } from "./local";
import { searchLandmarks, type Queryable, type SearchParams } from "./landmarkSearch";
import { PhotonError, type PhotonClient } from "./photon";

export type CandidateSource = "coordinates" | "landmarks" | "photon-local";

export interface Candidate {
  name: string; lat: number; lon: number; source: CandidateSource;
  /** 0..1. landmarks: trigram similarity. photon-local: local bigram similarity of the query to the returned name (Photon gives none). coordinates: 1. */
  score: number;
  /** metres from `near`; null when `near` was not given */
  distance_m: number | null;
}

export interface GeocodeResult { query: string; candidates: Candidate[]; degraded: boolean }
export type GeocodeFn = (p: SearchParams) => Promise<GeocodeResult>;

/** Photon results below this local similarity are dropped as noise (Photon returns its best guess for almost any text). */
export const PHOTON_MIN_SCORE = 0.3;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}
/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function diceScore(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (x.length === 0 || y.length === 0) return 0;
  if (x === y) return 1;
  const bx = bigrams(x), by = bigrams(y);
  let common = 0, nx = 0, ny = 0;
  for (const [k, v] of bx) { nx += v; common += Math.min(v, by.get(k) ?? 0); }
  for (const v of by.values()) ny += v;
  return nx + ny === 0 ? 0 : (2 * common) / (nx + ny);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function createGeocoder(deps: { db: Queryable; photon?: PhotonClient; search?: typeof searchLandmarks }): GeocodeFn {
  const search = deps.search ?? searchLandmarks;
  const coords = coordinateGeocoder();
  return async (p) => {
    const dist = (lat: number, lon: number) => (p.near ? Math.round(haversineM(p.near, { lat, lon })) : null);
    // Reachability is checked up front (cached) so degraded is honest even when a local stage answers.
    const photonUp = deps.photon ? await deps.photon.available() : true;
    const done = (candidates: Candidate[], degraded = !photonUp): GeocodeResult => ({ query: p.q, candidates, degraded });

    const c = await coords.geocode(p.q);
    if (c.answered && c.place) {
      return done([{ name: c.place.label, lat: c.place.lat, lon: c.place.lon, source: "coordinates", score: 1, distance_m: dist(c.place.lat, c.place.lon) }]);
    }

    const local = (await search(deps.db, p)).filter((m) => m.score >= LANDMARK_MIN_SCORE);
    if (local.length > 0) {
      return done(local.map((m) => ({ name: m.name, lat: m.lat, lon: m.lon, source: "landmarks" as const, score: m.score, distance_m: m.distance_m })));
    }

    if (!deps.photon || !photonUp) return done([]);
    try {
      const places = await deps.photon.search(p.q, { limit: p.limit, near: p.near });
      const ranked = places
        .map((x) => ({ name: x.label, lat: x.lat, lon: x.lon, source: "photon-local" as const, score: round3(Math.max(diceScore(p.q, x.name), diceScore(p.q, x.label))), distance_m: dist(x.lat, x.lon) }))
        .filter((x) => x.score >= PHOTON_MIN_SCORE)
        .sort((a, b) => b.score - a.score);
      return done(ranked.slice(0, p.limit), false);
    } catch (e) {
      if (e instanceof PhotonError || (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") return done([], true);
      throw e;
    }
  };
}
