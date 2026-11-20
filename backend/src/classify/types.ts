// Plain typed records shared by the matcher, classifier and loader. Imagery-source neutral on purpose: nothing here
// (or in the rest of src/classify) imports Mapillary code; frames arrive from the `frames` table or test fixtures.

/** One street-imagery frame. Coordinates are explicit lat/lon fields; heading is a compass angle (0 = north, clockwise). */
export interface FrameRecord {
  imageId: string;
  sequenceId: string | null;
  lat: number;
  lon: number;
  compassAngleDeg: number | null;
  qualityScore: number | null;
  /** ISO 8601 */
  capturedAt: string | null;
  /** Imagery source name (the `frames.source` column, e.g. "mapillary"). Absent on fixtures; the kill switch only acts on frames that carry one. */
  source?: string;
}

/** A route edge with its extent along the route axis (metres) and the attributes used for level-change detection. */
export interface EdgeSpan {
  edgeId: number;
  startM: number;
  endM: number;
  roadClass?: string;
  use?: string;
  bridge?: boolean;
  tunnel?: boolean;
  /** OSM `layer`, when a source provides it. Valhalla 3.9.3 trace_attributes does not, so bridge/tunnel/use/roadClass stand in. */
  layer?: number | null;
}

// Gap rule (owner-confirmed 2026-11-20; see classify.ts): gap < 15 m RIFE-eligible; 15-30 m (inclusive) crossfade bridge
// inside one STREET_VIDEO segment (same sequence_id only, at most 2 bridges per segment), never RIFE; > 30 m (or an unbridgeable run < 60 m) hands off to BIRDS_EYE_3D.
export type Mode = "STREET_VIDEO" | "BIRDS_EYE_3D";

export type DropReason =
  | "no_heading" | "no_sequence" | "off_route" | "left_of_centerline" | "bearing_mismatch" | "low_quality" | "other_sequence" | "duplicate_image";

export type LevelReason = "sequence_jump" | "heading_jump" | "level_change";

export type BirdsEyeReason = "no_frames" | "run_too_short" | "gap_too_large" | "level_uncertain";
