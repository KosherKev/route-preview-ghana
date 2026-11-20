import { buildAxis, projectOntoAxis, type LatLon } from "../geo/local";
import { loadFramesAlongAxisDetailed } from "../classify/load";
import { DEFAULT_MATCH_CONFIG } from "../classify/match";
import { classifyFrames, type PipelineResult } from "../classify/pipeline";
import type { EdgeSpan, FrameRecord } from "../classify/types";
import { decodePolyline6 } from "../routing/valhalla";
import type { ApproachResult } from "../routing/approach";
import { NAMED_POINTS, NEAR_NAMED_M, type NamedKey } from "./routes";
import type { Client } from "pg";

/** Axis and edge spans of the final approach, rebased so the approach starts at 0 m. */
export function approachInputs(r: ApproachResult) {
  const pts = decodePolyline6(r.approach.polyline6).map(([lat, lon]): LatLon => ({ lat, lon }));
  const axis = buildAxis(pts);
  const edges: EdgeSpan[] = r.approach.edges.map((e) => ({
    edgeId: e.id, startM: e.startM - r.approach.startM, endM: e.endM - r.approach.startM, roadClass: e.roadClass, use: e.use, bridge: e.bridge, tunnel: e.tunnel,
  }));
  // clamp rounding drift so the edges tile [0, axis length]
  if (edges.length) { edges[0]!.startM = 0; edges[edges.length - 1]!.endM = axis.lengthM; }
  return { axis, edges };
}

export function classifyApproach(r: ApproachResult, frames: readonly FrameRecord[], alreadyExcluded: readonly string[] = []): PipelineResult {
  const { axis, edges } = approachInputs(r);
  return classifyFrames(axis, edges, frames, undefined, undefined, alreadyExcluded);
}

export async function classifyApproachFromDb(r: ApproachResult, client: Client): Promise<PipelineResult> {
  const { axis } = approachInputs(r);
  const { frames, sourcesExcluded } = await loadFramesAlongAxisDetailed(client, axis, DEFAULT_MATCH_CONFIG.lateralToleranceM + 10);
  return classifyApproach(r, frames, sourcesExcluded);
}

/** Closest approach of the full route to each named place; flags routes that end at or pass through one. */
export function namedProximity(r: ApproachResult): Record<NamedKey, { distanceM: number; relation: "ends_at" | "through" | "no" }> {
  const axis = buildAxis(decodePolyline6(r.route.polyline6).map(([lat, lon]): LatLon => ({ lat, lon })));
  const out = {} as Record<NamedKey, { distanceM: number; relation: "ends_at" | "through" | "no" }>;
  for (const k of Object.keys(NAMED_POINTS) as NamedKey[]) {
    const p = projectOntoAxis(axis, NAMED_POINTS[k].at);
    const d = p.distanceM;
    const endNear = p.offsetM < NEAR_NAMED_M || p.offsetM > axis.lengthM - NEAR_NAMED_M;
    out[k] = { distanceM: Math.round(d), relation: d > NEAR_NAMED_M ? "no" : endNear ? "ends_at" : "through" };
  }
  return out;
}
