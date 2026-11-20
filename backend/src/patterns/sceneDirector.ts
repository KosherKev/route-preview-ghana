// Original sketch. Pattern: a serializable shot list plus one pure sampling
// function used for both playback and seeking. Adapted in spirit from the
// scene-director camera document in gods-eye-view (MIT, see
// THIRD_PARTY_NOTICES.md). Two trivial expressions (cubic-in-out easing and the
// shortest-arc angle wrap in lerpAngle) match src/director/camera.js:44-49 and
// are covered by that MIT notice; nothing else is copied.
// Target: a ~500 m bird's-eye swoop.

import type { CameraPose } from "./rendererContract";

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
