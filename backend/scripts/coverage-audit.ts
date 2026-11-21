// Metadata-only real-coverage audit (Phase 3 follow-up D).
//   npm run audit:coverage -- ingest [--note "text"] [--half-width-m 30] [--interval-ms 500]
//   npm run audit:coverage -- report [--out <dir>] [--note "text"]
//   npm run audit:coverage -- run [--skip-ingestion] [ingest and report options]   (ingest, then report; --skip-ingestion makes it exactly "report": no token read, no Mapillary call)
// ingest: routes the 25 validated pairs (Valhalla), ingests Mapillary IMAGE METADATA ONLY for cells covering a corridor
//   around those routes into the local PostGIS frames table, and writes aggregate counts to data/coverage-audit/ingest-stats.json.
// report: classifies every route (whole route and last-500 m approach) from the stored frames and writes
//   docs/validation/coverage-audit.md and coverage-audit.json.
// Never downloads images, never prints or logs the token or any request URL. Honours IMAGERY_SOURCES_DISABLED.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { dbConfig, loadEnv } from "../src/config";
import { DEFAULT_CLASSIFY_CONFIG } from "../src/classify/classify";
import { loadFramesAlongAxisDetailed } from "../src/classify/load";
import { DEFAULT_MATCH_CONFIG } from "../src/classify/match";
import { classifyFrames } from "../src/classify/pipeline";
import { assertSourceEnabled, IMAGERY_SOURCES_DISABLED_VAR, SourceDisabledError, warnOnceIfSuspiciousSources } from "../src/imagery/sources";
import { CallMeter } from "../src/ingest/callMeter";
import { convertImage, MapillarySource, requireToken, type FrameRow } from "../src/ingest/mapillary";
import { Corridor, cellBBox, DEFAULT_CORRIDOR } from "../src/ingest/routeCorridor";
import { upsertFrames } from "../src/ingest/store";
import { DEFAULT_APPROACH_LENGTH_M, extractApproach, type ApproachResult } from "../src/routing/approach";
import { decodePolyline6, type Costing } from "../src/routing/valhalla";
import type { LatLon } from "../src/geo/local";
import { levelUncertainNear, routeInputs, sumSummaries, summariseSegments, usableFrames } from "../src/validation/coverage";
import { COSTINGS, renderCoverageMarkdown, type AuditRow, type CoverageAudit, type CostingTotals, type DbStats, type FrameReconciliation, type IngestStats } from "../src/validation/coverageReport";
import { addImage, emptyFieldStats } from "../src/validation/ingestStats";
import { NAMED_POINTS, NEAR_NAMED_M, ROUTE_PAIRS, type NamedKey } from "../src/validation/routes";
import { approachInputs, namedProximity } from "../src/validation/run";

loadEnv();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATS_FILE = path.join(repoRoot, "data", "coverage-audit", "ingest-stats.json");
// The stray test run that wrote rows before the audit (see strayRowsNote): its own recorded stored-image count and query bbox.
const STRAY_RUN = { storedImages: 3383, bbox: [-0.21, 5.59, -0.19, 5.61] as [number, number, number, number], maxCalls: 4, fixedInCommit: "8e900f3" };
const killSwitchRaw = (): string | null => process.env[IMAGERY_SOURCES_DISABLED_VAR] ?? null;
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };

async function routeAll(): Promise<{ results: { pair: (typeof ROUTE_PAIRS)[number]; costing: Costing; r?: ApproachResult; error?: string }[] }> {
  const results = [];
  for (const pair of ROUTE_PAIRS) {
    for (const costing of COSTINGS) {
      try {
        results.push({ pair, costing, r: await extractApproach(costing, pair.origin, pair.destination, { warn: () => {} }) });
      } catch (e) {
        results.push({ pair, costing, error: (e as Error).message.slice(0, 160) });
      }
    }
  }
  return { results };
}

async function ingest() {
  warnOnceIfSuspiciousSources();
  assertSourceEnabled("mapillary"); // kill switch: refuse before any token, network or DB work
  const token = requireToken();
  const halfWidthM = Number(opt("--half-width-m") ?? DEFAULT_CORRIDOR.halfWidthM);
  const minIntervalMs = Number(opt("--interval-ms") ?? 500);
  const notes = argv.flatMap((a, i) => (a === "--note" && argv[i + 1] ? [argv[i + 1]!] : []));
  const startedAt = new Date().toISOString();

  const { results } = await routeAll();
  const lines: LatLon[][] = results.filter((x) => x.r).map((x) => decodePolyline6(x.r!.route.polyline6).map(([lat, lon]) => ({ lat, lon })));
  const failed = results.length - lines.length;
  const corridor = new Corridor(lines, { ...DEFAULT_CORRIDOR, halfWidthM });
  const cells = corridor.cellList();
  console.log(`routes used ${lines.length}, failed ${failed}; corridor half-width ${halfWidthM} m; cells to request ${cells.length}`);

  const meter = new CallMeter(minIntervalMs);
  const source = new MapillarySource({
    token, minIntervalMs, fetchImpl: meter.wrapFetch(fetch), sleep: meter.wrapSleep((ms) => new Promise((r) => setTimeout(r, ms))),
  });
  const client = new pg.Client(dbConfig());
  await client.connect();
  const seen = new Set<string>(); // every unique image id returned
  const stored = new Set<string>();
  const fields = emptyFieldStats();
  const skipped = { no_geometry: 0, invalid_captured_at: 0 };
  let done = 0;
  try {
    for (const [ix, iy] of cells) {
      const imgs = await source.imagesInBBox(cellBBox(ix, iy, DEFAULT_CORRIDOR.cellDeg));
      const rows: FrameRow[] = [];
      for (const img of imgs) {
        const id = String(img.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const g = img.computed_geometry ?? img.geometry;
        if (!g || !corridor.contains({ lon: g.coordinates[0], lat: g.coordinates[1] })) continue;
        const c = convertImage(img);
        if ("skip" in c) { skipped[c.skip]++; continue; }
        stored.add(id);
        addImage(fields, img);
        rows.push(c.row);
      }
      await upsertFrames(client, rows);
      if (++done % 50 === 0 || done === cells.length) console.log(`cells ${done}/${cells.length}, api calls ${meter.stats.calls}, stored images ${stored.size}, 429s ${meter.stats.rateLimitEvents.length}`);
    }
  } finally {
    await client.end();
  }
  const out: IngestStats = {
    startedAt, finishedAt: new Date().toISOString(),
    corridor: { halfWidthM, cellDeg: DEFAULT_CORRIDOR.cellDeg, stepM: DEFAULT_CORRIDOR.stepM, cells: cells.length, routesUsed: lines.length, routesFailed: failed },
    minIntervalMs, cellsRequested: cells.length, fetchedUniqueImages: seen.size, storedImages: stored.size, skipped, fields, calls: meter.stats, notes,
    killSwitch: { value: killSwitchRaw() },
  };
  mkdirSync(path.dirname(STATS_FILE), { recursive: true });
  writeFileSync(STATS_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`done: api calls ${meter.stats.calls}, stored images ${stored.size}, rate-limit events ${meter.stats.rateLimitEvents.length}; wrote aggregate stats`);
}

/** Applies the ingest corridor to every stored frame (re-routed polylines, same half-width): inside, outside, and outside within the stray bbox. */
async function reconcileFrames(
  client: pg.Client, results: Awaited<ReturnType<typeof routeAll>>["results"], ingestStats: IngestStats | null, framesTotal: number,
): Promise<FrameReconciliation | null> {
  const lines: LatLon[][] = results.filter((x) => x.r).map((x) => decodePolyline6(x.r!.route.polyline6).map(([lat, lon]) => ({ lat, lon })));
  if (!ingestStats || lines.length === 0) return null;
  const corridor = new Corridor(lines, { ...DEFAULT_CORRIDOR, halfWidthM: ingestStats.corridor.halfWidthM });
  const { rows } = await client.query("SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM frames");
  const [w, s, e, n] = STRAY_RUN.bbox;
  let inCorridor = 0, outsideCorridor = 0, outsideInStrayBbox = 0;
  for (const r of rows as { lon: number; lat: number }[]) {
    if (corridor.contains({ lat: r.lat, lon: r.lon })) { inCorridor++; continue; }
    outsideCorridor++;
    if (r.lon >= w && r.lon <= e && r.lat >= s && r.lat <= n) outsideInStrayBbox++;
  }
  return { framesTotal, storedByAudit: ingestStats.storedImages, surplus: framesTotal - ingestStats.storedImages, inCorridor, outsideCorridor, outsideInStrayBbox, stray: STRAY_RUN };
}

async function report() {
  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1]!) : path.join(repoRoot, "docs", "validation");
  const ingestStats: IngestStats | null = existsSync(STATS_FILE) ? (JSON.parse(readFileSync(STATS_FILE, "utf8")) as IngestStats) : null;
  if (ingestStats) ingestStats.notes.push(...argv.flatMap((a, i) => (a === "--note" && argv[i + 1] ? [argv[i + 1]!] : []))); // run-history notes added at report time
  const client = new pg.Client(dbConfig());
  await client.connect();
  try {
    const dbq = await client.query(`SELECT source, count(*)::int AS n, count(*) FILTER (WHERE quality_score IS NULL)::int AS nulls,
      count(*) FILTER (WHERE quality_score < $1)::int AS low FROM frames GROUP BY source`, [DEFAULT_MATCH_CONFIG.minQualityScore]);
    const db: DbStats = { framesTotal: 0, qualityScoreNull: 0, qualityScoreBelow05: 0, bySource: {} };
    for (const r of dbq.rows) { db.framesTotal += r.n; db.qualityScoreNull += r.nulls; db.qualityScoreBelow05 += r.low; db.bySource[r.source as string] = r.n; }

    const rows: AuditRow[] = [];
    const { results } = await routeAll();
    const reconciliation = await reconcileFrames(client, results, ingestStats, db.framesTotal);
    const cfg = DEFAULT_CLASSIFY_CONFIG;
    for (const { pair, costing, r, error } of results) {
      const base = { routeId: pair.id, label: pair.label, costing };
      if (!r) { rows.push({ ...base, status: "error", error }); console.log(`${pair.id} ${costing}: ERROR ${error}`); continue; }
      const whole = routeInputs(r);
      const { frames, sourcesExcluded } = await loadFramesAlongAxisDetailed(client, whole.axis, DEFAULT_MATCH_CONFIG.lateralToleranceM + 10);
      if (sourcesExcluded.length) console.log(`note: sources excluded by kill switch: ${sourcesExcluded.join(",")}`);
      const pw = classifyFrames(whole.axis, whole.edges, frames, undefined, cfg, sourcesExcluded);
      const wholeSummary = summariseSegments(pw.classification, usableFrames(whole.axis, whole.edges, frames), pw.candidateFrames, pw.dropped, cfg);
      const ap = approachInputs(r);
      const pa = classifyFrames(ap.axis, ap.edges, frames, undefined, cfg, sourcesExcluded);
      const approachSummary = summariseSegments(pa.classification, usableFrames(ap.axis, ap.edges, frames), pa.candidateFrames, pa.dropped, cfg);
      const near = namedProximity(r);
      const interchanges = {} as NonNullable<AuditRow["interchanges"]>;
      for (const k of Object.keys(NAMED_POINTS) as NamedKey[]) {
        const lu = levelUncertainNear(whole.axis, pw.classification.segments, NAMED_POINTS[k].at, NEAR_NAMED_M);
        interchanges[k] = { relation: near[k].relation, distanceM: near[k].distanceM, levelUncertainSegments: lu.count };
      }
      rows.push({ ...base, status: "ok", unpaved_fallback: r.unpaved_fallback, routeLengthM: r.route.lengthM, whole: wholeSummary, approach: approachSummary, interchanges });
      console.log(`${pair.id} ${costing}: whole street ${(wholeSummary.streetFraction * 100).toFixed(1)}% approach ${(approachSummary.streetFraction * 100).toFixed(1)}% frames ${wholeSummary.usableFrames}`);
    }

    const totals = {} as Record<Costing, CostingTotals>;
    for (const c of COSTINGS) {
      const ok = rows.filter((x) => x.costing === c && x.status === "ok");
      const inter = {} as CostingTotals["interchanges"];
      for (const k of Object.keys(NAMED_POINTS) as NamedKey[]) {
        const cells = ok.map((x) => x.interchanges![k]).filter((x) => x.relation !== "no");
        inter[k] = { routesNear: cells.length, levelUncertainSegments: cells.reduce((n, x) => n + x.levelUncertainSegments, 0), routesWithAny: cells.filter((x) => x.levelUncertainSegments > 0).length };
      }
      totals[c] = {
        routesOk: ok.length, routesFailed: rows.filter((x) => x.costing === c).length - ok.length,
        whole: sumSummaries(ok.map((x) => x.whole!)), approach: sumSummaries(ok.map((x) => x.approach!)), interchanges: inter,
      };
    }

    const m = DEFAULT_MATCH_CONFIG;
    const audit: CoverageAudit = {
      generatedAt: new Date().toISOString(),
      killSwitchAtReport: killSwitchRaw(), reconciliation,
      verdict: "none: this report states measurements only",
      config: { match: m, classify: cfg, approachLengthM: DEFAULT_APPROACH_LENGTH_M },
      ingest: ingestStats, db,
      nullScoreHandling: m.allowMissingQuality
        ? "frames with a null quality_score are KEPT (allowMissingQuality is true)."
        : `frames with a null (or non-finite) quality_score are DROPPED by the matcher with reason low_quality (allowMissingQuality is false), the same reason used for scores below ${m.minQualityScore}. The classifier therefore never counts an unscored frame as usable street imagery.`,
      rows, totals,
      limitations: [
        "Mapillary image metadata only. No image, thumbnail or pixel data was fetched, so nothing here says whether a frame is sharp, usable, correctly exposed, free of obstruction, or shows what the metadata claims.",
        "quality_score is Mapillary's own number; it is used as reported. There is no independent image-quality check.",
        "Thresholds (60 m minimum run, 15 m RIFE ceiling, 30 m bridge ceiling, 2 bridges per segment, 25 degree heading tolerance, 0.5 quality, 15 m lateral) are the Phase 3 defaults and are untuned against this data.",
        "A 'street' share is a geometric statement about usable frame spacing along a Valhalla route, not a statement that a rider-facing preview would look acceptable.",
        "Capture-age buckets describe the frames inside STREET_VIDEO segments. Old imagery may show a road that has since changed; no age filter is applied and none is recommended or rejected here.",
        `Only a ${ingestStats?.corridor.halfWidthM ?? DEFAULT_CORRIDOR.halfWidthM} m corridor around the 25 validated pairs (both costings) was ingested. Coverage outside that corridor was not sampled, and 25 pairs are a sample of trips, not of the road network.`,
        "Last-500 m approach figures use the existing approach window; very short routes use the whole route as the approach.",
        "Frames are matched with one sequence per edge (the Phase 3 rule); a corridor with several overlapping sequences is reduced to one, so frame counts are lower than raw image counts.",
        "Where a route-costing pair failed to route, it contributes nothing to totals (see the Routes column of the totals table).",
        "docs/validation/route-validation.md classifies the same 25 pairs (last 500 m only) and points here for the coverage measurement.",
      ],
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "coverage-audit.json"), JSON.stringify(audit, null, 2) + "\n");
    writeFileSync(path.join(outDir, "coverage-audit.md"), renderCoverageMarkdown(audit));
    console.log(`wrote ${path.join(outDir, "coverage-audit.md")} and .json`);
  } finally {
    await client.end();
  }
}

(async () => {
  if (cmd === "ingest") await ingest();
  else if (cmd === "report") await report();
  else if (cmd === "run") {
    if (argv.includes("--skip-ingestion")) console.log("--skip-ingestion: reusing the stored frames; no Mapillary call will be made and no token is read");
    else await ingest();
    await report();
  } else throw new Error("usage: coverage-audit.ts ingest | report | run [--skip-ingestion]");
})().catch((e) => {
  console.error(String((e as Error).message ?? e)); // messages never carry the token or a URL (see mapillary.ts)
  process.exit(e instanceof SourceDisabledError ? 4 : 1);
});
