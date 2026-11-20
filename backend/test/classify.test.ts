import { describe, expect, it } from "vitest";
import { classifyFrames } from "../src/classify/pipeline";
import { DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import { every, straightScene } from "../src/classify/synthetic";

const L = 600;
const run = (frames: ReturnType<typeof straightScene>["frames"] extends (...a: any) => infer R ? R : never, sc = straightScene({ lengthM: L })) =>
  classifyFrames(sc.axis, sc.edges, frames).classification;
const sc0 = straightScene({ lengthM: L });
const modes = (c: ReturnType<typeof run>) => c.segments.map((s) => `${s.mode === "STREET_VIDEO" ? "S" : "B"}${Math.round(s.startM)}-${Math.round(s.endM)}`);
const streets = (c: ReturnType<typeof run>) => c.segments.filter((s) => s.mode === "STREET_VIDEO");

/** invariants that must hold for every timeline */
function invariants(c: ReturnType<typeof run>) {
  expect(c.segments[0]!.startM).toBeCloseTo(0, 6);
  expect(c.segments.at(-1)!.endM).toBeCloseTo(c.routeLengthM, 6);
  c.segments.forEach((s, i) => {
    if (i > 0) expect(s.startM).toBeCloseTo(c.segments[i - 1]!.endM, 6);
    if (s.mode === "STREET_VIDEO") expect(s.lengthM).toBeGreaterThanOrEqual(DEFAULT_CLASSIFY_CONFIG.minRunM);
    if (i > 0) expect(s.mode === "STREET_VIDEO" && c.segments[i - 1]!.mode === "STREET_VIDEO").toBe(false);
    if (s.mode === "BIRDS_EYE_3D" && i > 0 && c.segments[i - 1]!.mode === "BIRDS_EYE_3D") throw new Error("adjacent BIRDS_EYE segments");
  });
}

describe("documented defaults", () => {
  it("60 m minimum run, strict 15 m gap, 30 m crossfade ceiling", () => {
    expect(DEFAULT_CLASSIFY_CONFIG).toMatchObject({ minRunM: 60, maxGapM: 15, crossfadeMaxGapM: 30 });
  });
});

describe("minimum run length (60 m, inclusive)", () => {
  it("a 60 m run of dense frames is street video; 59 m is not; no frames is birds-eye", () => {
    const ok = run(sc0.frames(every(5, 100, 160)));
    expect(modes(ok)).toEqual(["B0-100", "S100-160", "B160-600"]);
    const short = run(sc0.frames(every(5, 100, 159)));
    expect(modes(short)).toEqual(["B0-600"]);
    expect(short.segments[0]!.birdsEyeReason).toBe("run_too_short");
    const none = run([]);
    expect(modes(none)).toEqual(["B0-600"]);
    expect(none.segments[0]).toMatchObject({ birdsEyeReason: "no_frames", frameCount: 0, maxGapM: null, capturedAt: null });
    invariants(ok); invariants(short); invariants(none);
  });
});

describe("max gap (strict < 15 m), never an average", () => {
  it("14 m gaps qualify; exactly 15 m and 16 m do not (strict '<')", () => {
    for (const [step, street] of [[14, true], [14.999, true], [15, false], [16, false]] as const) {
      const c = run(sc0.frames(every(step, 50, 50 + step * 6)));
      expect(streets(c).length, `step ${step}`).toBe(street ? 1 : 0);
      if (street) expect(streets(c)[0]!.maxGapM).toBeCloseTo(step, 6);
      else expect(c.segments.every((s) => s.mode === "BIRDS_EYE_3D")).toBe(true);
    }
  });

  it("a run with ONE 20 m gap but a tiny average gap does NOT qualify", () => {
    const offs = [...every(2.5, 100, 150), ...every(2.5, 170, 220)]; // 2.5 m spacing, one 20 m hole; span 120 m
    const gaps = offs.slice(1).map((o, i) => o - offs[i]!);
    expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeLessThan(3.5); // average is tiny
    expect(Math.max(...gaps)).toBe(20);
    const c = run(sc0.frames(offs));
    expect(modes(c)).toEqual(["B0-600"]);
    expect(c.segments[0]).toMatchObject({ birdsEyeReason: "gap_too_large", maxGapM: 20 });
    expect(c.summary.maxGapM).toBe(20);
  });

  it("a long run with a gap above the ceiling splits into qualifying pieces only", () => {
    const c = run(sc0.frames([...every(5, 20, 70), ...every(5, 110, 300)])); // 50 m piece (too short) + 40 m hole + 190 m piece
    expect(modes(c)).toEqual(["B0-110", "S110-300", "B300-600"]);
  });
});

describe("crossfade inside a street run vs segment-level handoff (separate rules)", () => {
  const twoRuns = (gap: number) => run(sc0.frames([...every(5, 20, 100), ...every(5, 100 + gap, 100 + gap + 80)]));

  it("CROSSFADE: a 20 m gap between two qualifying runs stays ONE street segment with the gap marked", () => {
    const c = twoRuns(20);
    expect(modes(c)).toEqual(["B0-20", "S20-200", "B200-600"]);
    const s = streets(c)[0]!;
    expect(s.crossfades).toEqual([{ startM: 100, endM: 120, gapM: 20 }]);
    expect(s.maxGapM).toBeCloseTo(20, 6);
    expect(c.segments.filter((x) => x.mode === "BIRDS_EYE_3D").every((x) => x.crossfades.length === 0)).toBe(true);
    invariants(c);
  });
  it("crossfade ceiling is inclusive: 30 m crossfades, 30.5 m hands off", () => {
    expect(streets(twoRuns(30)).length).toBe(1);
    expect(streets(twoRuns(30))[0]!.crossfades.length).toBe(1);
  });
  it("HANDOFF: a 40 m gap between qualifying runs is two street segments with BIRDS_EYE_3D between, no crossfade", () => {
    const c = twoRuns(40);
    expect(modes(c)).toEqual(["B0-20", "S20-100", "B100-140", "S140-220", "B220-600"]);
    expect(streets(c).every((s) => s.crossfades.length === 0)).toBe(true);
    expect(c.segments[2]).toMatchObject({ mode: "BIRDS_EYE_3D", birdsEyeReason: "no_frames" });
    expect(streets(twoRuns(30.5)).length).toBe(2);
    invariants(c);
  });
  it("a gap bridged by crossfade must have qualifying runs on both sides", () => {
    const c = run(sc0.frames([...every(5, 20, 100), ...every(5, 120, 160)])); // second piece only 40 m
    expect(modes(c)).toEqual(["B0-20", "S20-100", "B100-600"]);
  });
});

describe("hysteresis: no flicker", () => {
  it("alternating SHORT runs (30 m frames / 20 m gaps) never produce street segments", () => {
    const offs: number[] = [];
    for (let s = 0; s + 30 <= L; s += 50) offs.push(...every(5, s, s + 30));
    const c = run(sc0.frames(offs));
    expect(modes(c)).toEqual(["B0-600"]);
    expect(c.segments.length).toBe(1);
  });
  it("alternating qualifying runs with crossfadable gaps collapse into ONE street segment", () => {
    const offs: number[] = [];
    for (let s = 0; s + 70 <= L; s += 90) offs.push(...every(5, s, s + 70)); // 70 m runs, 20 m gaps
    const c = run(sc0.frames(offs));
    expect(streets(c).length).toBe(1);
    expect(streets(c)[0]!.crossfades.length).toBeGreaterThanOrEqual(5);
    expect(c.segments.length).toBeLessThanOrEqual(3);
    invariants(c);
  });
  it("alternating 65 m runs and 45 m gaps flip at most once per run, never below the minimum lengths", () => {
    const offs: number[] = [];
    for (let s = 0; s + 65 <= L; s += 110) offs.push(...every(5, s, s + 65));
    const c = run(sc0.frames(offs));
    invariants(c);
    expect(streets(c).length).toBe(5);
    for (const s of c.segments) expect(s.lengthM).toBeGreaterThanOrEqual(40);
  });
  it("random-ish sparse input never yields a segment shorter than the minimum street run", () => {
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const offs = Array.from({ length: 80 }, () => rnd() * L).sort((a, b) => a - b);
    invariants(run(sc0.frames(offs)));
  });
});

describe("opposite-lane frames and compass directions (full pipeline)", () => {
  it("opposite-carriageway frames are excluded and do not change the street result, for every heading of the route", () => {
    for (const bearing of [0, 90, 180, 270, 33]) {
      const sc = straightScene({ bearingDeg: bearing, lengthM: 400 });
      const mine = sc.frames(every(5, 50, 250), { seq: "mine" });
      const theirs = sc.frames(every(2, 0, 400), { seq: "opp", lateralRightM: -7, headingDeltaDeg: 180 });
      const r = classifyFrames(sc.axis, sc.edges, [...mine, ...theirs]);
      expect(r.dropped.left_of_centerline, `bearing ${bearing}`).toBe(theirs.length);
      expect(streets(r.classification)[0]).toMatchObject({ startM: expect.closeTo(50, 1), sequenceId: "mine" });
      // only the opposite lane present: no street video at all
      const onlyOpp = classifyFrames(sc.axis, sc.edges, theirs);
      expect(streets(onlyOpp.classification).length, `bearing ${bearing}`).toBe(0);
      expect(onlyOpp.classification.segments[0]!.birdsEyeReason).toBe("no_frames");
    }
  });
});

describe("level_uncertain (multi-level interchange safety)", () => {
  const edges4 = (attrs: object[]) => straightScene({ lengthM: 400, edgeAttrs: attrs });
  const cont = (sc: ReturnType<typeof straightScene>) => sc.frames(every(5, 0, 400));
  const flagged = (c: ReturnType<typeof run>) => c.segments.filter((s) => s.level_uncertain);

  it("control: one sequence across edges with identical level attributes is one street segment, nothing flagged", () => {
    const sc = edges4([{}, {}, {}, {}]);
    const c = classifyFrames(sc.axis, sc.edges, cont(sc)).classification;
    expect(modes(c)).toEqual(["S0-400"]);
    expect(flagged(c)).toEqual([]);
  });

  it("road class / bridge change while the sequence continues -> level_uncertain BIRDS_EYE_3D around the transition", () => {
    const sc = edges4([{}, {}, { bridge: true, roadClass: "motorway" }, { bridge: true, roadClass: "motorway" }]);
    const c = classifyFrames(sc.axis, sc.edges, cont(sc)).classification;
    invariants(c);
    const f = flagged(c);
    expect(f.length).toBe(1); // the 200 m transition; spans merge with the 20 m pads (one flagged blip)
    expect(f[0]).toMatchObject({ mode: "BIRDS_EYE_3D", birdsEyeReason: "level_uncertain", level_uncertain_reasons: ["level_change"] });
    expect(f[0]!.startM).toBeLessThanOrEqual(200 - 15);
    expect(f[0]!.endM).toBeGreaterThanOrEqual(200 + 15);
    // no street segment overlaps the flagged zone
    expect(streets(c).some((s) => s.startM < f[0]!.endM && s.endM > f[0]!.startM)).toBe(false);
    expect(streets(c).length).toBe(2);
  });

  it("an explicit OSM layer change is detected as a level change", () => {
    const sc = edges4([{ layer: 0 }, { layer: 0 }, { layer: 1 }, { layer: 1 }]);
    expect(flagged(classifyFrames(sc.axis, sc.edges, cont(sc)).classification)[0]!.level_uncertain_reasons).toEqual(["level_change"]);
  });

  it("a sequence jump at an edge transition is flagged and falls back to BIRDS_EYE_3D", () => {
    const sc = edges4([{}, {}, {}, {}]);
    const a = sc.frames(every(5, 0, 195), { seq: "A" }), b = sc.frames(every(5, 205, 400), { seq: "B" });
    const c = classifyFrames(sc.axis, sc.edges, [...a, ...b]).classification;
    invariants(c);
    const f = flagged(c);
    expect(f.length).toBe(1);
    expect(f[0]!.level_uncertain_reasons).toContain("sequence_jump");
    expect(f[0]!.startM).toBeLessThan(195);
    expect(f[0]!.endM).toBeGreaterThan(205);
    expect(streets(c).map((s) => s.sequenceId)).toEqual(["A", "B"]);
  });

  it("a heading jump across an edge transition is flagged; a small wobble is not", () => {
    const sc = edges4([{}, {}, {}, {}]);
    const jump = (d1: number, d2: number) => classifyFrames(sc.axis, sc.edges, [
      ...sc.frames(every(5, 0, 195), { headingDeltaDeg: d1 }), ...sc.frames(every(5, 205, 400), { headingDeltaDeg: d2 }),
    ]).classification;
    const big = jump(-20, 20); // 40 deg change of heading relative to the road
    expect(flagged(big)[0]!.level_uncertain_reasons).toEqual(["heading_jump"]);
    expect(flagged(jump(-10, 10))).toEqual([]); // 20 deg: within noise
    expect(flagged(jump(-15, 15))).toEqual([]); // 30 deg: not above the 30 deg limit
  });

  it("discontinuities between frames far apart are a plain gap, not a level flag", () => {
    const sc = edges4([{}, {}, {}, {}]);
    const c = classifyFrames(sc.axis, sc.edges, [...sc.frames(every(5, 0, 150), { seq: "A" }), ...sc.frames(every(5, 250, 400), { seq: "B" })]).classification;
    expect(flagged(c)).toEqual([]);
    expect(modes(c)).toEqual(["S0-150", "B150-250", "S250-400"]);
  });
});

describe("segment record", () => {
  it("reports edge ids, sequence, frame count, max gap and capture dates; summary has coverage density", () => {
    const sc = straightScene({ lengthM: 300 });
    const frames = [...sc.frames(every(10, 0, 100), { capturedAt: "2023-05-01T08:00:00Z" }), sc.frame(105, { capturedAt: "2024-09-09T08:00:00Z" })];
    const c = classifyFrames(sc.axis, sc.edges, frames).classification;
    const s = streets(c)[0]!;
    expect(s).toMatchObject({ mode: "STREET_VIDEO", sequenceId: "seqA", frameCount: 12, level_uncertain: false, birdsEyeReason: null });
    expect(s.edgeIds).toEqual([1000, 1001]);
    expect(s.maxGapM).toBeCloseTo(10, 6);
    expect(s.capturedAt).toEqual({ earliest: "2023-05-01T08:00:00Z", latest: "2024-09-09T08:00:00Z" });
    expect(c.summary.usableFrameCount).toBe(12);
    expect(c.summary.framesPer100m).toBeCloseTo(4, 6);
    expect(c.summary.streetFraction).toBeCloseTo(105 / 300, 6);
  });
});
