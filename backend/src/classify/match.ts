// Task 3.2a: map-match frames onto a route axis, filter, and prefer one sequence per edge.
import { absAngleDiffDeg, projectOntoAxis, signedAngleDiffDeg, type Axis } from "../geo/local";
import type { DropReason, EdgeSpan, FrameRecord } from "./types";

export interface MatchConfig {
  /** Max perpendicular distance from the route centreline (projection onto the edge geometry). Default 15 m. */
  lateralToleranceM: number;
  /**
   * Right-hand traffic (Ghana). A frame more than this far to the LEFT of the centreline (in the direction of travel) is
   * treated as the opposite carriageway / wrong lane and dropped. Right-side offsets are kept up to lateralToleranceM.
   * Default 3 m: covers GPS noise on a centred frame, still excludes the far carriageway of a divided road.
   */
  maxLeftOffsetM: number;
  /** Max |frame heading - local road bearing|, inclusive. Default 25 deg. */
  bearingToleranceDeg: number;
  /** Frames with quality_score below this are dropped. Default 0.5. */
  minQualityScore: number;
  /** Keep frames whose quality_score is null (unscored). Default false: unknown quality is not trusted. */
  allowMissingQuality: boolean;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  lateralToleranceM: 15,
  maxLeftOffsetM: 3,
  bearingToleranceDeg: 25,
  minQualityScore: 0.5,
  allowMissingQuality: false,
};

/** Float slack so a frame at exactly the tolerance (e.g. road 10.0, heading 35.0) is kept despite projection round-off (~1e-4 deg between two local frames). */
const ANGLE_EPS_DEG = 1e-3;

export interface MatchedFrame {
  frame: FrameRecord;
  /** metres along the route axis, rounded to 1 mm so exact-threshold gap comparisons (15.000 m) are not decided by float noise */
  offsetM: number;
  /** + right of travel, - left */
  lateralRightM: number;
  /** road bearing at the frame's own projected position (segment bearing, not a chunk average) */
  localBearingDeg: number;
  /** frame heading minus local road bearing, signed, in (-180, 180] */
  headingDeltaDeg: number;
  edgeIndex: number;
  edgeId: number;
}

export interface DroppedFrame { frame: FrameRecord; reason: DropReason }

export function edgeIndexAt(edges: readonly EdgeSpan[], offsetM: number): number {
  if (edges.length === 0) throw new Error("no edges");
  for (let i = 0; i < edges.length; i++) if (offsetM >= edges[i]!.startM && offsetM < edges[i]!.endM) return i;
  return offsetM < edges[0]!.startM ? 0 : edges.length - 1;
}

export function matchFrames(
  axis: Axis, edges: readonly EdgeSpan[], frames: readonly FrameRecord[], cfg: MatchConfig = DEFAULT_MATCH_CONFIG,
): { kept: MatchedFrame[]; dropped: DroppedFrame[] } {
  const kept: MatchedFrame[] = [];
  const dropped: DroppedFrame[] = [];
  for (const f of frames) {
    const drop = (reason: DropReason) => dropped.push({ frame: f, reason });
    const pr = projectOntoAxis(axis, { lat: f.lat, lon: f.lon });
    const lateral = Math.abs(pr.lateralRightM);
    if (lateral > cfg.lateralToleranceM) { drop("off_route"); continue; }
    if (pr.lateralRightM < -cfg.maxLeftOffsetM) { drop("left_of_centerline"); continue; }
    if (f.compassAngleDeg === null || !Number.isFinite(f.compassAngleDeg)) { drop("no_heading"); continue; }
    if (absAngleDiffDeg(f.compassAngleDeg, pr.bearingDeg) > cfg.bearingToleranceDeg + ANGLE_EPS_DEG) { drop("bearing_mismatch"); continue; }
    if (f.qualityScore === null) {
      if (!cfg.allowMissingQuality) { drop("low_quality"); continue; }
    } else if (f.qualityScore < cfg.minQualityScore) { drop("low_quality"); continue; }
    if (!f.sequenceId) { drop("no_sequence"); continue; }
    const edgeIndex = edgeIndexAt(edges, pr.offsetM);
    kept.push({
      frame: f, offsetM: Math.round(pr.offsetM * 1000) / 1000, lateralRightM: pr.lateralRightM, localBearingDeg: pr.bearingDeg,
      headingDeltaDeg: signedAngleDiffDeg(pr.bearingDeg, f.compassAngleDeg), edgeIndex, edgeId: edges[edgeIndex]!.edgeId,
    });
  }
  kept.sort(byOffset);
  return { kept, dropped };
}

export function byOffset(a: MatchedFrame, b: MatchedFrame): number {
  return a.offsetM - b.offsetM || (a.frame.capturedAt ?? "").localeCompare(b.frame.capturedAt ?? "") || a.frame.imageId.localeCompare(b.frame.imageId);
}

const ts = (s: string | null) => (s ? Date.parse(s) : Number.NEGATIVE_INFINITY);

/**
 * One sequence per edge. Edges are visited in route order. If the sequence chosen for the previous edge also has frames on
 * this edge it is kept (continuity, so a run is not fragmented by a marginally richer neighbour). Otherwise the best
 * candidate wins by: most usable frames on the edge, then most recent capture (latest capturedAt) as the tiebreak, then
 * sequence id for determinism. Frames of the other sequences on that edge are dropped as `other_sequence`.
 */
export function selectSequences(kept: readonly MatchedFrame[]): { selected: MatchedFrame[]; dropped: DroppedFrame[] } {
  const byEdge = new Map<number, MatchedFrame[]>();
  for (const m of kept) {
    const list = byEdge.get(m.edgeIndex);
    if (list) list.push(m); else byEdge.set(m.edgeIndex, [m]);
  }
  const selected: MatchedFrame[] = [];
  const dropped: DroppedFrame[] = [];
  let prev: string | null = null;
  for (const idx of [...byEdge.keys()].sort((a, b) => a - b)) {
    const frames = byEdge.get(idx)!;
    const seqs = new Map<string, { n: number; latest: number }>();
    for (const m of frames) {
      const id = m.frame.sequenceId!;
      const s = seqs.get(id) ?? { n: 0, latest: Number.NEGATIVE_INFINITY };
      s.n++; s.latest = Math.max(s.latest, ts(m.frame.capturedAt));
      seqs.set(id, s);
    }
    let chosen: string;
    if (prev !== null && seqs.has(prev)) chosen = prev;
    else {
      chosen = [...seqs.entries()].sort(([ia, a], [ib, b]) => b.n - a.n || b.latest - a.latest || ia.localeCompare(ib))[0]![0];
    }
    for (const m of frames) {
      if (m.frame.sequenceId === chosen) selected.push(m);
      else dropped.push({ frame: m.frame, reason: "other_sequence" });
    }
    prev = chosen;
  }
  selected.sort(byOffset);
  return { selected, dropped };
}
