// POST /preview: build the versioned timeline manifest for a fixed origin and destination. Pre-trip preview only:
// nothing here takes, stores or follows a device position; every offset is metres along the planned route.
// No endpoint here renders anything: a street segment without a clip is reported "not_rendered" and the client plays
// the flyover for it.
import { sliceAxis, type Axis, type LatLon } from "../geo/local";
import { DEFAULT_MATCH_CONFIG } from "../classify/match";
import { classifyFrames } from "../classify/pipeline";
import type { Classification, TimelineSegment } from "../classify/classify";
import type { FrameRecord } from "../classify/types";
import { buildAttribution, type Attribution, type AttributionFrame } from "../imagery/attribution";
import type { Costing } from "../routing/valhalla";
import { encodePolyline6 } from "../routing/polyline";
import type { ApproachOptions, ApproachResult } from "../routing/approach";
import { planFlyover, type FlyoverPlan } from "../patterns/sceneDirector";
import { routeInputs, usableFrames, framesInStreetSegments } from "../validation/coverage";
import {
  DEFAULT_LANDMARK_OPTIONS, deriveTurnEvents, selectLandmarks, type LandmarkCallout, type LandmarkOptions, type LandmarkRow, type TurnEvent,
} from "./overlays";

export const MANIFEST_VERSION = 1;
/** Speed assumed for a street segment whose clip is not rendered (the clip pipeline renders at 10 m/s). */
export const NOMINAL_STREET_SPEED_MPS = 10;
/** A stored clip matches a segment only if its length is within this many metres of the segment length. */
export const CLIP_LENGTH_TOLERANCE_M = 5;
export const CLIP_DIRECTION = "forward";
/** Flyover segments shorter than this (after clipping to the timeline) are dropped from the manifest. */
export const MIN_FLYOVER_SEGMENT_M = 1;

export interface PreviewRequest {
  origin: LatLon; destination: LatLon; costing: Costing;
  approachLengthM?: number; decisionWindowM?: number; landmarkMaxDistanceM?: number; landmarkMaxPer100m?: number;
}

/** What the store knows about a registered clip (the `clips` row, plus whether the file is in the local cache). */
export interface ClipRecord {
  edge_id: number; direction: string; key: string; length_m: number | null; status: string;
  render_params: Record<string, unknown> | null; source_summary: unknown; start_pose: unknown; end_pose: unknown;
  /** Size of the cached file in bytes, or null when the file is not in the local cache. */
  fileBytes: number | null;
}

export interface PreviewDeps {
  extractor: (c: Costing, o: LatLon, d: LatLon, opts: ApproachOptions) => Promise<ApproachResult>;
  extractOptions?: ApproachOptions;
  loadFrames(axis: Axis): Promise<{ frames: FrameRecord[]; sourcesExcluded: string[] }>;
  loadAttribution(imageIds: readonly string[]): Promise<AttributionFrame[]>;
  loadClips(edgeIds: readonly number[], direction: string): Promise<ClipRecord[]>;
  loadLandmarks(axis: Axis, fromM: number, toM: number, maxDistanceM: number): Promise<LandmarkRow[]>;
}

export interface NamedEnd { query: string; name: string; lat: number; lon: number; source: string; score: number; degraded: boolean }

export interface ClipRef { edge_id: number; direction: string; key: string }
export interface ReadyClip extends ClipRef {
  status: "ready"; durationSec: number; fps: number | null; speedMps: number | null; bytes: number; lengthM: number;
  /** Dev-only path (GET), served only with PROTOTYPE_CLIP_SERVING=1 on loopback. Not a public URL. */
  servePath: string;
  startPose: unknown; endPose: unknown;
}

export interface ManifestSegment {
  index: number;
  mode: "STREET_VIDEO" | "BIRDS_EYE_3D";
  startM: number; endM: number; lengthM: number;
  /** polyline6 of the segment geometry (lat, lon pairs, precision 6). */
  polyline6: string;
  /** What the client plays for this segment: "clip" means use the clip when it can be fetched, otherwise play `flyover`. */
  playback: "clip" | "flyover";
  /** Why the flyover is played for a street segment, or the classifier's reason for a flyover segment. */
  playbackReason: string;
  nominalDurationSec: number;
  nominalSpeedMps: number;
  /** STREET_VIDEO only (null for flyover segments): ready | not_rendered. */
  status: "ready" | "not_rendered" | null;
  clipRef: ClipRef | null;
  clip: ReadyClip | null;
  bridges: { startM: number; endM: number; gapM: number }[];
  /** Capture-date indicator data for street segments (from the frames in the segment); null otherwise. */
  captureYears: { min: number; max: number } | null;
  flyover: { durationSec: number; nominalSpeedMps: number; keyframes: FlyoverPlan["keyframes"] };
  // always present: a street segment with a ready clip carries it as the fallback for a client that cannot fetch the clip
}

export interface PreviewManifest {
  manifestVersion: typeof MANIFEST_VERSION;
  /** Always true in this phase: the imagery is prototype-only and nothing derived from it may be served publicly (D1). */
  prototype: true;
  /** True when a name lookup ran without its Photon stage. The route itself is unaffected. */
  degraded: boolean;
  costing: Costing;
  unpavedFallback: boolean;
  warnings: string[];
  origin: LatLon; destination: LatLon;
  resolved?: Record<string, NamedEnd>;
  route: { lengthM: number; timeSec: number; polyline6: string };
  approach: { requestedLengthM: number; lengthM: number; startM: number; endM: number; wholeRoute: boolean };
  /** The span the segments cover. Starts at or before approach.startM (it is extended back to include whole ready clips). */
  timeline: { startM: number; endM: number; lengthM: number };
  nominal: { streetSpeedMps: number; flyoverSpeedMps: number; note: string };
  segments: ManifestSegment[];
  overlays: { turns: TurnEvent[]; landmarks: LandmarkCallout[]; turnWindowM: number; landmarkOptions: LandmarkOptions };
  captureYears: { min: number; max: number } | null;
  attribution: Attribution;
  sourcesExcluded: string[];
}

const yearOf = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
};

function segmentYears(s: TimelineSegment): { min: number; max: number } | null {
  if (s.mode !== "STREET_VIDEO" || !s.capturedAt) return null;
  const a = yearOf(s.capturedAt.earliest), b = yearOf(s.capturedAt.latest);
  if (a === null || b === null) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function toReady(rec: ClipRecord): ReadyClip {
  const rp = rec.render_params ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const dur = num(rp.duration_s) ?? 0;
  return {
    edge_id: rec.edge_id, direction: rec.direction, key: rec.key, status: "ready", durationSec: dur, fps: num(rp.fps), speedMps: num(rp.speed_mps),
    bytes: rec.fileBytes ?? 0, lengthM: rec.length_m ?? 0, servePath: `/clips/${rec.edge_id}/${rec.direction}.mp4`, startPose: rec.start_pose, endPose: rec.end_pose,
  };
}

/** A clip is ready when a registered row exists for the segment's first edge, its file is cached, and its length matches. */
export function matchClip(seg: TimelineSegment, rows: readonly ClipRecord[]): ClipRecord | null {
  const edge = seg.edgeIds[0];
  if (edge === undefined) return null;
  const r = rows.find((c) => c.edge_id === edge && c.direction === CLIP_DIRECTION);
  if (!r || r.fileBytes === null || r.length_m === null) return null;
  return Math.abs(r.length_m - seg.lengthM) <= CLIP_LENGTH_TOLERANCE_M ? r : null;
}

export interface AssembleInput {
  approach: ApproachResult; classification: Classification; axis: Axis;
  clips: readonly ClipRecord[]; landmarkRows: readonly LandmarkRow[];
  attributionFrames: readonly AttributionFrame[];
  sourcesExcluded: string[]; request: PreviewRequest; degraded: boolean; resolved?: Record<string, NamedEnd>;
}

/** Which segments the timeline covers and where it starts (pure; used before attribution is loaded). */
export function planTimeline(approach: ApproachResult, classification: Classification, clips: readonly ClipRecord[]) {
  const total = approach.route.lengthM;
  const windowStart = approach.approach.startM;
  let startM = windowStart;
  for (const s of classification.segments) {
    if (s.mode === "STREET_VIDEO" && s.endM > windowStart && matchClip(s, clips)) startM = Math.min(startM, s.startM);
  }
  const included = classification.segments.filter((s) => s.endM > startM && s.startM < total);
  return { startM, endM: total, included };
}

export function assembleManifest(i: AssembleInput): PreviewManifest {
  const { approach, classification, axis } = i;
  const total = approach.route.lengthM;
  const tl = planTimeline(approach, classification, i.clips);
  const turnWindowM = i.request.decisionWindowM ?? 80;
  const lmOpts: LandmarkOptions = {
    ...DEFAULT_LANDMARK_OPTIONS,
    ...(i.request.landmarkMaxDistanceM !== undefined ? { maxDistanceM: i.request.landmarkMaxDistanceM } : {}),
    ...(i.request.landmarkMaxPer100m !== undefined ? { maxPer100m: i.request.landmarkMaxPer100m } : {}),
  };
  const segments: ManifestSegment[] = [];
  // a flyover sliver under 1 m (the classifier can leave one at a route end after rounding) is not worth a segment
  const shown = tl.included.filter((s) => s.mode === "STREET_VIDEO" || Math.min(s.endM, total) - Math.max(s.startM, tl.startM) >= MIN_FLYOVER_SEGMENT_M);
  shown.forEach((seg, index) => {
    const startM = Math.max(seg.startM, tl.startM), endM = Math.min(seg.endM, total);
    const lengthM = endM - startM;
    const polyline6 = encodePolyline6(sliceAxis(axis, startM, endM).map((p) => [p.lat, p.lon] as [number, number]));
    const bridges = seg.bridges.map(({ startM: a, endM: b, gapM }) => ({ startM: a, endM: b, gapM }));
    const base = { index, mode: seg.mode, startM, endM, lengthM, polyline6, bridges, captureYears: segmentYears(seg) };
    const flyoverOf = () => {
      const prev = segments[index - 1];
      const plan = planFlyover(axis, startM, endM, { swoopIn: !prev || prev.playback === "clip", settleAtEnd: endM >= total - 1e-6 });
      return { durationSec: plan.durationSec, nominalSpeedMps: plan.nominalSpeedMps, keyframes: plan.keyframes };
    };
    if (seg.mode === "BIRDS_EYE_3D") {
      const f = flyoverOf();
      segments.push({ ...base, playback: "flyover", playbackReason: seg.birdsEyeReason ?? "birds_eye", nominalDurationSec: f.durationSec, nominalSpeedMps: f.nominalSpeedMps,
        status: null, clipRef: null, clip: null, flyover: f });
      return;
    }
    const edge = seg.edgeIds[0]!;
    const ref: ClipRef = { edge_id: edge, direction: CLIP_DIRECTION, key: `${edge}/${CLIP_DIRECTION}.mp4` };
    const rec = matchClip(seg, i.clips);
    if (rec) {
      const clip = toReady(rec);
      const f = flyoverOf(); // fallback for a client that cannot fetch the clip (over the tailnet the clip door is shut)
      const dur = clip.durationSec > 0 ? clip.durationSec : lengthM / NOMINAL_STREET_SPEED_MPS;
      segments.push({ ...base, playback: "clip", playbackReason: "clip_ready", nominalDurationSec: dur, nominalSpeedMps: lengthM / dur,
        status: "ready", clipRef: { ...ref, key: rec.key }, clip, flyover: f });
    } else {
      const f = flyoverOf();
      segments.push({ ...base, playback: "flyover", playbackReason: "clip_not_rendered", nominalDurationSec: f.durationSec, nominalSpeedMps: f.nominalSpeedMps,
        status: "not_rendered", clipRef: ref, clip: null, flyover: f });
    }
  });
  const years = segments.flatMap((s) => (s.captureYears ? [s.captureYears.min, s.captureYears.max] : []));
  return {
    manifestVersion: MANIFEST_VERSION, prototype: true, degraded: i.degraded,
    costing: approach.costing, unpavedFallback: approach.unpaved_fallback, warnings: approach.warnings,
    origin: approach.origin, destination: approach.destination,
    ...(i.resolved && Object.keys(i.resolved).length ? { resolved: i.resolved } : {}),
    route: { lengthM: total, timeSec: approach.route.timeSec, polyline6: approach.route.polyline6 },
    approach: { requestedLengthM: approach.approach.requestedLengthM, lengthM: approach.approach.lengthM, startM: approach.approach.startM, endM: approach.approach.endM, wholeRoute: approach.approach.wholeRoute },
    timeline: { startM: tl.startM, endM: tl.endM, lengthM: tl.endM - tl.startM },
    nominal: {
      streetSpeedMps: NOMINAL_STREET_SPEED_MPS, flyoverSpeedMps: 30,
      note: "Nominal figures only. Speed ramps are client work; durations here are the preview clock at nominal speed.",
    },
    segments,
    overlays: {
      turns: deriveTurnEvents(approach.maneuvers, tl.startM, tl.endM, total, turnWindowM),
      landmarks: selectLandmarks(axis, i.landmarkRows, tl.startM, tl.endM, lmOpts),
      turnWindowM, landmarkOptions: lmOpts,
    },
    captureYears: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
    attribution: buildAttribution(i.attributionFrames),
    sourcesExcluded: i.sourcesExcluded,
  };
}

/** The I/O wrapper: route, classify, look up clips, landmarks and attribution, assemble. */
export function createPreviewBuilder(deps: PreviewDeps) {
  return async function buildPreview(
    req: PreviewRequest, ctx: { signal?: AbortSignal; resolved?: Record<string, NamedEnd>; degraded?: boolean } = {},
  ): Promise<PreviewManifest> {
    const approach = await deps.extractor(req.costing, req.origin, req.destination, {
      ...deps.extractOptions, signal: ctx.signal, approachLengthM: req.approachLengthM, decisionWindowM: req.decisionWindowM,
    });
    const { axis, edges } = routeInputs(approach);
    const { frames, sourcesExcluded } = await deps.loadFrames(axis);
    const res = classifyFrames(axis, edges, frames, DEFAULT_MATCH_CONFIG, undefined, sourcesExcluded);
    const edgeIds = [...new Set(res.classification.segments.filter((s) => s.mode === "STREET_VIDEO" && s.edgeIds.length).map((s) => s.edgeIds[0]!))];
    const clips = edgeIds.length ? await deps.loadClips(edgeIds, CLIP_DIRECTION) : [];
    const tl = planTimeline(approach, res.classification, clips);
    const inTimeline = res.classification.segments.filter((s) => tl.included.includes(s));
    const usable = usableFrames(axis, edges, frames.filter((f) => !f.source || !sourcesExcluded.includes(f.source.trim().toLowerCase())));
    const ids = framesInStreetSegments(usable, inTimeline).map((m) => m.frame.imageId);
    const attributionFrames = ids.length ? await deps.loadAttribution(ids) : [];
    const lmOpts = req.landmarkMaxDistanceM ?? DEFAULT_LANDMARK_OPTIONS.maxDistanceM;
    const landmarkRows = await deps.loadLandmarks(axis, tl.startM, tl.endM, lmOpts);
    return assembleManifest({
      approach, classification: res.classification, axis, clips, landmarkRows, attributionFrames,
      sourcesExcluded: res.sourcesExcluded, request: req, degraded: ctx.degraded ?? false, resolved: ctx.resolved,
    });
  };
}
export type PreviewBuilder = ReturnType<typeof createPreviewBuilder>;
