import { describe, expect, it } from "vitest";
import { absAngleDiffDeg, buildAxis, haversineM, LocalFrame, pointAtOffset, projectOntoAxis, signedAngleDiffDeg, sliceAxis, type LatLon } from "../src/geo/local";
import { decodePolyline6 } from "../src/routing/valhalla";
import { encodePolyline6 } from "../src/routing/polyline";

const ACCRA: LatLon = { lat: 5.6037, lon: -0.187 };
const frame = new LocalFrame(ACCRA);
/** A point `eastM` east and `northM` north of Accra. */
const at = (eastM: number, northM: number): LatLon => frame.toLatLon({ x: eastM, y: northM });

describe("local frame", () => {
  it("round-trips and agrees with haversine at Accra latitude (within 0.1%)", () => {
    const p = at(300, -400);
    const xy = frame.toXY(p);
    expect(xy.x).toBeCloseTo(300, 6);
    expect(xy.y).toBeCloseTo(-400, 6);
    expect(Math.abs(haversineM(ACCRA, p) - 500)).toBeLessThan(0.5);
  });
  it("one degree of longitude is shorter than one of latitude (cos 5.6 deg), so lon/lat order matters", () => {
    const e = haversineM(ACCRA, { lat: ACCRA.lat, lon: ACCRA.lon + 0.001 });
    const n = haversineM(ACCRA, { lat: ACCRA.lat + 0.001, lon: ACCRA.lon });
    expect(e / n).toBeCloseTo(Math.cos((5.6037 * Math.PI) / 180), 3);
  });
});

describe("angles", () => {
  it("wraps at 0/360", () => {
    expect(signedAngleDiffDeg(350, 10)).toBe(20);
    expect(signedAngleDiffDeg(10, 350)).toBe(-20);
    expect(absAngleDiffDeg(359, 1)).toBe(2);
    expect(absAngleDiffDeg(0, 180)).toBe(180);
    expect(absAngleDiffDeg(-10, 370)).toBe(20);
  });
});

describe("projection", () => {
  it("reports offset, local bearing and a RIGHT-positive lateral for each compass direction", () => {
    // travelling N, E, S, W: a point 5 m to the right of travel must always give +5
    const dirs: [string, [number, number], [number, number], number][] = [
      ["north", [0, 1], [1, 0], 0],
      ["east", [1, 0], [0, -1], 90],
      ["south", [0, -1], [-1, 0], 180],
      ["west", [-1, 0], [0, 1], 270],
    ];
    for (const [name, d, right, bearing] of dirs) {
      const axis = buildAxis([at(0, 0), at(d[0] * 100, d[1] * 100)]);
      const onRight = at(d[0] * 40 + right[0] * 5, d[1] * 40 + right[1] * 5);
      const pr = projectOntoAxis(axis, onRight);
      expect(pr.lateralRightM, name).toBeCloseTo(5, 3);
      expect(pr.offsetM, name).toBeCloseTo(40, 3);
      expect(pr.bearingDeg, name).toBeCloseTo(bearing, 3);
      const onLeft = at(d[0] * 40 - right[0] * 5, d[1] * 40 - right[1] * 5);
      expect(projectOntoAxis(axis, onLeft).lateralRightM, name).toBeCloseTo(-5, 3);
    }
  });
  it("uses the bearing of the segment the point projects onto (bend), not an average", () => {
    const axis = buildAxis([at(0, 0), at(0, 100), at(100, 100)]); // north then east
    expect(projectOntoAxis(axis, at(2, 50)).bearingDeg).toBeCloseTo(0, 3);
    expect(projectOntoAxis(axis, at(50, 98)).bearingDeg).toBeCloseTo(90, 3);
    expect(projectOntoAxis(axis, at(50, 98)).offsetM).toBeCloseTo(150, 3);
  });
  it("slices at exact offsets", () => {
    const axis = buildAxis([at(0, 0), at(0, 100), at(100, 100)]);
    const s = buildAxis(sliceAxis(axis, 50, 150));
    expect(s.lengthM).toBeCloseTo(100, 3);
    expect(haversineM(pointAtOffset(axis, 150), at(50, 100))).toBeLessThan(0.1);
  });
});

describe("polyline6", () => {
  it("encode is the inverse of decode", () => {
    const pts: [number, number][] = [[5.636293, -0.175086], [5.6371, -0.17421], [5.550212, -0.217391]];
    expect(decodePolyline6(encodePolyline6(pts))).toEqual(pts);
  });
});
