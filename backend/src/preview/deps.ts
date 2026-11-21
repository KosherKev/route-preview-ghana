// PostGIS / filesystem backed dependencies for the preview builder. Read-only: SELECTs and file stat only.
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import type { ClipServing } from "../clips/serve";
import type { Axis } from "../geo/local";
import { loadFramesAlongAxisDetailed } from "../classify/load";
import { DEFAULT_MATCH_CONFIG } from "../classify/match";
import type { AttributionFrame } from "../imagery/attribution";
import { extractApproach } from "../routing/approach";
import type { ClipRecord, PreviewDeps } from "./build";
import { loadLandmarkRows } from "./overlays";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_CLIPS_DIR = path.join(repoRoot, "data", "clips-cache");
export const CLIP_KEY = /^([0-9]{1,15})\/([a-z]{1,16})\.mp4$/;

/** `clips.video_url` is `local:<key>` for locally cached clips; anything else (or a malformed key) is not a local clip. */
export function localClipKey(videoUrl: unknown): string | null {
  if (typeof videoUrl !== "string" || !videoUrl.startsWith("local:")) return null;
  const key = videoUrl.slice("local:".length);
  return CLIP_KEY.test(key) ? key : null;
}

/** Size in bytes of a regular file inside `dir` (never follows a key out of it), or null. */
export function cachedFileBytes(dir: string, key: string): number | null {
  if (!CLIP_KEY.test(key)) return null;
  const full = path.resolve(dir, key);
  if (!full.startsWith(path.resolve(dir) + path.sep)) return null;
  try { const st = statSync(full); return st.isFile() ? st.size : null; } catch { return null; }
}

export const rowToClipRecord = (r: Record<string, any>, clipsDir: string): ClipRecord | null => {
  const key = localClipKey(r.video_url);
  if (!key) return null;
  return {
    edge_id: Number(r.edge_id), direction: String(r.direction), key, length_m: r.length_m === null ? null : Number(r.length_m), status: String(r.status),
    render_params: (r.render_params ?? null) as Record<string, unknown> | null, source_summary: r.source_summary, start_pose: r.start_pose, end_pose: r.end_pose,
    fileBytes: cachedFileBytes(clipsDir, key),
  };
};

export function createPgPreviewDeps(db: Pick<Client, "query">, o: { clipsDir?: string; extractOptions?: PreviewDeps["extractOptions"] } = {}): PreviewDeps {
  const clipsDir = o.clipsDir ?? DEFAULT_CLIPS_DIR;
  return {
    extractor: extractApproach,
    extractOptions: o.extractOptions,
    loadFrames: (axis: Axis) => loadFramesAlongAxisDetailed(db, axis, DEFAULT_MATCH_CONFIG.lateralToleranceM + 10),
    async loadAttribution(imageIds): Promise<AttributionFrame[]> {
      const { rows } = await db.query(
        "SELECT source, creator_username, license, source_url FROM frames WHERE image_id = ANY($1) ORDER BY image_id", [imageIds],
      );
      return rows as AttributionFrame[];
    },
    async loadClips(edgeIds, direction) {
      const { rows } = await db.query(
        `SELECT edge_id, direction, video_url, length_m, status, render_params, source_summary, start_pose, end_pose
           FROM clips WHERE edge_id = ANY($1) AND direction = $2 ORDER BY edge_id`, [edgeIds, direction],
      );
      return rows.map((r) => rowToClipRecord(r, clipsDir)).filter((c): c is ClipRecord => c !== null);
    },
    loadLandmarks: (axis, from, to, maxDist) => loadLandmarkRows(db, axis, from, to, maxDist),
  };
}

/** Registered-clip lookup for the dev clip door (read-only). */
export function createPgClipServing(db: Pick<Client, "query">, clipsDir: string = DEFAULT_CLIPS_DIR): ClipServing {
  return {
    clipsDir,
    async lookup(edgeId, direction) {
      const { rows } = await db.query("SELECT video_url, source_summary FROM clips WHERE edge_id = $1 AND direction = $2 LIMIT 1", [edgeId, direction]);
      return rows[0] ?? null;
    },
  };
}
