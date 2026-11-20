// Valhalla 3.9.3 client helpers: request building, polyline6 decoding and edge-id extraction.
// Costing options here are the ones the pinned version supports (see backend/README.md).

export type Costing = "motor_scooter" | "auto";
export type LatLon = { lat: number; lon: number };

/**
 * motor_scooter: 3.9.3 has no unpaved option. Its costing already multiplies speed by a surface factor
 * (compacted 0.6, dirt 0.1) and refuses gravel/path/impassable, so unpaved roads are penalised built in.
 * Only documented scooter options are sent.
 * auto: `exclude_unpaved` keeps unpaved edges out of the middle of a route (start/end may be unpaved).
 */
export const COSTING_OPTIONS: Record<Costing, Record<string, number | boolean>> = {
  motor_scooter: { top_speed: 45 },
  auto: { exclude_unpaved: true },
};

/** Costing options for a request; `excludeUnpaved` overrides the `auto` default (used by the Phase 3 fallback). */
export function costingOptionsFor(costing: Costing, excludeUnpaved?: boolean): Record<string, number | boolean> {
  if (costing === "auto" && excludeUnpaved !== undefined) return { exclude_unpaved: excludeUnpaved };
  return COSTING_OPTIONS[costing];
}

export function routeRequest(costing: Costing, from: LatLon, to: LatLon, excludeUnpaved?: boolean) {
  return {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing,
    costing_options: { [costing]: costingOptionsFor(costing, excludeUnpaved) },
    directions_options: { units: "kilometers" },
  };
}

/** Decode a Valhalla polyline (precision 6) to [lat, lon] pairs. */
export function decodePolyline6(encoded: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lon += next();
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
}

export function traceAttributesRequest(costing: Costing, shape: [number, number][]) {
  return {
    shape: shape.map(([lat, lon]) => ({ lat, lon })),
    costing,
    costing_options: { [costing]: COSTING_OPTIONS[costing] },
    shape_match: "map_snap",
    filters: {
      attributes: ["edge.id", "edge.way_id", "edge.length", "edge.surface", "edge.names"],
      action: "include",
    },
  };
}

export interface RouteEdge { id: number; wayId?: number; lengthKm?: number; surface?: string; names?: string[] }

export function edgesFromTraceAttributes(resp: { edges?: Record<string, unknown>[] }): RouteEdge[] {
  return (resp.edges ?? []).map((e) => ({
    id: e.id as number,
    wayId: e.way_id as number | undefined,
    lengthKm: e.length as number | undefined,
    surface: e.surface as string | undefined,
    names: e.names as string[] | undefined,
  }));
}

/** Default per-request timeout for Valhalla calls. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** HTTP-level Valhalla failure; `errorCode` is Valhalla's own code (442 = no path could be found). */
export class ValhallaError extends Error {
  constructor(message: string, readonly status: number, readonly errorCode?: number) {
    super(message);
    this.name = "ValhallaError";
  }
}

export async function postJson(
  base: string, path: string, body: unknown, fetchImpl: typeof fetch = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error(`Valhalla ${path} timed out after ${timeoutMs} ms`);
    throw new Error(`Valhalla ${path} request failed: ${name}`);
  }
  if (!res.ok) {
    const text = await res.text();
    let errorCode: number | undefined;
    try { errorCode = (JSON.parse(text) as { error_code?: number }).error_code; } catch { /* not JSON */ }
    throw new ValhallaError(`Valhalla ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, errorCode);
  }
  return (await res.json()) as any;
}

export async function routeWithEdges(
  base: string, costing: Costing, from: LatLon, to: LatLon, fetchImpl: typeof fetch = fetch, timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const route = await postJson(base, "/route", routeRequest(costing, from, to), fetchImpl, timeoutMs);
  const leg = route?.trip?.legs?.[0];
  if (!leg || typeof leg.shape !== "string") throw new Error("Valhalla /route returned no route leg (trip.legs[0] missing)");
  const polyline: string = leg.shape;
  const shape = decodePolyline6(polyline);
  const attrs = await postJson(base, "/trace_attributes", traceAttributesRequest(costing, shape), fetchImpl, timeoutMs);
  return {
    costing,
    distanceKm: route.trip.summary.length as number,
    timeSec: route.trip.summary.time as number,
    polyline,
    shapePoints: shape.length,
    edges: edgesFromTraceAttributes(attrs),
  };
}
