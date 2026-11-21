// Coverage audit statistics (follow-up D). Pure functions over classifier output: no I/O, no imagery-source imports.
// Measures only. There is no go/no-go verdict, age filter or threshold here.
import { classifyGap, DEFAULT_CLASSIFY_CONFIG, type Classification, type ClassifyConfig, type TimelineSegment } from "../classify/classify";
import { matchFrames, selectSequences, type MatchedFrame } from "../classify/match";
import type { EdgeSpan, FrameRecord } from "../classify/types";
import { buildAxis, projectOntoAxis, type Axis, type LatLon } from "../geo/local";
import type { ApproachResult } from "../routing/approach";
import { decodePolyline6 } from "../routing/valhalla";

export type AgeBucket = "pre-2015" | "2015-2019" | "2020-2023" | "2024+" | "unknown";
export const AGE_BUCKETS: AgeBucket[] = ["pre-2015", "2015-2019", "2020-2023", "2024+", "unknown"];

/** Capture-year bucket by UTC year of captured_at. Missing or unparseable dates are "unknown". */
export function ageBucket(capturedAt: string | null | undefined): AgeBucket {
  if (!capturedAt) return "unknown";
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return "unknown";
  const y = new Date(t).getUTCFullYear();
  if (y < 2015) return "pre-2015";
  if (y <= 2019) return "2015-2019";
  if (y <= 2023) return "2020-2023";
  return "2024+";
}

export type BucketCounts = Record<AgeBucket, number>;
export const emptyBuckets = (): BucketCounts => ({ "pre-2015": 0, "2015-2019": 0, "2020-2023": 0, "2024+": 0, unknown: 0 });

export function countByAge(capturedAts: readonly (string | null | undefined)[]): BucketCounts {
  const out = emptyBuckets();
  for (const c of capturedAts) out[ageBucket(c)]++;
  return out;
}

export function addBuckets(a: BucketCounts, b: BucketCounts): BucketCounts {
  const out = emptyBuckets();
  for (const k of AGE_BUCKETS) out[k] = a[k] + b[k];
  return out;
}

/** Shares summing to 1 (all zero when there are no frames). */
export function bucketShares(c: BucketCounts): Record<AgeBucket, number> {
  const n = AGE_BUCKETS.reduce((s, k) => s + c[k], 0);
  const out = emptyBuckets();
  if (n > 0) for (const k of AGE_BUCKETS) out[k] = c[k] / n;
  return out;
}

/** The matched, one-sequence-per-edge frames the classifier works from (same steps as classifyFrames). */
export function usableFrames(axis: Axis, edges: readonly EdgeSpan[], frames: readonly FrameRecord[]): MatchedFrame[] {
  return selectSequences(matchFrames(axis, edges, frames).kept).selected;
}

/**
 * Gaps in the crossfade-bridge tier (15 to 30 m, inclusive) between two consecutive usable frames that the classifier
 * REFUSES to bridge because their sequence_id differs (or is missing on either side). Same offset ordering and tier rule
 * as classifyTimeline; frames beyond the route ends are ignored.
 */
export function countRefusedSequenceGaps(
  usable: readonly MatchedFrame[], routeLengthM: number, cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG,
): number {
  const f = usable.filter((m) => m.offsetM >= 0 && m.offsetM <= routeLengthM + 0.001).sort((a, b) => a.offsetM - b.offsetM);
  let n = 0;
  for (let i = 1; i < f.length; i++) {
    const a = f[i - 1]!, b = f[i]!;
    if (classifyGap(b.offsetM - a.offsetM, cfg) !== "bridge") continue;
    const sa = a.frame.sequenceId, sb = b.frame.sequenceId;
    if (!sa || !sb || sa !== sb) n++;
  }
  return n;
}

/** Usable frames that sit inside STREET_VIDEO segments (segment extent, both ends inclusive). */
export function framesInStreetSegments(usable: readonly MatchedFrame[], segments: readonly TimelineSegment[]): MatchedFrame[] {
  const street = segments.filter((s) => s.mode === "STREET_VIDEO");
  return usable.filter((m) => street.some((s) => m.offsetM >= s.startM && m.offsetM <= s.endM));
}

export interface SegmentSummary {
  lengthM: number;
  streetVideoM: number;
  birdsEyeM: number;
  streetFraction: number;
  segments: number;
  streetSegments: number;
  bridges: number;
  /** STREET_VIDEO segments that already hold the maximum number of bridges (the 2-bridge cap was reached). */
  segmentsAtBridgeCap: number;
  /** Bridge-tier gaps refused because sequence_id differed. */
  refusedSequenceGaps: number;
  levelUncertainSegments: number;
  candidateFrames: number;
  usableFrames: number;
  dropped: Record<string, number>;
  ageBuckets: BucketCounts;
}

export function summariseSegments(
  c: Classification, usable: readonly MatchedFrame[], candidateFrames: number, dropped: Record<string, number>,
  cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG,
): SegmentSummary {
  const street = c.segments.filter((s) => s.mode === "STREET_VIDEO");
  return {
    lengthM: c.routeLengthM, streetVideoM: c.summary.streetVideoM, birdsEyeM: c.summary.birdsEyeM, streetFraction: c.summary.streetFraction,
    segments: c.segments.length, streetSegments: street.length,
    bridges: street.reduce((n, s) => n + s.bridges.length, 0),
    segmentsAtBridgeCap: street.filter((s) => s.bridges.length >= cfg.maxBridgesPerSegment).length,
    refusedSequenceGaps: countRefusedSequenceGaps(usable, c.routeLengthM, cfg),
    levelUncertainSegments: c.summary.levelUncertainSegments,
    candidateFrames, usableFrames: usable.length, dropped,
    ageBuckets: countByAge(framesInStreetSegments(usable, c.segments).map((m) => m.frame.capturedAt)),
  };
}

/** level_uncertain segments whose extent comes within radiusM (along the route) of the point's projection; 0 when the route is farther than radiusM from it. */
export function levelUncertainNear(axis: Axis, segments: readonly TimelineSegment[], at: LatLon, radiusM: number): { near: boolean; count: number } {
  const p = projectOntoAxis(axis, at);
  if (p.distanceM > radiusM) return { near: false, count: 0 };
  const lo = p.offsetM - radiusM, hi = p.offsetM + radiusM;
  return { near: true, count: segments.filter((s) => s.level_uncertain && s.startM < hi && s.endM > lo).length };
}

/** Whole-route axis and edge spans (edges tile [0, axis length]). */
export function routeInputs(r: ApproachResult): { axis: Axis; edges: EdgeSpan[] } {
  const axis = buildAxis(decodePolyline6(r.route.polyline6).map(([lat, lon]): LatLon => ({ lat, lon })));
  const edges: EdgeSpan[] = r.edges.map((e) => ({ edgeId: e.id, startM: e.startM, endM: e.endM, roadClass: e.roadClass, use: e.use, bridge: e.bridge, tunnel: e.tunnel }));
  if (edges.length) { edges[0]!.startM = 0; edges[edges.length - 1]!.endM = axis.lengthM; }
  return { axis, edges };
}

/** Sum of segment summaries (lengths and counts add; fractions are length-weighted, not means of per-route fractions). */
export function sumSummaries(list: readonly SegmentSummary[]): SegmentSummary {
  const out: SegmentSummary = {
    lengthM: 0, streetVideoM: 0, birdsEyeM: 0, streetFraction: 0, segments: 0, streetSegments: 0, bridges: 0, segmentsAtBridgeCap: 0,
    refusedSequenceGaps: 0, levelUncertainSegments: 0, candidateFrames: 0, usableFrames: 0, dropped: {}, ageBuckets: emptyBuckets(),
  };
  for (const s of list) {
    out.lengthM += s.lengthM; out.streetVideoM += s.streetVideoM; out.birdsEyeM += s.birdsEyeM;
    out.segments += s.segments; out.streetSegments += s.streetSegments; out.bridges += s.bridges;
    out.segmentsAtBridgeCap += s.segmentsAtBridgeCap; out.refusedSequenceGaps += s.refusedSequenceGaps;
    out.levelUncertainSegments += s.levelUncertainSegments; out.candidateFrames += s.candidateFrames; out.usableFrames += s.usableFrames;
    for (const [k, v] of Object.entries(s.dropped)) out.dropped[k] = (out.dropped[k] ?? 0) + v;
    out.ageBuckets = addBuckets(out.ageBuckets, s.ageBuckets);
  }
  out.streetFraction = out.lengthM > 0 ? out.streetVideoM / out.lengthM : 0;
  return out;
}

// ---- Coverage gate (D9) ----------------------------------------------------------------------------------------------
export interface GateConfig {
  /** Minimum last-500 m STREET_VIDEO share, 0..1. Default 0.35. */
  threshold: number;
  /** Only frames captured in this UTC year or later count. Default 2022. */
  minCaptureYear: number;
}
export const DEFAULT_GATE_CONFIG: GateConfig = { threshold: 0.35, minCaptureYear: 2022 };

/** Frames captured in `minYear` (UTC) or later. A missing or unparseable captured_at never counts. */
export function framesFromYear<T extends { capturedAt: string | null }>(frames: readonly T[], minYear: number): T[] {
  return frames.filter((f) => {
    if (!f.capturedAt) return false;
    const t = Date.parse(f.capturedAt);
    return Number.isFinite(t) && new Date(t).getUTCFullYear() >= minYear;
  });
}

export interface GateRow {
  routeId: string;
  costing: string;
  approachLengthM: number;
  streetVideoM: number;
  share: number;
  pass: boolean;
}
export interface GateTotal { routes: number; approachLengthM: number; streetVideoM: number; share: number; pass: boolean }
export interface GateResult {
  config: GateConfig;
  rows: GateRow[];
  /** Length-weighted per costing, plus "all" over every ok route-costing pair. */
  totals: Record<string, GateTotal>;
  routesPassing: number;
  routesTotal: number;
}

export function gateRow(routeId: string, costing: string, approachLengthM: number, streetVideoM: number, cfg: GateConfig): GateRow {
  const share = approachLengthM > 0 ? streetVideoM / approachLengthM : 0;
  return { routeId, costing, approachLengthM, streetVideoM, share, pass: approachLengthM > 0 && share >= cfg.threshold };
}

export function gateResult(rows: readonly GateRow[], cfg: GateConfig, costings: readonly string[]): GateResult {
  const total = (rs: readonly GateRow[]): GateTotal => {
    const len = rs.reduce((n, r) => n + r.approachLengthM, 0), sv = rs.reduce((n, r) => n + r.streetVideoM, 0);
    const share = len > 0 ? sv / len : 0;
    return { routes: rs.length, approachLengthM: len, streetVideoM: sv, share, pass: len > 0 && share >= cfg.threshold };
  };
  const totals: Record<string, GateTotal> = {};
  for (const c of costings) totals[c] = total(rows.filter((r) => r.costing === c));
  totals.all = total(rows);
  return { config: cfg, rows: [...rows], totals, routesPassing: rows.filter((r) => r.pass).length, routesTotal: rows.length };
}
