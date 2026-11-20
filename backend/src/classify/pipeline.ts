import type { Axis } from "../geo/local";
import { disabledSources } from "../imagery/sources";
import { classifyTimeline, DEFAULT_CLASSIFY_CONFIG, type Classification, type ClassifyConfig } from "./classify";
import { DEFAULT_MATCH_CONFIG, matchFrames, selectSequences, type MatchConfig } from "./match";
import type { DropReason, EdgeSpan, FrameRecord } from "./types";

export interface PipelineResult {
  classification: Classification;
  candidateFrames: number;
  usableFrames: number;
  dropped: Partial<Record<DropReason, number>>;
  /** Disabled imagery sources (IMAGERY_SOURCES_DISABLED) whose frames were excluded before classification; empty when none. */
  sourcesExcluded: string[];
}

/**
 * frames -> match/filter -> one sequence per edge -> timeline. Frames whose `source` is disabled (read at call time) are
 * removed first; `alreadyExcluded` carries sources a loader already removed, so they are still reported.
 */
export function classifyFrames(
  axis: Axis, edges: readonly EdgeSpan[], frames: readonly FrameRecord[],
  match: MatchConfig = DEFAULT_MATCH_CONFIG, cfg: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG,
  alreadyExcluded: readonly string[] = [],
): PipelineResult {
  const disabled = disabledSources();
  const excluded = new Set(alreadyExcluded);
  const kept = disabled.length === 0 ? frames : frames.filter((f) => {
    const s = f.source?.trim().toLowerCase();
    if (s && disabled.includes(s)) { excluded.add(s); return false; }
    return true;
  });
  frames = kept;
  const m = matchFrames(axis, edges, frames, match);
  const s = selectSequences(m.kept);
  const dropped: Partial<Record<DropReason, number>> = {};
  for (const d of [...m.dropped, ...s.dropped]) dropped[d.reason] = (dropped[d.reason] ?? 0) + 1;
  return {
    classification: classifyTimeline(axis.lengthM, edges, s.selected, cfg),
    candidateFrames: frames.length, usableFrames: s.selected.length, dropped,
    sourcesExcluded: [...excluded].sort(),
  };
}
