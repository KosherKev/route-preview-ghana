import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { applyMigrations } from "../src/db/migrate";
import { toFrameRow } from "../src/ingest/mapillary";
import { upsertFrames } from "../src/ingest/store";

loadEnv();
const cfg = dbConfig();
const dbName = `ingtest_${randomBytes(4).toString("hex")}`;
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
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${dbName}`); await admin.end(); }
});

describe("upsertFrames", () => {
  const row = (id: string, angle: number) => toFrameRow({
    id, sequence: "s", computed_geometry: { type: "Point", coordinates: [-0.2, 5.6] }, computed_compass_angle: angle,
    captured_at: 1700000000000, creator: { username: "u" }, width: 10, height: 20,
  })!;

  it("writes source='mapillary' rows with SRID 4326 geometry and upserts on conflict", async () => {
    expect(await upsertFrames(db, [row("a", 10), row("b", 20)])).toBe(2);
    expect(await upsertFrames(db, [row("a", 99)])).toBe(1);
    const r = await db.query("SELECT image_id, source, license, creator_username, source_url, computed_compass_angle AS ang, ST_SRID(geom) AS srid, ST_X(geom) AS x FROM frames ORDER BY 1");
    expect(r.rows).toEqual([
      { image_id: "a", source: "mapillary", license: "CC-BY-SA-4.0", creator_username: "u", source_url: "https://www.mapillary.com/app/?pKey=a", ang: 99, srid: 4326, x: -0.2 },
      { image_id: "b", source: "mapillary", license: "CC-BY-SA-4.0", creator_username: "u", source_url: "https://www.mapillary.com/app/?pKey=b", ang: 20, srid: 4326, x: -0.2 },
    ]);
  });

  it("stores a null creator_username and a licence the source reports, and survives a multi-row batch", async () => {
    const many = Array.from({ length: 5 }, (_, i) => toFrameRow({
      id: `m${i}`, computed_geometry: { type: "Point", coordinates: [-0.3, 5.7] }, creator: i === 0 ? null : { username: `u${i}` },
      ...(i === 1 ? { license: "CC0-1.0" } : {}),
    })!);
    expect(await upsertFrames(db, many, 2)).toBe(5); // batches of 2 exercise the placeholder arithmetic
    const r = await db.query("SELECT image_id, creator_username, license FROM frames WHERE image_id LIKE 'm%' ORDER BY 1");
    expect(r.rows.map((x) => [x.creator_username, x.license])).toEqual([
      [null, "CC-BY-SA-4.0"], ["u1", "CC0-1.0"], ["u2", "CC-BY-SA-4.0"], ["u3", "CC-BY-SA-4.0"], ["u4", "CC-BY-SA-4.0"],
    ]);
  });
});
