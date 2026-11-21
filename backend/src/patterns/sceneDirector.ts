// Original sketch. Pattern: a serializable shot list plus one pure sampling
// function used for both playback and seeking. Adapted in spirit from the
// scene-director camera document in gods-eye-view (MIT, see
// THIRD_PARTY_NOTICES.md). Two trivial expressions (cubic-in-out easing and the
// shortest-arc angle wrap in lerpAngle) match src/director/camera.js:44-49 and
// are covered by that MIT notice; nothing else is copied.
// Target: a ~500 m bird's-eye swoop.

import type { CameraPose } from "./rendererContract";
import { bearingXY, normDeg, pointAtOffset, signedAngleDiffDeg, type Axis } from "../geo/local";

export type Easing = "linear" | "cubic-in-out";

export interface Shot {
  id: string;
  durationSec: number;
  holdSec: number;
  easing: Easing;
  /** Two or more poses; sampled piecewise in order. */
  waypoints: CameraPose[];
}

export interface ScenePlan {
  version: 1;
  shots: Shot[];
}

const ease = (t: number, e: Easing) =>
  e === "linear" ? t : t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/** Shortest signed arc interpolation for angles in degrees (same wrap expression as the clone's camera.js:48-49, MIT). */
const lerpAngle = (a: number, b: number, t: number) =>
  a + ((((b - a + 540) % 360) + 360) % 360 - 180) * t;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Pure: same progress always gives the same pose. Endpoints are exact. A single-waypoint shot is a fixed pose. */
export function samplePose(shot: Shot, progress: number): CameraPose {
  const w = shot.waypoints;
  if (w.length === 1) return { ...w[0] };
  const p = Math.min(1, Math.max(0, progress || 0));
  if (p === 0) return { ...w[0] };
  if (p === 1) return { ...w[w.length - 1] };
  const seg = ease(p, shot.easing) * (w.length - 1);
  const i = Math.min(Math.floor(seg), w.length - 2);
  const t = seg - i;
  const [a, b] = [w[i], w[i + 1]];
  return {
    lat: lerp(a.lat, b.lat, t),
    lon: lerp(a.lon, b.lon, t),
    altitudeM: lerp(a.altitudeM, b.altitudeM, t),
    headingDeg: lerpAngle(a.headingDeg, b.headingDeg, t),
    pitchDeg: lerp(a.pitchDeg, b.pitchDeg, t),
  };
}

/**
 * Pure: pose at `timeSec` from shot start. Motion runs for durationSec, then the
 * camera holds on the final pose for holdSec (progress is clamped at 1).
 */
export function samplePoseAtTime(shot: Shot, timeSec: number): CameraPose {
  return samplePose(shot, shot.durationSec > 0 ? timeSec / shot.durationSec : 1);
}

/**
 * Example: a DESCENT over the destination (altitude 500 -> 250 -> 80 m, fixed
 * lat/lon, heading 0 -> 90). It is NOT an approach along the route; a real
 * approach needs waypoints with varying lat/lon along the path.
 */
export function exampleSwoop(dest: { lat: number; lon: number }): ScenePlan {
  const at = (altitudeM: number, pitchDeg: number, headingDeg: number): CameraPose =>
    ({ lat: dest.lat, lon: dest.lon, altitudeM, headingDeg, pitchDeg });
  return {
    version: 1,
    shots: [{
      id: "swoop", durationSec: 8, holdSec: 2, easing: "cubic-in-out",
      waypoints: [at(500, 60, 0), at(250, 55, 45), at(80, 70, 90)],
    }],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Flyover keyframes (Phase 5A). Renderer-neutral DATA for a BIRDS_EYE_3D segment: time, centre, bearing, pitch, zoom,
// easing, plus the route offset the centre sits at. MapLibre Native animates it later (client work). Pre-trip
// preview only: every keyframe is keyed by distance along the fixed route, never by a live position.
// Shape: swoop in (zoom and pitch ease from a high wide view to cruise), follow (centre rides the route spline,
// bearing looks ahead along it with a rate limit), settle (only on the segment that ends at the destination: ease
// down to a close, steep view). Pure and deterministic.
// ---------------------------------------------------------------------------------------------------------------

export interface CameraKeyframe {
  /** Seconds from the start of the segment's flyover. Strictly increasing; first is 0, last is durationSec. */
  t: number;
  /** Metres along the whole route that the camera centre sits at. Non-decreasing; first = segment start, last = segment end. */
  offsetM: number;
  lat: number;
  lon: number;
  /** Compass degrees in [0, 360). */
  bearingDeg: number;
  pitchDeg: number;
  /** MapLibre zoom level. */
  zoom: number;
  /** How the client interpolates from this keyframe to the next. */
  easing: Easing;
}

export interface FlyoverOptions {
  /** Nominal speed used to derive the duration. Default 30 m/s. */
  nominalSpeedMps: number;
  minDurationSec: number;
  maxDurationSec: number;
  /** Largest gap between keyframes. Default 1 s. */
  keyframeStepSec: number;
  maxKeyframes: number;
  /** How far ahead along the route the camera looks for its bearing. Default 60 m. */
  lookaheadM: number;
  /** Largest bearing change between consecutive keyframes (shortest arc). Default 20 degrees. */
  maxBearingStepDeg: number;
  cruiseZoom: number; cruisePitchDeg: number;
  swoopZoom: number; swoopPitchDeg: number;
  settleZoom: number; settlePitchDeg: number;
  swoopFraction: number; settleFraction: number;
  /** Swoop in at the start (default true). */
  swoopIn: boolean;
  /** This segment ends at the destination: settle there (default true). */
  settleAtEnd: boolean;
}

export const DEFAULT_FLYOVER_OPTIONS: FlyoverOptions = {
  nominalSpeedMps: 30, minDurationSec: 6, maxDurationSec: 90, keyframeStepSec: 1, maxKeyframes: 120,
  lookaheadM: 60, maxBearingStepDeg: 20,
  cruiseZoom: 16, cruisePitchDeg: 60, swoopZoom: 14.5, swoopPitchDeg: 35, settleZoom: 17.5, settlePitchDeg: 68,
  swoopFraction: 0.2, settleFraction: 0.2, swoopIn: true, settleAtEnd: true,
};

/** Hard bounds every keyframe respects (the plan clamps to them). */
export const FLYOVER_BOUNDS = { minZoom: 12, maxZoom: 19, minPitchDeg: 0, maxPitchDeg: 80 } as const;

export interface FlyoverPlan {
  durationSec: number;
  lengthM: number;
  /** lengthM / durationSec. A client may ramp speed; this is only the nominal figure. */
  nominalSpeedMps: number;
  keyframes: CameraKeyframe[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smooth = (p: number) => p * p * (3 - 2 * p);

/** Bearing of the route at `offsetM`, looking `lookaheadM` ahead (looks back near the end so it never degenerates). */
export function routeBearingAt(axis: Axis, offsetM: number, lookaheadM: number): number {
  const len = axis.lengthM;
  let a = clamp(offsetM, 0, len), b = clamp(offsetM + lookaheadM, 0, len);
  if (b - a < 1) { b = len; a = Math.max(0, len - Math.max(lookaheadM, 1)); }
  const pa = axis.frame.toXY(pointAtOffset(axis, a)), pb = axis.frame.toXY(pointAtOffset(axis, b));
  return normDeg(bearingXY(pa, pb));
}

/**
 * Camera keyframes for the part of `axis` between `startM` and `endM`. Guarantees (unit-tested): offsets are
 * non-decreasing from startM to endM, shortest-arc bearing change between keyframes is at most maxBearingStepDeg,
 * zoom and pitch stay inside FLYOVER_BOUNDS, times are strictly increasing, and a zero-length or very short segment
 * still yields a valid plan (minimum duration), as does a very long one (duration capped, nominal speed rises).
 */
export function planFlyover(axis: Axis, startM: number, endM: number, partial: Partial<FlyoverOptions> = {}): FlyoverPlan {
  const o = { ...DEFAULT_FLYOVER_OPTIONS, ...partial };
  if (!(o.nominalSpeedMps > 0) || !(o.keyframeStepSec > 0) || !(o.maxBearingStepDeg > 0)) throw new RangeError("invalid flyover options");
  const s0 = clamp(Number.isFinite(startM) ? startM : 0, 0, axis.lengthM);
  const s1 = clamp(Number.isFinite(endM) ? endM : axis.lengthM, s0, axis.lengthM);
  const lengthM = s1 - s0;
  const durationSec = clamp(lengthM / o.nominalSpeedMps, o.minDurationSec, o.maxDurationSec);
  const n = Math.max(2, Math.min(o.maxKeyframes - 1, Math.ceil(durationSec / o.keyframeStepSec)));
  const keyframes: CameraKeyframe[] = [];
  let prevBearing = 0;
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    const t = i === n ? durationSec : (durationSec * i) / n;
    // mostly constant speed with gentle ease at both ends; monotonic because both terms are
    const progress = i === 0 ? 0 : i === n ? 1 : 0.7 * p + 0.3 * smooth(p);
    const offsetM = i === n ? s1 : s0 + lengthM * progress;
    let zoom = o.cruiseZoom, pitch = o.cruisePitchDeg, easing: Easing = "linear";
    if (o.swoopIn && p < o.swoopFraction) {
      const q = smooth(p / o.swoopFraction);
      zoom = o.swoopZoom + (o.cruiseZoom - o.swoopZoom) * q;
      pitch = o.swoopPitchDeg + (o.cruisePitchDeg - o.swoopPitchDeg) * q;
      easing = "cubic-in-out";
    } else if (o.settleAtEnd && p > 1 - o.settleFraction) {
      const q = smooth((p - (1 - o.settleFraction)) / o.settleFraction);
      zoom = o.cruiseZoom + (o.settleZoom - o.cruiseZoom) * q;
      pitch = o.cruisePitchDeg + (o.settlePitchDeg - o.cruisePitchDeg) * q;
      easing = "cubic-in-out";
    }
    const target = routeBearingAt(axis, offsetM, o.lookaheadM);
    const bearing = i === 0 ? target
      : normDeg(prevBearing + clamp(signedAngleDiffDeg(prevBearing, target), -o.maxBearingStepDeg, o.maxBearingStepDeg));
    prevBearing = bearing;
    const c = pointAtOffset(axis, offsetM);
    keyframes.push({
      t, offsetM, lat: c.lat, lon: c.lon, bearingDeg: bearing,
      pitchDeg: clamp(pitch, FLYOVER_BOUNDS.minPitchDeg, FLYOVER_BOUNDS.maxPitchDeg),
      zoom: clamp(zoom, FLYOVER_BOUNDS.minZoom, FLYOVER_BOUNDS.maxZoom), easing: i === n ? "linear" : easing,
    });
  }
  return { durationSec, lengthM, nominalSpeedMps: lengthM / durationSec, keyframes };
}
