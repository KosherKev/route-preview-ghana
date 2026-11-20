// Local geodesic helpers. ORDERING RULE: every point in this module is a named {lat, lon} object (never a bare
// [a, b] tuple), and local metre coordinates are {x: east, y: north}. Valhalla polylines decode to [lat, lon] pairs
// and PostGIS/GeoJSON use lon, lat; both are converted to LatLon at the boundary so a swap cannot slip through.
import type { LatLon } from "../routing/valhalla";
export type { LatLon };

export interface XY { x: number; y: number } // metres: x east, y north, relative to a LocalFrame origin

const EARTH_R_M = 6_371_008.8;
const RAD = Math.PI / 180;

/**
 * Equirectangular projection about a fixed reference point. At Accra (5.6 N) over a route a few km long the
 * distortion is far below 0.1%, well inside the metre-scale tolerances used by the matcher.
 */
export class LocalFrame {
  private readonly kx: number;
  private readonly ky = EARTH_R_M * RAD;
  constructor(readonly ref: LatLon) {
    this.kx = EARTH_R_M * RAD * Math.cos(ref.lat * RAD);
  }
  toXY(p: LatLon): XY {
    return { x: (p.lon - this.ref.lon) * this.kx, y: (p.lat - this.ref.lat) * this.ky };
  }
  toLatLon(p: XY): LatLon {
    return { lat: this.ref.lat + p.y / this.ky, lon: this.ref.lon + p.x / this.kx };
  }
}

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Normalise to [0, 360). */
export function normDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** Signed smallest angle from `from` to `to` in degrees, in (-180, 180]. Handles the 0/360 wrap. */
export function signedAngleDiffDeg(from: number, to: number): number {
  let d = normDeg(to) - normDeg(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function absAngleDiffDeg(a: number, b: number): number {
  return Math.abs(signedAngleDiffDeg(a, b));
}

/** Compass bearing (0 = north, clockwise) of the vector a -> b in local metres. */
export function bearingXY(a: XY, b: XY): number {
  return normDeg(Math.atan2(b.x - a.x, b.y - a.y) / RAD);
}

/** A polyline with cumulative distances, expressed in its own LocalFrame. */
export interface Axis {
  points: LatLon[];
  frame: LocalFrame;
  xy: XY[];
  /** cum[i] = metres along the axis at vertex i; cum[0] = 0. */
  cum: number[];
  lengthM: number;
}

export function buildAxis(points: readonly LatLon[]): Axis {
  if (points.length < 2) throw new Error("axis needs at least 2 points");
  const mid = points[Math.floor(points.length / 2)]!;
  const frame = new LocalFrame(mid);
  const xy = points.map((p) => frame.toXY(p));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1]! + Math.hypot(xy[i]!.x - xy[i - 1]!.x, xy[i]!.y - xy[i - 1]!.y));
  return { points: [...points], frame, xy, cum, lengthM: cum[cum.length - 1]! };
}

export interface Projection {
  /** metres along the axis of the foot point */
  offsetM: number;
  /** signed perpendicular distance; POSITIVE = to the RIGHT of the direction of travel along the axis */
  lateralRightM: number;
  /** compass bearing of the axis segment that the point projects onto (the LOCAL road bearing) */
  bearingDeg: number;
  segmentIndex: number;
}

/** Project onto the nearest axis segment (point-to-segment, clamped). Zero-length segments are skipped. */
export function projectOntoAxis(axis: Axis, p: LatLon): Projection {
  const q = axis.frame.toXY(p);
  let best: (Projection & { d: number }) | null = null;
  for (let i = 0; i < axis.xy.length - 1; i++) {
    const a = axis.xy[i]!, b = axis.xy[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2));
    const fx = a.x + t * dx, fy = a.y + t * dy;
    const d = Math.hypot(q.x - fx, q.y - fy);
    if (best && d >= best.d) continue;
    const segLen = Math.sqrt(len2);
    // cross > 0 means the point is LEFT of travel (counter-clockwise from the direction vector); right is the negation
    const cross = (dx * (q.y - a.y) - dy * (q.x - a.x)) / segLen;
    best = {
      d,
      offsetM: axis.cum[i]! + t * segLen,
      lateralRightM: -cross,
      bearingDeg: bearingXY(a, b),
      segmentIndex: i,
    };
  }
  if (!best) throw new Error("axis has no non-zero segment");
  const { d: _d, ...proj } = best;
  return proj;
}

export function pointAtOffset(axis: Axis, offsetM: number): LatLon {
  const o = Math.max(0, Math.min(axis.lengthM, offsetM));
  let i = 0;
  while (i < axis.cum.length - 2 && axis.cum[i + 1]! < o) i++;
  const segLen = axis.cum[i + 1]! - axis.cum[i]!;
  const t = segLen === 0 ? 0 : (o - axis.cum[i]!) / segLen;
  const a = axis.xy[i]!, b = axis.xy[i + 1]!;
  return axis.frame.toLatLon({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

/** Sub-polyline between two offsets (exact cut points are interpolated, intermediate vertices kept). */
export function sliceAxis(axis: Axis, startM: number, endM: number): LatLon[] {
  const s = Math.max(0, startM), e = Math.min(axis.lengthM, endM);
  const out: LatLon[] = [pointAtOffset(axis, s)];
  for (let i = 0; i < axis.cum.length; i++) if (axis.cum[i]! > s && axis.cum[i]! < e) out.push(axis.points[i]!);
  out.push(pointAtOffset(axis, e));
  return out;
}
