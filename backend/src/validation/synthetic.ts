// SYNTHETIC demonstrations of each classifier outcome. None of this is real imagery or real coverage.
import { classifyFrames, type PipelineResult } from "../classify/pipeline";
import { every, straightScene, type Scene } from "../classify/synthetic";
import type { FrameRecord } from "../classify/types";

export interface SyntheticScenario {
  id: string;
  title: string;
  description: string;
  expectation: string;
  synthetic: true;
  routeLengthM: number;
  frameCount: number;
  result: PipelineResult;
}

function run(id: string, title: string, description: string, expectation: string, sc: Scene, frames: FrameRecord[]): SyntheticScenario {
  return { id, title, description, expectation, synthetic: true, routeLengthM: sc.axis.lengthM, frameCount: frames.length, result: classifyFrames(sc.axis, sc.edges, frames) };
}

export function syntheticScenarios(): SyntheticScenario[] {
  const out: SyntheticScenario[] = [];
  {
    const sc = straightScene({ bearingDeg: 0, lengthM: 500 });
    out.push(run("street-run", "Street run", "500 m route, one sequence, a frame every 5 m on the right-hand lane from 100 m to 400 m.",
      "One STREET_VIDEO segment 100-400 m, BIRDS_EYE_3D before and after.", sc, sc.frames(every(5, 100, 400))));
  }
  {
    const sc = straightScene({ bearingDeg: 0, lengthM: 500 });
    out.push(run("short-run", "Short run", "Same road, but frames only cover 50 m (below the 60 m minimum run).",
      "No STREET_VIDEO: the whole route is BIRDS_EYE_3D (run_too_short).", sc, sc.frames(every(5, 200, 250))));
  }
  for (const gap of [14, 16]) {
    const sc = straightScene({ bearingDeg: 0, lengthM: 500 });
    out.push(run(`gap-${gap}m`, `Gap of ${gap} m`, `Frames every ${gap} m across 100-400 m (every consecutive gap is exactly ${gap} m; the limit is strict < 15 m).`,
      gap < 15 ? "Qualifies: one STREET_VIDEO segment." : "Does not qualify: BIRDS_EYE_3D (gap_too_large).", sc, sc.frames(every(gap, 100, 100 + gap * 20))));
  }
  {
    const sc = straightScene({ bearingDeg: 90, lengthM: 500 });
    const mine = sc.frames(every(5, 100, 400), { seq: "own-direction" });
    const opposite = sc.frames(every(3, 0, 500), { seq: "opposite-direction", lateralRightM: -7, headingDeltaDeg: 180 });
    out.push(run("opposite-lane", "Opposite-lane frames", "Eastbound route. 61 frames on the correct right-hand lane plus 167 frames from the opposite carriageway (7 m left, heading reversed).",
      "Opposite-lane frames are all dropped (left_of_centerline); the street run comes only from the own-direction sequence.", sc, [...mine, ...opposite]));
    out.push(run("opposite-lane-only", "Opposite-lane frames only", "Same road, only the opposite carriageway has imagery.",
      "No usable frames: the whole route is BIRDS_EYE_3D.", sc, opposite));
  }
  {
    const sc = straightScene({
      bearingDeg: 0, lengthM: 600,
      edgeAttrs: [{}, {}, {}, { bridge: true, roadClass: "motorway", use: "ramp" }, { bridge: true, roadClass: "motorway", use: "ramp" }, { bridge: true, roadClass: "motorway", use: "ramp" }],
    });
    out.push(run("interchange-discontinuity", "Interchange discontinuity", "One sequence runs continuously, but at 300 m the matched edge changes from a primary road to a motorway ramp on a bridge (a level change while the sequence continues).",
      "level_uncertain BIRDS_EYE_3D around 300 m; street video only on either side, not across the transition.", sc, sc.frames(every(5, 0, 600))));
    const sc2 = straightScene({ bearingDeg: 0, lengthM: 600 });
    out.push(run("interchange-sequence-jump", "Interchange sequence/heading jump", "Sequence A ends at 295 m and a different sequence B begins at 305 m on the next edge, with the heading relative to the road changing from -20 to +20 degrees.",
      "level_uncertain BIRDS_EYE_3D across the jump (sequence_jump and heading_jump).", sc2,
      [...sc2.frames(every(5, 0, 295), { seq: "A", headingDeltaDeg: -20 }), ...sc2.frames(every(5, 305, 600), { seq: "B", headingDeltaDeg: 20 })]));
  }
  {
    const sc = straightScene({ bearingDeg: 0, lengthM: 500 });
    out.push(run("crossfade", "Bridge: two 80 m runs, 20 m gap", "Two 80 m runs separated by a 20 m gap (15 m to 30 m: a crossfade bridge, never RIFE-interpolated).",
      "One STREET_VIDEO segment with the 20 m gap listed as a bridge (not a handoff).", sc, [...sc.frames(every(5, 100, 180)), ...sc.frames(every(5, 200, 280))]));
  }
  // exact-threshold demonstrations: two 60 m runs (frames every 5 m) joined by a gap of exactly the stated length, in integer mm
  const joined = (gapMm: number) => {
    const sc = straightScene({ bearingDeg: 0, lengthM: 500 });
    const first = every(5, 100, 160);
    const second = every(5, 0, 60).map((x) => (Math.round(160 * 1000) + gapMm + Math.round(x * 1000)) / 1000);
    return { sc, frames: [...sc.frames(first), ...sc.frames(second)] };
  };
  for (const [id, gapMm, title, expectation] of [
    ["gap-14999mm", 14999, "Gap of 14.999 m between two runs", "RIFE tier: the two pieces form ONE run (no bridge); the gap is RIFE-eligible."],
    ["gap-15000mm", 15000, "Gap of exactly 15.000 m between two runs", "Bridge tier: ONE STREET_VIDEO segment with ONE bridge (crossfade, not RIFE)."],
    ["gap-30000mm", 30000, "Gap of exactly 30.000 m between two runs", "Bridge tier (ceiling is inclusive): ONE STREET_VIDEO segment with ONE bridge."],
    ["gap-30001mm", 30001, "Gap of 30.001 m between two runs", "Handoff tier: TWO STREET_VIDEO segments with BIRDS_EYE_3D between, no bridge."],
  ] as const) {
    const { sc, frames } = joined(gapMm);
    out.push(run(id, title, `Two 60 m runs (a frame every 5 m) joined by a gap of ${(gapMm / 1000).toFixed(3)} m between the last frame of the first and the first frame of the second.`, expectation, sc, frames));
  }
  {
    const sc = straightScene({ bearingDeg: 0, lengthM: 500 });
    out.push(run("bridge-chain", "Chain of three runs, two bridges", "Three 60 m runs separated by gaps of 20 m and 25 m, all one sequence (pairwise rule: each qualifying run joins the previous one, up to the 2-bridge cap).",
      "ONE STREET_VIDEO segment 50-275 m with TWO bridges (110-130 m and 190-215 m).", sc,
      [...sc.frames(every(5, 50, 110)), ...sc.frames(every(5, 130, 190)), ...sc.frames(every(5, 215, 275))]));
  }
  {
    const sc = straightScene({ bearingDeg: 0, lengthM: 600 });
    out.push(run("bridge-cap", "Bridge cap: four runs, three valid gaps", "Four 60 m runs, one sequence, separated by gaps of 20 m, 25 m and 22 m. A segment may hold at most 2 bridges.",
      "STREET_VIDEO 50-275 m with TWO bridges, a BIRDS_EYE_3D handoff over the third gap (275-297 m), then the fourth run (297-357 m) as its own STREET_VIDEO segment with no bridge.", sc,
      [...sc.frames(every(5, 50, 110)), ...sc.frames(every(5, 130, 190)), ...sc.frames(every(5, 215, 275)), ...sc.frames(every(5, 297, 357))]));
  }
  {
    const sc = straightScene({ bearingDeg: 0, lengthM: 500 });
    out.push(run("bridge-sequence-change", "Same-sequence rule: 20 m gap, different sequence_id", "Two 60 m runs separated by a 20 m gap, but the second run belongs to a different sequence_id.",
      "No bridge across the sequence change (the matcher keeps one sequence per edge, so the other run is dropped as other_sequence): ONE STREET_VIDEO segment with no bridges, the rest BIRDS_EYE_3D.", sc,
      [...sc.frames(every(5, 100, 160), { seq: "A" }), ...sc.frames(every(5, 180, 240), { seq: "B" })]));
  }
  return out;
}
