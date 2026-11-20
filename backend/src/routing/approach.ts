// Task 3.1: route + final-approach extractor. Pre-trip preview only: origin and destination are fixed inputs;
// nothing here follows a live position or produces turn-by-turn guidance.
import { buildAxis, sliceAxis, type Axis, type LatLon } from "../geo/local";
import { encodePolyline6 } from "./polyline";
import {
  costingOptionsFor, decodePolyline6, DEFAULT_TIMEOUT_MS, postJson, routeRequest, ValhallaError, type Costing,
} from "./valhalla";

/** Bad caller-supplied argument (as opposed to an upstream/Valhalla failure); the HTTP layer maps it to 400. */
export class ArgumentError extends Error {}

/** Valhalla error code for "No path could be found for input". */
export const NO_PATH_ERROR_CODE = 442;

export interface ApproachOptions {
  /** Length of the final approach measured ALONG the route. Default 500 m. */
  approachLengthM?: number;
  /** Total width of each decision-point window, centred on the maneuver point. Default 80 m. */
  decisionWindowM?: number;
  valhallaUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Aborts in-flight Valhalla requests (the HTTP service aborts at its request deadline). */
  signal?: AbortSignal;
  /** Called for every non-silent condition (the same text is also in result.warnings). Defaults to console.warn. */
  warn?: (msg: string) => void;
}

export const DEFAULT_APPROACH_LENGTH_M = 500;
export const DEFAULT_DECISION_WINDOW_M = 80;

export interface ExtractedEdge {
  id: number;
  wayId?: number;
  roadClass?: string;
  surface?: string;
  use?: string;
  bridge: boolean;
  tunnel: boolean;
  names: string[];
  /** Offsets along the full route polyline, metres. */
  startM: number;
  endM: number;
}

export type ManeuverKind = "turn" | "roundabout" | "merge" | "ramp_or_fork" | "other";

export interface ExtractedManeuver {
  type: number;
  kind: ManeuverKind;
  instruction: string;
  streetNames: string[];
  /** Offset of the maneuver point (begin of the maneuver) along the route, metres. */
  atM: number;
  endM: number;
}

export interface DecisionWindow {
  kind: ManeuverKind;
  maneuverType: number;
  instruction: string;
  atM: number;
  startM: number;
  endM: number;
  edgeIds: number[];
}

export interface ApproachResult {
  costing: Costing;
  /** True when `auto` + exclude_unpaved found no route and a plain `auto` route was returned instead. */
  unpaved_fallback: boolean;
  warnings: string[];
  origin: LatLon;
  destination: LatLon;
  route: {
    lengthM: number; valhallaLengthKm: number; timeSec: number; polyline6: string; pointCount: number;
    /** Route vertices map_snap dropped from the matched shape (0/0 when identical); edge offsets are corrected for them. */
    matchedShapeTrim: { leading: number; trailing: number };
  };
  edges: ExtractedEdge[];
  maneuvers: ExtractedManeuver[];
  approach: {
    requestedLengthM: number;
    lengthM: number;
    startM: number;
    endM: number;
    /** true when the route is no longer than the requested approach, so the whole route is returned */
    wholeRoute: boolean;
    polyline6: string;
    /** Approach-window edges, offsets still relative to the full route (clipped to the window). */
    edges: ExtractedEdge[];
    edgeIds: number[];
  };
  decisionWindows: DecisionWindow[];
}

export function maneuverKind(type: number): ManeuverKind {
  if (type >= 9 && type <= 16 && type !== 8) return "turn"; // slight/right/sharp/uturn/left (Valhalla DirectionsLeg Maneuver.Type)
  if (type === 26 || type === 27) return "roundabout";
  if (type === 25 || type === 37 || type === 38) return "merge";
  if (type >= 17 && type <= 24) return "ramp_or_fork";
  return "other";
}

const WINDOW_KINDS = new Set<ManeuverKind>(["turn", "roundabout", "merge", "ramp_or_fork"]);

function traceRequest(costing: Costing, polyline6: string, excludeUnpaved?: boolean) {
  return {
    encoded_polyline: polyline6,
    shape_format: "polyline6",
    costing,
    costing_options: { [costing]: costingOptionsFor(costing, excludeUnpaved) },
    shape_match: "map_snap",
    filters: {
      attributes: [
        "edge.id", "edge.way_id", "edge.names", "edge.road_class", "edge.surface", "edge.use", "edge.bridge", "edge.tunnel",
        "edge.begin_shape_index", "edge.end_shape_index", "shape",
      ],
      action: "include",
    },
  };
}

function overlaps(e: { startM: number; endM: number }, s: number, t: number) {
  return e.endM > s && e.startM < t;
}

/**
 * The edge offsets are computed from the ROUTE polyline using trace_attributes' shape indices, so the matched shape
 * must line up with the route shape exactly. Live finding (Valhalla 3.9.3, map_snap): the matched shape can DROP the
 * leading (origin) and/or trailing vertex of the route, which shifts every shape index by one while still being in range.
 * Accepted: the matched shape is identical to the route shape, or is a contiguous run of route vertices (equal
 * coordinates) starting at route index `leading`; the indices are then shifted by `leading`. Anything else (different
 * point count with different vertices, no shape) fails loudly: offsets would be silently wrong.
 */
export function alignShape(routeShape6: string, tracedShape: unknown, routePoints: readonly LatLon[]): { leading: number; trailing: number } {
  if (typeof tracedShape !== "string") throw new Error("Valhalla /trace_attributes returned no shape; cannot verify it matches the route shape");
  if (tracedShape === routeShape6) return { leading: 0, trailing: 0 };
  let traced: [number, number][] = [];
  try { traced = decodePolyline6(tracedShape); } catch { /* undecodable: reported below */ }
  const n = traced.length;
  if (n >= 2 && n < routePoints.length) {
    for (let k = 0; k + n <= routePoints.length; k++) {
      if (traced.every(([la, lo], i) => la === routePoints[k + i]!.lat && lo === routePoints[k + i]!.lon)) {
        return { leading: k, trailing: routePoints.length - k - n };
      }
    }
  }
  throw new Error(
    `trace_attributes matched shape differs from the route shape (route ${routePoints.length} points, matched ${n > 0 ? n : "undecodable"} points) ` +
    "and is not a contiguous part of it; edge offsets would be wrong, refusing to continue",
  );
}

/** Edges of the matched shape. `shape` indices refer to the matched shape, verified (alignShape) identical to, or a contiguous part of, the route shape. */
export function buildEdges(rawEdges: Record<string, any>[], axis: Axis, indexShift = 0): ExtractedEdge[] {
  const last = axis.cum.length - 1;
  return rawEdges.map((e) => {
    const b = Number(e.begin_shape_index) + indexShift, t = Number(e.end_shape_index) + indexShift;
    if (!Number.isInteger(b) || !Number.isInteger(t) || b < indexShift || t > last || t < b) {
      throw new Error(`trace_attributes edge ${e.id} has shape indices outside the route shape`);
    }
    return {
      id: e.id as number,
      wayId: e.way_id as number | undefined,
      roadClass: e.road_class as string | undefined,
      surface: e.surface as string | undefined,
      use: e.use as string | undefined,
      bridge: e.bridge === true,
      tunnel: e.tunnel === true,
      names: (e.names as string[] | undefined) ?? [],
      startM: axis.cum[b]!,
      endM: axis.cum[t]!,
    };
  });
}

/** Pure part: build the approach and decision windows from a decoded route. Exported for unit tests. */
export function assembleApproach(
  axis: Axis, edges: ExtractedEdge[], maneuvers: ExtractedManeuver[], approachLengthM: number, decisionWindowM: number,
) {
  if (!(approachLengthM > 0)) throw new ArgumentError("approachLengthM must be > 0");
  if (!(decisionWindowM > 0)) throw new ArgumentError("decisionWindowM must be > 0");
  const total = axis.lengthM;
  const startM = Math.max(0, total - approachLengthM);
  const wholeRoute = total <= approachLengthM;
  const polyline = sliceAxis(axis, startM, total).map((p) => [p.lat, p.lon] as [number, number]);
  const clipped = edges
    .filter((e) => overlaps(e, startM, total))
    .map((e) => ({ ...e, startM: Math.max(e.startM, startM), endM: Math.min(e.endM, total) }));
  const windows: DecisionWindow[] = [];
  for (const m of maneuvers) {
    if (!WINDOW_KINDS.has(m.kind)) continue;
    const s = Math.max(0, m.atM - decisionWindowM / 2), t = Math.min(total, m.atM + decisionWindowM / 2);
    windows.push({
      kind: m.kind, maneuverType: m.type, instruction: m.instruction, atM: m.atM, startM: s, endM: t,
      edgeIds: edges.filter((e) => overlaps(e, s, t)).map((e) => e.id),
    });
  }
  return {
    requestedLengthM: approachLengthM, lengthM: total - startM, startM, endM: total, wholeRoute,
    polyline6: encodePolyline6(polyline), edges: clipped, edgeIds: clipped.map((e) => e.id),
    windows,
  };
}

export async function extractApproach(
  costing: Costing, origin: LatLon, destination: LatLon, opts: ApproachOptions = {},
): Promise<ApproachResult> {
  const base = opts.valhallaUrl ?? process.env.VALHALLA_URL ?? "http://127.0.0.1:8002";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const warn = opts.warn ?? ((m: string) => console.warn(`[approach] ${m}`));
  const warnings: string[] = [];

  let fallback = false;
  let route: any;
  try {
    route = await postJson(base, "/route", routeRequest(costing, origin, destination), fetchImpl, timeoutMs, opts.signal);
  } catch (e) {
    // auto's exclude_unpaved is a hard exclusion (Phase 2 finding): retry once without it, and say so.
    if (costing === "auto" && e instanceof ValhallaError && e.errorCode === NO_PATH_ERROR_CODE) {
      const msg = "auto + exclude_unpaved found no route (Valhalla 442); retried without exclude_unpaved, so this route may use unpaved roads";
      warnings.push(msg);
      warn(msg);
      fallback = true;
      route = await postJson(base, "/route", routeRequest(costing, origin, destination, false), fetchImpl, timeoutMs, opts.signal);
    } else {
      throw e;
    }
  }
  const leg = route?.trip?.legs?.[0];
  if (!leg || typeof leg.shape !== "string") throw new Error("Valhalla /route returned no route leg (trip.legs[0] missing)");
  const polyline6: string = leg.shape;
  const points = decodePolyline6(polyline6).map(([lat, lon]): LatLon => ({ lat, lon }));
  const axis = buildAxis(points);

  const attrs = await postJson(base, "/trace_attributes", traceRequest(costing, polyline6, fallback ? false : undefined), fetchImpl, timeoutMs, opts.signal);
  if (!Array.isArray(attrs?.edges) || attrs.edges.length === 0) throw new Error("Valhalla /trace_attributes returned no edges");
  const trim = alignShape(polyline6, attrs.shape, points);
  const edges = buildEdges(attrs.edges, axis, trim.leading);
  // the dropped sliver (origin/destination snap) belongs to the first/last matched edge
  if (trim.leading > 0) edges[0]!.startM = 0;
  if (trim.trailing > 0) edges[edges.length - 1]!.endM = axis.lengthM;

  const maneuvers: ExtractedManeuver[] = ((leg.maneuvers ?? []) as Record<string, any>[]).map((m) => ({
    type: m.type as number,
    kind: maneuverKind(m.type as number),
    instruction: String(m.instruction ?? ""),
    streetNames: (m.street_names as string[] | undefined) ?? [],
    atM: axis.cum[Math.min(m.begin_shape_index as number, axis.cum.length - 1)]!,
    endM: axis.cum[Math.min(m.end_shape_index as number, axis.cum.length - 1)]!,
  }));

  const a = assembleApproach(axis, edges, maneuvers, opts.approachLengthM ?? DEFAULT_APPROACH_LENGTH_M, opts.decisionWindowM ?? DEFAULT_DECISION_WINDOW_M);
  return {
    costing, unpaved_fallback: fallback, warnings, origin, destination,
    route: {
      lengthM: axis.lengthM, valhallaLengthKm: route.trip.summary.length as number, timeSec: route.trip.summary.time as number,
      polyline6, pointCount: points.length, matchedShapeTrim: trim,
    },
    edges, maneuvers,
    approach: {
      requestedLengthM: a.requestedLengthM, lengthM: a.lengthM, startM: a.startM, endM: a.endM, wholeRoute: a.wholeRoute,
      polyline6: a.polyline6, edges: a.edges, edgeIds: a.edgeIds,
    },
    decisionWindows: a.windows,
  };
}
