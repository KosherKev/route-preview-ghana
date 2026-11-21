// Clip plans: which STREET_VIDEO segments of a classified route become video clips, and exactly which frames,
// bridges and attribution data the Python worker needs. Pure functions; no I/O, no imagery-source imports.
import type { Classification, TimelineSegment } from "../classify/classify";
import type { MatchedFrame } from "../classify/match";
import type { AttributionFrame } from "../imagery/attribution";

export const CLIP_DIRECTION = "forward" as const;

export interface PlanFrame {
  image_id: string;
  sequence_id: string | null;
  offsetM: number;
  lat: number;
  lon: number;
  heading_deg: number | null;
  captured_at: string | null;
}

export interface ClipPlan {
  /** Cache key with `direction`: the first routing edge the segment touches. */
  edge_id: number;
  direction: typeof CLIP_DIRECTION;
  routeId: string;
  segment: { startM: number; endM: number; lengthM: number; edgeIds: number[]; sequenceId: string | null };
  /** Crossfade bridges (15 to 30 m gaps, same sequence only) inside the segment, from the classifier. */
  bridges: { startM: number; endM: number; gapM: number }[];
  /** Ordered along the route. */
  frames: PlanFrame[];
  captureYears: { min: number | null; max: number | null; mean: number | null };
}

const yearOf = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
};

export function captureYears(frames: readonly { captured_at: string | null }[]): ClipPlan["captureYears"] {
  const ys = frames.map((f) => yearOf(f.captured_at)).filter((y): y is number => y !== null);
  if (ys.length === 0) return { min: null, max: null, mean: null };
  return { min: Math.min(...ys), max: Math.max(...ys), mean: ys.reduce((a, b) => a + b, 0) / ys.length };
}

/** One plan per STREET_VIDEO segment (frames are the usable, matched, one-sequence-per-edge frames inside the segment extent). */
export function buildClipPlans(routeId: string, c: Classification, usable: readonly MatchedFrame[]): ClipPlan[] {
  const plans: ClipPlan[] = [];
  for (const s of c.segments) {
    if (s.mode !== "STREET_VIDEO" || s.edgeIds.length === 0) continue;
    const inside = usable
      .filter((m) => m.offsetM >= s.startM && m.offsetM <= s.endM && (s.sequenceId === null || m.frame.sequenceId === s.sequenceId))
      .sort((a, b) => a.offsetM - b.offsetM);
    if (inside.length < 2) continue;
    const frames: PlanFrame[] = inside.map((m) => ({
      image_id: m.frame.imageId, sequence_id: m.frame.sequenceId, offsetM: m.offsetM, lat: m.frame.lat, lon: m.frame.lon,
      heading_deg: m.frame.compassAngleDeg, captured_at: m.frame.capturedAt,
    }));
    plans.push({
      edge_id: s.edgeIds[0]!, direction: CLIP_DIRECTION, routeId,
      segment: { startM: s.startM, endM: s.endM, lengthM: s.lengthM, edgeIds: s.edgeIds, sequenceId: s.sequenceId },
      bridges: s.bridges.map(({ startM, endM, gapM }) => ({ startM, endM, gapM })),
      frames, captureYears: captureYears(frames),
    });
  }
  return plans;
}

export interface PickOptions { count: number; minLengthM: number; maxLengthM: number }

/** Newest imagery first (highest mean capture year), then more frames; one plan per (edge_id, direction); length window applied. */
export function pickPlans(plans: readonly ClipPlan[], o: PickOptions): ClipPlan[] {
  const ok = plans.filter((p) => p.segment.lengthM >= o.minLengthM && p.segment.lengthM <= o.maxLengthM && p.captureYears.mean !== null);
  ok.sort((a, b) => b.captureYears.mean! - a.captureYears.mean! || b.frames.length - a.frames.length || a.edge_id - b.edge_id);
  const seen = new Set<string>();
  const out: ClipPlan[] = [];
  for (const p of ok) {
    const k = `${p.edge_id}:${p.direction}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= o.count) break;
  }
  return out;
}

export type { TimelineSegment, AttributionFrame };
