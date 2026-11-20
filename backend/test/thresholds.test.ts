import { describe, expect, it } from "vitest";
import { classifyTimeline, DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import { gteMm, gtMm, lteMm, ltMm, toMm } from "../src/classify/mm";
import type { MatchedFrame } from "../src/classify/match";
import type { EdgeSpan } from "../src/classify/types";

// seeded PRNG (mulberry32) so the "random" start offsets are deterministic
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

const L = 2000;
const edges: EdgeSpan[] = [{ edgeId: 1, startM: 0, endM: L, roadClass: "primary", use: "road", bridge: false, tunnel: false }];
const mf = (offsetM: number, i: number): MatchedFrame => ({
  frame: { imageId: `f${i}`, sequenceId: "s", lat: 0, lon: 0, compassAngleDeg: 0, qualityScore: 1, capturedAt: null },
  offsetM: Math.round(offsetM * 1000) / 1000, lateralRightM: 1, localBearingDeg: 0, headingDeltaDeg: 0, edgeIndex: 0, edgeId: 1,
});
const streets = (frames: MatchedFrame[]) => classifyTimeline(L, edges, frames, DEFAULT_CLASSIFY_CONFIG).segments.filter((s) => s.mode === "STREET_VIDEO");
const N = 2000;
const starts = (() => { const r = rng(12345); return Array.from({ length: N }, () => Math.round((10 + r() * 1500) * 1000) / 1000); })();

describe("mm helpers", () => {
  it("compare in integer millimetres", () => {
    expect(toMm(59.99999999999999)).toBe(60000);
    expect(gteMm(59.99999999999999, 60)).toBe(true);
    expect(ltMm(15.000000000000002, 15)).toBe(false);
    expect(ltMm(14.999, 15)).toBe(true);
    expect(lteMm(30.0000000001, 30)).toBe(true);
    expect(gtMm(30.001, 30)).toBe(true);
  });
});

describe("exact thresholds hold for every start offset", () => {
  it("gap: 15.000 m never joins (strictly < 15), 14.999 m always does", () => {
    for (const s of starts) {
      // dense 5 m run, a gap, dense 5 m run; each side is a 60 m run
      const mk = (gap: number) => {
        const a = Array.from({ length: 13 }, (_, i) => s + i * 5);
        const b0 = a[a.length - 1]! + gap;
        return [...a, ...Array.from({ length: 13 }, (_, i) => b0 + i * 5)].map(mf);
      };
      const exact = streets(mk(15));
      expect(exact.length, `start ${s}`).toBe(1);
      expect(exact[0]!.crossfades.length, `start ${s}`).toBe(1); // two runs (not one) merged by crossfade
      expect(streets(mk(14.999))[0]!.crossfades.length, `start ${s}`).toBe(0);
    }
  });

  it("extent: 60.000 m always qualifies, 59.999 m never", () => {
    for (const s of starts) {
      const run = (ext: number) => [0, 12, 24, 36, 48, ext].map((d, i) => mf(s + d, i));
      expect(streets(run(60)).length, `start ${s}`).toBe(1);
      expect(streets(run(59.999)).length, `start ${s}`).toBe(0);
    }
  });

  it("crossfade ceiling: 30.000 m gap merges (inclusive), 30.001 m does not", () => {
    for (const s of starts) {
      const mk = (gap: number) => {
        const a = Array.from({ length: 13 }, (_, i) => s + i * 5);
        const b0 = a[a.length - 1]! + gap;
        return [...a, ...Array.from({ length: 13 }, (_, i) => b0 + i * 5)].map(mf);
      };
      const at30 = streets(mk(30));
      expect(at30.length, `start ${s}`).toBe(1);
      expect(at30[0]!.crossfades[0]!.gapM, `start ${s}`).toBeCloseTo(30, 6);
      expect(streets(mk(30.001)).length, `start ${s}`).toBe(2);
    }
  });
});

describe("frames outside the route", () => {
  it("are ignored: no segment exceeds [0, routeLength]", () => {
    const fs = [-50, -20, ...Array.from({ length: 21 }, (_, i) => 100 + i * 5), L + 10, L + 300].map((o, i) => {
      const m = mf(o, i);
      return m;
    });
    const c = classifyTimeline(L, edges, fs);
    expect(c.segments[0]!.startM).toBe(0);
    expect(c.segments.at(-1)!.endM).toBe(L);
    expect(c.segments.every((s) => s.startM >= 0 && s.endM <= L)).toBe(true);
    expect(c.summary.usableFrameCount).toBe(21);
    expect(c.summary.streetVideoM + c.summary.birdsEyeM).toBe(L);
  });
});
