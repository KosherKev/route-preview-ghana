import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyMigrations, MIGRATIONS_DIR } from "../src/db/migrate";

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
    expect(first.length).toBeGreaterThanOrEqual(5);
    expect(await applyMigrations(db)).toEqual([]);
  });

  it("creates frames with the specified columns", async () => {
    expect(await columns("frames")).toEqual(expect.arrayContaining([
      "image_id", "sequence_id", "geom", "computed_compass_angle", "is_pano", "camera_type",
      "width", "height", "quality_score", "captured_at", "source", "creator", "license",
      "creator_username", "source_url",
    ]));
  });

  it("creates clips with the specified columns", async () => {
    expect(await columns("clips")).toEqual(expect.arrayContaining([
      "clip_id", "edge_id", "start_offset", "end_offset", "direction", "video_url", "length_m",
      "imagery_version", "render_params", "status", "start_pose", "end_pose", "expires_at", "source_summary",
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

  it("adds the attribution columns with the right types and nullability (005)", async () => {
    const r = await db.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE (table_name='frames' AND column_name IN ('creator_username','source_url','source','license','creator'))
           OR (table_name='clips' AND column_name='source_summary') ORDER BY 1, 2`,
    );
    const by = Object.fromEntries(r.rows.map((x) => [`${x.table_name}.${x.column_name}`, x]));
    expect(by["frames.creator_username"]).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(by["frames.source_url"]).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(by["clips.source_summary"]).toMatchObject({ data_type: "jsonb", is_nullable: "NO" });
    // pre-existing columns are unchanged by 005 (source gained its default in 008, see below)
    expect(by["frames.source"]).toMatchObject({ is_nullable: "NO", column_default: "'mapillary'::text" });
    expect(by["frames.license"]).toMatchObject({ is_nullable: "YES" });
    expect(by["frames.creator"]).toMatchObject({ is_nullable: "YES" });
  });

  it("defaults clips.source_summary to an empty jsonb array", async () => {
    await db.query("INSERT INTO clips (edge_id) VALUES (1)");
    const r = await db.query("SELECT source_summary, jsonb_typeof(source_summary) AS t FROM clips WHERE edge_id=1");
    expect(r.rows[0]).toEqual({ source_summary: [], t: "array" });
  });

  it("005 re-applies as a no-op on a database that already has the columns", async () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, "005_attribution_fields.sql"), "utf8");
    await db.query(sql);
    await db.query(sql);
    expect(await columns("clips")).toContain("source_summary");
  });

  it("006 is followed by 007, which re-asserts it idempotently on an already-migrated database", async () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, "007_landmark_search_rerunnable.sql"), "utf8");
    await db.query(sql);
    await db.query(sql);
    const idx = await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'landmarks_name_trgm_idx'");
    expect(idx.rowCount).toBe(1);
    expect((await db.query("SELECT landmarks_norm('Café') AS n")).rows[0]!.n).toBe("cafe");
  });

  it("008 sets only a default of 'mapillary' on frames.source and is re-runnable", async () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, "008_frames_source_default.sql"), "utf8");
    await db.query(sql);
    const r = await db.query("SELECT is_nullable, data_type, column_default FROM information_schema.columns WHERE table_name='frames' AND column_name='source'");
    expect(r.rows[0]).toEqual({ is_nullable: "NO", data_type: "text", column_default: "'mapillary'::text" });
    await db.query("INSERT INTO frames (image_id, geom, source) VALUES ('mig-default', ST_SetSRID(ST_MakePoint(0,0),4326), DEFAULT)");
    expect((await db.query("SELECT source FROM frames WHERE image_id='mig-default'")).rows[0]!.source).toBe("mapillary");
  });
});
