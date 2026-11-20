import { describe, expect, it } from "vitest";
import { buildAxis, LocalFrame, type LatLon } from "../src/geo/local";
import { DEFAULT_MATCH_CONFIG, matchFrames, selectSequences } from "../src/classify/match";
import { every, straightScene } from "../src/classify/synthetic";
import type { EdgeSpan, FrameRecord } from "../src/classify/types";

const reasons = (r: { dropped: { reason: string }[] }) => r.dropped.map((d) => d.reason);

describe("bearing filter (local road bearing, +/-25 deg inclusive, wraps at 0/360)", () => {
  it("uses the bearing at the frame's own position, not a chunk average (north leg then east leg)", () => {
    const fr = new LocalFrame({ lat: 5.6, lon: -0.2 });
    const p = (x: number, y: number): LatLon => fr.toLatLon({ x, y });
    const axis = buildAxis([p(0, 0), p(0, 100), p(100, 100)]);
    const edges: EdgeSpan[] = [{ edgeId: 1, startM: 0, endM: axis.lengthM }];
    const f = (id: string, x: number, y: number, heading: number): FrameRecord => ({
      imageId: id, sequenceId: "s", ...p(x, y), compassAngleDeg: heading, qualityScore: 1, capturedAt: null,
    });
    const r = matchFrames(axis, edges, [
      f("north-ok", 1.5, 50, 0), f("east-ok", 150 - 100 + 50, 98.5, 90), // east leg frame, 1.5 m right (south) of centreline
      f("east-with-north-heading", 50, 98.5, 0),
      f("north-with-east-heading", 1.5, 50, 90),
    ]);
    expect(r.kept.map((m) => m.frame.imageId).sort()).toEqual(["east-ok", "north-ok"]);
    expect(r.kept.find((m) => m.frame.imageId === "east-ok")!.localBearingDeg).toBeCloseTo(90, 3);
    expect(reasons(r)).toEqual(["bearing_mismatch", "bearing_mismatch"]);
    // a chunk-average bearing (45 deg) would have accepted neither 0 nor 90 within 25 deg: the local rule is what keeps the good ones
  });

  it("accepts exactly 25 deg off, rejects 25.5, across the 0/360 wrap and for several road bearings", () => {
    for (const bearing of [0, 10, 355, 90, 180, 270]) {
      const sc = straightScene({ bearingDeg: bearing, lengthM: 100 });
      const ok = [25, -25, 24.9, -10].map((d) => sc.frame(50, { headingDeltaDeg: d }));
      const bad = [25.5, -25.5, 90, 180].map((d) => sc.frame(50, { headingDeltaDeg: d }));
      const r = matchFrames(sc.axis, sc.edges, [...ok, ...bad]);
      expect(r.kept.length, `bearing ${bearing}`).toBe(4);
      expect(reasons(r), `bearing ${bearing}`).toEqual(Array(4).fill("bearing_mismatch"));
    }
    // explicit wrap: road due north, frame heading 350 -> 10 deg off; 330 -> 30 deg off
    const north = straightScene({ bearingDeg: 0, lengthM: 100 });
    const r = matchFrames(north.axis, north.edges, [north.frame(50, { headingAbsDeg: 350 }), north.frame(50, { headingAbsDeg: 330 }), north.frame(50, { headingAbsDeg: 359 })]);
    expect(r.kept.map((m) => Math.round(m.headingDeltaDeg))).toEqual([-10, -1]);
  });
});

describe("lateral tolerance and right-hand-lane alignment", () => {
  const cfg = DEFAULT_MATCH_CONFIG;
  it("documents the thresholds", () => {
    expect(cfg.lateralToleranceM).toBe(15);
    expect(cfg.maxLeftOffsetM).toBe(3);
    expect(cfg.bearingToleranceDeg).toBe(25);
  });

  it("keeps right-of-centreline frames, drops left-of-centreline and off-route ones, for every compass direction", () => {
    for (const bearing of [0, 45, 90, 180, 270, 315]) {
      const sc = straightScene({ bearingDeg: bearing, lengthM: 200 });
      const keep = [2, 8, 14.5, 0, -2.5].map((l) => sc.frame(100, { lateralRightM: l }));
      const left = [-3.5, -8, -14].map((l) => sc.frame(100, { lateralRightM: l }));
      const far = [15.5, 20, -20].map((l) => sc.frame(100, { lateralRightM: l }));
      const r = matchFrames(sc.axis, sc.edges, [...keep, ...left, ...far]);
      expect(r.kept.length, `bearing ${bearing}`).toBe(5);
      expect(r.dropped.filter((d) => d.reason === "left_of_centerline").length, `bearing ${bearing}`).toBe(3);
      expect(r.dropped.filter((d) => d.reason === "off_route").length, `bearing ${bearing}`).toBe(3);
      for (const m of r.kept.filter((m) => m.frame.imageId && keep.includes(m.frame))) expect(m.lateralRightM).toBeGreaterThanOrEqual(-3);
    }
  });

  it("drops opposite-carriageway frames (left side AND reversed heading)", () => {
    for (const bearing of [0, 90, 180, 270]) {
      const sc = straightScene({ bearingDeg: bearing, lengthM: 200 });
      const opposite = sc.frames(every(10, 0, 200), { lateralRightM: -7, headingDeltaDeg: 180 });
      const mine = sc.frames(every(10, 0, 200), { lateralRightM: 2 });
      const r = matchFrames(sc.axis, sc.edges, [...opposite, ...mine]);
      expect(r.kept.length).toBe(mine.length);
      expect(r.kept.every((m) => m.lateralRightM > 0)).toBe(true);
      expect(reasons(r).every((x) => x === "left_of_centerline")).toBe(true);
    }
    // same-direction frame on the wrong (left) side is dropped too; reversed heading on the right is dropped by the bearing rule
    const sc = straightScene({ bearingDeg: 90, lengthM: 100 });
    const r = matchFrames(sc.axis, sc.edges, [sc.frame(50, { lateralRightM: -6 }), sc.frame(50, { lateralRightM: 2, headingDeltaDeg: 180 })]);
    expect(reasons(r)).toEqual(["left_of_centerline", "bearing_mismatch"]);
  });

  it("a sign mistake cannot pass: a westbound route's right side is NORTH", () => {
    const sc = straightScene({ bearingDeg: 270, lengthM: 100 });
    const f = sc.frame(50, { lateralRightM: 2 });
    const centre = sc.frame(50, { lateralRightM: 0 });
    expect(f.lat).toBeGreaterThan(centre.lat); // right of a westbound traveller is north
    const m = matchFrames(sc.axis, sc.edges, [f]).kept[0]!;
    expect(m.lateralRightM).toBeCloseTo(2, 2);
  });
});

describe("quality and completeness filters", () => {
  const sc = straightScene({ lengthM: 100 });
  it("drops below minQualityScore (0.5 inclusive-keep), null quality by default, null heading, no sequence", () => {
    const frames = [
      sc.frame(10, { quality: 0.49, id: "q49" }), sc.frame(20, { quality: 0.5, id: "q50" }), sc.frame(30, { quality: null, id: "qnull" }),
      sc.frame(40, { headingAbsDeg: null, id: "nohead" }), sc.frame(50, { seq: null, id: "noseq" }),
    ];
    const r = matchFrames(sc.axis, sc.edges, frames);
    expect(r.kept.map((m) => m.frame.imageId)).toEqual(["q50"]);
    expect(r.dropped.map((d) => `${d.frame.imageId}:${d.reason}`)).toEqual(["q49:low_quality", "qnull:low_quality", "nohead:no_heading", "noseq:no_sequence"]);
    expect(matchFrames(sc.axis, sc.edges, [frames[2]!], { ...DEFAULT_MATCH_CONFIG, allowMissingQuality: true }).kept.length).toBe(1);
  });
});

describe("one sequence per segment (edge)", () => {
  const sc = straightScene({ lengthM: 300 });
  const sel = (frames: FrameRecord[]) => selectSequences(matchFrames(sc.axis, sc.edges, frames).kept);

  it("prefers the sequence with more usable frames on the edge", () => {
    const a = sc.frames([10, 20, 30], { seq: "A" }), b = sc.frames([15, 25, 35, 45, 55], { seq: "B" });
    const r = sel([...a, ...b]);
    expect(new Set(r.selected.map((m) => m.frame.sequenceId))).toEqual(new Set(["B"]));
    expect(r.dropped.length).toBe(3);
    expect(r.dropped.every((d) => d.reason === "other_sequence")).toBe(true);
  });

  it("breaks a count tie by capture age: the more recent capture wins; undated is oldest", () => {
    const old = sc.frames([10, 20], { seq: "old", capturedAt: "2019-01-01T00:00:00Z" });
    const recent = sc.frames([15, 25], { seq: "recent", capturedAt: "2024-06-01T00:00:00Z" });
    const undated = sc.frames([12, 22], { seq: "undated", capturedAt: null });
    expect(new Set(sel([...old, ...recent, ...undated]).selected.map((m) => m.frame.sequenceId))).toEqual(new Set(["recent"]));
    expect(new Set(sel([...old, ...undated]).selected.map((m) => m.frame.sequenceId))).toEqual(new Set(["old"]));
  });

  it("is per edge, and keeps the previous edge's sequence while it still has frames", () => {
    const e0 = sc.frames([10, 40, 70], { seq: "A", capturedAt: "2020-01-01T00:00:00Z" });
    const e1a = sc.frames([110], { seq: "A", capturedAt: "2020-01-01T00:00:00Z" });
    const e1b = sc.frames([120, 130, 140], { seq: "B", capturedAt: "2025-01-01T00:00:00Z" });
    const e2b = sc.frames([210, 220], { seq: "B", capturedAt: "2025-01-01T00:00:00Z" });
    const r = sel([...e0, ...e1a, ...e1b, ...e2b]);
    const bySeq = (id: string) => r.selected.filter((m) => m.frame.sequenceId === id).map((m) => m.edgeIndex);
    expect(bySeq("A")).toEqual([0, 0, 0, 1]); // stuck with A on edge 1 although B has more frames there
    expect(bySeq("B")).toEqual([2, 2]); // A has no frames on edge 2, so B is chosen
  });
});

describe("true distance to the route polyline (clamped), not the infinite line", () => {
  const sc = straightScene({ lengthM: 400 });
  const kept = (fs: FrameRecord[], s = sc) => matchFrames(s.axis, s.edges, fs).kept.length;

  it("drops frames 300 m beyond the end or before the start on the same line; keeps frames on the route and at the end", () => {
    expect(kept([sc.frame(700)])).toBe(0);
    expect(kept([sc.frame(-300)])).toBe(0);
    expect(reasons(matchFrames(sc.axis, sc.edges, [sc.frame(700), sc.frame(-300)]))).toEqual(["off_route", "off_route"]);
    expect(kept([sc.frame(0), sc.frame(200), sc.frame(400)])).toBe(3);
    expect(kept([sc.frame(405), sc.frame(-5)])).toBe(2); // within 15 m of an end
    expect(kept([sc.frame(416), sc.frame(-16)])).toBe(0);
  });

  it("drops a frame just beyond an outer bend vertex that is close to the line but far from the polyline", () => {
    const fr = new LocalFrame({ lat: 5.6, lon: -0.2 });
    const p = (x: number, y: number): LatLon => fr.toLatLon({ x, y });
    const axis = buildAxis([p(0, 0), p(0, 100), p(100, 100)]);
    const edges: EdgeSpan[] = [{ edgeId: 1, startM: 0, endM: axis.lengthM }];
    const f = (id: string, x: number, y: number): FrameRecord => ({ imageId: id, sequenceId: "s", ...p(x, y), compassAngleDeg: 0, qualityScore: 1, capturedAt: null });
    // 5 m right of the north leg's line, but 20.6 m past the corner vertex
    const r = matchFrames(axis, edges, [f("beyond", 5, 120), f("on", 2, 60)]);
    expect(r.kept.map((m) => m.frame.imageId)).toEqual(["on"]);
    expect(reasons(r)).toEqual(["off_route"]);
  });
});

describe("duplicate images and non-finite quality", () => {
  const sc = straightScene({ lengthM: 100 });
  it("NaN / Infinity quality is unscored: dropped by default, kept with allowMissingQuality", () => {
    const fs = [sc.frame(10, { quality: NaN, id: "nan" }), sc.frame(20, { quality: Infinity, id: "inf" })];
    const r = matchFrames(sc.axis, sc.edges, fs);
    expect(r.kept.length).toBe(0);
    expect(reasons(r)).toEqual(["low_quality", "low_quality"]);
    expect(matchFrames(sc.axis, sc.edges, fs, { ...DEFAULT_MATCH_CONFIG, allowMissingQuality: true }).kept.length).toBe(2);
  });

  it("de-duplicates by imageId before selection: latest capturedAt wins, tie keeps the first", () => {
    const a = sc.frame(10, { id: "dup", capturedAt: "2020-01-01T00:00:00Z" });
    const b = { ...sc.frame(10, { id: "dup", capturedAt: "2024-01-01T00:00:00Z" }) };
    const c = sc.frame(30, { id: "tie" }), d = { ...c };
    const r = matchFrames(sc.axis, sc.edges, [a, b, c, d]);
    expect(r.kept.map((m) => m.frame)).toEqual([b, c]);
    expect(r.kept.find((m) => m.frame.imageId === "tie")!.frame).toBe(c);
    expect(reasons(r)).toEqual(["duplicate_image", "duplicate_image"]);
    expect(selectSequences(r.kept).selected.length).toBe(2);
  });
});
