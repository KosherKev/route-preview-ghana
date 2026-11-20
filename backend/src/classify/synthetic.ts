// SYNTHETIC scene builder. Used by the unit tests and by the clearly labelled synthetic section of the validation
// report. Nothing here is real imagery or real coverage.
import { buildAxis, LocalFrame, type Axis, type LatLon } from "../geo/local";
import type { EdgeSpan, FrameRecord } from "./types";

export interface FrameOpts {
  /** metres to the RIGHT of the direction of travel (negative = left). Default 1.5 (typical right-lane position). */
  lateralRightM?: number;
  /** heading relative to the road bearing, degrees (positive = clockwise). Default 0. */
  headingDeltaDeg?: number;
  seq?: string | null;
  quality?: number | null;
  capturedAt?: string | null;
  id?: string;
  /** heading as a compass angle, overriding headingDeltaDeg */
  headingAbsDeg?: number | null;
}

export interface Scene {
  axis: Axis;
  edges: EdgeSpan[];
  bearingDeg: number;
  /** a frame `offsetM` metres along the road */
  frame(offsetM: number, o?: FrameOpts): FrameRecord;
  /** frames at the given offsets, same options */
  frames(offsets: readonly number[], o?: FrameOpts): FrameRecord[];
}

export const SYNTHETIC_ORIGIN: LatLon = { lat: 5.6037, lon: -0.187 }; // central Accra

/** A straight road of `lengthM` heading `bearingDeg`, cut into edges of the given lengths (default one edge per 100 m). */
export function straightScene(opts: {
  bearingDeg?: number; lengthM: number; edgeLengthsM?: number[]; edgeAttrs?: Partial<EdgeSpan>[]; origin?: LatLon;
}): Scene {
  const bearing = opts.bearingDeg ?? 0;
  const th = (bearing * Math.PI) / 180;
  const dir = { x: Math.sin(th), y: Math.cos(th) }; // east, north
  const right = { x: Math.cos(th), y: -Math.sin(th) };
  const frame = new LocalFrame(opts.origin ?? SYNTHETIC_ORIGIN);
  const at = (along: number, lat: number): LatLon => frame.toLatLon({ x: dir.x * along + right.x * lat, y: dir.y * along + right.y * lat });
  // vertices every 50 m so geometry is a real polyline
  const pts: LatLon[] = [];
  for (let m = 0; m < opts.lengthM; m += 50) pts.push(at(m, 0));
  pts.push(at(opts.lengthM, 0));
  const axis = buildAxis(pts);
  const lens = opts.edgeLengthsM ?? Array.from({ length: Math.ceil(opts.lengthM / 100) }, (_, i) => Math.min(100, opts.lengthM - i * 100));
  let s = 0;
  const edges: EdgeSpan[] = lens.map((l, i) => {
    const e: EdgeSpan = { edgeId: 1000 + i, startM: s, endM: s + l, roadClass: "primary", use: "road", bridge: false, tunnel: false, ...opts.edgeAttrs?.[i] };
    s += l;
    return e;
  });
  let n = 0;
  const mk = (offsetM: number, o: FrameOpts = {}): FrameRecord => {
    const p = at(offsetM, o.lateralRightM ?? 1.5);
    return {
      imageId: o.id ?? `syn-${n++}`,
      sequenceId: o.seq === undefined ? "seqA" : o.seq,
      lat: p.lat, lon: p.lon,
      compassAngleDeg: o.headingAbsDeg !== undefined ? o.headingAbsDeg : (((bearing + (o.headingDeltaDeg ?? 0)) % 360) + 360) % 360,
      qualityScore: o.quality === undefined ? 0.9 : o.quality,
      capturedAt: o.capturedAt === undefined ? "2024-03-01T10:00:00.000Z" : o.capturedAt,
    };
  };
  return { axis, edges, bearingDeg: bearing, frame: mk, frames: (offs, o) => offs.map((m) => mk(m, o)) };
}

/** offsets from `from` to `to` inclusive every `step` metres */
export function every(step: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = from; m <= to + 1e-9; m += step) out.push(m);
  return out;
}
