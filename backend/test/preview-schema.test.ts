import { describe, expect, it } from "vitest";
import { createPreviewBuilder } from "../src/preview/build";
import { manifestErrors, schema } from "./helpers/manifestSchema";
import { clipRecord, depsFixture, scene, streetFrames } from "./helpers/previewFixture";

const REQ = { origin: scene.axis.points[0]!, destination: scene.axis.points.at(-1)!, costing: "motor_scooter" as const };
const ready = () => createPreviewBuilder(depsFixture({ frames: streetFrames(950, 1100), clips: [clipRecord(1009, 150)] }))(REQ);
const notRendered = () => createPreviewBuilder(depsFixture({ frames: streetFrames(1100, 1250) }))(REQ);
const flyover = () => createPreviewBuilder(depsFixture())(REQ);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("preview manifest JSON Schema", () => {
  it("is itself a valid draft-07 schema and declares version 1", () => {
    expect(schema.$schema).toContain("draft-07");
    expect(schema.properties.manifestVersion.const).toBe(1);
  });
  it("valid fixtures pass (ready clip, not_rendered, all flyover)", async () => {
    for (const m of [await ready(), await notRendered(), await flyover()]) expect(manifestErrors(m)).toEqual([]);
  });
  const bad: [string, (m: any) => void][] = [
    ["missing prototype flag", (m) => { delete m.prototype; }],
    ["prototype false", (m) => { m.prototype = false; }],
    ["wrong version", (m) => { m.manifestVersion = 2; }],
    ["unknown top-level field", (m) => { m.extra = 1; }],
    ["a live-position style field is rejected as unknown", (m) => { m.current_position = { lat: 5.6, lon: -0.2 }; }],
    ["bad costing", (m) => { m.costing = "bicycle"; }],
    ["segment mode unknown", (m) => { m.segments[0].mode = "DRONE"; }],
    ["segment missing polyline", (m) => { delete m.segments[0].polyline6; }],
    ["keyframe bearing 360", (m) => { m.segments.at(-1).flyover.keyframes[0].bearingDeg = 360; }],
    ["keyframe pitch above 80", (m) => { m.segments.at(-1).flyover.keyframes[0].pitchDeg = 85; }],
    ["flyover with too few keyframes", (m) => { m.segments.at(-1).flyover.keyframes = m.segments.at(-1).flyover.keyframes.slice(0, 2); }],
    ["landmark side centre", (m) => { m.overlays.landmarks = [{ offsetM: 1, name: "x", category: "fuel", kind: null, side: "centre", distanceM: 1, lat: 5, lon: 0, osm: "node/1" }]; }],
    ["turn direction invalid", (m) => { m.overlays.turns = [{ offsetM: 1, maneuver: "left", direction: "up", kind: "turn", streetName: null, window: { startM: 0, endM: 2 } }]; }],
    ["attribution without the logo flag", (m) => { delete m.attribution.requiresLogoAndLink; }],
    ["capture years not integers", (m) => { m.captureYears = { min: 2020.5, max: 2021 }; }],
  ];
  for (const [name, mutate] of bad) {
    it(`malformed fails: ${name}`, async () => {
      const m = clone(await flyover());
      mutate(m);
      expect(manifestErrors(m).length).toBeGreaterThan(0);
    });
  }
  it("street rules: a ready segment needs its clip, a not_rendered one must have clip null and a flyover", async () => {
    const r = clone(await ready());
    const s = r.segments.find((x) => x.mode === "STREET_VIDEO");
    s!.clip = null;
    expect(manifestErrors(r).length).toBeGreaterThan(0);
    const n = clone(await notRendered());
    const t = n.segments.find((x) => x.mode === "STREET_VIDEO");
    t!.playback = "clip";
    expect(manifestErrors(n).length).toBeGreaterThan(0);
    const n2 = clone(await notRendered());
    n2.segments.find((x) => x.mode === "STREET_VIDEO")!.flyover = null as any;
    expect(manifestErrors(n2).length).toBeGreaterThan(0);
    const r2 = clone(await ready());
    r2.segments.find((x) => x.mode === "STREET_VIDEO")!.flyover = null as any;
    expect(manifestErrors(r2).length).toBeGreaterThan(0); // a ready clip must carry the flyover fallback too
    const r3 = clone(await ready());
    r3.segments.find((x) => x.mode === "STREET_VIDEO")!.flyover.keyframes = [];
    expect(manifestErrors(r3).length).toBeGreaterThan(0);
  });
  it("a flyover segment cannot carry a clip", async () => {
    const m = clone(await flyover());
    m.segments[0].clip = clone((await ready()).segments.find((x) => x.clip)!.clip);
    expect(manifestErrors(m).length).toBeGreaterThan(0);
  });
});
