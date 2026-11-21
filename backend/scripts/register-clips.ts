// Phase 4: write the `clips` row for each clip the Python worker produced (data/clips/results/*.json), using the plan
// that produced it and the follow-up B attribution builder. Idempotent per (edge_id, direction). Needs no token.
//   npm run clips:register
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { dbConfig, loadEnv } from "../src/config";
import type { ClipPlan } from "../src/clips/plan";
import { buildClipRow, insertClipIfAbsent, type ClipResult } from "../src/clips/register";

loadEnv();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
(async () => {
  const resDir = path.join(repoRoot, "data", "clips", "results"), planDir = path.join(repoRoot, "data", "clips", "plans");
  const client = new pg.Client(dbConfig());
  await client.connect();
  try {
    for (const f of readdirSync(resDir).filter((n) => n.endsWith(".json")).sort()) {
      const result = JSON.parse(readFileSync(path.join(resDir, f), "utf8")) as ClipResult;
      const { plan, edgeSpan } = JSON.parse(readFileSync(path.join(planDir, f), "utf8")) as { plan: ClipPlan; edgeSpan: { startM: number; endM: number } };
      const ids = plan.frames.map((x) => x.image_id);
      const { rows } = await client.query("SELECT image_id, source, creator_username, license, source_url FROM frames WHERE image_id = ANY($1) ORDER BY image_id", [ids]);
      const byId = new Map(rows.map((r) => [r.image_id as string, r]));
      const attribution = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
      const inserted = await insertClipIfAbsent(client, buildClipRow(plan, result, attribution, edgeSpan));
      console.log(`${f}: ${inserted ? "clips row inserted" : "clips row already present"}; ${attribution.length}/${ids.length} frames attributed`);
    }
  } finally { await client.end(); }
})().catch((e) => { console.error(String((e as Error).message ?? e)); process.exit(1); });
