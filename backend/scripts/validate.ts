// Usage: npm run validate [-- --out <dir>]
// Runs the extractor + classifier over the real Accra pairs against the live local Valhalla and PostGIS, then over labelled
// SYNTHETIC fixtures, and writes route-validation.md / route-validation.json. Never calls Mapillary, never prints credentials.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { dbConfig, loadEnv } from "../src/config";
import { DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import { DEFAULT_MATCH_CONFIG } from "../src/classify/match";
import { DEFAULT_APPROACH_LENGTH_M, DEFAULT_DECISION_WINDOW_M, extractApproach } from "../src/routing/approach";
import type { Costing } from "../src/routing/valhalla";
import { NOT_MERGED_NOTICE, NO_IMAGERY_STATEMENT, renderMarkdown, summariseClassification, SYNTHETIC_LABEL, type RealRow, type ValidationReport } from "../src/validation/report";
import { NAMED_POINTS, ROUTE_PAIRS } from "../src/validation/routes";
import { classifyApproachFromDb, namedProximity } from "../src/validation/run";
import { syntheticScenarios } from "../src/validation/synthetic";

loadEnv();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outIdx = process.argv.indexOf("--out");
const outDir = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]!) : path.join(repoRoot, "docs", "validation");

const client = new pg.Client(dbConfig());
await client.connect();
try {
  const frameRows = Number((await client.query("SELECT count(*)::int AS n FROM frames")).rows[0].n);
  const rows: RealRow[] = [];
  for (const p of ROUTE_PAIRS) {
    for (const costing of ["motor_scooter", "auto"] as Costing[]) {
      const base = { routeId: p.id, label: p.label, costing, origin: p.origin, destination: p.destination };
      try {
        const r = await extractApproach(costing, p.origin, p.destination, { warn: () => {} }); // fallback is recorded in the row, not lost
        const cls = await classifyApproachFromDb(r, client);
        rows.push({
          ...base, status: "ok", routeLengthKm: r.route.lengthM / 1000, approachLengthM: r.approach.lengthM, approachWholeRoute: r.approach.wholeRoute,
          approachEdgeCount: r.approach.edgeIds.length, routeEdgeCount: r.edges.length, unpaved_fallback: r.unpaved_fallback,
          decisionWindowCount: r.decisionWindows.length, named: namedProximity(r), classification: summariseClassification(cls),
        });
        console.log(`${p.id} ${costing}: ok approach=${r.approach.lengthM.toFixed(1)}m edges=${r.approach.edgeIds.length} fallback=${r.unpaved_fallback} modes=${summariseClassification(cls).modes.join(",")}`);
      } catch (e) {
        rows.push({ ...base, status: "error", error: (e as Error).message.slice(0, 160) });
        console.log(`${p.id} ${costing}: ERROR ${(e as Error).message.slice(0, 120)}`);
      }
    }
  }
  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    branchStatus: NOT_MERGED_NOTICE,
    liveImageryMeasured: false,
    mapillaryTokenConfigured: Boolean(process.env.MAPILLARY_TOKEN),
    statement: NO_IMAGERY_STATEMENT,
    frameRowsInDatabase: frameRows,
    config: { match: DEFAULT_MATCH_CONFIG, classify: DEFAULT_CLASSIFY_CONFIG, approachLengthM: DEFAULT_APPROACH_LENGTH_M, decisionWindowM: DEFAULT_DECISION_WINDOW_M },
    namedPoints: NAMED_POINTS,
    realRoutes: rows,
    synthetic: { synthetic: true, label: SYNTHETIC_LABEL, scenarios: syntheticScenarios() },
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "route-validation.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(outDir, "route-validation.md"), renderMarkdown(report));
  console.log(`wrote ${path.join(outDir, "route-validation.md")} and .json (frames in DB: ${frameRows}, routes: ${rows.length})`);
} finally {
  await client.end();
}
