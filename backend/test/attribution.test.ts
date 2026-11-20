import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAttribution, toSourceSummary } from "../src/imagery/attribution";
import {
  DEFAULT_MAPILLARY_LICENSE, FRAME_FIELDS, mapillaryImageUrl, toFrameRow, type MapillaryImage,
} from "../src/ingest/mapillary";

const base = (extra: Partial<MapillaryImage> = {}): MapillaryImage => ({
  id: "123", computed_geometry: { type: "Point", coordinates: [-0.2, 5.6] }, captured_at: 1700000000000, ...extra,
});

describe("Mapillary creator and source_url mapping (fixtures only)", () => {
  it("requests the creator field", () => {
    expect(FRAME_FIELDS).toContain("creator");
  });
  it("maps creator.username into creator_username", () => {
    const r = toFrameRow(base({ creator: { id: "9", username: "mapper" } }))!;
    expect(r.creator_username).toBe("mapper");
    expect(r.creator).toBe("mapper");
  });
  it("is null when the creator or username is missing or null", () => {
    expect(toFrameRow(base())!.creator_username).toBeNull();
    expect(toFrameRow(base({ creator: null }))!.creator_username).toBeNull();
    expect(toFrameRow(base({ creator: { id: "9" } }))!.creator_username).toBeNull();
    expect(toFrameRow(base({ creator: { id: "9", username: null } }))!.creator_username).toBeNull();
    expect(toFrameRow(base({ creator: { id: "9", username: "" } }))!.creator_username).toBeNull();
  });
  it("builds the Mapillary image page URL from the image id", () => {
    expect(toFrameRow(base())!.source_url).toBe("https://www.mapillary.com/app/?pKey=123");
    expect(mapillaryImageUrl("a b")).toBe("https://www.mapillary.com/app/?pKey=a%20b");
  });
  it("uses the default licence only when the source states none", () => {
    expect(toFrameRow(base())!.license).toBe(DEFAULT_MAPILLARY_LICENSE);
    expect(toFrameRow(base({ license: "CC0-1.0" }))!.license).toBe("CC0-1.0");
  });
});

describe("buildAttribution", () => {
  const f = (source: string, creator: string | null, extra: Record<string, string | null> = {}) => ({
    source, creator_username: creator, license: "CC-BY-SA-4.0", source_url: `https://x/${creator}`, ...extra,
  });
  it("collapses duplicate creators (case-sensitive) in stable first-seen order", () => {
    const a = buildAttribution([f("mapillary", "bob"), f("mapillary", "amy"), f("mapillary", "bob"), f("mapillary", "Bob")]);
    expect(a.creators).toEqual(["bob", "amy", "Bob"]);
  });
  it("handles missing creators and licences", () => {
    const a = buildAttribution([
      { source: "mapillary", creator_username: null, license: null, source_url: null },
      { source: "mapillary" },
    ]);
    expect(a.creators).toEqual([]);
    expect(a.licenses).toEqual([]);
    expect(a.sourceUrls).toEqual([]);
    expect(a.bySource).toHaveLength(1);
    expect(buildAttribution([])).toMatchObject({ bySource: [], sources: [], requiresLogoAndLink: false });
  });
  it("passes the licence and source URLs through", () => {
    const a = buildAttribution([f("mapillary", "amy", { license: "CC0-1.0" }), f("mapillary", "bob")]);
    expect(a.licenses).toEqual(["CC0-1.0", "CC-BY-SA-4.0"]);
    expect(a.sourceUrls).toEqual(["https://x/amy", "https://x/bob"]);
  });
  it("sets requiresLogoAndLink for Mapillary only", () => {
    expect(buildAttribution([f("mapillary", "amy")]).requiresLogoAndLink).toBe(true);
    expect(buildAttribution([f("rider", "amy")]).requiresLogoAndLink).toBe(false);
    const mixed = buildAttribution([f("rider", "zed"), f("mapillary", "amy")]);
    expect(mixed.requiresLogoAndLink).toBe(true);
    expect(mixed.bySource.map((e) => [e.source, e.requiresLogoAndLink])).toEqual([["rider", false], ["mapillary", true]]);
  });
  it("keeps sources separate when mixed", () => {
    const a = buildAttribution([f("mapillary", "amy"), f("rider", "zed"), f("mapillary", "bob")]);
    expect(a.sources).toEqual(["mapillary", "rider"]);
    expect(a.bySource[0]!.creators).toEqual(["amy", "bob"]);
    expect(a.bySource[1]!.creators).toEqual(["zed"]);
  });
});

describe("toSourceSummary", () => {
  it("produces one {source, creators, license, sourceUrls} entry per source", () => {
    const s = toSourceSummary([
      { source: "mapillary", creator_username: "amy", license: "CC-BY-SA-4.0", source_url: "u1" },
      { source: "mapillary", creator_username: "amy", license: "CC-BY-SA-4.0", source_url: "u2" },
      { source: "rider", creator_username: null, license: null, source_url: null },
    ]);
    expect(s).toEqual([
      { source: "mapillary", creators: ["amy"], license: "CC-BY-SA-4.0", sourceUrls: ["u1", "u2"] },
      { source: "rider", creators: [], license: null, sourceUrls: [] },
    ]);
  });
  it("joins distinct licences within a source and returns [] for no frames", () => {
    expect(toSourceSummary([
      { source: "mapillary", license: "A" }, { source: "mapillary", license: "B" },
    ])[0]!.license).toBe("A / B");
    expect(toSourceSummary([])).toEqual([]);
  });
});

describe("licence literal", () => {
  it("appears in backend/src and backend/scripts only as the single DEFAULT_MAPILLARY_LICENSE definition", () => {
    const backend = path.resolve(__dirname, "..");
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-n", "CC-BY-SA-4.0", "--", "src", "scripts"], { cwd: backend, encoding: "utf8" });
    } catch { /* exit 1 = no matches */ }
    const lines = out.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/src\/ingest\/mapillary\.ts:\d+:export const DEFAULT_MAPILLARY_LICENSE = "CC-BY-SA-4\.0";/);
  });
});
