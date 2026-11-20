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

export function routeRequest(costing: Costing, from: LatLon, to: LatLon) {
  return {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing,
    costing_options: { [costing]: COSTING_OPTIONS[costing] },
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

export async function postJson(base: string, path: string, body: unknown, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Valhalla ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as any;
}

export async function routeWithEdges(base: string, costing: Costing, from: LatLon, to: LatLon, fetchImpl: typeof fetch = fetch) {
  const route = await postJson(base, "/route", routeRequest(costing, from, to), fetchImpl);
  const leg = route.trip.legs[0];
  const polyline: string = leg.shape;
  const shape = decodePolyline6(polyline);
  const attrs = await postJson(base, "/trace_attributes", traceAttributesRequest(costing, shape), fetchImpl);
  return {
    costing,
    distanceKm: route.trip.summary.length as number,
    timeSec: route.trip.summary.time as number,
    polyline,
    shapePoints: shape.length,
    edges: edgesFromTraceAttributes(attrs),
  };
}
