import { describe, expect, it } from "vitest";
import { classifyGap, classifyTimeline, DEFAULT_CLASSIFY_CONFIG, isRifeEligible } from "../src/classify/classify";
import type { MatchedFrame } from "../src/classify/match";
import { classifyFrames } from "../src/classify/pipeline";
import { every, straightScene } from "../src/classify/synthetic";
import type { EdgeSpan } from "../src/classify/types";

// Two-tier gap rule (owner-confirmed 2026-11-20): gap < 15 m RIFE-eligible; 15..30 m (inclusive) crossfade bridge,
// never RIFE; > 30 m or an unbridgeable run < 60 m hands off to BIRDS_EYE_3D. Applied pairwise.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- integer-millimetre, timeline-level fixtures (no matcher) ----
const L = 3000;
const edges: EdgeSpan[] = [{ edgeId: 1, startM: 0, endM: L, roadClass: "primary", use: "road", bridge: false, tunnel: false }];
const mm = (v: number) => Math.round(v * 1000) / 1000;
const mf = (offsetM: number, i: number): MatchedFrame => ({
  frame: { imageId: `f${i}`, sequenceId: "s", lat: 0, lon: 0, compassAngleDeg: 0, qualityScore: 1, capturedAt: null },
  offsetM: mm(offsetM), lateralRightM: 1, localBearingDeg: 0, headingDeltaDeg: 0, edgeIndex: 0, edgeId: 1,
});
/** runs of 60 m (13 frames every 5 m) separated by the given gaps in millimetres, starting at startM */
function chainMm(startM: number, gapsMm: number[]): MatchedFrame[] {
  const out: number[] = [];
  let at = Math.round(startM * 1000);
  const run = () => { for (let i = 0; i < 13; i++) { out.push(at); if (i < 12) at += 5000; } };
  run();
  for (const g of gapsMm) { at += g; run(); }
  return out.map((o, i) => mf(o / 1000, i));
}
const segs = (fs: MatchedFrame[]) => classifyTimeline(L, edges, fs, DEFAULT_CLASSIFY_CONFIG).segments;
const streets = (fs: MatchedFrame[]) => segs(fs).filter((s) => s.mode === "STREET_VIDEO");

describe("gap tiers at exact integer-millimetre thresholds", () => {
  it("classifyGap: 14.999 rife, 15.000 bridge, 30.000 bridge, 30.001 handoff", () => {
    expect(classifyGap(14.999)).toBe("rife");
    expect(classifyGap(15)).toBe("bridge");
    expect(classifyGap(15.000000000000002)).toBe("bridge");
    expect(classifyGap(30)).toBe("bridge");
    expect(classifyGap(30.0000000001)).toBe("bridge");
    expect(classifyGap(30.001)).toBe("handoff");
    expect(isRifeEligible(14.999)).toBe(true);
    expect(isRifeEligible(15)).toBe(false);
    expect(isRifeEligible(30)).toBe(false);
  });

  it("14.999 m: RIFE allowed, no bridge, one run", () => {
    const s = streets(chainMm(100, [14999]));
    // consecutive frame gap across the join is exactly 14.999 m
    expect(s.length).toBe(1);
    expect(s[0]!.bridges).toEqual([]);
    expect(s[0]!.crossfades).toEqual([]);
    expect(s[0]!.internalMaxGapM).toBeCloseTo(14.999, 6);
    expect(s[0]!.internalMaxGapM!).toBeLessThan(s[0]!.rifeCeilingM);
  });
  it("15.000 m: a bridge, not RIFE-eligible, one segment", () => {
    const s = streets(chainMm(100, [15000]));
    expect(s.length).toBe(1);
    expect(s[0]!.bridges).toHaveLength(1);
    expect(s[0]!.bridges[0]).toMatchObject({ gapM: 15, rifeEligible: false });
  });
  it("30.000 m: a bridge, one segment", () => {
    const s = streets(chainMm(100, [30000]));
    expect(s.length).toBe(1);
    expect(s[0]!.bridges[0]).toMatchObject({ gapM: 30, rifeEligible: false });
  });
  it("30.001 m: handoff, two segments with BIRDS_EYE_3D between", () => {
    const all = segs(chainMm(100, [30001]));
    expect(all.map((x) => x.mode)).toEqual(["BIRDS_EYE_3D", "STREET_VIDEO", "BIRDS_EYE_3D", "STREET_VIDEO", "BIRDS_EYE_3D"]);
    expect(all.filter((x) => x.mode === "STREET_VIDEO").every((x) => x.bridges.length === 0)).toBe(true);
  });
});

describe("seeded sweep: thresholds hold for every start offset", () => {
  const r = rng(20261120);
  const starts = Array.from({ length: 1500 }, () => Math.round((10 + r() * 1500) * 1000) / 1000);
  it("14.999 / 15 / 30 / 30.001 behave identically at 1500 random starts", () => {
    for (const st of starts) {
      const at = (gap: number) => streets(chainMm(st, [Math.round(gap * 1000)]));
      const a = at(14.999), b = at(15), c = at(30), d = at(30.001);
      expect(a.length, `s=${st}`).toBe(1); expect(a[0]!.bridges.length, `s=${st}`).toBe(0);
      expect(b.length, `s=${st}`).toBe(1); expect(b[0]!.bridges.length, `s=${st}`).toBe(1);
      expect(c.length, `s=${st}`).toBe(1); expect(c[0]!.bridges.length, `s=${st}`).toBe(1);
      expect(d.length, `s=${st}`).toBe(2);
      for (const x of [...a, ...b, ...c]) {
        expect(x.bridges.every((g) => g.rifeEligible === false)).toBe(true);
        expect(x.internalMaxGapM!, `s=${st}`).toBeLessThan(x.rifeCeilingM);
      }
    }
  });
  it("chains: two valid gaps merge (two bridges); a 31 m second gap ends the segment after two runs", () => {
    for (const st of starts.slice(0, 500)) {
      const ok = streets(chainMm(st, [20000, 25000]));
      expect(ok.length, `s=${st}`).toBe(1);
      expect(ok[0]!.bridges.length, `s=${st}`).toBe(2);
      const cut = streets(chainMm(st, [20000, 31000]));
      expect(cut.length, `s=${st}`).toBe(2);
      expect(cut[0]!.bridges.length).toBe(1);
      expect(cut[1]!.bridges.length).toBe(0);
    }
  });
});

// ---- scenarios through the real matcher + classifier pipeline ----
const sc = straightScene({ bearingDeg: 0, lengthM: 600 });
const run = (frames: ReturnType<typeof sc.frames>) => classifyFrames(sc.axis, sc.edges, frames).classification;
const modes = (c: ReturnType<typeof run>) => c.segments.map((s) => `${s.mode === "STREET_VIDEO" ? "S" : "B"}${Math.round(s.startM)}-${Math.round(s.endM)}`);
const st = (c: ReturnType<typeof run>) => c.segments.filter((s) => s.mode === "STREET_VIDEO");
const runAt = (a: number, b: number, o = {}) => sc.frames(every(5, a, b), o);

describe("pipeline scenarios", () => {
  it("two 60 m runs with a 20 m gap: ONE segment, ONE bridge, bridge not RIFE-eligible", () => {
    const c = run([...runAt(100, 160), ...runAt(180, 240)]);
    expect(modes(c)).toEqual(["B0-100", "S100-240", "B240-600"]);
    const s = st(c)[0]!;
    expect(s.bridges).toEqual([{ startM: 160, endM: 180, gapM: 20, rifeEligible: false }]);
    expect(s.crossfades).toEqual([{ startM: 160, endM: 180, gapM: 20 }]); // compat alias
    expect(s.internalMaxGapM).toBeCloseTo(5, 6);
    expect(s.rifeCeilingM).toBe(15);
  });
  it("same with a 31 m gap: TWO segments separated by a BIRDS_EYE_3D handoff", () => {
    const c = run([...runAt(100, 160), ...runAt(191, 251)]);
    expect(modes(c)).toEqual(["B0-100", "S100-160", "B160-191", "S191-251", "B251-600"]);
    expect(st(c).every((s) => s.bridges.length === 0)).toBe(true);
  });
  it("a 59 m run next to a valid run with a 20 m gap does NOT bridge", () => {
    const c = run([...runAt(100, 160), ...runAt(180, 239)]);
    expect(modes(c)).toEqual(["B0-100", "S100-160", "B160-600"]);
    const c2 = run([...runAt(100, 159), ...runAt(179, 239)]);
    expect(modes(c2)).toEqual(["B0-179", "S179-239", "B239-600"]);
  });
  it("a bridged gap is never RIFE-eligible; a < 15 m gap inside a run is", () => {
    // 100-160 dense, 12 m internal gap, then 60 m more, then a 20 m bridge, then a run
    const c = run([...runAt(100, 160), ...runAt(172, 232), ...runAt(252, 312)]);
    const s = st(c)[0]!;
    expect(s.bridges.map((b) => b.gapM)).toEqual([20]);
    expect(s.bridges.every((b) => b.rifeEligible === false)).toBe(true);
    expect(s.internalMaxGapM).toBeCloseTo(12, 6);
    expect(isRifeEligible(s.internalMaxGapM!)).toBe(true);
    expect(isRifeEligible(s.bridges[0]!.gapM)).toBe(false);
    for (const g of [...s.bridges]) expect(g.gapM).toBeGreaterThanOrEqual(s.rifeCeilingM);
  });
  it("chain of THREE runs with two valid gaps: one segment, two bridges", () => {
    const c = run([...runAt(50, 110), ...runAt(130, 190), ...runAt(215, 275)]);
    expect(modes(c)).toEqual(["B0-50", "S50-275", "B275-600"]);
    expect(st(c)[0]!.bridges.map((b) => [b.startM, b.endM, b.gapM])).toEqual([[110, 130, 20], [190, 215, 25]]);
  });
  it("chain where the second gap is 31 m: segment ends after two runs", () => {
    const c = run([...runAt(50, 110), ...runAt(130, 190), ...runAt(221, 281)]);
    expect(modes(c)).toEqual(["B0-50", "S50-190", "B190-221", "S221-281", "B281-600"]);
    expect(st(c)[0]!.bridges.length).toBe(1);
  });
  it("bearing violation (> 25 deg from local bearing) in the FIRST run prevents the merge", () => {
    const c = run([...runAt(100, 160, { headingDeltaDeg: 30 }), ...runAt(180, 240)]);
    expect(modes(c)).toEqual(["B0-180", "S180-240", "B240-600"]);
    expect(st(c)[0]!.bridges).toEqual([]);
  });
  it("bearing violation in the SECOND run prevents the merge", () => {
    const c = run([...runAt(100, 160), ...runAt(180, 240, { headingDeltaDeg: -30 })]);
    expect(modes(c)).toEqual(["B0-100", "S100-160", "B160-600"]);
  });
  it("bearing exactly at the limit (25 deg) is fine and still bridges", () => {
    const c = run([...runAt(100, 160, { headingDeltaDeg: 25 }), ...runAt(180, 240, { headingDeltaDeg: -25 })]);
    expect(st(c).length).toBe(1);
    expect(st(c)[0]!.bridges.length).toBe(1);
  });
  it("a bearing-violating middle run breaks a three-run chain into two segments", () => {
    const c = run([...runAt(50, 110), ...runAt(130, 190, { headingDeltaDeg: 40 }), ...runAt(215, 275)]);
    expect(st(c).length).toBe(2);
    expect(st(c).every((s) => s.bridges.length === 0)).toBe(true);
  });
  it("BIRDS_EYE_3D segments carry no bridges and the ceiling", () => {
    const c = run([...runAt(100, 160), ...runAt(180, 240)]);
    for (const s of c.segments.filter((x) => x.mode === "BIRDS_EYE_3D")) {
      expect(s.bridges).toEqual([]);
      expect(s.internalMaxGapM).toBeNull();
      expect(s.rifeCeilingM).toBe(15);
    }
  });
});
