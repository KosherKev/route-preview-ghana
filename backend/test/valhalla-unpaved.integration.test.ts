// Optional integration test against the LOCAL Valhalla (127.0.0.1:8002); skips cleanly when it is not reachable.
// Documents the unpaved-handling experiment (numbers also in backend/README.md).
import { describe, expect, it } from "vitest";
import { decodePolyline6, edgesFromTraceAttributes, postJson, routeRequest, traceAttributesRequest, type Costing } from "../src/routing/valhalla";

const BASE = process.env.VALHALLA_URL ?? "http://127.0.0.1:8002";
const reachable = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

// Accra pair where a 1.07 km dirt shortcut exists (Tetteh Quarshie / Accra Central corridor).
const A = { lat: 5.6175320078618824, lon: -0.21186577833956108 };
const B = { lat: 5.609746622233652, lon: -0.22379657014273108 };

async function surfaceKm(costing: Costing, excludeUnpaved: boolean | undefined) {
  const req = routeRequest(costing, A, B);
  if (costing === "auto") req.costing_options = { auto: { exclude_unpaved: excludeUnpaved ?? false } };
  const route = await postJson(BASE, "/route", req);
  const shape = decodePolyline6(route.trip.legs[0].shape);
  const tr = traceAttributesRequest(costing, shape);
  if (costing === "auto") tr.costing_options = req.costing_options;
  const edges = edgesFromTraceAttributes(await postJson(BASE, "/trace_attributes", tr));
  let paved = 0, unpaved = 0;
  for (const e of edges) (e.surface?.startsWith("paved") ? (paved += e.lengthKm ?? 0) : (unpaved += e.lengthKm ?? 0));
  return { totalKm: route.trip.summary.length as number, paved, unpaved };
}

describe.skipIf(!reachable)("unpaved handling (live local Valhalla)", () => {
  it("auto exclude_unpaved changes the route; motor_scooter's built-in penalty also avoids the dirt", async () => {
    const excl = await surfaceKm("auto", true);
    const plain = await surfaceKm("auto", false);
    const scooter = await surfaceKm("motor_scooter", undefined);
    expect(excl.unpaved).toBeLessThan(0.01);
    expect(plain.unpaved).toBeGreaterThan(0.5);
    expect(plain.totalKm).toBeLessThan(excl.totalKm);
    expect(scooter.unpaved).toBeLessThan(plain.unpaved / 5);
  });
});
