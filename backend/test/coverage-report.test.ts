import { describe, expect, it } from "vitest";
import { DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import { DEFAULT_MATCH_CONFIG } from "../src/classify/match";
import { emptyBuckets, sumSummaries } from "../src/validation/coverage";
import { COSTINGS, killSwitchLine, renderCoverageMarkdown, strayRowsNote, type CoverageAudit, type CostingTotals, type FrameReconciliation, type IngestStats } from "../src/validation/coverageReport";

const sum = sumSummaries([{
  lengthM: 1000, streetVideoM: 250, birdsEyeM: 750, streetFraction: 0.25, segments: 3, streetSegments: 1, bridges: 2, segmentsAtBridgeCap: 1,
  refusedSequenceGaps: 4, levelUncertainSegments: 1, candidateFrames: 40, usableFrames: 30, dropped: { low_quality: 10 }, ageBuckets: { ...emptyBuckets(), "2024+": 5 },
}]);
const totals = (): CostingTotals => ({
  routesOk: 1, routesFailed: 0, whole: sum, approach: sum,
  interchanges: { kwameNkrumahInterchange: { routesNear: 1, levelUncertainSegments: 1, routesWithAny: 1 }, tettehQuarshieInterchange: { routesNear: 0, levelUncertainSegments: 0, routesWithAny: 0 }, danquahCircle: { routesNear: 0, levelUncertainSegments: 0, routesWithAny: 0 } },
});
const audit: CoverageAudit = {
  generatedAt: "2026-01-01T00:00:00.000Z", killSwitchAtReport: null, reconciliation: null, verdict: "none: this report states measurements only",
  config: { match: DEFAULT_MATCH_CONFIG, classify: DEFAULT_CLASSIFY_CONFIG, approachLengthM: 500 },
  ingest: null, db: { framesTotal: 10, qualityScoreNull: 2, qualityScoreBelow05: 1, bySource: { mapillary: 10 } },
  nullScoreHandling: "dropped", rows: [], totals: { motor_scooter: totals(), auto: totals() }, limitations: ["metadata only"],
};

describe("renderCoverageMarkdown", () => {
  const md = renderCoverageMarkdown(audit);
  it("states the headline numbers and the required sections", () => {
    expect(md).toContain("25.0%"); // street share
    expect(md).toContain("## Limitations");
    expect(md).toContain("## level_uncertain at the three interchanges");
    expect(md).toContain("## Capture age of frames used in STREET_VIDEO segments");
    expect(md).toContain("metadata only");
    for (const c of COSTINGS) expect(md).toContain(c);
  });
  it("renders without ingest stats and makes no recommendation", () => {
    expect(md).toContain("no ingest-stats file");
    expect(md.toLowerCase()).not.toMatch(/\b(go|no-go) (decision|verdict): (go|no-go)\b|\brecommend(ed|s)? (go|proceed)\b/);
  });
});

const rec: FrameReconciliation = {
  framesTotal: 50476, storedByAudit: 47280, surplus: 3196, inCorridor: 47280, outsideCorridor: 3196, outsideInStrayBbox: 3181,
  stray: { storedImages: 3383, bbox: [-0.21, 5.59, -0.19, 5.61], maxCalls: 4, fixedInCommit: "abc1234" },
};

describe("strayRowsNote", () => {
  it("reconciles the stray count against the table surplus and says the inside share is inferred", () => {
    const n = strayRowsNote(rec);
    expect(n).toContain("3383 - 3196 = 187");
    expect(n).toContain("inferred by subtraction");
    expect(n).toContain("surplus is 3196");
  });
  it("says plainly when the numbers do not reconcile", () => {
    const n = strayRowsNote({ ...rec, outsideCorridor: 3100 });
    expect(n).toContain("do not reconcile");
    expect(n).not.toContain("inferred by subtraction");
  });
  it("is rendered exactly once, and the old contradicting wording is gone", () => {
    const stats = { startedAt: "a", finishedAt: "b", corridor: { halfWidthM: 30, cellDeg: 0.002, stepM: 10, cells: 1, routesUsed: 1, routesFailed: 0 }, minIntervalMs: 500, cellsRequested: 1, fetchedUniqueImages: 1, storedImages: 47280, skipped: { no_geometry: 0, invalid_captured_at: 0 }, fields: { images: 1, qualityScorePresent: 1, qualityScoreNull: 0, qualityScoreBelow05: 0, computedGeometryMissing: 0, computedCompassMissing: 0, sequenceMissing: 0, capturedAtMissing: 0, panoramas: 0, captureYear: emptyBuckets() }, calls: { calls: 1, byStatus: { "200": 1 }, networkErrors: 0, rateLimitEvents: [], retriedResponses: 0, backoffWaitMs: 0 }, notes: [] } as unknown as IngestStats;
    const md = renderCoverageMarkdown({ ...audit, ingest: stats, reconciliation: rec });
    expect(md.match(/Stray test rows:/g)).toHaveLength(1);
    expect(md).not.toMatch(/re-fetched or discarded|Correction to the setup note/);
  });
});

describe("kill switch rendering", () => {
  it("renders the recorded value, not a fixed phrase", () => {
    expect(killSwitchLine({ value: null })).toContain("unset");
    expect(killSwitchLine({ value: "mapillary" })).toContain('"mapillary"');
    expect(killSwitchLine({ value: "mapillary\u200b" })).toContain("\\u{200b}");
  });
  it("says so when the ingest did not record it", () => {
    expect(killSwitchLine(undefined)).toContain("not recorded");
  });
  it("shows the report-time value", () => {
    expect(renderCoverageMarkdown({ ...audit, killSwitchAtReport: "mapillary" })).toContain('at report time: "mapillary"');
    expect(renderCoverageMarkdown(audit)).toContain("at report time: unset");
  });
});

describe("per-route approach counts", () => {
  it("renders approach bridges, segments at cap and refused gaps per route", () => {
    const md = renderCoverageMarkdown({ ...audit, rows: [{ routeId: "R1", label: "x", costing: "auto", status: "ok", routeLengthM: 1000, whole: sum, approach: { ...sum, bridges: 7, segmentsAtBridgeCap: 6, refusedSequenceGaps: 5 } }] });
    expect(md).toContain("Appr. bridges | Appr. at cap | Appr. refused gaps");
    expect(md).toMatch(/\| 4 \| 7 \| 6 \| 5 \|/); // whole refused 4, then approach 7, 6, 5
  });
});

import { DEFAULT_GATE_CONFIG, gateResult, gateRow } from "../src/validation/coverage";
describe("renderCoverageMarkdown gate section", () => {
  it("renders per-route and total pass/fail when a gate is present, and nothing when absent", () => {
    const g = gateResult([gateRow("r1", "auto", 500, 100, DEFAULT_GATE_CONFIG), gateRow("r2", "auto", 500, 400, DEFAULT_GATE_CONFIG)], DEFAULT_GATE_CONFIG, ["auto"]);
    const md = renderCoverageMarkdown({ ...audit, gate: g });
    expect(md).toContain("Coverage gate (D9)");
    expect(md).toContain("| r1 | auto | 500 | 100 | 20.0% | FAIL |");
    expect(md).toContain("| r2 | auto | 500 | 400 | 80.0% | PASS |");
    expect(md).toContain("| total all | 2 |");
    expect(renderCoverageMarkdown(audit)).not.toContain("Coverage gate (D9)");
  });
});
