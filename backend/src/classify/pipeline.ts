import type { Axis } from "../geo/local";
import { classifyTimeline, DEFAULT_CLASSIFY_CONFIG, type Classification, type ClassifyConfig } from "./classify";
import { DEFAULT_MATCH_CONFIG, matchFrames, selectSequences, type MatchConfig } from "./match";
import type { DropReason, EdgeSpan, FrameRecord } from "./types";

export interface PipelineResult {
  classification: Classification;
  candidateFrames: number;
  usableFrames: number;
  dropped: Partial<Record<DropReason, number>>;
}

/** frames -> match/filter -> one sequence per edge -> timeline. */
export function classifyFrames(
  axis: Axis, edges: readonly EdgeSpan[], frames: readonly FrameRecord[],
  match: MatchConfig = DEFAULT_MATCH_CONFIG, cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG,
): PipelineResult {
  const m = matchFrames(axis, edges, frames, match);
  const s = selectSequences(m.kept);
  const dropped: Partial<Record<DropReason, number>> = {};
  for (const d of [...m.dropped, ...s.dropped]) dropped[d.reason] = (dropped[d.reason] ?? 0) + 1;
  return {
    classification: classifyTimeline(axis.lengthM, edges, s.selected, cfg),
    candidateFrames: frames.length, usableFrames: s.selected.length, dropped,
  };
}
