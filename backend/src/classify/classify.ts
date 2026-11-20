// Task 3.2b: route timeline classifier (STREET_VIDEO vs BIRDS_EYE_3D). Pure: no I/O, no imagery-source imports.
//
// Rules (all thresholds are in ClassifyConfig and documented there):
//  1. Gap rule uses the MAXIMUM gap between consecutive usable frames, never an average.
//  2. A "good run" is a maximal group of consecutive usable frames of ONE sequence whose every consecutive gap is
//     STRICTLY < maxGapM (a gap of exactly 15.0 m does not qualify; 14.999 does).
//  3. A good run qualifies as STREET_VIDEO only if its extent (first to last frame) is >= minRunM (inclusive).
//  4. CROSSFADE (inside a street run): two qualifying good runs of the same chain separated by a gap g with
//     maxGapM <= g <= crossfadeMaxGapM merge into ONE street segment; the gap is recorded in `crossfades`.
//  5. HANDOFF (segment level): anything else (a gap > crossfadeMaxGapM, a non-qualifying run, a sequence change,
//     no frames) is BIRDS_EYE_3D. Rules 4 and 5 are independent and separately tested.
//  6. Hysteresis falls out of 3-5: there are no street segments shorter than minRunM, no adjacent segments of the same
//     mode (except street segments of different sequences, which cannot touch), and gaps up to crossfadeMaxGapM never
//     split a street segment.
//  7. level_uncertain: at an edge transition between consecutive usable frames closer than discontinuityMaxGapM, flag
//     a sequence jump, a heading jump (change in heading-relative-to-road above headingJumpDeg) or a level change
//     (road class / use / bridge / tunnel / layer differs on the edges between them while the sequence continues).
//     The flagged span (frames' extent padded by levelPadM) is forced to BIRDS_EYE_3D and never merged away.
import { byOffset, type MatchedFrame } from "./match";
import type { BirdsEyeReason, EdgeSpan, LevelReason, Mode } from "./types";
import { absAngleDiffDeg } from "../geo/local";

export interface ClassifyConfig {
  /** Minimum street run length, metres, inclusive. Default 60. */
  minRunM: number;
  /** Gap limit, metres, STRICT: gap < maxGapM keeps a run together. Default 15. */
  maxGapM: number;
  /** Largest gap that may be crossfaded inside a street segment, inclusive. Default 30. */
  crossfadeMaxGapM: number;
  /** Only pairs closer than this are examined for discontinuities. Default 30. */
  discontinuityMaxGapM: number;
  /** Heading-relative-to-road change that counts as a jump, degrees. Default 30. */
  headingJumpDeg: number;
  /** Padding around a flagged transition, metres, each side. Default 20. */
  levelPadM: number;
}

export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  minRunM: 60, maxGapM: 15, crossfadeMaxGapM: 30, discontinuityMaxGapM: 30, headingJumpDeg: 30, levelPadM: 20,
};

export interface Crossfade { startM: number; endM: number; gapM: number }

export interface TimelineSegment {
  startM: number;
  endM: number;
  lengthM: number;
  mode: Mode;
  edgeIds: number[];
  sequenceId: string | null;
  frameCount: number;
  /** Largest gap between consecutive usable frames inside the segment (incl. crossfaded gaps); null with < 2 frames. */
  maxGapM: number | null;
  capturedAt: { earliest: string; latest: string } | null;
  level_uncertain: boolean;
  level_uncertain_reasons: LevelReason[];
  /** Gaps > maxGapM inside a STREET_VIDEO segment, to be crossfaded. Always empty for BIRDS_EYE_3D. */
  crossfades: Crossfade[];
  /** Why a BIRDS_EYE_3D segment is not street video; null for STREET_VIDEO. */
  birdsEyeReason: BirdsEyeReason | null;
}

export interface Classification {
  routeLengthM: number;
  segments: TimelineSegment[];
  summary: {
    streetVideoM: number;
    birdsEyeM: number;
    streetFraction: number;
    usableFrameCount: number;
    framesPer100m: number;
    maxGapM: number | null;
    levelUncertainSegments: number;
  };
}

interface Span { startM: number; endM: number; reasons: Set<LevelReason> }

function levelKey(e: EdgeSpan): string {
  return `${e.roadClass ?? "?"}|${e.use ?? "?"}|b${e.bridge ? 1 : 0}|t${e.tunnel ? 1 : 0}|l${e.layer ?? "-"}`;
}

export function detectLevelSpans(
  frames: readonly MatchedFrame[], edges: readonly EdgeSpan[], routeLengthM: number, cfg: ClassifyConfig,
): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i]!, b = frames[i + 1]!;
    if (a.edgeIndex === b.edgeIndex || b.offsetM - a.offsetM > cfg.discontinuityMaxGapM) continue;
    const reasons = new Set<LevelReason>();
    const sameSeq = a.frame.sequenceId === b.frame.sequenceId;
    if (!sameSeq) reasons.add("sequence_jump");
    if (sameSeq) {
      const ka = levelKey(edges[a.edgeIndex]!);
      for (let k = a.edgeIndex + 1; k <= b.edgeIndex; k++) if (levelKey(edges[k]!) !== ka) { reasons.add("level_change"); break; }
    }
    if (absAngleDiffDeg(a.headingDeltaDeg, b.headingDeltaDeg) > cfg.headingJumpDeg) reasons.add("heading_jump");
    if (reasons.size === 0) continue;
    spans.push({ startM: Math.max(0, a.offsetM - cfg.levelPadM), endM: Math.min(routeLengthM, b.offsetM + cfg.levelPadM), reasons });
  }
  // union overlapping spans
  const merged: Span[] = [];
  for (const s of spans.sort((x, y) => x.startM - y.startM)) {
    const last = merged[merged.length - 1];
    if (last && s.startM <= last.endM) { last.endM = Math.max(last.endM, s.endM); s.reasons.forEach((r) => last.reasons.add(r)); }
    else merged.push({ ...s, reasons: new Set(s.reasons) });
  }
  return merged;
}

const minMax = (xs: string[]) => {
  const t = xs.filter(Boolean).sort((p, q) => Date.parse(p) - Date.parse(q));
  return t.length ? { earliest: t[0]!, latest: t[t.length - 1]! } : null;
};

function maxGap(frames: readonly MatchedFrame[]): number | null {
  let g: number | null = null;
  for (let i = 1; i < frames.length; i++) g = Math.max(g ?? 0, frames[i]!.offsetM - frames[i - 1]!.offsetM);
  return g;
}

export function classifyTimeline(
  routeLengthM: number, edges: readonly EdgeSpan[], usable: readonly MatchedFrame[], cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG,
): Classification {
  const frames = [...usable].sort(byOffset);
  const spans = detectLevelSpans(frames, edges, routeLengthM, cfg);
  const inSpan = (o: number) => spans.some((s) => o >= s.startM && o <= s.endM);
  const spanBetween = (a: number, b: number) => spans.some((s) => s.startM < b && s.endM > a);

  // chains: consecutive candidate frames, split by sequence change, gap > crossfadeMaxGapM, or a flagged span between them
  const chains: MatchedFrame[][] = [];
  for (const f of frames.filter((m) => !inSpan(m.offsetM))) {
    const chain = chains[chains.length - 1];
    const prev = chain?.[chain.length - 1];
    if (chain && prev && prev.frame.sequenceId === f.frame.sequenceId && f.offsetM - prev.offsetM <= cfg.crossfadeMaxGapM && !spanBetween(prev.offsetM, f.offsetM)) chain.push(f);
    else chains.push([f]);
  }

  interface Street { frames: MatchedFrame[]; crossfades: Crossfade[] }
  const streets: Street[] = [];
  for (const chain of chains) {
    // good runs: split where gap >= maxGapM (strict < keeps together)
    const runs: MatchedFrame[][] = [[chain[0]!]];
    for (let i = 1; i < chain.length; i++) {
      if (chain[i]!.offsetM - chain[i - 1]!.offsetM < cfg.maxGapM) runs[runs.length - 1]!.push(chain[i]!);
      else runs.push([chain[i]!]);
    }
    const qualifies = (r: MatchedFrame[]) => r[r.length - 1]!.offsetM - r[0]!.offsetM >= cfg.minRunM;
    let cur: Street | null = null;
    let prevRun: MatchedFrame[] | null = null;
    for (const r of runs) {
      if (!qualifies(r)) { if (cur) streets.push(cur); cur = null; prevRun = null; continue; }
      if (cur && prevRun) {
        const a = prevRun[prevRun.length - 1]!.offsetM, b = r[0]!.offsetM;
        cur.crossfades.push({ startM: a, endM: b, gapM: b - a });
        cur.frames.push(...r);
      } else {
        if (cur) streets.push(cur);
        cur = { frames: [...r], crossfades: [] };
      }
      prevRun = r;
    }
    if (cur) streets.push(cur);
  }
  streets.sort((a, b) => a.frames[0]!.offsetM - b.frames[0]!.offsetM);

  const edgesIn = (s: number, e: number) => edges.filter((x) => x.endM > s && x.startM < e).map((x) => x.edgeId);
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  const birds = (s: number, e: number, closedEnd: boolean) => {
    if (e - s <= 1e-9) return;
    const inside = frames.filter((m) => (m.offsetM > s || s === 0) && (m.offsetM < e || (closedEnd && m.offsetM <= e)));
    const reasons = new Set<LevelReason>();
    for (const sp of spans) if (sp.startM < e && sp.endM > s) sp.reasons.forEach((r) => reasons.add(r));
    const lu = reasons.size > 0;
    const g = maxGap(inside);
    const reason: BirdsEyeReason = lu ? "level_uncertain" : inside.length === 0 ? "no_frames" : g !== null && g >= cfg.maxGapM ? "gap_too_large" : "run_too_short";
    segments.push({
      startM: s, endM: e, lengthM: e - s, mode: "BIRDS_EYE_3D", edgeIds: edgesIn(s, e), sequenceId: null, frameCount: inside.length,
      maxGapM: g, capturedAt: minMax(inside.map((m) => m.frame.capturedAt ?? "")), level_uncertain: lu,
      level_uncertain_reasons: [...reasons], crossfades: [], birdsEyeReason: reason,
    });
  };
  for (const st of streets) {
    const s = st.frames[0]!.offsetM, e = st.frames[st.frames.length - 1]!.offsetM;
    birds(cursor, s, false);
    segments.push({
      startM: s, endM: e, lengthM: e - s, mode: "STREET_VIDEO", edgeIds: edgesIn(s, e), sequenceId: st.frames[0]!.frame.sequenceId,
      frameCount: st.frames.length, maxGapM: maxGap(st.frames), capturedAt: minMax(st.frames.map((m) => m.frame.capturedAt ?? "")),
      level_uncertain: false, level_uncertain_reasons: [], crossfades: st.crossfades, birdsEyeReason: null,
    });
    cursor = e;
  }
  birds(cursor, routeLengthM, true);

  const streetM = segments.filter((x) => x.mode === "STREET_VIDEO").reduce((n, x) => n + x.lengthM, 0);
  return {
    routeLengthM, segments,
    summary: {
      streetVideoM: streetM, birdsEyeM: routeLengthM - streetM, streetFraction: routeLengthM > 0 ? streetM / routeLengthM : 0,
      usableFrameCount: frames.length, framesPer100m: routeLengthM > 0 ? (frames.length / routeLengthM) * 100 : 0,
      maxGapM: maxGap(frames), levelUncertainSegments: segments.filter((x) => x.level_uncertain).length,
    },
  };
}
