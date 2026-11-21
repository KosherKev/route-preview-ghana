import { describe, expect, it } from "vitest";
import { buildAxis, LocalFrame, type LatLon } from "../src/geo/local";
import type { ExtractedManeuver } from "../src/routing/approach";
import { deriveTurnEvents, loadLandmarkRows, selectLandmarks, type LandmarkRow } from "../src/preview/overlays";

const O: LatLon = { lat: 5.56, lon: -0.2 };
const f = new LocalFrame(O);
// straight 1 km route heading east from O
const axis = buildAxis([O, f.toLatLon({ x: 500, y: 0 }), f.toLatLon({ x: 1000, y: 0 })]);
const at = (x: number, y: number) => f.toLatLon({ x, y });
const lm = (id: number, name: string | null, x: number, y: number, category = "amenity"): LandmarkRow =>
  ({ osm_type: "node", osm_id: id, category, kind: "x", name, lat: at(x, y).lat, lon: at(x, y).lon });
const man = (type: number, atM: number, names: string[] = []): ExtractedManeuver =>
  ({ type, kind: type >= 26 && type <= 27 ? "roundabout" : type >= 17 && type <= 24 ? "ramp_or_fork" : type === 25 || type >= 37 ? "merge" : type >= 9 && type <= 16 ? "turn" : "other", instruction: "SECRET TEXT", streetNames: names, atM, endM: atM + 10 });

describe("deriveTurnEvents", () => {
  it("maps Valhalla maneuvers to offset, maneuver, direction and drops start/destination/continue", () => {
    const ev = deriveTurnEvents([man(1, 0), man(15, 300, ["Oxford St"]), man(10, 700), man(26, 900), man(8, 920), man(4, 1000)], 0, 1000, 1000);
    expect(ev.map((e) => [e.offsetM, e.maneuver, e.direction])).toEqual([[300, "left", "left"], [700, "right", "right"], [900, "roundabout_enter", "straight"]]);
    expect(ev[0]!.streetName).toBe("Oxford St");
    expect(ev[1]!.streetName).toBeNull();
  });
  it("only keeps events whose window overlaps the timeline, and the window is configurable and clipped to the route", () => {
    const m = [man(15, 480), man(15, 900), man(10, 1000)];
    expect(deriveTurnEvents(m, 500, 1000, 1000, 80).map((e) => e.offsetM)).toEqual([480, 900, 1000]);
    expect(deriveTurnEvents(m, 500, 1000, 1000, 10).map((e) => e.offsetM)).toEqual([900, 1000]);
    const w = deriveTurnEvents(m, 500, 1000, 1000, 200).at(-1)!.window;
    expect(w).toEqual({ startM: 900, endM: 1000 });
    expect(() => deriveTurnEvents(m, 0, 1, 1000, 0)).toThrow(RangeError);
  });
  it("never carries instruction text", () => {
    expect(JSON.stringify(deriveTurnEvents([man(15, 300)], 0, 1000, 1000))).not.toContain("SECRET TEXT");
  });
});

describe("selectLandmarks", () => {
  it("computes offset and side of travel (left is north when heading east) and enforces the 40 m default", () => {
    const out = selectLandmarks(axis, [lm(1, "Shell", 200, 15), lm(2, "Total", 400, -10), lm(3, "Too far", 600, 41), lm(4, "Edge", 650, 39.5)], 0, 1000);
    expect(out.map((c) => [c.name, c.side, Math.round(c.offsetM)])).toEqual([["Shell", "left", 200], ["Total", "right", 400], ["Edge", "left", 650]]);
    expect(out[0]!.distanceM).toBeCloseTo(15, 0);
  });
  it("drops unnamed, out-of-range and past-the-end landmarks", () => {
    const out = selectLandmarks(axis, [lm(1, null, 100, 5), lm(2, "  ", 100, 5), lm(3, "Before", 50, 5), lm(4, "Past end", 1030, 0), lm(5, "In", 500, 5)], 100, 1000);
    expect(out.map((c) => c.name)).toEqual(["In"]);
  });
  it("de-duplicates the same name close together (keeps the nearest) and the same osm object across categories", () => {
    const out = selectLandmarks(axis, [lm(1, "Madina Station", 300, 30, "tro_tro_stop"), lm(2, "madina  station", 340, 5, "tro_tro_stop"), lm(3, "Madina Station", 700, 8, "tro_tro_stop"), lm(4, "Shell", 100, 3, "fuel"), lm(4, "Shell", 100, 3, "amenity")], 0, 1000);
    expect(out.map((c) => [c.name, Math.round(c.offsetM)])).toEqual([["Shell", 100], ["madina  station", 340], ["Madina Station", 700]]);
  });
  it("caps density per 100 m (closest win) and is configurable", () => {
    const rows = [lm(1, "A", 110, 30), lm(2, "B", 120, 20), lm(3, "C", 130, 10), lm(4, "D", 140, 5), lm(5, "E", 250, 5)];
    expect(selectLandmarks(axis, rows, 0, 1000).map((c) => c.name)).toEqual(["B", "C", "D", "E"]);
    expect(selectLandmarks(axis, rows, 0, 1000, { maxPer100m: 1 }).map((c) => c.name)).toEqual(["D", "E"]);
    expect(selectLandmarks(axis, rows, 0, 1000, { maxDistanceM: 12, maxPer100m: 5 }).map((c) => c.name)).toEqual(["C", "D", "E"]);
  });
  it("is ordered by offset and deterministic; rejects bad options", () => {
    const rows = [lm(9, "Z", 900, 1), lm(1, "A", 10, 1), lm(5, "M", 500, 1)];
    expect(selectLandmarks(axis, rows, 0, 1000)).toEqual(selectLandmarks(axis, [...rows].reverse(), 0, 1000));
    expect(selectLandmarks(axis, rows, 0, 1000).map((c) => c.name)).toEqual(["A", "M", "Z"]);
    expect(() => selectLandmarks(axis, rows, 0, 1000, { maxPer100m: 0 })).toThrow(RangeError);
  });
});

describe("loadLandmarkRows", () => {
  it("issues one parameterised read-only query with lon-lat WKT", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const rows = await loadLandmarkRows({ query: (async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rows: [{ osm_type: "node", osm_id: "7", category: "fuel", kind: "fuel", name: "Shell", lat: "5.5", lon: "-0.2" }] }; }) as never }, axis, 100, 400);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/^\s*SELECT/);
    expect(calls[0]!.sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
    expect(String(calls[0]!.params[0])).toMatch(/^LINESTRING\(-0\.\d+ 5\.5\d+,/);
    expect(rows).toEqual([{ osm_type: "node", osm_id: "7", category: "fuel", kind: "fuel", name: "Shell", lat: 5.5, lon: -0.2 }]);
  });
});
