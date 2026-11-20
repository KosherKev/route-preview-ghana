// Original sketch. Pattern: screen-space path-trail and telemetry overlay.
// Idea (bounded vertex budget, resample by distance, fade by age) is from
// gods-eye-view's trail renderer (MIT, see THIRD_PARTY_NOTICES.md); no code copied.
// Driven by the preview clock only. Never fed by live GPS.

export interface TrailPoint { x: number; y: number; ageMs: number }

export interface TrailOptions { maxVertices: number; stepPx: number; fadeMs: number }

/** Keep at most maxVertices points, spaced at least stepPx apart, newest last. */
export function resampleTrail(pts: readonly TrailPoint[], o: TrailOptions): TrailPoint[] {
  const out: TrailPoint[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= o.stepPx) out.push(p);
  }
  return out.slice(-o.maxVertices);
}

/** Opacity 1 at age 0, falling linearly to 0 at fadeMs. */
export const trailAlpha = (ageMs: number, fadeMs: number) =>
  Math.max(0, Math.min(1, 1 - ageMs / fadeMs));

export interface Telemetry { distanceRemainingM: number; headingDeg: number; nextTurn?: string }

/** Overlay widgets subscribe; the preview engine publishes. */
export interface TelemetryFeed {
  subscribe(listener: (t: Telemetry) => void): () => void;
}
