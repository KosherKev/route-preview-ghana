import { afterEach, describe, expect, it } from "vitest";
import { createPreviewBuilder, type PreviewRequest } from "../src/preview/build";
import { manifestErrors } from "./helpers/manifestSchema";
import { clipRecord, depsFixture, landmarkRows, scene, streetFrames } from "./helpers/previewFixture";

const REQ: PreviewRequest = { origin: scene.axis.points[0]!, destination: scene.axis.points.at(-1)!, costing: "motor_scooter" };
afterEach(() => { delete process.env.IMAGERY_SOURCES_DISABLED; });

describe("POST /preview manifest builder", () => {
  it("(a) route with a ready prototype clip: validates, plays the clip, extends the timeline back to the whole clip", async () => {
    const m = await createPreviewBuilder(depsFixture({ frames: streetFrames(950, 1100), clips: [clipRecord(1009, 150)], landmarks: landmarkRows }))(REQ);
    expect(manifestErrors(m)).toEqual([]);
    expect(m.prototype).toBe(true);
    const street = m.segments.filter((s) => s.mode === "STREET_VIDEO");
    expect(street).toHaveLength(1);
    expect(street[0]).toMatchObject({ status: "ready", playback: "clip", playbackReason: "clip_ready", flyover: null });
    expect(street[0]!.clip).toMatchObject({ edge_id: 1009, direction: "forward", key: "1009/forward.mp4", status: "ready", servePath: "/clips/1009/forward.mp4", durationSec: 15 });
    expect(street[0]!.captureYears).toEqual({ min: 2024, max: 2024 });
    expect(m.captureYears).toEqual({ min: 2024, max: 2024 });
    // approach window is the last 500 m, but the ready clip starts earlier so the timeline starts there
    expect(m.approach.startM).toBeCloseTo(1000);
    expect(m.timeline.startM).toBeCloseTo(950);
    expect(m.attribution).toMatchObject({ requiresLogoAndLink: true, sources: ["mapillary"], creators: ["tester"] });
    expect(m.segments[0]!.startM).toBeCloseTo(950);
    expect(m.segments.at(-1)!.endM).toBeCloseTo(scene.axis.lengthM);
    for (let i = 1; i < m.segments.length; i++) expect(m.segments[i]!.startM).toBeCloseTo(m.segments[i - 1]!.endM);
    expect(m.overlays.turns.map((t) => [t.offsetM, t.maneuver, t.direction])).toEqual([[1200, "left", "left"]]);
  });

  it("(b) street segment with no clip row: not_rendered, clip null, flyover keyframes to play instead", async () => {
    const m = await createPreviewBuilder(depsFixture({ frames: streetFrames(1100, 1250) }))(REQ);
    expect(manifestErrors(m)).toEqual([]);
    const s = m.segments.find((x) => x.mode === "STREET_VIDEO")!;
    expect(s).toMatchObject({ status: "not_rendered", clip: null, playback: "flyover", playbackReason: "clip_not_rendered" });
    expect(s.clipRef).toEqual({ edge_id: 1011, direction: "forward", key: "1011/forward.mp4" });
    expect(s.flyover!.keyframes.length).toBeGreaterThan(2);
    expect(m.timeline.startM).toBeCloseTo(m.approach.startM);
  });

  it("a registered clip whose file is not cached, or whose length does not match, is not_rendered", async () => {
    const noFile = await createPreviewBuilder(depsFixture({ frames: streetFrames(1100, 1250), clips: [clipRecord(1011, 150, { fileBytes: null })] }))(REQ);
    expect(noFile.segments.find((x) => x.mode === "STREET_VIDEO")!.status).toBe("not_rendered");
    const wrongLen = await createPreviewBuilder(depsFixture({ frames: streetFrames(1100, 1250), clips: [clipRecord(1011, 90)] }))(REQ);
    expect(wrongLen.segments.find((x) => x.mode === "STREET_VIDEO")!.status).toBe("not_rendered");
  });

  it("(c) all-flyover route: validates, no street segment, no attribution, no clip lookup", async () => {
    const d = depsFixture({ frames: [] });
    const m = await createPreviewBuilder(d)(REQ);
    expect(manifestErrors(m)).toEqual([]);
    expect(m.segments.every((s) => s.mode === "BIRDS_EYE_3D" && s.playback === "flyover" && s.clip === null && s.status === null)).toBe(true);
    expect(m.segments[0]!.playbackReason).toBe("no_frames");
    expect(m.captureYears).toBeNull();
    expect(m.attribution).toMatchObject({ requiresLogoAndLink: false, sources: [] });
    expect(d.calls.loadClips).toBe(0);
    // first swoops in, last settles at the destination
    const k = m.segments.at(-1)!.flyover!.keyframes;
    expect(k.at(-1)!.zoom).toBeGreaterThan(17);
    expect(k.at(-1)!.offsetM).toBeCloseTo(scene.axis.lengthM);
  });

  it("drops a sub-metre flyover sliver at the route end", async () => {
    const m = await createPreviewBuilder(depsFixture({ frames: [...streetFrames(1400, 1495), ...scene.frames([1499.7]).map((f) => ({ ...f, source: "mapillary" }))] }))(REQ);
    expect(manifestErrors(m)).toEqual([]);
    expect(m.segments.every((s) => s.lengthM >= 1)).toBe(true);
    expect(m.segments.at(-1)!.mode).toBe("STREET_VIDEO");
  });

  it("kill switch: frames of a disabled source are excluded, the segment becomes flyover and sourcesExcluded says so", async () => {
    process.env.IMAGERY_SOURCES_DISABLED = "mapillary";
    const m = await createPreviewBuilder(depsFixture({ frames: streetFrames(1100, 1250), clips: [clipRecord(1011, 150)] }))(REQ);
    expect(manifestErrors(m)).toEqual([]);
    expect(m.sourcesExcluded).toEqual(["mapillary"]);
    expect(m.segments.every((s) => s.mode === "BIRDS_EYE_3D")).toBe(true);
    expect(m.attribution.requiresLogoAndLink).toBe(false);
  });

  it("carries the degraded flag and the named ends, and the landmark option overrides", async () => {
    const resolved = { destination: { query: "x", name: "X", lat: 5.6, lon: -0.18, source: "landmarks", score: 0.9, degraded: true } };
    const m = await createPreviewBuilder(depsFixture({ landmarks: landmarkRows }))({ ...REQ, landmarkMaxDistanceM: 25, landmarkMaxPer100m: 2, decisionWindowM: 120 }, { degraded: true, resolved });
    expect(manifestErrors(m)).toEqual([]);
    expect(m.degraded).toBe(true);
    expect(m.resolved).toEqual(resolved);
    expect(m.overlays.landmarkOptions).toMatchObject({ maxDistanceM: 25, maxPer100m: 2 });
    expect(m.overlays.turnWindowM).toBe(120);
  });

  it("is deterministic (same inputs, same manifest) and contains no generated timestamps", async () => {
    const mk = () => createPreviewBuilder(depsFixture({ frames: streetFrames(950, 1100), clips: [clipRecord(1009, 150)] }))(REQ);
    expect(JSON.stringify(await mk())).toBe(JSON.stringify(await mk()));
  });

  it("never copies Valhalla instruction text into the manifest", async () => {
    const m = await createPreviewBuilder(depsFixture())(REQ);
    expect(JSON.stringify(m)).not.toContain("Turn left onto X");
  });
});
