// Phase 4: choose real STREET_VIDEO segments from the STORED frames (no Mapillary call, no token) and write one plan
// file per segment to data/clips/plans/ (gitignored) for the Python worker.
//   npm run clips:plan -- [--count 3] [--min-length-m 60] [--max-length-m 180] [--min-year Y]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { dbConfig, loadEnv } from "../src/config";
import { DEFAULT_MATCH_CONFIG } from "../src/classify/match";
import { loadFramesAlongAxisDetailed } from "../src/classify/load";
import { classifyFrames } from "../src/classify/pipeline";
import { buildClipPlans, pickPlans, type ClipPlan } from "../src/clips/plan";
import { extractApproach } from "../src/routing/approach";
import { COSTINGS } from "../src/validation/coverageReport";
import { framesFromYear, routeInputs, usableFrames } from "../src/validation/coverage";
import { ROUTE_PAIRS } from "../src/validation/routes";

loadEnv();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const opt = (k: string, d: number) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };

(async () => {
  const count = opt("--count", 3), minLengthM = opt("--min-length-m", 60), maxLengthM = opt("--max-length-m", 180), minYear = opt("--min-year", 0);
  const client = new pg.Client(dbConfig());
  await client.connect();
  const all: { plan: ClipPlan; edgeSpan: { startM: number; endM: number } }[] = [];
  try {
    for (const pair of ROUTE_PAIRS) for (const costing of COSTINGS) {
      let r;
      try { r = await extractApproach(costing, pair.origin, pair.destination, { warn: () => {} }); } catch { continue; }
      const whole = routeInputs(r);
      const { frames, sourcesExcluded } = await loadFramesAlongAxisDetailed(client, whole.axis, DEFAULT_MATCH_CONFIG.lateralToleranceM + 10);
      const used = minYear > 0 ? framesFromYear(frames, minYear) : frames;
      const res = classifyFrames(whole.axis, whole.edges, used, undefined, undefined, sourcesExcluded);
      for (const plan of buildClipPlans(`${pair.id}/${costing}`, res.classification, usableFrames(whole.axis, whole.edges, used))) {
        const e = whole.edges.find((x) => x.edgeId === plan.edge_id)!;
        all.push({ plan, edgeSpan: { startM: e.startM, endM: e.endM } });
      }
    }
  } finally { await client.end(); }
  const pool = all.map((x) => x.plan);
  const chosen = pickPlans(pool, { count, minLengthM, maxLengthM });
  // Show the crossfade path on real data too: if none chosen holds a bridge, swap the last pick for the newest bridged segment.
  if (chosen.length === count && !chosen.some((p) => p.bridges.length > 0)) {
    const [bridged] = pickPlans(pool.filter((p) => p.bridges.length > 0 && !chosen.some((c) => c.edge_id === p.edge_id)), { count: 1, minLengthM, maxLengthM });
    if (bridged) chosen[count - 1] = bridged;
  }
  console.log(`candidate STREET_VIDEO segments: ${all.length}; in length window: ${all.filter((x) => x.plan.segment.lengthM >= minLengthM && x.plan.segment.lengthM <= maxLengthM).length}; chosen: ${chosen.length}`);
  const dir = path.join(repoRoot, "data", "clips", "plans");
  mkdirSync(dir, { recursive: true });
  for (const plan of chosen) {
    const edgeSpan = all.find((x) => x.plan === plan)!.edgeSpan;
    writeFileSync(path.join(dir, `${plan.edge_id}_${plan.direction}.json`), JSON.stringify({ plan, edgeSpan }, null, 2) + "\n");
    console.log(`plan edge ${plan.edge_id} ${plan.direction}: route ${plan.routeId}, ${plan.segment.lengthM.toFixed(0)} m, ${plan.frames.length} frames, ${plan.bridges.length} bridges, capture years ${plan.captureYears.min}-${plan.captureYears.max}`);
  }
})().catch((e) => { console.error(String((e as Error).message ?? e)); process.exit(1); });
