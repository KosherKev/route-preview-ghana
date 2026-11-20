// PostGIS-backed frame loader. Reads the source-neutral `frames` table (any `source`); no imagery-source code is imported.
import type { Client } from "pg";
import type { Axis } from "../geo/local";
import { disabledSources, warnOnceIfSuspiciousSources } from "../imagery/sources";
import type { FrameRecord } from "./types";

export interface LoadedFrames {
  /** Frames from enabled sources only. */
  frames: FrameRecord[];
  /** Disabled sources (IMAGERY_SOURCES_DISABLED) that had candidate frames near the axis; sorted. */
  sourcesExcluded: string[];
}

/**
 * Frames within `bufferM` metres of the route axis, with frames of disabled sources removed BEFORE classification
 * (the kill switch is read at call time). The axis is sent as WKT with EXPLICIT lon-lat ordering
 * (LINESTRING(lon lat, ...)), matching the table's geometry(Point, 4326) axis order; the distance test is geographic
 * (metres). The matcher then does the precise projection and filtering; this only narrows the candidates.
 */
export async function loadFramesAlongAxisDetailed(
  client: Pick<Client, "query">, axis: Axis, bufferM: number, disabled: readonly string[] = disabledSources(),
): Promise<LoadedFrames> {
  warnOnceIfSuspiciousSources();
  const wkt = `LINESTRING(${axis.points.map((p) => `${p.lon} ${p.lat}`).join(",")})`;
  const res = await client.query(
    `SELECT image_id, sequence_id, ST_Y(geom) AS lat, ST_X(geom) AS lon, computed_compass_angle, quality_score, captured_at, source
       FROM frames
      WHERE ST_DWithin(geom::geography, ST_GeogFromText($1), $2)
      ORDER BY captured_at NULLS LAST, image_id`,
    [wkt, bufferM],
  );
  const excluded = new Set<string>();
  const frames: FrameRecord[] = [];
  for (const r of res.rows) {
    const source = String(r.source as string);
    if (disabled.includes(source.trim().toLowerCase())) { excluded.add(source.trim().toLowerCase()); continue; }
    frames.push({
      imageId: r.image_id as string,
      sequenceId: (r.sequence_id as string | null) ?? null,
      lat: r.lat as number,
      lon: r.lon as number,
      compassAngleDeg: (r.computed_compass_angle as number | null) ?? null,
      qualityScore: (r.quality_score as number | null) ?? null,
      capturedAt: r.captured_at ? new Date(r.captured_at as string | Date).toISOString() : null,
      source,
    });
  }
  return { frames, sourcesExcluded: [...excluded].sort() };
}

/** Same as the detailed loader, frames only (disabled sources already excluded). */
export async function loadFramesAlongAxis(client: Pick<Client, "query">, axis: Axis, bufferM: number): Promise<FrameRecord[]> {
  return (await loadFramesAlongAxisDetailed(client, axis, bufferM)).frames;
}
