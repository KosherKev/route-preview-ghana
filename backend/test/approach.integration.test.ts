// Integration tests against the LOCAL Valhalla (127.0.0.1:8002); skipped cleanly when it is not reachable.
import { describe, expect, it } from "vitest";
import { extractApproach } from "../src/routing/approach";
import { postJson, routeRequest } from "../src/routing/valhalla";

const BASE = process.env.VALHALLA_URL ?? "http://127.0.0.1:8002";
const reachable = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

// Tetteh Quarshie Interchange area -> Accra Central area (same pair as the README's `npm run route` example).
const TQ = { lat: 5.6361, lon: -0.175 };
const CENTRAL = { lat: 5.5502, lon: -0.2174 };

/**
 * REAL Phase 2 failure class: `auto` + exclude_unpaved => "No path could be found" (error 442) while plain `auto` routes.
 * The Phase 2 README records only the count (4 of 60 random pairs in the tetteh-quarshie-accra-central corridor), not the
 * pairs, so this pair was found in Phase 3 by a seeded random search of that same corridor (LCG seed 12345) against the
 * live Valhalla 3.9.3. Observed: exclude_unpaved -> HTTP 400 error_code 442; plain auto -> 3.846 km.
 */
const FAILING_A = { lat: 5.60198221293278, lon: -0.2261231006379239 };
const FAILING_B = { lat: 5.578112799362279, lon: -0.2297016521100886 };

describe.skipIf(!reachable)("approach extractor (live local Valhalla)", () => {
  for (const costing of ["motor_scooter", "auto"] as const) {
    it(`${costing}: Accra pair gives edge ids and an approach of 500 +/- 25 m`, async () => {
      const r = await extractApproach(costing, TQ, CENTRAL, { valhallaUrl: BASE });
      expect(r.unpaved_fallback).toBe(false);
      expect(r.approach.lengthM).toBeGreaterThan(475);
      expect(r.approach.lengthM).toBeLessThan(525);
      expect(r.approach.edgeIds.length).toBeGreaterThan(0);
      expect(r.edges.length).toBeGreaterThan(r.approach.edgeIds.length);
      expect(r.route.lengthM).toBeGreaterThan(10_000);
      expect(r.maneuvers.length).toBeGreaterThan(5);
      expect(r.decisionWindows.length).toBeGreaterThan(0);
      for (const e of r.approach.edges) expect(Number.isInteger(e.id)).toBe(true);
    });
  }

  it("unpaved_fallback regression: the real Phase 2 failing pair fails with exclude_unpaved, is retried, and is flagged", async () => {
    await expect(postJson(BASE, "/route", routeRequest("auto", FAILING_A, FAILING_B))).rejects.toThrow(/442/);
    const warned: string[] = [];
    const r = await extractApproach("auto", FAILING_A, FAILING_B, { valhallaUrl: BASE, warn: (m) => warned.push(m) });
    expect(r.unpaved_fallback).toBe(true);
    expect(r.warnings.length).toBe(1);
    expect(warned).toEqual(r.warnings);
    expect(r.route.valhallaLengthKm).toBeCloseTo(3.846, 2);
    expect(r.approach.lengthM).toBeGreaterThan(475);
    expect(r.approach.lengthM).toBeLessThan(525);
    expect(r.approach.edgeIds.length).toBeGreaterThan(0);
    // motor_scooter refuses gravel/path surfaces outright and has no unpaved option to relax: the same pair has no scooter
    // route, and that is surfaced as an error (never a silent fallback). Observed on live Valhalla 3.9.3.
    await expect(extractApproach("motor_scooter", FAILING_A, FAILING_B, { valhallaUrl: BASE })).rejects.toThrow(/442/);
  });
});
