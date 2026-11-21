// Synthetic preview fixtures: a straight 1500 m road heading east with 100 m edges (ids 1000..1014). Not real data.
import type { FrameRecord } from "../../src/classify/types";
import { every, straightScene } from "../../src/classify/synthetic";
import type { ApproachResult, ExtractedManeuver } from "../../src/routing/approach";
import { encodePolyline6 } from "../../src/routing/polyline";
import type { ClipRecord, PreviewDeps } from "../../src/preview/build";
import type { LandmarkRow } from "../../src/preview/overlays";

export const scene = straightScene({ lengthM: 1500, bearingDeg: 90 });

export function approachFixture(): ApproachResult {
  const total = scene.axis.lengthM;
  const maneuvers: ExtractedManeuver[] = [
    { type: 1, kind: "other", instruction: "Start", streetNames: [], atM: 0, endM: 100 },
    { type: 15, kind: "turn", instruction: "Turn left onto X", streetNames: ["Test Rd"], atM: 1200, endM: 1300 },
    { type: 4, kind: "other", instruction: "Arrive", streetNames: [], atM: total, endM: total },
  ];
  return {
    costing: "motor_scooter", unpaved_fallback: false, warnings: [],
    origin: scene.axis.points[0]!, destination: scene.axis.points.at(-1)!,
    route: { lengthM: total, valhallaLengthKm: total / 1000, timeSec: 200, polyline6: encodePolyline6(scene.axis.points.map((p) => [p.lat, p.lon] as [number, number])), pointCount: scene.axis.points.length, matchedShapeTrim: { leading: 0, trailing: 0 } },
    edges: scene.edges.map((e) => ({ id: e.edgeId, bridge: false, tunnel: false, names: [], startM: e.startM, endM: e.endM, roadClass: "primary", use: "road" })),
    maneuvers,
    approach: { requestedLengthM: 500, lengthM: 500, startM: total - 500, endM: total, wholeRoute: false, polyline6: "", edges: [], edgeIds: [] },
    decisionWindows: [],
  };
}

export const streetFrames = (from: number, to: number): FrameRecord[] =>
  scene.frames(every(5, from, to)).map((f) => ({ ...f, source: "mapillary" }));

export const clipRecord = (edge: number, lengthM: number, over: Partial<ClipRecord> = {}): ClipRecord => ({
  edge_id: edge, direction: "forward", key: `${edge}/forward.mp4`, length_m: lengthM, status: "prototype",
  render_params: { prototype: true, duration_s: lengthM / 10, fps: 10, speed_mps: 10 },
  source_summary: [{ source: "mapillary", creators: ["tester"], license: "CC-BY-SA-4.0", sourceUrls: ["https://example.invalid/x"] }],
  start_pose: { lat: 5.6, lon: -0.18, heading_deg: 90 }, end_pose: { lat: 5.6, lon: -0.17, heading_deg: 90 }, fileBytes: 123456, ...over,
});

export const landmarkRows: LandmarkRow[] = [
  { osm_type: "node", osm_id: 1, category: "fuel", kind: "fuel", name: "Test Fuel", lat: scene.axis.points[0]!.lat, lon: scene.axis.points[0]!.lon },
];

export function depsFixture(o: { frames?: FrameRecord[]; clips?: ClipRecord[]; landmarks?: LandmarkRow[] } = {}): PreviewDeps & { calls: Record<string, number> } {
  const calls: Record<string, number> = { loadClips: 0 };
  return {
    calls,
    extractor: async () => approachFixture(),
    loadFrames: async () => ({ frames: o.frames ?? [], sourcesExcluded: [] }),
    loadAttribution: async (ids) => ids.map(() => ({ source: "mapillary", creator_username: "tester", license: "CC-BY-SA-4.0", source_url: "https://example.invalid/x" })),
    loadClips: async (edgeIds) => { calls.loadClips!++; return (o.clips ?? []).filter((c) => edgeIds.includes(c.edge_id)); },
    loadLandmarks: async () => o.landmarks ?? [],
  };
}
