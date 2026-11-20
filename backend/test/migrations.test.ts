import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { applyMigrations } from "../src/db/migrate";

// Needs the PostGIS container (docker compose up -d postgis). It creates and drops its own throwaway database.
loadEnv();
const cfg = dbConfig();
const dbName = `migtest_${randomBytes(4).toString("hex")}`;
let admin: pg.Client;
let db: pg.Client;

const columns = async (table: string) =>
  (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name=$1", [table])).rows.map((r) => r.column_name as string);

beforeAll(async () => {
  admin = new pg.Client({ ...cfg, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  db = new pg.Client({ ...cfg, database: dbName });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
});

describe("migrations on an empty database", () => {
  it("applies cleanly and is idempotent", async () => {
    const first = await applyMigrations(db);
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(await applyMigrations(db)).toEqual([]);
  });

  it("creates frames with the specified columns", async () => {
    expect(await columns("frames")).toEqual(expect.arrayContaining([
      "image_id", "sequence_id", "geom", "computed_compass_angle", "is_pano", "camera_type",
      "width", "height", "quality_score", "captured_at", "source", "creator", "license",
    ]));
  });

  it("creates clips with the specified columns", async () => {
    expect(await columns("clips")).toEqual(expect.arrayContaining([
      "clip_id", "edge_id", "start_offset", "end_offset", "direction", "video_url", "length_m",
      "imagery_version", "render_params", "status", "start_pose", "end_pose", "expires_at",
    ]));
  });

  it("creates landmarks", async () => {
    expect(await columns("landmarks")).toEqual(expect.arrayContaining(["osm_id", "category", "name", "geom"]));
  });

  it("uses Point geometry in SRID 4326 for frames and landmarks", async () => {
    const r = await db.query(
      "SELECT f_table_name, type, srid FROM geometry_columns WHERE f_table_name IN ('frames','landmarks') AND f_geometry_column='geom' ORDER BY 1",
    );
    expect(r.rows).toEqual([
      { f_table_name: "frames", type: "POINT", srid: 4326 },
      { f_table_name: "landmarks", type: "POINT", srid: 4326 },
    ]);
  });
});
