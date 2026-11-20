import { describe, expect, it } from "vitest";
import { classifyTimeline, DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import type { MatchedFrame } from "../src/classify/match";
import type { EdgeSpan } from "../src/classify/types";
import { buildAxis } from "../src/geo/local";
import {
  ageBucket, bucketShares, countByAge, countRefusedSequenceGaps, framesInStreetSegments, levelUncertainNear, sumSummaries, summariseSegments,
} from "../src/validation/coverage";

const mf = (offsetM: number, seq: string | null, capturedAt: string | null = "2022-05-01T00:00:00Z", edgeIndex = 0): MatchedFrame => ({
  frame: { imageId: `i${offsetM}`, sequenceId: seq, lat: 0, lon: 0, compassAngleDeg: 0, qualityScore: 1, capturedAt },
  offsetM, lateralRightM: 0, localBearingDeg: 0, headingDeltaDeg: 0, edgeIndex, edgeId: edgeIndex + 1,
});
const edges: EdgeSpan[] = [{ edgeId: 1, startM: 0, endM: 1000, roadClass: "primary", use: "road" }];
const run = (from: number, to: number, seq: string, step = 10, cap?: string) => {
  const out: MatchedFrame[] = [];
  for (let o = from; o <= to; o += step) out.push(mf(o, seq, cap));
  return out;
};

describe("ageBucket", () => {
  it("buckets by UTC year with exact boundaries", () => {
    expect(ageBucket("2014-12-31T23:59:59Z")).toBe("pre-2015");
    expect(ageBucket("2015-01-01T00:00:00Z")).toBe("2015-2019");
    expect(ageBucket("2019-12-31T23:59:59Z")).toBe("2015-2019");
    expect(ageBucket("2020-01-01T00:00:00Z")).toBe("2020-2023");
    expect(ageBucket("2023-12-31T23:59:59Z")).toBe("2020-2023");
    expect(ageBucket("2024-01-01T00:00:00Z")).toBe("2024+");
    expect(ageBucket("2026-06-01T00:00:00Z")).toBe("2024+");
  });
  it("puts missing and unparseable dates in unknown", () => {
    expect(ageBucket(null)).toBe("unknown");
    expect(ageBucket("")).toBe("unknown");
    expect(ageBucket("not a date")).toBe("unknown");
  });
  it("shares sum to 1, or all zero for no frames", () => {
    const s = bucketShares(countByAge(["2016-01-01T00:00:00Z", "2016-02-01T00:00:00Z", "2021-01-01T00:00:00Z", "2025-01-01T00:00:00Z"]));
    expect(s["2015-2019"]).toBeCloseTo(0.5);
    expect(s["2020-2023"]).toBeCloseTo(0.25);
    expect(s["2024+"]).toBeCloseTo(0.25);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(Object.values(bucketShares(countByAge([]))).every((v) => v === 0)).toBe(true);
  });
});

describe("countRefusedSequenceGaps", () => {
  it("counts a 15-30 m gap between different sequences, not same-sequence or other tiers", () => {
    const f = [
      ...run(0, 100, "A"), ...run(120, 220, "A"), // 20 m gap, same sequence: bridged, not refused
      ...run(245, 345, "B"), // 25 m gap, different sequence: refused
      ...run(350, 450, "C", 10), // 5 m gap, different sequence: RIFE tier, not a bridge-tier refusal
      ...run(500, 600, "C"), // 50 m gap: handoff tier, not counted
    ];
    expect(countRefusedSequenceGaps(f, 1000)).toBe(1);
  });
  it("treats exactly 15 m and exactly 30 m as bridge tier, and a missing sequence as refused", () => {
    expect(countRefusedSequenceGaps([mf(0, "A"), mf(15, "B")], 100)).toBe(1);
    expect(countRefusedSequenceGaps([mf(0, "A"), mf(30, "B")], 100)).toBe(1);
    expect(countRefusedSequenceGaps([mf(0, "A"), mf(14.999, "B")], 100)).toBe(0);
    expect(countRefusedSequenceGaps([mf(0, "A"), mf(30.001, "B")], 100)).toBe(0);
    expect(countRefusedSequenceGaps([mf(0, null), mf(20, null)], 100)).toBe(1);
  });
  it("is zero for no or one frame", () => {
    expect(countRefusedSequenceGaps([], 100)).toBe(0);
    expect(countRefusedSequenceGaps([mf(0, "A")], 100)).toBe(0);
  });
});

describe("summariseSegments", () => {
  // four 60 m runs of one sequence joined by 20 m gaps: with the 2-bridge cap the first segment holds three runs and the
  // fourth run starts a new segment.
  const f = [
    ...run(0, 60, "A", 10, "2016-01-01T00:00:00Z"), ...run(80, 140, "A", 10, "2016-01-01T00:00:00Z"),
    ...run(160, 220, "A", 10, "2021-01-01T00:00:00Z"), ...run(240, 300, "A", 10, "2025-01-01T00:00:00Z"),
  ];
  const c = classifyTimeline(1000, edges, f, DEFAULT_CLASSIFY_CONFIG);
  const s = summariseSegments(c, f, f.length, { low_quality: 3 });

  it("counts street segments, bridges and segments at the bridge cap", () => {
    expect(s.streetSegments).toBe(2);
    expect(s.bridges).toBe(2);
    expect(s.segmentsAtBridgeCap).toBe(1);
    expect(s.segments).toBe(c.segments.length);
    expect(s.dropped).toEqual({ low_quality: 3 });
  });
  it("street share is street metres over route metres", () => {
    expect(s.streetVideoM).toBeCloseTo(220 + 60);
    expect(s.streetFraction).toBeCloseTo(280 / 1000);
    expect(s.streetVideoM + s.birdsEyeM).toBeCloseTo(1000);
  });
  it("age buckets count frames inside street segments only", () => {
    expect(s.ageBuckets["2015-2019"]).toBe(14);
    expect(s.ageBuckets["2020-2023"]).toBe(7);
    expect(s.ageBuckets["2024+"]).toBe(7);
    const extra = [...f, mf(700, "Z", "2010-01-01T00:00:00Z")]; // a lone frame in a birds-eye stretch
    const c2 = classifyTimeline(1000, edges, extra, DEFAULT_CLASSIFY_CONFIG);
    expect(framesInStreetSegments(extra, c2.segments)).toHaveLength(f.length);
  });
  it("sums lengths and counts and recomputes the length-weighted fraction", () => {
    const t = sumSummaries([s, s]);
    expect(t.lengthM).toBe(2000);
    expect(t.bridges).toBe(4);
    expect(t.streetFraction).toBeCloseTo(0.28);
    expect(t.dropped).toEqual({ low_quality: 6 });
    expect(t.ageBuckets["2015-2019"]).toBe(28);
  });
});

describe("levelUncertainNear", () => {
  // east-west axis at the equator, 1000 m
  const mLon = 111_320;
  const axis = buildAxis([{ lat: 0, lon: 0 }, { lat: 0, lon: 1000 / mLon }]);
  const seg = (startM: number, endM: number, lu: boolean) => ({ startM, endM, level_uncertain: lu }) as any;
  it("counts only level_uncertain segments overlapping the window around the projected point", () => {
    const at = { lat: 0, lon: 500 / mLon };
    const r = levelUncertainNear(axis, [seg(400, 450, true), seg(480, 520, false), seg(700, 800, true), seg(0, 340, true)], at, 150);
    expect(r).toEqual({ near: true, count: 1 });
  });
  it("reports not near when the route is farther than the radius", () => {
    const r = levelUncertainNear(axis, [seg(0, 1000, true)], { lat: 0.01, lon: 500 / mLon }, 150);
    expect(r).toEqual({ near: false, count: 0 });
  });
});
