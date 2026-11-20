import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { every, straightScene } from "../src/classify/synthetic";
import { classifyFrames } from "../src/classify/pipeline";
import {
  assertSourceEnabled, disabledSources, isClipServable, isSourceEnabled, parseDisabledSources, SourceDisabledError,
} from "../src/imagery/sources";
import { MapillarySource } from "../src/ingest/mapillary";

const KEY = "IMAGERY_SOURCES_DISABLED";
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY]; else process.env[KEY] = original;
});

describe("parsing IMAGERY_SOURCES_DISABLED", () => {
  it("unset or empty disables nothing", () => {
    expect(disabledSources({})).toEqual([]);
    expect(disabledSources({ [KEY]: "" })).toEqual([]);
    expect(disabledSources({ [KEY]: " , ,, " })).toEqual([]);
  });
  it("trims, lower-cases, ignores empties and de-duplicates", () => {
    expect(parseDisabledSources("  Mapillary , ,RIDER-captured,,mapillary ")).toEqual(["mapillary", "rider-captured"]);
  });
  it("accepts unknown source names without error", () => {
    expect(disabledSources({ [KEY]: "nonesuch" })).toEqual(["nonesuch"]);
    expect(isSourceEnabled("mapillary", { [KEY]: "nonesuch" })).toBe(true);
  });
  it("isSourceEnabled is case and whitespace insensitive", () => {
    expect(isSourceEnabled(" Mapillary ", { [KEY]: "mapillary" })).toBe(false);
    expect(isSourceEnabled("mapillary", {})).toBe(true);
  });
  it("assertSourceEnabled throws a clear error naming the source and the variable", () => {
    expect(() => assertSourceEnabled("mapillary", { [KEY]: "mapillary" })).toThrow(SourceDisabledError);
    expect(() => assertSourceEnabled("mapillary", { [KEY]: "mapillary" })).toThrow(/"mapillary" is disabled by IMAGERY_SOURCES_DISABLED/);
    expect(() => assertSourceEnabled("mapillary", {})).not.toThrow();
  });
});

describe("isClipServable", () => {
  const env = { [KEY]: "mapillary" };
  it("is false for a clip whose source is disabled", () => {
    expect(isClipServable({ source: "mapillary" }, env)).toBe(false);
    expect(isClipServable({ source: "Mapillary" }, env)).toBe(false);
  });
  it("is false when ANY source in source_summary is disabled", () => {
    expect(isClipServable({ source_summary: [{ source: "rider" }, { source: "mapillary" }] }, env)).toBe(false);
  });
  it("is true for another source, an empty summary, or nothing disabled", () => {
    expect(isClipServable({ source: "rider" }, env)).toBe(true);
    expect(isClipServable({ source: "rider", source_summary: [{ source: "rider" }] }, env)).toBe(true);
    expect(isClipServable({ source_summary: [] }, env)).toBe(true);
    expect(isClipServable({ source: "mapillary" }, {})).toBe(true);
  });
  it("reads process.env by default", () => {
    process.env[KEY] = "mapillary";
    expect(isClipServable({ source: "mapillary" })).toBe(false);
  });
});

describe("classifier with the kill switch (pure pipeline, synthetic frames)", () => {
  const sc = straightScene({ bearingDeg: 90, lengthM: 300 });
  const frames = sc.frames(every(5, 0, 300)).map((f) => ({ ...f, source: "mapillary" }));
  const modes = (r: ReturnType<typeof classifyFrames>) => r.classification.segments.map((s) => s.mode);

  it("unset: STREET_VIDEO and sourcesExcluded is empty", () => {
    delete process.env[KEY];
    const r = classifyFrames(sc.axis, sc.edges, frames);
    expect(modes(r)).toEqual(["STREET_VIDEO"]);
    expect(r.sourcesExcluded).toEqual([]);
  });
  it("disabled: BIRDS_EYE_3D and sourcesExcluded is [mapillary]", () => {
    process.env[KEY] = "mapillary";
    const r = classifyFrames(sc.axis, sc.edges, frames);
    expect(modes(r)).toEqual(["BIRDS_EYE_3D"]);
    expect(r.sourcesExcluded).toEqual(["mapillary"]);
    expect(r.candidateFrames).toBe(0);
  });
  it("frames of another source survive; frames without a source are never excluded", () => {
    process.env[KEY] = "mapillary";
    const other = frames.map((f) => ({ ...f, source: "rider" }));
    expect(modes(classifyFrames(sc.axis, sc.edges, other))).toEqual(["STREET_VIDEO"]);
    const bare = sc.frames(every(5, 0, 300));
    expect(classifyFrames(sc.axis, sc.edges, bare).sourcesExcluded).toEqual([]);
  });
  it("is read at CALL time: flipping the variable between two calls in one process changes the result", () => {
    delete process.env[KEY];
    expect(modes(classifyFrames(sc.axis, sc.edges, frames))).toEqual(["STREET_VIDEO"]);
    process.env[KEY] = "mapillary";
    expect(modes(classifyFrames(sc.axis, sc.edges, frames))).toEqual(["BIRDS_EYE_3D"]);
    delete process.env[KEY];
    expect(modes(classifyFrames(sc.axis, sc.edges, frames))).toEqual(["STREET_VIDEO"]);
  });
});

describe("MapillarySource and the ingestion CLI refuse when mapillary is disabled", () => {
  it("never calls fetch, and honours a flip at call time", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const src = new MapillarySource({ token: "test-token", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, minIntervalMs: 0 });
    process.env[KEY] = "mapillary";
    await expect(src.imagesInBBox([-0.21, 5.59, -0.19, 5.61])).rejects.toThrow(SourceDisabledError);
    await expect(src.imagesNear(-0.2, 5.6, 50)).rejects.toThrow(SourceDisabledError);
    await expect(src.framesAlong([[5.6, -0.2], [5.61, -0.2]], 20)).rejects.toThrow(SourceDisabledError);
    expect(fetchImpl).not.toHaveBeenCalled();
    delete process.env[KEY];
    await expect(src.imagesNear(-0.2, 5.6, 50)).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("the CLI exits 4 with a clear message before any token, network or DB access", () => {
    const backend = path.resolve(__dirname, "..");
    const env: NodeJS.ProcessEnv = { ...process.env, [KEY]: "mapillary" };
    delete env.MAPILLARY_TOKEN;
    const r = spawnSync(path.join(backend, "node_modules/.bin/tsx"), ["src/ingest/cli.ts", "--bbox", "-0.21,5.59,-0.19,5.61"], {
      cwd: backend, env, encoding: "utf8",
    });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/"mapillary" is disabled by IMAGERY_SOURCES_DISABLED/);
    expect(r.stderr).not.toMatch(/MAPILLARY_TOKEN is not set/); // refused before the token check
    expect(r.stdout).toBe("");
  });
});
