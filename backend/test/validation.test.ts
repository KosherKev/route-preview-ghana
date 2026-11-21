import { describe, expect, it } from "vitest";
import { NOT_MERGED_NOTICE, coverageStatement, renderMarkdown, SYNTHETIC_LABEL, type ValidationReport } from "../src/validation/report";
import { NAMED_POINTS, ROUTE_PAIRS } from "../src/validation/routes";
import { syntheticScenarios } from "../src/validation/synthetic";
import { DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import { DEFAULT_MATCH_CONFIG } from "../src/classify/match";
import { approachInputs } from "../src/validation/run";
import { encodePolyline6 } from "../src/routing/polyline";
import type { ApproachResult } from "../src/routing/approach";

const scen = (id: string) => syntheticScenarios().find((s) => s.id === id)!;
const modes = (id: string) => scen(id).result.classification.segments.map((s) => s.mode);

describe("route list", () => {
  it("has at least 20 pairs in Greater Accra including each named place as an endpoint", () => {
    expect(ROUTE_PAIRS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ROUTE_PAIRS.map((p) => p.id)).size).toBe(ROUTE_PAIRS.length);
    for (const p of ROUTE_PAIRS) for (const q of [p.origin, p.destination]) {
      expect(q.lat).toBeGreaterThan(5.4); expect(q.lat).toBeLessThan(5.8); // lat first, Accra ~5.6 N
      expect(q.lon).toBeGreaterThan(-0.4); expect(q.lon).toBeLessThan(0.1); // lon ~ -0.2 W
    }
    for (const n of Object.values(NAMED_POINTS)) {
      expect(ROUTE_PAIRS.some((p) => [p.origin, p.destination].some((q) => q.lat === n.at.lat && q.lon === n.at.lon)), n.name).toBe(true);
    }
  });
});

describe("synthetic scenarios produce the documented outcomes", () => {
  it("street run, short run, 14 m vs 16 m", () => {
    expect(modes("street-run")).toEqual(["BIRDS_EYE_3D", "STREET_VIDEO", "BIRDS_EYE_3D"]);
    expect(modes("short-run")).toEqual(["BIRDS_EYE_3D"]);
    expect(modes("gap-14m")).toContain("STREET_VIDEO");
    expect(modes("gap-16m")).toEqual(["BIRDS_EYE_3D"]);
  });
  it("opposite-lane frames are dropped", () => {
    expect(scen("opposite-lane").result.dropped.left_of_centerline).toBe(167);
    expect(modes("opposite-lane")).toContain("STREET_VIDEO");
    expect(modes("opposite-lane-only")).toEqual(["BIRDS_EYE_3D"]);
  });
  it("interchange discontinuities are level_uncertain birds-eye; crossfade is one street segment", () => {
    for (const id of ["interchange-discontinuity", "interchange-sequence-jump"]) {
      expect(scen(id).result.classification.segments.some((s) => s.level_uncertain && s.mode === "BIRDS_EYE_3D"), id).toBe(true);
    }
    const x = scen("crossfade").result.classification.segments.filter((s) => s.mode === "STREET_VIDEO");
    expect(x.length).toBe(1);
    expect(x[0]!.crossfades.length).toBe(1);
  });
  it("two-tier gap demonstrations: 14.999 no bridge, 15 and 30 bridge, 30.001 handoff, chain of three has two bridges", () => {
    const st = (id: string) => scen(id).result.classification.segments.filter((s) => s.mode === "STREET_VIDEO");
    expect(st("gap-14999mm").map((s) => s.bridges.length)).toEqual([0]);
    expect(st("gap-15000mm").map((s) => s.bridges.length)).toEqual([1]);
    expect(st("gap-30000mm").map((s) => s.bridges.length)).toEqual([1]);
    expect(st("gap-30001mm").map((s) => s.bridges.length)).toEqual([0, 0]);
    expect(st("bridge-chain").map((s) => s.bridges.length)).toEqual([2]);
  });
  it("every scenario is flagged synthetic", () => {
    expect(syntheticScenarios().every((s) => s.synthetic === true)).toBe(true);
  });
});

describe("report rendering", () => {
  const report: ValidationReport = {
    generatedAt: "2026-01-01T00:00:00Z", branchStatus: NOT_MERGED_NOTICE, mapillaryTokenConfigured: false, statement: coverageStatement(0),
    frameRowsInDatabase: 0,
    config: { match: DEFAULT_MATCH_CONFIG, classify: DEFAULT_CLASSIFY_CONFIG, approachLengthM: 500, decisionWindowM: 80 },
    namedPoints: NAMED_POINTS,
    realRoutes: [{ routeId: "r00", label: "x", costing: "auto", origin: ROUTE_PAIRS[0]!.origin, destination: ROUTE_PAIRS[0]!.destination, status: "error", error: "boom" }],
    synthetic: { synthetic: true, label: SYNTHETIC_LABEL, scenarios: syntheticScenarios() },
  };
  const md = renderMarkdown(report);
  it("explains the empty-table classification and points to the coverage audit", () => {
    expect(md).toContain("table was empty");
    expect(md).toContain("docs/validation/coverage-audit.md");
    expect(md).not.toMatch(/NOT measured|not measured/);
  });
  it("with frames present, says which data it used and still points to the audit", () => {
    const s = coverageStatement(50476);
    expect(s).toContain("50476 frames");
    expect(s).toContain("docs/validation/coverage-audit.md");
    expect(s).not.toMatch(/NOT measured|not measured|empty/);
  });
  it("labels the synthetic section and every scenario as SYNTHETIC", () => {
    expect(md).toContain("## SYNTHETIC classifier demonstrations");
    for (const s of report.synthetic.scenarios) expect(md).toContain(`### SYNTHETIC: ${s.title}`);
    expect(md.indexOf("## Real routes")).toBeLessThan(md.indexOf("## SYNTHETIC"));
  });
  it("says why the branch is not merged", () => {
    expect(md).toContain("## Branch status");
    expect(md).toContain("intentionally NOT merged to main");
    expect(md).toContain("auto-merge bar permanently excludes work touching migrations");
  });
  it("reports route errors as errors, not coverage", () => {
    expect(md).toContain("no route");
    expect(md).toContain("error: boom");
  });
});

describe("approachInputs", () => {
  it("rebases edge spans so the approach starts at 0 and tiles its axis", () => {
    const poly = encodePolyline6([[5.6, -0.2], [5.601, -0.2], [5.602, -0.2]]);
    const r = { approach: { polyline6: poly, startM: 1000, edges: [
      { id: 1, startM: 1000, endM: 1060, bridge: false, tunnel: false, names: [] }, { id: 2, startM: 1060, endM: 1222.1, bridge: true, tunnel: false, names: [] },
    ] } } as unknown as ApproachResult;
    const { axis, edges } = approachInputs(r);
    expect(edges[0]!.startM).toBe(0);
    expect(edges[1]!.endM).toBeCloseTo(axis.lengthM, 6);
    expect(edges[1]!.bridge).toBe(true);
  });
});
