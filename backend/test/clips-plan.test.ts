import { describe, expect, it } from "vitest";
import { classifyFrames } from "../src/classify/pipeline";
import { every, straightScene } from "../src/classify/synthetic";
import { matchFrames, selectSequences } from "../src/classify/match";
import { buildClipPlans, pickPlans, captureYears } from "../src/clips/plan";
import { buildClipRow, insertClipIfAbsent, type ClipResult } from "../src/clips/register";
import { isClipServable } from "../src/imagery/sources";

function planFor(capturedAt: string, gaps: number[] = []) {
  const sc = straightScene({ lengthM: 400 });
  let offs = every(8, 10, 150);
  if (gaps.length) offs = [...every(8, 10, 82), 100, ...every(8, 108, 180)];
  const frames = sc.frames(offs, { capturedAt }).map((f) => ({ ...f, source: "mapillary" }));
  const r = classifyFrames(sc.axis, sc.edges, frames);
  const usable = selectSequences(matchFrames(sc.axis, sc.edges, frames).kept).selected;
  return { plans: buildClipPlans("r1", r.classification, usable), r };
}

describe("buildClipPlans", () => {
  it("makes one plan per STREET_VIDEO segment with ordered frames, first-edge key and forward direction", () => {
    const { plans } = planFor("2024-03-01T10:00:00.000Z");
    expect(plans).toHaveLength(1);
    const p = plans[0]!;
    expect(p.edge_id).toBe(1000);
    expect(p.direction).toBe("forward");
    expect(p.frames.map((f) => f.offsetM)).toEqual([...p.frames.map((f) => f.offsetM)].sort((a, b) => a - b));
    expect(p.frames.length).toBeGreaterThanOrEqual(15);
    expect(p.captureYears).toEqual({ min: 2024, max: 2024, mean: 2024 });
  });
  it("carries the classifier's bridges (15 to 30 m gaps) and no others", () => {
    const { plans } = planFor("2024-03-01T10:00:00.000Z", [1]);
    expect(plans[0]!.bridges).toEqual([{ startM: 82, endM: 100, gapM: 18 }]);
  });
  it("pickPlans prefers newer imagery, applies the length window and one plan per edge", () => {
    const a = planFor("2018-01-01T00:00:00Z").plans[0]!, b = planFor("2024-01-01T00:00:00Z").plans[0]!;
    const out = pickPlans([a, b], { count: 3, minLengthM: 60, maxLengthM: 400 });
    expect(out).toHaveLength(1); // same edge: one per (edge, direction); the newer one wins
    expect(out[0]!.captureYears.mean).toBe(2024);
    expect(pickPlans([a], { count: 3, minLengthM: 500, maxLengthM: 900 })).toEqual([]);
  });
  it("captureYears ignores missing dates", () => expect(captureYears([{ captured_at: null }])).toEqual({ min: null, max: null, mean: null }));
});

const result = (): ClipResult => ({
  edge_id: 1000, direction: "forward", clip_key: "1000/forward.mp4", duration_s: 14, fps: 10, speed_mps: 10, frame_count: 140, source_frames: 18,
  interpolated_frames: 30, bridge_frames: 0, bridges_used: 0, interpolator: "hold", file_bytes: 1000, encode_seconds: 1,
  start_pose: { lat: 5.6, lon: -0.18, heading_deg: 10 }, end_pose: { lat: 5.61, lon: -0.18, heading_deg: 10 }, render_params: { crf: 27 },
});

describe("clip rows", () => {
  const { plans } = planFor("2024-03-01T10:00:00.000Z");
  const attr = [
    { source: "mapillary", creator_username: "alice", license: "CC-BY-SA-4.0", source_url: "https://www.mapillary.com/app/?pKey=1" },
    { source: "mapillary", creator_username: "bob", license: "CC-BY-SA-4.0", source_url: "https://www.mapillary.com/app/?pKey=2" },
  ];
  const now = new Date("2026-11-21T00:00:00Z");
  const row = buildClipRow(plans[0]!, result(), attr, { startM: 0, endM: 100 }, now);
  it("populates source_summary from the attribution builder", () => {
    expect(row.source_summary).toEqual([{ source: "mapillary", creators: ["alice", "bob"], license: "CC-BY-SA-4.0", sourceUrls: attr.map((a) => a.source_url) }]);
  });
  it("marks the clip prototype, sets expires_at, and fails isClipServable", () => {
    expect(row.status).toBe("prototype");
    expect(row.render_params.prototype).toBe(true);
    expect(row.expires_at).toBe("2026-12-21T00:00:00.000Z");
    expect(isClipServable({ source_summary: row.source_summary, status: row.status, render_params: row.render_params }, {})).toBe(false);
  });
  it("uses a local key as video_url and fractional offsets within the first edge", () => {
    expect(row.video_url).toBe("local:1000/forward.mp4");
    expect(row.start_offset).toBeGreaterThanOrEqual(0);
    expect(row.end_offset).toBeLessThanOrEqual(1);
  });
  it("insertClipIfAbsent does not insert a second row for the same edge and direction", async () => {
    const calls: string[] = [];
    const mk = (n: number) => ({ query: async (q: string) => { calls.push(q.trim().split(/\s/)[0]!); return { rowCount: n }; } });
    expect(await insertClipIfAbsent(mk(1) as never, row)).toBe(false);
    expect(calls).toEqual(["SELECT"]);
    calls.length = 0;
    expect(await insertClipIfAbsent(mk(0) as never, row)).toBe(true);
    expect(calls).toEqual(["SELECT", "INSERT"]);
  });
});
