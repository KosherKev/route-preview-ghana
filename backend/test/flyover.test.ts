import { describe, expect, it } from "vitest";
import { buildAxis, absAngleDiffDeg, haversineM, type LatLon } from "../src/geo/local";
import { DEFAULT_FLYOVER_OPTIONS, FLYOVER_BOUNDS, planFlyover, routeBearingAt } from "../src/patterns/sceneDirector";

const O = { lat: 5.56, lon: -0.2 };
// an L-shaped route: ~1 km east, then ~1 km north, with intermediate vertices
function lRoute(): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= 10; i++) pts.push({ lat: O.lat, lon: O.lon + i * 0.0009 });
  for (let i = 1; i <= 10; i++) pts.push({ lat: O.lat + i * 0.0009, lon: O.lon + 10 * 0.0009 });
  return pts;
}
const axis = buildAxis(lRoute());

function checkProperties(plan: ReturnType<typeof planFlyover>, s0: number, s1: number) {
  const k = plan.keyframes;
  expect(k.length).toBeGreaterThanOrEqual(3);
  expect(k.length).toBeLessThanOrEqual(DEFAULT_FLYOVER_OPTIONS.maxKeyframes);
  expect(k[0]!.t).toBe(0);
  expect(k.at(-1)!.t).toBe(plan.durationSec);
  expect(k[0]!.offsetM).toBeCloseTo(s0, 6);
  expect(k.at(-1)!.offsetM).toBeCloseTo(s1, 6);
  for (let i = 1; i < k.length; i++) {
    expect(k[i]!.t).toBeGreaterThan(k[i - 1]!.t);
    expect(k[i]!.offsetM).toBeGreaterThanOrEqual(k[i - 1]!.offsetM);
    expect(absAngleDiffDeg(k[i]!.bearingDeg, k[i - 1]!.bearingDeg)).toBeLessThanOrEqual(DEFAULT_FLYOVER_OPTIONS.maxBearingStepDeg + 1e-9);
  }
  for (const f of k) {
    expect(f.zoom).toBeGreaterThanOrEqual(FLYOVER_BOUNDS.minZoom);
    expect(f.zoom).toBeLessThanOrEqual(FLYOVER_BOUNDS.maxZoom);
    expect(f.pitchDeg).toBeGreaterThanOrEqual(FLYOVER_BOUNDS.minPitchDeg);
    expect(f.pitchDeg).toBeLessThanOrEqual(FLYOVER_BOUNDS.maxPitchDeg);
    expect(f.bearingDeg).toBeGreaterThanOrEqual(0);
    expect(f.bearingDeg).toBeLessThan(360);
    expect(Number.isFinite(f.lat) && Number.isFinite(f.lon)).toBe(true);
  }
}

describe("planFlyover", () => {
  it("rides the route: monotonic offsets, bounded bearing steps, zoom and pitch in bounds", () => {
    const plan = planFlyover(axis, 0, axis.lengthM);
    checkProperties(plan, 0, axis.lengthM);
    expect(plan.durationSec).toBeCloseTo(axis.lengthM / 30, 6);
    // the centre stays on the route (first keyframe at the start, last at the end)
    expect(haversineM(plan.keyframes[0]!, axis.points[0]!)).toBeLessThan(1);
    expect(haversineM(plan.keyframes.at(-1)!, axis.points.at(-1)!)).toBeLessThan(1);
  });
  it("swoops in (wider and flatter than cruise) and settles closer and steeper at the destination", () => {
    const k = planFlyover(axis, 0, axis.lengthM).keyframes;
    expect(k[0]!.zoom).toBeCloseTo(DEFAULT_FLYOVER_OPTIONS.swoopZoom, 6);
    expect(k[0]!.pitchDeg).toBeCloseTo(DEFAULT_FLYOVER_OPTIONS.swoopPitchDeg, 6);
    const mid = k[Math.floor(k.length / 2)]!;
    expect(mid.zoom).toBeCloseTo(DEFAULT_FLYOVER_OPTIONS.cruiseZoom, 6);
    expect(k.at(-1)!.zoom).toBeCloseTo(DEFAULT_FLYOVER_OPTIONS.settleZoom, 6);
    expect(k.at(-1)!.pitchDeg).toBeCloseTo(DEFAULT_FLYOVER_OPTIONS.settlePitchDeg, 6);
  });
  it("does not settle when the segment is not the last, and can skip the swoop", () => {
    const k = planFlyover(axis, 200, 900, { settleAtEnd: false, swoopIn: false }).keyframes;
    expect(new Set(k.map((f) => f.zoom))).toEqual(new Set([DEFAULT_FLYOVER_OPTIONS.cruiseZoom]));
    expect(new Set(k.map((f) => f.pitchDeg))).toEqual(new Set([DEFAULT_FLYOVER_OPTIONS.cruisePitchDeg]));
  });
  it("turns the bearing smoothly through the 90 degree corner (no jump larger than the step)", () => {
    const k = planFlyover(axis, 0, axis.lengthM).keyframes;
    expect(k[0]!.bearingDeg).toBeGreaterThan(80);
    expect(k[0]!.bearingDeg).toBeLessThan(100);
    expect(absAngleDiffDeg(k.at(-1)!.bearingDeg, 0)).toBeLessThan(5);
  });
  it("bearing continuity across the 0/360 wrap", () => {
    // a route heading north-north-west then north-north-east crosses bearing 0
    const pts: LatLon[] = [];
    for (let i = 0; i <= 8; i++) pts.push({ lat: O.lat + i * 0.001, lon: O.lon - i * 0.00005 });
    for (let i = 1; i <= 8; i++) pts.push({ lat: O.lat + (8 + i) * 0.001, lon: O.lon - 8 * 0.00005 + i * 0.00005 });
    const a = buildAxis(pts);
    checkProperties(planFlyover(a, 0, a.lengthM), 0, a.lengthM);
  });
  it("very short segment (3 m) and zero-length segment still produce a valid plan with the minimum duration", () => {
    const short = planFlyover(axis, 500, 503);
    checkProperties(short, 500, 503);
    expect(short.durationSec).toBe(DEFAULT_FLYOVER_OPTIONS.minDurationSec);
    const zero = planFlyover(axis, 500, 500);
    checkProperties(zero, 500, 500);
    expect(zero.nominalSpeedMps).toBe(0);
    expect(new Set(zero.keyframes.map((f) => f.offsetM)).size).toBe(1);
  });
  it("very long segment caps the duration and the keyframe count", () => {
    const longPts: LatLon[] = [];
    for (let i = 0; i <= 200; i++) longPts.push({ lat: O.lat + i * 0.0005, lon: O.lon + Math.sin(i / 10) * 0.002 });
    const a = buildAxis(longPts); // about 11 km
    expect(a.lengthM).toBeGreaterThan(10_000);
    const plan = planFlyover(a, 0, a.lengthM);
    checkProperties(plan, 0, a.lengthM);
    expect(plan.durationSec).toBe(DEFAULT_FLYOVER_OPTIONS.maxDurationSec);
    expect(plan.nominalSpeedMps).toBeGreaterThan(DEFAULT_FLYOVER_OPTIONS.nominalSpeedMps);
  });
  it("is deterministic, clamps out-of-range offsets, and rejects bad options", () => {
    expect(planFlyover(axis, 0, 700)).toEqual(planFlyover(axis, 0, 700));
    const c = planFlyover(axis, -50, axis.lengthM + 500);
    checkProperties(c, 0, axis.lengthM);
    expect(() => planFlyover(axis, 0, 100, { nominalSpeedMps: 0 })).toThrow(RangeError);
  });
  it("routeBearingAt looks back near the end instead of degenerating", () => {
    expect(absAngleDiffDeg(routeBearingAt(axis, axis.lengthM, 60), 0)).toBeLessThan(2);
  });
  it("has no live-position inputs: keyframes are keyed by route offset only", () => {
    expect(Object.keys(planFlyover(axis, 0, 100).keyframes[0]!).sort()).toEqual(["bearingDeg", "easing", "lat", "lon", "offsetM", "pitchDeg", "t", "zoom"]);
  });
});
