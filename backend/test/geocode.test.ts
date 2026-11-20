import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { createGeocoder, diceScore, type GeocodeFn } from "../src/geo/geocode";
import { type LandmarkMatch, type Queryable } from "../src/geo/landmarkSearch";
import { photonClient, PhotonError, type PhotonClient, type PhotonPlace } from "../src/geo/photon";
import { createApproachServer, listenLoopback } from "../src/routing/server";
import { photonIsUp, SKIP_NOTE } from "./helpers/photon";

const db: Queryable = { async query() { return { rows: [] }; } };
const lm = (o: Partial<LandmarkMatch> = {}): LandmarkMatch => ({ name: "Circle", category: "tro_tro_stop", lat: 5.57, lon: -0.213, distance_m: null, score: 0.9, ...o });
const fakePhoton = (o: { up?: boolean; places?: PhotonPlace[]; fail?: boolean; calls?: { n: number } } = {}): PhotonClient => ({
  name: "photon-local",
  async available() { return o.up ?? true; },
  async search() { if (o.calls) o.calls.n++; if (o.fail) throw new PhotonError("down"); return o.places ?? []; },
});
const P = (q: string, extra: object = {}) => ({ q, limit: 5, ...extra });

describe("createGeocoder", () => {
  it("parses coordinates without touching landmarks or Photon", async () => {
    let touched = false;
    const g = createGeocoder({ db, photon: fakePhoton({ calls: { n: 0 } }), search: async () => { touched = true; return []; } });
    const r = await g(P("5.6037, -0.1870"));
    expect(r.candidates).toEqual([{ name: "5.6037, -0.1870", lat: 5.6037, lon: -0.187, source: "coordinates", score: 1, distance_m: null }]);
    expect(touched).toBe(false);
  });
  it("landmarks at >= 0.5 claim the answer and Photon is not asked", async () => {
    const calls = { n: 0 };
    const g = createGeocoder({ db, photon: fakePhoton({ calls }), search: async () => [lm(), lm({ name: "weak", score: 0.4 })] });
    const r = await g(P("circle"));
    expect(r.candidates.map((c) => [c.name, c.source])).toEqual([["Circle", "landmarks"]]);
    expect(r.degraded).toBe(false);
    expect(calls.n).toBe(0);
  });
  it("falls through to Photon when landmarks score below the claim threshold", async () => {
    const g = createGeocoder({
      db, search: async () => [lm({ name: "Opportunity International", score: 0.41 })],
      photon: fakePhoton({ places: [{ name: "Kotoka International Airport", label: "Kotoka International Airport, Accra", lat: 5.6038, lon: -0.1683 }] }),
    });
    const r = await g(P("Kotoka International Airport", { near: { lat: 5.6, lon: -0.2 } }));
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ source: "photon-local", score: 1 });
    expect(r.candidates[0]!.distance_m).toBeGreaterThan(1000);
    expect(r.degraded).toBe(false);
  });
  it("drops Photon noise below the similarity floor so nonsense gives an empty list", async () => {
    const g = createGeocoder({ db, search: async () => [], photon: fakePhoton({ places: [{ name: "Accra Mall", label: "Accra Mall", lat: 5.6, lon: -0.17 }] }) });
    expect(await g(P("qqzzxxvv"))).toEqual({ query: "qqzzxxvv", candidates: [], degraded: false });
  });
  it("Photon down: local results come back flagged degraded, and no wrong confident answer for Kotoka", async () => {
    const g = createGeocoder({ db, photon: fakePhoton({ up: false }), search: async (_d, p) => (p.q === "circle" ? [lm()] : [lm({ name: "Opportunity International", score: 0.41 })]) });
    expect(await g(P("circle"))).toMatchObject({ degraded: true, candidates: [{ source: "landmarks" }] });
    expect(await g(P("Kotoka International Airport"))).toEqual({ query: "Kotoka International Airport", candidates: [], degraded: true });
    expect((await g(P("5.6, -0.2"))).degraded).toBe(true);
  });
  it("Photon failing mid-request degrades instead of throwing", async () => {
    const g = createGeocoder({ db, search: async () => [], photon: fakePhoton({ fail: true }) });
    expect(await g(P("anything"))).toEqual({ query: "anything", candidates: [], degraded: true });
    const slow = createGeocoder({ db, search: async () => [], photon: photonClient("http://127.0.0.1:1") });
    expect((await slow(P("anything"))).degraded).toBe(true);
  });
  it("without a Photon client it is local-only and not degraded", async () => {
    expect((await createGeocoder({ db, search: async () => [] })(P("x"))).degraded).toBe(false);
  });
  it("a landmark database failure still surfaces (it is not a Photon problem)", async () => {
    await expect(createGeocoder({ db, search: async () => { throw new Error("db"); } })(P("x"))).rejects.toThrow("db");
  });
});

describe("diceScore", () => {
  it("is 1 for equal-after-normalisation, high for near matches, low for unrelated", () => {
    expect(diceScore("Café Accra", "cafe  accra")).toBe(1);
    expect(diceScore("Spintex Road", "Spintex")).toBeGreaterThan(0.6);
    expect(diceScore("qqzzxxvv", "Accra Mall")).toBeLessThan(0.3);
    expect(diceScore("", "x")).toBe(0);
  });
});

// HTTP surface: real server, real landmarks table (read-only); Photon is faked unless live Photon is up.
loadEnv();
let pool: pg.Pool;
let base = "";
const server = (g: GeocodeFn) => createApproachServer({ geocode: g, onError: () => {} });
let srv: ReturnType<typeof server>;
const photonDown: PhotonClient = fakePhoton({ up: false });
beforeAll(async () => {
  pool = new pg.Pool({ ...dbConfig(), max: 2 });
  srv = server(createGeocoder({ db: pool, photon: photonDown }));
  await listenLoopback(srv, 0);
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => srv.close(() => r())); await pool.end(); });
const get = (qs: string) => fetch(`${base}/geocode?${qs}`);

describe("GET /geocode (Photon down)", () => {
  it("resolves a misspelled landmark from the local table, degraded true", async () => {
    const r = await get("q=asilum+down+farmacy");
    expect(r.status).toBe(200);
    const b = await r.json() as { degraded: boolean; candidates: Array<{ name: string; source: string; distance_m?: number }> };
    expect(b.degraded).toBe(true);
    expect(b.candidates[0]).toMatchObject({ name: "Asylum Down Pharmacy", source: "landmarks" });
    expect(b.candidates[0]!.distance_m).toBeUndefined();
  });
  it("includes distance_m only when near is given", async () => {
    const b = await (await get("q=Asylum+Down+Pharmacy&near=5.57,-0.2")).json() as { candidates: Array<{ distance_m: number }> };
    expect(b.candidates[0]!.distance_m).toBeGreaterThanOrEqual(0);
  });
  it("returns the parsed point for a coordinate string and [] for nonsense, both 200", async () => {
    expect(await (await get("q=5.6037,+-0.1870")).json()).toMatchObject({ candidates: [{ source: "coordinates", lat: 5.6037, lon: -0.187 }] });
    const r = await get("q=qqzzxxvv");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ candidates: [] });
  });
  it("Kotoka without Photon gives no wrong confident answer", async () => {
    const b = await (await get("q=Kotoka+International+Airport")).json() as { candidates: unknown[]; degraded: boolean };
    expect(b).toMatchObject({ candidates: [], degraded: true });
  });
  it.each([
    ["missing q", ""], ["empty q", "q="], ["over-long q", `q=${"a".repeat(101)}`], ["NUL in q", "q=a%00b"],
    ["bad near", "q=x&near=abc"], ["near out of range", "q=x&near=99,0"], ["limit 0", "q=x&limit=0"], ["huge limit", "q=x&limit=1000000"],
  ])("%s -> problem JSON 400 with no internals", async (_n, qs) => {
    const r = await get(qs);
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
    const t = await r.text();
    expect(JSON.parse(t)).toMatchObject({ title: "Invalid request", status: 400 });
    expect(t).not.toMatch(/postgres|stack|node_modules|SELECT/i);
  });
  it("quote, semicolon and SQL in q are data: 200, table intact", async () => {
    for (const q of ["'; DROP TABLE landmarks; --", "a;b'c\"d"]) {
      const r = await get(`q=${encodeURIComponent(q)}`);
      expect(r.status).toBe(200);
    }
    expect(Number((await pool.query("SELECT count(*) AS n FROM landmarks")).rows[0]!.n)).toBeGreaterThan(1000);
  });
  it("a landmark DB failure is a generic 500 problem with no details", async () => {
    const bad = server(async () => { throw new Error("password=hunter2 at pg.connect"); });
    await listenLoopback(bad, 0);
    try {
      const r = await fetch(`http://127.0.0.1:${(bad.address() as AddressInfo).port}/geocode?q=x`);
      expect(r.status).toBe(500);
      expect(await r.text()).not.toMatch(/hunter2|pg\.connect/);
    } finally { await new Promise<void>((res) => bad.close(() => res())); }
  });
  it("rejects non-GET and binds loopback", async () => {
    expect((await fetch(`${base}/geocode?q=x`, { method: "POST" })).status).toBe(405);
    expect((srv.address() as AddressInfo).address).toBe("127.0.0.1");
  });
});

const up = await photonIsUp();
if (!up) console.warn(SKIP_NOTE);
describe.skipIf(!up)("GET /geocode with live Photon (skipped when Photon is not running)", () => {
  it("Kotoka International Airport resolves via Photon near (5.6038, -0.1683), not degraded", async () => {
    const liveSrv = server(createGeocoder({ db: pool, photon: photonClient() }));
    await listenLoopback(liveSrv, 0);
    try {
      const b = await (await fetch(`http://127.0.0.1:${(liveSrv.address() as AddressInfo).port}/geocode?q=Kotoka+International+Airport`)).json() as { degraded: boolean; candidates: Array<{ source: string; lat: number; lon: number }> };
      expect(b.degraded).toBe(false);
      expect(b.candidates[0]).toMatchObject({ source: "photon-local" });
      expect(b.candidates[0]!.lat).toBeCloseTo(5.6038, 1);
      expect(b.candidates[0]!.lon).toBeCloseTo(-0.1683, 1);
    } finally { await new Promise<void>((r) => liveSrv.close(() => r())); }
  });
});
