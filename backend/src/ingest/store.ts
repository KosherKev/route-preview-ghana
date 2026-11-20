import type { Client } from "pg";
import type { FrameRow } from "./mapillary";

/** Upserts frame rows into PostGIS (geom is built from lon/lat in SRID 4326). Returns rows written. */
export async function upsertFrames(client: Client, rows: readonly FrameRow[], batchSize = 500): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const tuples = batch.map((r) => {
      const base = values.length; // placeholders for this row start after the ones already pushed (no magic row width)
      values.push(r.image_id, r.sequence_id, r.lon, r.lat, r.computed_compass_angle, r.is_pano, r.camera_type,
        r.width, r.height, r.quality_score, r.captured_at, r.source, r.creator, r.license, r.creator_username, r.source_url);
      const p = (j: number) => `$${base + j}`;
      return `(${p(1)},${p(2)},ST_SetSRID(ST_MakePoint(${p(3)},${p(4)}),4326),${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)},${p(11)},${p(12)},${p(13)},${p(14)},${p(15)},${p(16)})`;
    });
    await client.query(
      `INSERT INTO frames (image_id, sequence_id, geom, computed_compass_angle, is_pano, camera_type, width, height,
         quality_score, captured_at, source, creator, license, creator_username, source_url) VALUES ${tuples.join(",")}
       ON CONFLICT (image_id) DO UPDATE SET sequence_id=EXCLUDED.sequence_id, geom=EXCLUDED.geom,
         computed_compass_angle=EXCLUDED.computed_compass_angle, is_pano=EXCLUDED.is_pano, camera_type=EXCLUDED.camera_type,
         width=EXCLUDED.width, height=EXCLUDED.height, quality_score=EXCLUDED.quality_score,
         captured_at=EXCLUDED.captured_at, source=EXCLUDED.source, creator=EXCLUDED.creator, license=EXCLUDED.license,
         creator_username=EXCLUDED.creator_username, source_url=EXCLUDED.source_url`,
      values,
    );
    n += batch.length;
  }
  return n;
}
