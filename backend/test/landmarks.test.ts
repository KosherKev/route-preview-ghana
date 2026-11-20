import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { applyMigrations } from "../src/db/migrate";

// Runs docker/landmarks/classify.sql against a synthetic landmarks_stage in a throwaway database.
loadEnv();
const cfg = dbConfig();
const dbName = `lmtest_${randomBytes(4).toString("hex")}`;
const classify = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docker/landmarks/classify.sql"), "utf8");
let admin: pg.Client;
let db: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ ...cfg, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  db = new pg.Client({ ...cfg, database: dbName });
  await db.connect();
  await applyMigrations(db);
});

afterAll(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
});

describe("landmarks classification", () => {
  it("categorises staged OSM points", async () => {
    await db.query("CREATE TABLE landmarks_stage (fid serial, geom geometry(Point,4326), osm_id text, name text, amenity text, highway text, public_transport text)");
    await db.query(`INSERT INTO landmarks_stage (geom, osm_id, name, amenity, highway, public_transport) VALUES
      (ST_SetSRID(ST_MakePoint(-0.19, 5.6), 4326), '1', 'Shell', 'fuel', NULL, NULL),
      (ST_SetSRID(ST_MakePoint(-0.18, 5.61), 4326), '2', 'Stop', NULL, 'bus_stop', NULL),
      (ST_SetSRID(ST_MakePoint(-0.17, 5.62), 4326), '3', NULL, NULL, 'traffic_signals', NULL),
      (ST_SetSRID(ST_MakePoint(-0.16, 5.63), 4326), '4', 'Makola', 'marketplace', NULL, NULL)`);
    await db.query(classify);
    const r = await db.query("SELECT category, count(*)::int AS n FROM landmarks GROUP BY 1 ORDER BY 1");
    expect(r.rows).toEqual([
      { category: "amenity", n: 1 }, { category: "fuel", n: 1 }, { category: "junction", n: 1 }, { category: "tro_tro_stop", n: 1 },
    ]);
    expect((await db.query("SELECT DISTINCT ST_SRID(geom) AS s FROM landmarks")).rows).toEqual([{ s: 4326 }]);
  });
});
