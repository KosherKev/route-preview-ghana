// Chain behaviour, exercised through the production geocoder (createGeocoder), not a test-only copy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { coordinateGeocoder, LANDMARK_MIN_SCORE } from "../src/patterns/geocodeChain";
import { createGeocoder } from "../src/geo/geocode";
import { parseSearchParams, SearchInputError, type LandmarkMatch, type Queryable } from "../src/geo/landmarkSearch";
import { isLoopbackUrl, photonClient, type PhotonClient } from "../src/geo/photon";

const db: Queryable = { async query() { return { rows: [] }; } };
const lm = (o: Partial<LandmarkMatch> = {}): LandmarkMatch => ({ name: "Circle", category: "tro_tro_stop", lat: 5.57, lon: -0.213, distance_m: null, score: 1, ...o });
const P = (q: string) => ({ q, limit: 5 });
const spyPhoton = (hit: boolean): PhotonClient & { calls: number } => {
  const o = {
    calls: 0, name: "photon-local" as const,
    async available() { return true; },
    async search() { o.calls++; return hit ? [{ name: "Zzz Place", label: "Zzz Place", lat: 5.5, lon: -0.2 }] : []; },
  };
  return o;
};
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

describe("geocode chain (production path)", () => {
  it("parses coordinate input without network", async () => {
    expect(await coordinateGeocoder().geocode("5.6037, -0.1870")).toEqual({
      answered: true, place: { lat: 5.6037, lon: -0.187, label: "5.6037, -0.1870", source: "coordinates" },
    });
  });

  it("coordinates come first: no landmark search and no Photon call", async () => {
    let searched = false;
    const photon = spyPhoton(true);
    const r = await createGeocoder({ db, photon, search: async () => { searched = true; return []; } })(P("5.6, -0.2"));
    expect(r.candidates[0]).toMatchObject({ source: "coordinates", score: 1 });
    expect(searched).toBe(false);
    expect(photon.calls).toBe(0);
  });

  it("the landmark threshold is 0.5", () => {
    expect(LANDMARK_MIN_SCORE).toBe(0.5);
  });

  it("landmark stage answers from the search and labels the place", async () => {
    const r = await createGeocoder({ db, search: async () => [lm()] })(P("circle"));
    expect(r.candidates).toEqual([{ name: "Circle", lat: 5.57, lon: -0.213, source: "landmarks", score: 1, distance_m: null }]);
  });

  it("landmarks run before Photon, which is skipped when landmarks answer", async () => {
    const photon = spyPhoton(true);
    await createGeocoder({ db, photon, search: async () => [lm()] })(P("circle"));
    expect(photon.calls).toBe(0);
  });

  it("falls through to Photon when landmarks find nothing or score too low", async () => {
    for (const rows of [[], [lm({ score: 0.45 })]]) {
      const photon = spyPhoton(true);
      const r = await createGeocoder({ db, photon, search: async () => rows })(P("zzz place"));
      expect(photon.calls).toBe(1);
      expect(r.candidates[0]).toMatchObject({ source: "photon-local" });
    }
  });

  it("a database failure is not a miss: it surfaces and Photon is not consulted", async () => {
    const photon = spyPhoton(true);
    await expect(createGeocoder({ db, photon, search: async () => { throw new Error("db down"); } })(P("circle"))).rejects.toThrow("db down");
    expect(photon.calls).toBe(0);
  });

  it("empty or over-long input is rejected by input parsing before any database access", () => {
    expect(() => parseSearchParams(new URLSearchParams({ q: "   " }))).toThrow(SearchInputError);
    expect(() => parseSearchParams(new URLSearchParams({ q: "a".repeat(101) }))).toThrow(SearchInputError);
  });

  it("refuses non-loopback providers (no public Nominatim or Photon)", () => {
    for (const u of ["https://photon.komoot.io", "https://nominatim.openstreetmap.org", "http://10.0.0.5:2322", "not a url"]) {
      expect(isLoopbackUrl(u)).toBe(false);
      expect(() => photonClient(u)).toThrow(/loopback/);
    }
    expect(isLoopbackUrl("http://127.0.0.1:2322")).toBe(true);
  });

  it("production geocoder sources contain no public geocoder hostnames", () => {
    for (const f of ["geo/geocode.ts", "geo/photon.ts", "patterns/geocodeChain.ts"]) {
      const src = readFileSync(path.join(srcDir, f), "utf8");
      expect(src, f).not.toMatch(/komoot|nominatim\.openstreetmap|https?:\/\/(?!127\.0\.0\.1|localhost)/i);
    }
  });

  it("Photon stage parses a Photon GeoJSON answer from a loopback server", async () => {
    let seen = "";
    const srv = http.createServer((req, res) => {
      seen = req.url ?? "";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ features: [{ geometry: { coordinates: [-0.2151, 5.6697] }, properties: { name: "Kwame Nkrumah Circle", district: "Kokomlemle" } }] }));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const photon = photonClient(`http://127.0.0.1:${(srv.address() as { port: number }).port}`);
      const r = await createGeocoder({ db, photon, search: async () => [] })(P("nkrumah circle"));
      expect(r.candidates[0]).toMatchObject({ name: "Kwame Nkrumah Circle, Kokomlemle", lat: 5.6697, lon: -0.2151, source: "photon-local" });
      expect(seen).toContain("q=nkrumah+circle");
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("an unreachable Photon is a failure (degraded), not a miss", async () => {
    const r = await createGeocoder({ db, photon: photonClient("http://127.0.0.1:1"), search: async () => [] })(P("x"));
    expect(r).toEqual({ query: "x", candidates: [], degraded: true });
  });
});
