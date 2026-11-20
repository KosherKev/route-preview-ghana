// Original sketch. Pattern: street imagery behind a swappable interface.
// Mapillary is the prototype source; rider-captured imagery replaces it later.
// No Mapillary calls, tokens or endpoints are configured in this phase.

export interface ImageFrame {
  lat: number;
  lon: number;
  headingDeg: number;
  capturedAt: string; // ISO 8601
  /** Opaque handle the source can turn into pixels; callers never parse it. */
  ref: string;
}

export interface StreetImagerySource {
  readonly id: string; // "mapillary" | "rider-captured" | ...
  /** Frames near a path, ordered along it. */
  framesAlong(path: readonly (readonly [number, number])[], bufferM: number): Promise<ImageFrame[]>;
  /** Attribution/licence text owed to the data provider. */
  attribution(): string;
}
