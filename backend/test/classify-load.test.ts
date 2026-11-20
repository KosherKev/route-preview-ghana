import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { applyMigrations } from "../src/db/migrate";
import { loadFramesAlongAxis } from "../src/classify/load";
import { classifyFrames } from "../src/classify/pipeline";
import { every, straightScene } from "../src/classify/synthetic";

loadEnv();
const cfg = dbConfig();
const dbName = `clsload_${randomBytes(4).toString("hex")}`;
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

async function insert(f: { imageId: string; sequenceId: string | null; lat: number; lon: number; compassAngleDeg: number | null; qualityScore: number | null; capturedAt: string | null }, source = "synthetic") {
  await db.query(
    `INSERT INTO frames (image_id, sequence_id, geom, computed_compass_angle, quality_score, captured_at, source)
     VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,$7,$8)`,
    [f.imageId, f.sequenceId, f.lon, f.lat, f.compassAngleDeg, f.qualityScore, f.capturedAt, source],
  );
}

describe("loadFramesAlongAxis (throwaway PostGIS database)", () => {
  it("returns no frames from an empty table", async () => {
    const sc = straightScene({ lengthM: 300 });
    expect(await loadFramesAlongAxis(db, sc.axis, 30)).toEqual([]);
  });

  it("loads nearby frames with lat/lon in the right order, ignores far ones, and feeds the classifier end to end", async () => {
    const sc = straightScene({ bearingDeg: 90, lengthM: 300 });
    const near = sc.frames(every(5, 0, 300));
    const far = sc.frames([100], { lateralRightM: 200, id: "far" });
    for (const f of [...near, ...far]) await insert(f);
    const loaded = await loadFramesAlongAxis(db, sc.axis, 30);
    expect(loaded.length).toBe(near.length);
    expect(loaded.find((f) => f.imageId === "far")).toBeUndefined();
    const sample = loaded.find((f) => f.imageId === near[0]!.imageId)!;
    expect(sample.lat).toBeCloseTo(near[0]!.lat, 9); // lat is lat, lon is lon
    expect(sample.lon).toBeCloseTo(near[0]!.lon, 9);
    expect(sample.capturedAt).toBe("2024-03-01T10:00:00.000Z");
    const c = classifyFrames(sc.axis, sc.edges, loaded).classification;
    expect(c.segments.map((s) => s.mode)).toEqual(["STREET_VIDEO"]);
  });
});
