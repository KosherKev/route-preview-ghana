// Types and Markdown renderer for the coverage audit (follow-up D). Reports measurements only: no verdict.
import type { CallStats } from "../ingest/callMeter";
import type { ClassifyConfig } from "../classify/classify";
import type { MatchConfig } from "../classify/match";
import type { Costing } from "../routing/valhalla";
import { AGE_BUCKETS, bucketShares, type GateResult, type SegmentSummary } from "./coverage";
import type { FieldStats } from "./ingestStats";
import { NAMED_POINTS, NEAR_NAMED_M, type NamedKey } from "./routes";

export interface IngestStats {
  startedAt: string;
  finishedAt: string;
  corridor: { halfWidthM: number; cellDeg: number; stepM: number; cells: number; routesUsed: number; routesFailed: number };
  minIntervalMs: number;
  cellsRequested: number;
  /** Unique images the API returned for the requested cells, including ones outside the corridor (discarded). */
  fetchedUniqueImages: number;
  /** Unique images inside the corridor: the stored set. */
  storedImages: number;
  skipped: { no_geometry: number; invalid_captured_at: number };
  fields: FieldStats;
  calls: CallStats;
  notes: string[];
  /** Raw IMAGERY_SOURCES_DISABLED when the ingest ran (null when unset). Absent in stats written before this field existed. */
  killSwitch?: { value: string | null };
}

export interface InterchangeCell { relation: "ends_at" | "through" | "no"; distanceM: number; levelUncertainSegments: number }

export interface AuditRow {
  routeId: string;
  label: string;
  costing: Costing;
  status: "ok" | "error";
  error?: string;
  unpaved_fallback?: boolean;
  routeLengthM?: number;
  whole?: SegmentSummary;
  approach?: SegmentSummary;
  interchanges?: Record<NamedKey, InterchangeCell>;
}

export interface CostingTotals {
  routesOk: number;
  routesFailed: number;
  whole: SegmentSummary;
  approach: SegmentSummary;
  interchanges: Record<NamedKey, { routesNear: number; levelUncertainSegments: number; routesWithAny: number }>;
}

export interface DbStats {
  framesTotal: number;
  qualityScoreNull: number;
  qualityScoreBelow05: number;
  bySource: Record<string, number>;
}

/** Frames-table reconciliation against the corridor, measured at report time from the stored frames and the re-routed corridor. */
export interface FrameReconciliation {
  framesTotal: number;
  /** Images the audit ingest stored (ingest-stats storedImages). */
  storedByAudit: number;
  /** framesTotal - storedByAudit. */
  surplus: number;
  inCorridor: number;
  outsideCorridor: number;
  /** Rows outside the corridor that lie inside the stray test run's query bbox. */
  outsideInStrayBbox: number;
  stray: { storedImages: number; bbox: [number, number, number, number]; maxCalls: number; fixedInCommit: string };
}

/** The one note about stray test rows: states the measured numbers and what is inferred. */
export function strayRowsNote(r: FrameReconciliation): string {
  const inferredInside = r.stray.storedImages - r.outsideCorridor;
  const parts = [
    `Stray test rows: before this audit, the CLI test in test/sources.test.ts (since fixed in commit ${r.stray.fixedInCommit}) made live Mapillary calls because the copied .env supplied a token: at most ${r.stray.maxCalls} calls against the bbox ${r.stray.bbox.join(",")}, which stored ${r.stray.storedImages} images (that figure was recorded at the time; it cannot be re-derived from the database). Those calls are NOT in the API count above.`,
    `Reconciliation, measured at report time: the frames table has ${r.framesTotal} rows; the audit ingest stored ${r.storedByAudit}; the surplus is ${r.surplus}. Re-routing the pairs and applying the same corridor to every stored frame gives ${r.inCorridor} rows inside the corridor and ${r.outsideCorridor} outside it, ${r.outsideInStrayBbox} of those outside rows inside the stray bbox.`,
  ];
  if (r.inCorridor === r.storedByAudit && r.outsideCorridor === r.surplus) {
    parts.push(`The outside-corridor count equals the surplus exactly, so the surplus is the stray rows the ingest never touched, and ${r.stray.storedImages} - ${r.outsideCorridor} = ${inferredInside} of the stray images lie inside the corridor and were re-upserted (idempotent) by the ingest, so they are inside the ${r.storedByAudit}. That ${inferredInside} is inferred by subtraction: rows do not record which run wrote them.`);
  } else {
    parts.push(`These numbers do not reconcile: the inside-corridor count (${r.inCorridor}) differs from what the ingest stored (${r.storedByAudit}) or the outside count (${r.outsideCorridor}) differs from the surplus (${r.surplus}). The corridor at report time may not match the corridor at ingest time. The ${r.stray.storedImages} figure cannot be reconciled with the table from these data.`);
  }
  parts.push("Frames outside the corridor are never near a route axis, so they do not affect classification.");
  return parts.join(" ");
}

export interface CoverageAudit {
  generatedAt: string;
  /** Raw IMAGERY_SOURCES_DISABLED at report time (null when unset): the classifier drops frames from disabled sources. */
  killSwitchAtReport: string | null;
  reconciliation: FrameReconciliation | null;
  verdict: "none: this report states measurements only";
  config: { match: MatchConfig; classify: ClassifyConfig; approachLengthM: number };
  ingest: IngestStats | null;
  db: DbStats;
  nullScoreHandling: string;
  rows: AuditRow[];
  totals: Record<Costing, CostingTotals>;
  limitations: string[];
  /** D9 coverage gate (frames captured in the configured year or later only). Absent in older audits. */
  gate?: GateResult;
}

const showSwitch = (v: string | null) => (v === null || v === "" ? "unset" : `"${v.replace(/[^\x20-\x7e]/g, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`)}"`);

/** Kill-switch statement for the ingest, from the recorded value. */
export function killSwitchLine(k: IngestStats["killSwitch"]): string {
  if (!k) return "Kill switch IMAGERY_SOURCES_DISABLED at ingest time: not recorded (this ingest ran before the value was recorded; it can only have run with mapillary not disabled, because the ingest refuses to start otherwise).";
  return `Kill switch IMAGERY_SOURCES_DISABLED at ingest time: ${showSwitch(k.value)} (recorded by the ingest run).`;
}

export const COSTINGS: Costing[] = ["motor_scooter", "auto"];
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const km = (m: number | undefined) => (m === undefined ? "n/a" : (m / 1000).toFixed(2));
const rate = (n: number, d: number) => (d === 0 ? "n/a" : pct(n / d, 2));

export function renderCoverageMarkdown(a: CoverageAudit): string {
  const L: string[] = [];
  const ing = a.ingest;
  L.push("# Real-coverage audit (Phase 3 follow-up D)", "");
  L.push(`Generated: ${a.generatedAt}. Generated by \`npm run audit:coverage\` (backend); not typed by hand. This report states measurements only. It gives no go/no-go verdict and applies no age filter or threshold change.`, "");

  L.push("## Method", "");
  L.push("1. Route geometry: each of the 25 validated route pairs is routed with Valhalla under both costings (motor_scooter and auto), giving up to 50 route polylines.");
  if (ing) {
    L.push(`2. Corridor: a point counts as inside the corridor when it is within ${ing.corridor.halfWidthM} m of any of those polylines. To limit requests, the polylines are covered by fixed ${ing.corridor.cellDeg} degree cells (about ${Math.round(ing.corridor.cellDeg * 111_320)} m); ${ing.corridor.cells} cells were requested. Images the API returned outside the ${ing.corridor.halfWidthM} m corridor were discarded before storage.`);
    L.push(`3. Ingestion: Mapillary Graph API v4 /images, metadata fields only (the same field list the Phase 2 ingester requests), one bbox request per cell, throttled to one request start per ${ing.minIntervalMs} ms, Retry-After honoured by the Phase 2 client (retry cap 5 per request). Rows are upserted into the local PostGIS \`frames\` table by the Phase 2 store (idempotent on image_id). No image file, thumbnail or pixel data is requested, downloaded or stored.`);
  } else {
    L.push("2. Corridor and ingestion: no ingest-stats file was found when this report was generated, so the ingestion section is empty. Run `npm run audit:coverage -- ingest` first.");
  }
  L.push(`4. Classification: each route is classified twice from the stored frames under the current rules (two-tier gap rule: RIFE below ${a.config.classify.maxGapM} m, crossfade bridge ${a.config.classify.maxGapM} to ${a.config.classify.crossfadeMaxGapM} m inclusive, at most ${a.config.classify.maxBridgesPerSegment} bridges per segment, bridging only within one sequence_id; frame filters: lateral tolerance ${a.config.match.lateralToleranceM} m, at most ${a.config.match.maxLeftOffsetM} m left of centreline, heading within ${a.config.match.bearingToleranceDeg} degrees of the road, quality_score at least ${a.config.match.minQualityScore}): over the WHOLE route, and over the final approach (the last ${a.config.approachLengthM} m), which is what the Phase 3 validation classified. The two are reported separately.`);
  L.push("5. Shares are length-weighted: street share = STREET_VIDEO metres divided by route metres, totals are summed metres over summed metres (not an average of per-route percentages).", "");

  if (ing) {
    L.push("## Ingestion and API usage", "");
    L.push(`- Window: ${ing.startedAt} to ${ing.finishedAt}.`);
    L.push(`- Corridor half-width: ${ing.corridor.halfWidthM} m either side of each route polyline; cell size ${ing.corridor.cellDeg} degrees; ${ing.corridor.cells} cells; ${ing.corridor.routesUsed} routes used (${ing.corridor.routesFailed} failed to route and contributed no corridor).`);
    L.push(`- Mapillary API calls made by the audit ingest: **${ing.calls.calls}** (${Object.entries(ing.calls.byStatus).map(([k, v]) => `HTTP ${k}: ${v}`).join(", ") || "none"}); calls that failed at the network level before any HTTP response (and were retried): ${ing.calls.networkErrors}. Every request counted above is a metadata query (/images). ${killSwitchLine(ing.killSwitch)}`);
    L.push(`- Rate-limit events (HTTP 429): **${ing.calls.rateLimitEvents.length}**${ing.calls.rateLimitEvents.length ? ` (${ing.calls.rateLimitEvents.map((e) => `call ${e.atCall}, Retry-After ${e.retryAfter ?? "absent"}`).join("; ")})` : ""}. Retried 429/5xx responses: ${ing.calls.retriedResponses}. Total back-off waiting: ${(ing.calls.backoffWaitMs / 1000).toFixed(1)} s.`);
    L.push(`- Unique images returned: ${ing.fetchedUniqueImages}; inside the corridor and stored: ${ing.storedImages}; skipped at conversion: ${ing.skipped.no_geometry} without geometry, ${ing.skipped.invalid_captured_at} with an invalid captured_at.`);
    for (const n of ing.notes) L.push(`- Note: ${n}`);
    if (a.reconciliation) L.push(`- Note: ${strayRowsNote(a.reconciliation)}`);
    L.push("");
    L.push("## quality_score null rate", "");
    const f = ing.fields;
    L.push(`Measured over the ${f.images} unique images in the stored corridor set (before any classifier filter):`, "");
    L.push("| Field | Count | Rate |", "| --- | ---: | ---: |");
    L.push(`| quality_score null or absent | ${f.qualityScoreNull} | ${rate(f.qualityScoreNull, f.images)} |`);
    L.push(`| quality_score present | ${f.qualityScorePresent} | ${rate(f.qualityScorePresent, f.images)} |`);
    L.push(`| quality_score present and below ${a.config.match.minQualityScore} | ${f.qualityScoreBelow05} | ${rate(f.qualityScoreBelow05, f.images)} |`);
    L.push(`| computed_geometry missing (raw geometry used) | ${f.computedGeometryMissing} | ${rate(f.computedGeometryMissing, f.images)} |`);
    L.push(`| computed_compass_angle missing | ${f.computedCompassMissing} | ${rate(f.computedCompassMissing, f.images)} |`);
    L.push(`| sequence missing | ${f.sequenceMissing} | ${rate(f.sequenceMissing, f.images)} |`);
    L.push(`| captured_at missing | ${f.capturedAtMissing} | ${rate(f.capturedAtMissing, f.images)} |`);
    L.push(`| panoramas (is_pano) | ${f.panoramas} | ${rate(f.panoramas, f.images)} |`, "");
    L.push(`What the classifier does with a null-score frame today: ${a.nullScoreHandling}`, "");
    L.push("Capture year of ALL stored corridor images (context for the street-frame table further down):", "");
    L.push("| " + AGE_BUCKETS.join(" | ") + " |", "| " + AGE_BUCKETS.map(() => "---:").join(" | ") + " |");
    L.push("| " + AGE_BUCKETS.map((k) => `${f.captureYear[k]} (${rate(f.captureYear[k], f.images)})`).join(" | ") + " |", "");
  }
  L.push("## Frames table at report time", "");
  L.push(`- Kill switch IMAGERY_SOURCES_DISABLED at report time: ${showSwitch(a.killSwitchAtReport)} (frames from a disabled source are removed before classification).`);
  L.push(`- Rows in \`frames\`: ${a.db.framesTotal} (${Object.entries(a.db.bySource).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}); quality_score null: ${a.db.qualityScoreNull} (${rate(a.db.qualityScoreNull, a.db.framesTotal)}); below ${a.config.match.minQualityScore}: ${a.db.qualityScoreBelow05}.`, "");

  L.push("## Totals", "");
  L.push("| Costing | Scope | Routes | Route km | STREET_VIDEO | BIRDS_EYE_3D | Segments | Street segments | Bridges | Segments at bridge cap | Gaps refused (sequence_id differs) | level_uncertain segments |");
  L.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const c of COSTINGS) {
    const t = a.totals[c];
    for (const [scope, s] of [["whole route", t.whole], [`last ${a.config.approachLengthM} m approach`, t.approach]] as const) {
      L.push(`| ${c} | ${scope} | ${t.routesOk}${t.routesFailed ? ` (+${t.routesFailed} failed)` : ""} | ${km(s.lengthM)} | ${pct(s.streetFraction)} | ${pct(s.lengthM > 0 ? s.birdsEyeM / s.lengthM : 0)} | ${s.segments} | ${s.streetSegments} | ${s.bridges} | ${s.segmentsAtBridgeCap} | ${s.refusedSequenceGaps} | ${s.levelUncertainSegments} |`);
    }
  }
  L.push("");

  L.push("## level_uncertain at the three interchanges", "");
  L.push(`Counted on the whole-route classification: level_uncertain segments whose extent comes within ${NEAR_NAMED_M} m (along the route) of the interchange, for routes that pass within ${NEAR_NAMED_M} m of it.`, "");
  L.push("| Costing | Interchange | Routes passing | level_uncertain segments | Routes with at least one |", "| --- | --- | ---: | ---: | ---: |");
  for (const c of COSTINGS) for (const k of Object.keys(NAMED_POINTS) as NamedKey[]) {
    const i = a.totals[c].interchanges[k];
    L.push(`| ${c} | ${NAMED_POINTS[k].name} | ${i.routesNear} | ${i.levelUncertainSegments} | ${i.routesWithAny} |`);
  }
  L.push("");

  L.push("## Capture age of frames used in STREET_VIDEO segments", "");
  L.push("Share of the usable frames that sit inside STREET_VIDEO segments, by UTC capture year. No age filter is applied; this is a description of the frames the classifier already uses.", "");
  L.push("| Costing | Scope | Frames | " + AGE_BUCKETS.join(" | ") + " |", "| --- | --- | ---: | " + AGE_BUCKETS.map(() => "---:").join(" | ") + " |");
  for (const c of COSTINGS) for (const [scope, s] of [["whole route", a.totals[c].whole], ["approach", a.totals[c].approach]] as const) {
    const n = AGE_BUCKETS.reduce((x, k) => x + s.ageBuckets[k], 0);
    const sh = bucketShares(s.ageBuckets);
    L.push(`| ${c} | ${scope} | ${n} | ` + AGE_BUCKETS.map((k) => `${s.ageBuckets[k]} (${pct(sh[k])})`).join(" | ") + " |");
  }
  L.push("");

  L.push("## Frames dropped by the matcher (summed over route-costing pairs; a frame near two routes counts once per route)", "");
  for (const c of COSTINGS) {
    const d = a.totals[c].whole.dropped;
    L.push(`- ${c}, whole route: candidates ${a.totals[c].whole.candidateFrames}, usable ${a.totals[c].whole.usableFrames}; dropped: ${Object.entries(d).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`);
  }
  L.push("");

  if (a.gate) {
    const g = a.gate;
    L.push(`## Coverage gate (D9): last-${a.config.approachLengthM} m STREET_VIDEO share, frames captured ${g.config.minCaptureYear} or later only`, "");
    L.push(`Pass means the share is at least ${pct(g.config.threshold)} (configurable). The approach is classified again from the stored frames after removing every frame captured before ${g.config.minCaptureYear} (and frames with no capture date); quality, heading and gap rules are unchanged. Computed from stored frames only: no Mapillary call, no token. The gate result is a measurement against the owner's rule, not a change to any classifier threshold.`, "");
    L.push("| Scope | Routes | Approach km | STREET_VIDEO km | Share | Result |", "| --- | ---: | ---: | ---: | ---: | --- |");
    for (const [k, t] of Object.entries(g.totals)) L.push(`| total ${k} | ${t.routes} | ${km(t.approachLengthM)} | ${km(t.streetVideoM)} | ${pct(t.share)} | **${t.pass ? "PASS" : "FAIL"}** |`);
    L.push("", `Routes passing individually: ${g.routesPassing} of ${g.routesTotal}.`, "");
    L.push("| Route | Costing | Approach m | STREET_VIDEO m | Share | Result |", "| --- | --- | ---: | ---: | ---: | --- |");
    for (const r of g.rows) L.push(`| ${r.routeId} | ${r.costing} | ${r.approachLengthM.toFixed(0)} | ${r.streetVideoM.toFixed(0)} | ${pct(r.share)} | ${r.pass ? "PASS" : "FAIL"} |`);
    L.push("");
  }

  L.push("## Per route", "");
  L.push(`Street % columns are STREET_VIDEO metres over route (or approach) metres. Bridges are crossfade bridges used, "at cap" is STREET_VIDEO segments holding the maximum of ${a.config.classify.maxBridgesPerSegment} bridges, refused gaps are bridge-tier gaps not bridged because the sequence_id differs.`, "");
  L.push(`Whole-route columns first, then the same three counts for the last ${a.config.approachLengthM} m approach (Appr.).`, "");
  L.push("| Route | Costing | Route km | Whole street % | Approach street % | Segments | Bridges | At cap | Refused gaps | Appr. bridges | Appr. at cap | Appr. refused gaps | level_uncertain | Usable frames | Notes |");
  L.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of a.rows) {
    if (r.status !== "ok" || !r.whole || !r.approach) { L.push(`| ${r.routeId} ${r.label} | ${r.costing} | | | | | | | | | | | | | error: ${r.error ?? "unknown"} |`); continue; }
    L.push(`| ${r.routeId} ${r.label} | ${r.costing} | ${km(r.routeLengthM)} | ${pct(r.whole.streetFraction)} | ${pct(r.approach.streetFraction)} | ${r.whole.segments} | ${r.whole.bridges} | ${r.whole.segmentsAtBridgeCap} | ${r.whole.refusedSequenceGaps} | ${r.approach.bridges} | ${r.approach.segmentsAtBridgeCap} | ${r.approach.refusedSequenceGaps} | ${r.whole.levelUncertainSegments} | ${r.whole.usableFrames} | ${r.unpaved_fallback ? "unpaved_fallback" : ""} |`);
  }
  L.push("");

  L.push("## Limitations", "");
  for (const x of a.limitations) L.push(`- ${x}`);
  L.push("");
  return L.join("\n");
}
