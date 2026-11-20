import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGeocodeChain, coordinateGeocoder, geocodeWithFallback, httpGeocoder, isLoopbackUrl, landmarkSearchGeocoder,
} from "../src/patterns/geocodeChain";
import type { Queryable } from "../src/geo/landmarkSearch";

const fakeDb = (rows: Record<string, unknown>[]): Queryable & { calls: number } => {
  const o = { calls: 0, async query() { o.calls++; return { rows }; } };
  return o;
};
const row = { name: "Circle", category: "tro_tro_stop", lat: 5.57, lon: -0.213, distance_m: null, score: 1 };

describe("geocodeChain", () => {
  it("parses coordinate input without network", async () => {
    const out = await coordinateGeocoder().geocode("5.6037, -0.1870");
    expect(out).toEqual({
      answered: true,
      place: { lat: 5.6037, lon: -0.187, label: "5.6037, -0.1870", source: "coordinates" },
    });
  });

  it("falls through a failed provider (AbortSignal.any available)", async () => {
    const failing = httpGeocoder("down", "http://127.0.0.1:1", async () => { throw new Error("boom"); });
    const res = await geocodeWithFallback([failing, coordinateGeocoder()], "5.6, -0.2", new AbortController().signal);
    expect(res.answeredBy).toBe("coordinates");
  });

  it("landmark stage answers from the search and labels the place", async () => {
    const res = await geocodeWithFallback(buildGeocodeChain({ db: fakeDb([row]) }), "circle");
    expect(res).toEqual({ place: { lat: 5.57, lon: -0.213, label: "Circle", source: "landmarks" }, answeredBy: "landmarks" });
  });

  it("landmarks run before any self-hosted stage, which is skipped when landmarks answer", async () => {
    let called = false;
    const selfHosted = httpGeocoder("photon-local", "http://127.0.0.1:2322", async () => { called = true; return null; });
    const chain = buildGeocodeChain({ db: fakeDb([row]), selfHosted });
    expect(chain.map((g) => g.name)).toEqual(["coordinates", "landmarks", "photon-local"]);
    await geocodeWithFallback(chain, "circle");
    expect(called).toBe(false);
  });

  it("falls through to the self-hosted stage when landmarks find nothing or score too low", async () => {
    const hit = { lat: 5.5, lon: -0.2, label: "x", source: "photon-local" };
    const selfHosted = httpGeocoder("photon-local", "http://localhost:2322", async () => hit);
    for (const rows of [[], [{ ...row, score: 0.1 }]]) {
      const res = await geocodeWithFallback(buildGeocodeChain({ db: fakeDb(rows), selfHosted }), "zzz");
      expect(res.answeredBy).toBe("photon-local");
    }
  });

  it("a database failure is not cached as a miss and falls through", async () => {
    const broken: Queryable = { async query() { throw new Error("db down"); } };
    expect(await landmarkSearchGeocoder(broken).geocode("circle")).toEqual({ answered: false });
  });

  it("does not hit the database for empty or over-long input", async () => {
    const db = fakeDb([row]);
    const g = landmarkSearchGeocoder(db);
    expect(await g.geocode("   ")).toEqual({ answered: true, place: null });
    expect(await g.geocode("a".repeat(101))).toEqual({ answered: true, place: null });
    expect(db.calls).toBe(0);
  });

  it("refuses non-loopback HTTP providers (no public Nominatim or Photon)", () => {
    for (const u of ["https://photon.komoot.io", "https://nominatim.openstreetmap.org", "http://10.0.0.5:2322", "not a url"]) {
      expect(isLoopbackUrl(u)).toBe(false);
      expect(() => httpGeocoder("x", u, async () => null)).toThrow(/loopback/);
    }
    expect(isLoopbackUrl("http://127.0.0.1:2322")).toBe(true);
  });

  it("source contains no public geocoder hostnames", () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/patterns/geocodeChain.ts"), "utf8");
    expect(src).not.toMatch(/komoot|nominatim\.openstreetmap|https?:\/\/(?!127\.0\.0\.1|localhost)/i);
  });
});
