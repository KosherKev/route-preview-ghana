import { describe, expect, it } from "vitest";
import { DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import { DEFAULT_MATCH_CONFIG } from "../src/classify/match";
import { emptyBuckets, sumSummaries } from "../src/validation/coverage";
import { COSTINGS, renderCoverageMarkdown, type CoverageAudit, type CostingTotals } from "../src/validation/coverageReport";

const sum = sumSummaries([{
  lengthM: 1000, streetVideoM: 250, birdsEyeM: 750, streetFraction: 0.25, segments: 3, streetSegments: 1, bridges: 2, segmentsAtBridgeCap: 1,
  refusedSequenceGaps: 4, levelUncertainSegments: 1, candidateFrames: 40, usableFrames: 30, dropped: { low_quality: 10 }, ageBuckets: { ...emptyBuckets(), "2024+": 5 },
}]);
const totals = (): CostingTotals => ({
  routesOk: 1, routesFailed: 0, whole: sum, approach: sum,
  interchanges: { kwameNkrumahInterchange: { routesNear: 1, levelUncertainSegments: 1, routesWithAny: 1 }, tettehQuarshieInterchange: { routesNear: 0, levelUncertainSegments: 0, routesWithAny: 0 }, danquahCircle: { routesNear: 0, levelUncertainSegments: 0, routesWithAny: 0 } },
});
const audit: CoverageAudit = {
  generatedAt: "2026-01-01T00:00:00.000Z", verdict: "none: this report states measurements only",
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
