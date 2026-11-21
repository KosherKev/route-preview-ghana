import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { createGeocoder, type Candidate, type GeocodeFn } from "../src/geo/geocode";
import type { ApproachResult } from "../src/routing/approach";
import { resolvePlace } from "../src/routing/resolve";
import { createApproachServer, listenLoopback } from "../src/routing/server";

const cand = (name: string, lat: number, lon: number, score: number, source: Candidate["source"] = "landmarks"): Candidate => ({ name, lat, lon, source, score, distance_m: null });
const TABLE: Record<string, Candidate[]> = {
  "asylum down pharmacy": [cand("Asylum Down Pharmacy", 5.5724, -0.2001, 1)],
  "madina": [cand("Madina", 5.6767, -0.1716, 1), cand("Madina", 5.6772, -0.1713, 1)],
  "total": [cand("Total", 5.5652, -0.1814, 1), cand("Total", 5.6423, -0.152, 1)],
  "weak": [cand("Opportunity International", 5.6, -0.2, 0.41)],
  "far": [cand("Far Place", 40, 40, 0.9)],
  "kotoka": [cand("Kotoka International Airport", 5.6038, -0.1683, 0.95, "photon-local")],
};
const fakeGeocode: GeocodeFn = async (p) => ({ query: p.q, candidates: TABLE[p.q.toLowerCase()] ?? [], degraded: p.q === "kotoka" ? false : true });

let calls: Array<{ o: unknown; d: unknown }> = [];
const make = (g?: GeocodeFn, extra: object = {}) => createApproachServer({
  geocode: g, onError: () => {}, ...extra,
  extractor: async (c, o, d) => { calls.push({ o, d }); return { costing: c } as unknown as ApproachResult; },
});
let srv: ReturnType<typeof make>;
let base = "";
beforeAll(async () => { srv = make(fakeGeocode); await listenLoopback(srv, 0); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; });
afterAll(() => new Promise<void>((r) => srv.close(() => r())));
const post = (b: unknown, url = base) => fetch(`${url}/approach`, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
const LL = { lat: 5.6361, lon: -0.175 };

describe("name-based routing", () => {
  it("routes from two names and says which candidates were used", async () => {
    calls = [];
    const r = await post({ origin_query: "Asylum Down Pharmacy", destination_query: "kotoka", costing: "auto" });
    expect(r.status).toBe(200);
    const b = await r.json() as { resolved: Record<string, Record<string, unknown>> };
    expect(b.resolved.origin).toMatchObject({ query: "Asylum Down Pharmacy", name: "Asylum Down Pharmacy", source: "landmarks", score: 1 });
    expect(b.resolved.destination).toMatchObject({ name: "Kotoka International Airport", source: "photon-local" });
    expect(calls[0]).toEqual({ o: { lat: 5.5724, lon: -0.2001 }, d: { lat: 5.6038, lon: -0.1683 } });
  });
  it("mixes a name with coordinates; only the named end appears in resolved", async () => {
    const b = await (await post({ origin: LL, destination_query: "kotoka", costing: "auto" })).json() as { resolved: Record<string, unknown> };
    expect(Object.keys(b.resolved)).toEqual(["destination"]);
  });
  it("plain lat/lon requests are unchanged: no resolved key", async () => {
    const b = await (await post({ origin: LL, destination: { lat: 5.55, lon: -0.2174 }, costing: "auto" })).json();
    expect(b).toEqual({ costing: "auto" });
  });
  it("two near-identical matches within 500 m are not ambiguous (Madina)", async () => {
    expect((await post({ origin_query: "Madina", destination: LL, costing: "auto" })).status).toBe(200);
  });
  it("an ambiguous name returns the candidates and does not route", async () => {
    calls = [];
    const r = await post({ origin_query: "Total", destination: LL, costing: "auto" });
    expect(r.status).toBe(422);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
    const b = await r.json() as { candidates: unknown[] };
    expect(b).toMatchObject({ title: "Ambiguous place", status: 422, field: "origin_query", query: "Total" });
    expect(b.candidates).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });
  it("a low-confidence best candidate is returned for disambiguation, not used", async () => {
    calls = [];
    const r = await post({ origin: LL, destination_query: "weak", costing: "auto" });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ title: "No confident match", candidates: [{ name: "Opportunity International" }] });
    expect(calls).toHaveLength(0);
  });
  it("no candidates -> 422 not found with an empty list", async () => {
    expect(await (await post({ origin_query: "nothing here", destination: LL, costing: "auto" })).json()).toMatchObject({ title: "Place not found", candidates: [] });
  });
  it("a resolved point outside Ghana is rejected by the normal bounds check", async () => {
    expect((await post({ origin_query: "far", destination: LL, costing: "auto" })).status).toBe(400);
  });
  it("rejects both forms, non-strings, bad queries, and names when lookup is not enabled", async () => {
    for (const b of [
      { origin: LL, origin_query: "Total", destination: LL }, { origin_query: 5, destination: LL }, { origin_query: "", destination: LL },
      { origin_query: "a\u0000b", destination: LL }, { origin_query: "x".repeat(101), destination: LL },
    ]) {
      const r = await post({ ...b, costing: "auto" });
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(r.headers.get("content-type")).toBe("application/problem+json");
      expect(await r.json()).toMatchObject({ type: "about:blank", title: "Invalid request", status: 400, detail: expect.any(String) });
    }
    const long = (await (await post({ origin_query: "x".repeat(101), destination: LL, costing: "auto" })).json()) as Record<string, unknown>;
    expect(long.detail).toBe("origin_query: q must be at most 100 characters");
    expect(Object.keys(long).sort()).toEqual(["detail", "status", "title", "type"]);
    const bare = make(undefined);
    await listenLoopback(bare, 0);
    try { expect((await post({ origin_query: "Total", destination: LL, costing: "auto" }, `http://127.0.0.1:${(bare.address() as AddressInfo).port}`)).status).toBe(400); }
    finally { await new Promise<void>((r) => bare.close(() => r())); }
  });
  it("the margin is configurable", async () => {
    const tight = make(async (p) => ({ query: p.q, degraded: false, candidates: [cand("A", 5.5, -0.2, 0.8), cand("B", 5.6, -0.2, 0.75)] }), { disambiguationMargin: 0.01 });
    const loose = make(async (p) => ({ query: p.q, degraded: false, candidates: [cand("A", 5.5, -0.2, 0.8), cand("B", 5.6, -0.2, 0.75)] }), { disambiguationMargin: 0.1 });
    for (const s of [tight, loose]) await listenLoopback(s, 0);
    const u = (s: typeof tight) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      expect((await post({ origin_query: "x", destination: LL, costing: "auto" }, u(tight))).status).toBe(200);
      expect((await post({ origin_query: "x", destination: LL, costing: "auto" }, u(loose))).status).toBe(422);
    } finally { for (const s of [tight, loose]) await new Promise<void>((r) => s.close(() => r())); }
    expect(() => make(fakeGeocode, { disambiguationMargin: NaN })).toThrow(/disambiguationMargin/);
  });
});

describe("resolvePlace", () => {
  it("coordinates resolve with score 1", async () => {
    const g = createGeocoder({ db: { async query() { return { rows: [] }; } } });
    expect(await resolvePlace(g, "5.6, -0.2")).toMatchObject({ ok: true, candidate: { source: "coordinates" } });
  });
});

// Real landmarks table (read-only), Photon unavailable: names a rider might type.
loadEnv();
describe("resolvePlace on the real Accra data", () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ ...dbConfig(), max: 2 }); });
  afterAll(() => pool.end());
  const g = () => createGeocoder({ db: pool });
  it("resolves a misspelled unique landmark", async () => {
    expect(await resolvePlace(g(), "asilum down farmacy")).toMatchObject({ ok: true, candidate: { name: "Asylum Down Pharmacy" } });
  });
  it("treats the 58 identically named Total stations as ambiguous", async () => {
    expect(await resolvePlace(g(), "Total")).toMatchObject({ ok: false, reason: "ambiguous" });
  });
  it("Madina (two entries 60 m apart) resolves", async () => {
    expect(await resolvePlace(g(), "Madina")).toMatchObject({ ok: true });
  });
});
