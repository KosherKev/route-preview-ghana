// Usage: npm run route -- <motor_scooter|auto> <fromLat,fromLon> <toLat,toLon>
// Requests a route from the local Valhalla, then map-matches the shape to list edge ids.
import { routeWithEdges, type Costing, type LatLon } from "../src/routing/valhalla";

const [costing, a, b] = process.argv.slice(2);
if ((costing !== "motor_scooter" && costing !== "auto") || !a || !b) {
  console.error("usage: npm run route -- <motor_scooter|auto> <lat,lon> <lat,lon>");
  process.exit(2);
}
const pt = (s: string): LatLon => {
  const [lat, lon] = s.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`bad point: ${s}`);
  return { lat: lat!, lon: lon! };
};
const base = process.env.VALHALLA_URL ?? "http://127.0.0.1:8002";
const r = await routeWithEdges(base, costing as Costing, pt(a), pt(b));
console.log(`costing=${r.costing} distance_km=${r.distanceKm} time_s=${r.timeSec} edges=${r.edges.length}`);
console.log(`polyline6=${r.polyline}`);
console.log(`edge_ids=${r.edges.map((e) => e.id).join(",")}`);
for (const e of r.edges.slice(0, 5)) console.log(`  edge ${e.id} way ${e.wayId} ${e.lengthKm}km ${e.surface} ${e.names?.join("/") ?? ""}`);
