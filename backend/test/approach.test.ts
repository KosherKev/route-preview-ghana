import { describe, expect, it } from "vitest";
import { assembleApproach, buildEdges, extractApproach, maneuverKind, type ExtractedEdge, type ExtractedManeuver } from "../src/routing/approach";
import { buildAxis, haversineM, LocalFrame, type LatLon } from "../src/geo/local";
import { decodePolyline6 } from "../src/routing/valhalla";
import { encodePolyline6 } from "../src/routing/polyline";

const frame = new LocalFrame({ lat: 5.6, lon: -0.2 });
const pt = (x: number, y: number): LatLon => frame.toLatLon({ x, y });
const O = pt(0, 0), D = pt(0, 2000);

/** Straight 2 km north route, a vertex every 100 m, edge every 250 m. */
function fakeValhalla(opts: { failExcludeUnpaved?: boolean; routeLenM?: number; tracedShape?: string | null } = {}) {
  const len = opts.routeLenM ?? 2000;
  const verts: [number, number][] = [];
  for (let m = 0; m <= len; m += 100) { const p = pt(0, m); verts.push([p.lat, p.lon]); }
  if (len % 100) { const p = pt(0, len); verts.push([p.lat, p.lon]); }
  const shape = encodePolyline6(verts);
  const calls: { path: string; body: any }[] = [];
  const impl = (async (url: string, init: { body: string }) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (path === "/route") {
      if (opts.failExcludeUnpaved && body.costing_options?.auto?.exclude_unpaved === true) {
        return json({ error_code: 442, error: "No path could be found for input", status_code: 400 }, 400);
      }
      return json({ trip: { summary: { length: len / 1000, time: 100 }, legs: [{ shape, maneuvers: [
        { type: 1, instruction: "Drive north.", begin_shape_index: 0, end_shape_index: 5, street_names: ["A"] },
        { type: 15, instruction: "Turn left onto B.", begin_shape_index: 5, end_shape_index: 10 },
        { type: 26, instruction: "Enter the roundabout.", begin_shape_index: 10, end_shape_index: 12 },
        { type: 25, instruction: "Merge.", begin_shape_index: 12, end_shape_index: 14 },
        { type: 4, instruction: "Arrive.", begin_shape_index: 14, end_shape_index: verts.length - 1 },
      ] }] } });
    }
    if (path === "/trace_attributes") {
      const edges = [];
      const last = verts.length - 1;
      for (let b = 0, id = 100; b < last; b += 2, id++) edges.push({ id, way_id: id, begin_shape_index: b, end_shape_index: Math.min(b + 2, last), road_class: "primary", surface: "paved_smooth", bridge: false, tunnel: false, names: ["N"] });
      return json({ shape: opts.tracedShape === undefined ? shape : opts.tracedShape ?? undefined, edges });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("extractApproach (mocked Valhalla)", () => {
  it("returns a 500 m approach measured along the route, edge ids, maneuvers and decision windows", async () => {
    const { impl } = fakeValhalla();
    const r = await extractApproach("motor_scooter", O, D, { fetchImpl: impl, valhallaUrl: "http://v" });
    expect(r.unpaved_fallback).toBe(false);
    expect(r.approach.lengthM).toBeCloseTo(500, 1);
    expect(r.approach.wholeRoute).toBe(false);
    expect(r.approach.startM).toBeCloseTo(r.route.lengthM - 500, 1);
    const pts = decodePolyline6(r.approach.polyline6);
    expect(haversineM({ lat: pts[0]![0], lon: pts[0]![1] }, pt(0, 1500))).toBeLessThan(0.5);
    expect(haversineM({ lat: pts.at(-1)![0], lon: pts.at(-1)![1] }, D)).toBeLessThan(0.5);
    expect(r.edges.length).toBe(10);
    expect(r.approach.edgeIds).toEqual([107, 108, 109]);
    expect(r.approach.edges[0]!.startM).toBeCloseTo(1500, 1);
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["other", "turn", "roundabout", "merge", "other"]);
    expect(r.decisionWindows.map((w) => w.kind)).toEqual(["turn", "roundabout", "merge"]);
    for (const w of r.decisionWindows) expect(w.endM - w.startM).toBeLessThanOrEqual(80 + 1e-6);
  });

  it("fails loudly when trace_attributes returns a different shape (or none) than the route", async () => {
    const other = encodePolyline6([[5.6, -0.2], [5.601, -0.2], [5.602, -0.2]]); // 3 points vs the route's 21
    await expect(extractApproach("auto", O, D, { fetchImpl: fakeValhalla({ tracedShape: other }).impl, valhallaUrl: "http://v" }))
      .rejects.toThrow(/differs from the route shape \(route 21 points, matched 3 points\)/);
    await expect(extractApproach("auto", O, D, { fetchImpl: fakeValhalla({ tracedShape: null }).impl, valhallaUrl: "http://v" }))
      .rejects.toThrow(/returned no shape/);
    await expect(extractApproach("auto", O, D, { fetchImpl: fakeValhalla({ tracedShape: "\u0001" }).impl, valhallaUrl: "http://v" }))
      .rejects.toThrow(/differs from the route shape/);
  });

  it("honours configurable approach length and window size; a short route returns the whole route", async () => {
    const { impl } = fakeValhalla({ routeLenM: 800 });
    const r = await extractApproach("motor_scooter", O, pt(0, 800), { fetchImpl: impl, valhallaUrl: "http://v", approachLengthM: 1000, decisionWindowM: 40 });
    expect(r.approach.wholeRoute).toBe(true);
    expect(r.approach.lengthM).toBeCloseTo(800, 1);
    expect(r.approach.startM).toBe(0);
    expect(r.decisionWindows[0]!.endM - r.decisionWindows[0]!.startM).toBeCloseTo(40, 6);
    const long = await extractApproach("motor_scooter", O, D, { fetchImpl: fakeValhalla().impl, valhallaUrl: "http://v", approachLengthM: 1000 });
    expect(long.approach.lengthM).toBeCloseTo(1000, 1);
  });

  it("auto: no route with exclude_unpaved -> retries without it, unpaved_fallback true, loudly (warning + warn callback)", async () => {
    const { impl, calls } = fakeValhalla({ failExcludeUnpaved: true });
    const warned: string[] = [];
    const r = await extractApproach("auto", O, D, { fetchImpl: impl, valhallaUrl: "http://v", warn: (m) => warned.push(m) });
    expect(r.unpaved_fallback).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(warned).toEqual(r.warnings);
    expect(r.warnings[0]).toMatch(/exclude_unpaved/);
    const routes = calls.filter((c) => c.path === "/route").map((c) => c.body.costing_options.auto.exclude_unpaved);
    expect(routes).toEqual([true, false]);
    // trace_attributes must use the same relaxed costing as the route it matches
    expect(calls.find((c) => c.path === "/trace_attributes")!.body.costing_options.auto.exclude_unpaved).toBe(false);
  });

  it("auto without failure: no fallback, no warnings; scooter never retries", async () => {
    const clean = await extractApproach("auto", O, D, { fetchImpl: fakeValhalla().impl, valhallaUrl: "http://v" });
    expect(clean.unpaved_fallback).toBe(false);
    expect(clean.warnings).toEqual([]);
    const sc = fakeValhalla({ failExcludeUnpaved: true });
    // scooter requests carry no exclude_unpaved, so the helper never fails them
    expect((await extractApproach("motor_scooter", O, D, { fetchImpl: sc.impl, valhallaUrl: "http://v" })).unpaved_fallback).toBe(false);
  });

  it("does not hide other failures: a non-442 error and a failing retry both propagate", async () => {
    const boom = (async () => new Response(JSON.stringify({ error_code: 171, error: "bad" }), { status: 400 })) as unknown as typeof fetch;
    await expect(extractApproach("auto", O, D, { fetchImpl: boom, valhallaUrl: "http://v", warn: () => {} })).rejects.toThrow(/HTTP 400/);
    const always442 = (async () => new Response(JSON.stringify({ error_code: 442 }), { status: 400 })) as unknown as typeof fetch;
    await expect(extractApproach("auto", O, D, { fetchImpl: always442, valhallaUrl: "http://v", warn: () => {} })).rejects.toThrow(/HTTP 400/);
    await expect(extractApproach("motor_scooter", O, D, { fetchImpl: always442, valhallaUrl: "http://v" })).rejects.toThrow(/HTTP 400/);
  });
});

describe("assembleApproach / buildEdges / maneuverKind", () => {
  const axis = buildAxis([pt(0, 0), pt(0, 1000)]);
  const edges: ExtractedEdge[] = [0, 400, 800].map((s, i) => ({ id: i + 1, bridge: false, tunnel: false, names: [], startM: s, endM: Math.min(s + 400, 1000) }));
  it("clips edges to the approach window and windows to the route", () => {
    const m: ExtractedManeuver = { type: 15, kind: "turn", instruction: "", streetNames: [], atM: 10, endM: 20 };
    const a = assembleApproach(axis, edges, [m], 500, 80);
    expect(a.startM).toBeCloseTo(axis.lengthM - 500, 6);
    expect(a.edgeIds).toEqual([2, 3]);
    expect(a.edges[0]!.startM).toBeCloseTo(axis.lengthM - 500, 6);
    expect(a.windows[0]).toMatchObject({ startM: 0, edgeIds: [1] });
    expect(a.windows[0]!.endM).toBeCloseTo(50, 6);
  });
  it("rejects bad inputs and shape indices outside the route", () => {
    expect(() => assembleApproach(axis, edges, [], 0, 80)).toThrow();
    expect(() => assembleApproach(axis, edges, [], 500, -1)).toThrow();
    expect(() => buildEdges([{ id: 1, begin_shape_index: 0, end_shape_index: 9 }], axis)).toThrow(/outside/);
  });
  it("classifies Valhalla maneuver types", () => {
    expect([10, 15, 12, 26, 27, 25, 37, 38, 19, 21, 1, 4, 8].map(maneuverKind)).toEqual(
      ["turn", "turn", "turn", "roundabout", "roundabout", "merge", "merge", "merge", "ramp_or_fork", "ramp_or_fork", "other", "other", "other"]);
  });
});
