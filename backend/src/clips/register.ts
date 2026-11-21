// Writes the `clips` row for a clip the Python worker built. Attribution comes from the follow-up B builder; every
// clip from this task is a PROTOTYPE (status "prototype", render_params.prototype true) and so fails isClipServable.
import type { Client } from "pg";
import { toSourceSummary, type AttributionFrame, type SourceSummaryEntry } from "../imagery/attribution";
import { PROTOTYPE_CLIP_STATUS } from "../imagery/sources";
import type { ClipPlan } from "./plan";

/** What the worker writes next to each clip (worker/rpg_worker/pipeline.py ClipResult.to_json). */
export interface ClipResult {
  edge_id: number;
  direction: string;
  clip_key: string;
  duration_s: number;
  fps: number;
  speed_mps: number;
  frame_count: number;
  source_frames: number;
  interpolated_frames: number;
  bridge_frames: number;
  bridges_used: number;
  interpolator: string;
  file_bytes: number;
  encode_seconds: number;
  start_pose: { lat: number; lon: number; heading_deg: number | null };
  end_pose: { lat: number; lon: number; heading_deg: number | null };
  render_params: Record<string, unknown>;
}

/** Retention for prototype clips in the local cache. */
export const PROTOTYPE_CLIP_TTL_DAYS = 30;

export interface ClipRow {
  edge_id: number;
  start_offset: number;
  end_offset: number;
  direction: string;
  video_url: string;
  length_m: number;
  imagery_version: string;
  render_params: Record<string, unknown>;
  status: string;
  start_pose: unknown;
  end_pose: unknown;
  expires_at: string;
  source_summary: SourceSummaryEntry[];
}

export function buildClipRow(
  plan: ClipPlan, result: ClipResult, attribution: readonly AttributionFrame[], edgeSpan: { startM: number; endM: number }, now: Date = new Date(),
): ClipRow {
  const span = Math.max(edgeSpan.endM - edgeSpan.startM, 1e-9);
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const years = plan.captureYears;
  return {
    edge_id: plan.edge_id, direction: plan.direction,
    start_offset: clamp01((plan.segment.startM - edgeSpan.startM) / span), end_offset: clamp01((plan.segment.endM - edgeSpan.startM) / span),
    video_url: `local:${result.clip_key}`, // local cache key; nothing is uploaded or served
    length_m: plan.segment.lengthM,
    imagery_version: `mapillary:${years.min ?? "?"}-${years.max ?? "?"}`,
    render_params: {
      ...result.render_params, prototype: true, segment: plan.segment, bridges: plan.bridges, fps: result.fps, speed_mps: result.speed_mps,
      duration_s: result.duration_s, interpolator: result.interpolator, frame_count: result.frame_count, captureYears: years,
    },
    status: PROTOTYPE_CLIP_STATUS,
    start_pose: result.start_pose, end_pose: result.end_pose,
    expires_at: new Date(now.getTime() + PROTOTYPE_CLIP_TTL_DAYS * 86_400_000).toISOString(),
    source_summary: toSourceSummary(attribution),
  };
}

/**
 * Inserts the row idempotently: `ON CONFLICT (edge_id, direction) DO NOTHING` against the unique index from migration 009,
 * so a re-run or a concurrent registration never duplicates and never errors. DO NOTHING (not DO UPDATE) because an existing
 * row is the source of truth: a later promotion, status change or expiry must not be reset by re-registering the same clip.
 * Returns whether this call inserted the row.
 */
export async function insertClipIfAbsent(client: Pick<Client, "query">, row: ClipRow): Promise<boolean> {
  const res = await client.query(
    `INSERT INTO clips (edge_id, start_offset, end_offset, direction, video_url, length_m, imagery_version, render_params, status,
       start_pose, end_pose, expires_at, source_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (edge_id, direction) DO NOTHING`,
    [row.edge_id, row.start_offset, row.end_offset, row.direction, row.video_url, row.length_m, row.imagery_version,
      JSON.stringify(row.render_params), row.status, JSON.stringify(row.start_pose), JSON.stringify(row.end_pose), row.expires_at, JSON.stringify(row.source_summary)],
  );
  return (res.rowCount ?? 0) > 0;
}
