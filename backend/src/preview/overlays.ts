// Phase 5A overlay DATA for the pre-trip preview: static turn events and landmark callouts, both keyed by distance
// along the fixed route. Nothing here reads, accepts or stores a position of a device or a rider; the "turn events" are
// not guidance, they are markers the client draws while it plays the preview clock.
import type { Client } from "pg";
import { projectOntoAxis, sliceAxis, type Axis } from "../geo/local";
import type { ExtractedManeuver } from "../routing/approach";

export type TurnDirection = "left" | "right" | "straight" | "uturn";
export interface TurnEvent {
  /** Metres along the route where the maneuver begins. */
  offsetM: number;
  /** Stable machine name, e.g. "left", "slight_right", "roundabout_enter", "exit_left". */
  maneuver: string;
  direction: TurnDirection;
  kind: ExtractedManeuver["kind"];
  /** First street name of the maneuver when Valhalla gave one. */
  streetName: string | null;
  /** Decision-point window around the maneuver, clipped to the route. */
  window: { startM: number; endM: number };
}

// Valhalla DirectionsLeg Maneuver.Type values that are worth an overlay. Start (1-3), destination (4-6), becomes (7),
// continue (8), ferries (28, 29) and anything unknown are not turns.
const MANEUVERS: Record<number, [string, TurnDirection]> = {
  9: ["slight_right", "right"], 10: ["right", "right"], 11: ["sharp_right", "right"], 12: ["uturn_right", "uturn"],
  13: ["uturn_left", "uturn"], 14: ["sharp_left", "left"], 15: ["left", "left"], 16: ["slight_left", "left"],
  17: ["ramp_straight", "straight"], 18: ["ramp_right", "right"], 19: ["ramp_left", "left"], 20: ["exit_right", "right"],
  21: ["exit_left", "left"], 22: ["fork_straight", "straight"], 23: ["fork_right", "right"], 24: ["fork_left", "left"],
  25: ["merge", "straight"], 26: ["roundabout_enter", "straight"], 27: ["roundabout_exit", "straight"],
  37: ["merge_right", "right"], 38: ["merge_left", "left"],
};

export const DEFAULT_TURN_WINDOW_M = 80;

/**
 * Turn events whose decision window overlaps [fromM, toM] (the preview timeline). `decisionWindowM` is the total width of
 * the window centred on the maneuver point (configurable per request, same meaning as /approach's decision_window_m).
 */
export function deriveTurnEvents(
  maneuvers: readonly ExtractedManeuver[], fromM: number, toM: number, routeLengthM: number, decisionWindowM = DEFAULT_TURN_WINDOW_M,
): TurnEvent[] {
  if (!(decisionWindowM > 0)) throw new RangeError("decisionWindowM must be > 0");
  const out: TurnEvent[] = [];
  for (const m of maneuvers) {
    const def = MANEUVERS[m.type];
    if (!def) continue;
    const startM = Math.max(0, m.atM - decisionWindowM / 2), endM = Math.min(routeLengthM, m.atM + decisionWindowM / 2);
    if (endM < fromM || startM > toM) continue;
    out.push({ offsetM: m.atM, maneuver: def[0], direction: def[1], kind: m.kind, streetName: m.streetNames[0] ?? null, window: { startM, endM } });
  }
  return out.sort((a, b) => a.offsetM - b.offsetM || a.maneuver.localeCompare(b.maneuver));
}

export interface LandmarkRow {
  osm_type: string; osm_id: number | string; category: string; kind: string | null; name: string | null; lat: number; lon: number;
}
export interface LandmarkCallout {
  offsetM: number;
  name: string;
  category: string;
  kind: string | null;
  /** Side of the direction of travel the landmark is on. A landmark exactly on the centreline counts as "right". */
  side: "left" | "right";
  /** Perpendicular distance from the route, metres. */
  distanceM: number;
  lat: number;
  lon: number;
  osm: string;
}
export interface LandmarkOptions {
  /** Keep landmarks within this distance of the route. Default 40 m. */
  maxDistanceM: number;
  /** At most this many callouts in any 100 m stretch of route (closest to the route win). Default 3. */
  maxPer100m: number;
  /** Two landmarks with the same name closer than this along the route are one callout. Default 100 m. */
  dedupeWithinM: number;
}
export const DEFAULT_LANDMARK_OPTIONS: LandmarkOptions = { maxDistanceM: 40, maxPer100m: 3, dedupeWithinM: 100 };

const nameKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");

/** Pure: project candidate landmarks onto the route, drop far / unnamed / out-of-range ones, de-duplicate, cap density, order. */
export function selectLandmarks(
  axis: Axis, rows: readonly LandmarkRow[], fromM: number, toM: number, partial: Partial<LandmarkOptions> = {},
): LandmarkCallout[] {
  const o = { ...DEFAULT_LANDMARK_OPTIONS, ...partial };
  if (!(o.maxDistanceM > 0) || !Number.isInteger(o.maxPer100m) || o.maxPer100m < 1 || !(o.dedupeWithinM >= 0)) throw new RangeError("invalid landmark options");
  const cands: LandmarkCallout[] = [];
  for (const r of rows) {
    const name = r.name?.trim();
    if (!name) continue;
    const p = projectOntoAxis(axis, { lat: r.lat, lon: r.lon });
    // distanceM is the true distance to the (clamped) foot point: a landmark past the route end is not "near the route"
    if (p.distanceM > o.maxDistanceM || p.offsetM < fromM || p.offsetM > toM) continue;
    cands.push({
      offsetM: p.offsetM, name, category: r.category, kind: r.kind, side: p.lateralRightM >= 0 ? "right" : "left",
      distanceM: Math.abs(p.lateralRightM), lat: r.lat, lon: r.lon, osm: `${r.osm_type}/${r.osm_id}`,
    });
  }
  // closest to the route first, so de-duplication and the density cap keep the best candidate; osm id breaks ties deterministically
  cands.sort((a, b) => a.distanceM - b.distanceM || a.osm.localeCompare(b.osm) || a.category.localeCompare(b.category));
  const kept: LandmarkCallout[] = [];
  const perBucket = new Map<number, number>();
  for (const c of cands) {
    if (kept.some((k) => (k.osm === c.osm) || (nameKey(k.name) === nameKey(c.name) && Math.abs(k.offsetM - c.offsetM) < o.dedupeWithinM))) continue;
    const bucket = Math.floor(c.offsetM / 100);
    if ((perBucket.get(bucket) ?? 0) >= o.maxPer100m) continue;
    perBucket.set(bucket, (perBucket.get(bucket) ?? 0) + 1);
    kept.push(c);
  }
  return kept.sort((a, b) => a.offsetM - b.offsetM || a.name.localeCompare(b.name));
}

/** Candidate landmarks near the route slice [fromM, toM]; the precise filtering is selectLandmarks. Read-only SQL. */
export async function loadLandmarkRows(
  client: Pick<Client, "query">, axis: Axis, fromM: number, toM: number, maxDistanceM = DEFAULT_LANDMARK_OPTIONS.maxDistanceM,
): Promise<LandmarkRow[]> {
  const pts = sliceAxis(axis, fromM, toM);
  const wkt = `LINESTRING(${pts.map((p) => `${p.lon} ${p.lat}`).join(",")})`;
  const res = await client.query(
    `SELECT osm_type, osm_id, category, kind, name, ST_Y(geom) AS lat, ST_X(geom) AS lon
       FROM landmarks
      WHERE name IS NOT NULL AND ST_DWithin(geom::geography, ST_GeogFromText($1), $2)
      ORDER BY osm_type, osm_id, category
      LIMIT 2000`,
    [wkt, maxDistanceM + 5],
  );
  return res.rows.map((r) => ({ osm_type: r.osm_type, osm_id: r.osm_id, category: r.category, kind: r.kind, name: r.name, lat: Number(r.lat), lon: Number(r.lon) }));
}
