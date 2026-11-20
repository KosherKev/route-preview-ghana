// Original sketch. Pattern: route-preview logic depends on a small renderer
// interface, never on a map engine. Inspired by the renderer-contract idea in
// gods-eye-view (MIT, see THIRD_PARTY_NOTICES.md); no code copied.

export interface CameraPose {
  lat: number;
  lon: number;
  /** Metres above local ground (not ellipsoid height). */
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
}

export type LngLat = readonly [lon: number, lat: number];

export interface PreviewRenderer {
  readonly id: string;
  /** Optional features the engine supports; callers degrade, never branch on id. */
  readonly capabilities: ReadonlySet<"terrain" | "buildings3d" | "pathTrail">;
  setCamera(pose: CameraPose): void;
  drawRoute(path: readonly LngLat[]): void;
  project(point: LngLat): { x: number; y: number } | null;
  /** Resolves when the visible area has finished loading. */
  settled(): Promise<void>;
  dispose(): void;
}

/** MapLibre implementation lives in the client (later phase); tests use a no-op. */
export function createStubRenderer(): PreviewRenderer {
  let last: CameraPose | null = null;
  return {
    id: "stub",
    capabilities: new Set(),
    setCamera: (p) => { last = p; void last; },
    drawRoute: () => {},
    project: () => null,
    settled: () => Promise.resolve(),
    dispose: () => {},
  };
}
