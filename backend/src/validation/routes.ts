// Real Accra validation pairs. All coordinates are {lat, lon} (WGS84, decimal degrees).
//
// How the three named places were located (queried against the local data, not assumed):
//  - Tetteh Quarshie Interchange: `landmarks` row osm node 493773904 (category junction, kind motorway_junction, name
//    "Tetteh Quarshie Interchange") at 5.623259, -0.175523. The table holds 4 such nodes (ramps); this one is the middle one.
//  - Kwame Nkrumah Interchange ("Kwame Nkrumah Circle" in OSM): the landmarks table has NO row with that name, so it was
//    located from Valhalla. Routes through central Accra were scanned for roundabout maneuvers; the maneuvers "Enter Kwame
//    Nkrumah Circle ..." occur at 5.56933..5.56977, -0.21568..-0.21504. Centre used: 5.5696, -0.2152.
//  - Danquah Circle: same method (maneuvers "Enter Danquah Circle ..." at 5.56688..5.56696, -0.18117..-0.18062).
//    Centre used: 5.5670, -0.1809.
// Valhalla snaps each point to the nearest drivable edge; routes that pass within NEAR_NAMED_M of a named place are flagged
// "through", and those that start or end at it "ends at".
import type { LatLon } from "../geo/local";

export const NAMED_POINTS = {
  kwameNkrumahInterchange: { name: "Kwame Nkrumah Interchange (Circle)", at: { lat: 5.5696, lon: -0.2152 } },
  tettehQuarshieInterchange: { name: "Tetteh Quarshie Interchange", at: { lat: 5.623259, lon: -0.175523 } },
  danquahCircle: { name: "Danquah Circle", at: { lat: 5.567, lon: -0.1809 } },
} as const satisfies Record<string, { name: string; at: LatLon }>;

export type NamedKey = keyof typeof NAMED_POINTS;
export const NEAR_NAMED_M = 150;

const KN = NAMED_POINTS.kwameNkrumahInterchange.at;
const TQ = NAMED_POINTS.tettehQuarshieInterchange.at;
const DQ = NAMED_POINTS.danquahCircle.at;

/** Approximate area centres (rounded to 4 dp, about 10 m). They are snapped to the road network by Valhalla. */
const P = {
  accraCentral: { lat: 5.5502, lon: -0.2174 },
  airport: { lat: 5.6052, lon: -0.1668 },
  achimota: { lat: 5.615, lon: -0.233 },
  osu: { lat: 5.5541, lon: -0.1836 },
  legon: { lat: 5.6508, lon: -0.187 },
  madina: { lat: 5.6683, lon: -0.1665 },
  dzorwulu: { lat: 5.602, lon: -0.195 },
  kaneshie: { lat: 5.56, lon: -0.237 },
  labone: { lat: 5.564, lon: -0.172 },
  ridge: { lat: 5.56, lon: -0.198 },
  eastLegon: { lat: 5.635, lon: -0.155 },
  spintex: { lat: 5.635, lon: -0.105 },
  adabraka: { lat: 5.563, lon: -0.209 },
  abeka: { lat: 5.5995, lon: -0.2285 },
} satisfies Record<string, LatLon>;

export interface RoutePair { id: string; label: string; origin: LatLon; destination: LatLon }

const pair = (id: string, label: string, origin: LatLon, destination: LatLon): RoutePair => ({ id, label, origin, destination });

export const ROUTE_PAIRS: RoutePair[] = [
  pair("r01", "Accra Central -> Tetteh Quarshie Interchange", P.accraCentral, TQ),
  pair("r02", "Tetteh Quarshie Interchange -> Accra Central", TQ, P.accraCentral),
  pair("r03", "Kwame Nkrumah Interchange -> Airport", KN, P.airport),
  pair("r04", "Achimota -> Kwame Nkrumah Interchange", P.achimota, KN),
  pair("r05", "Kwame Nkrumah Interchange -> Danquah Circle", KN, DQ),
  pair("r06", "Danquah Circle -> Airport", DQ, P.airport),
  pair("r07", "Osu -> Danquah Circle", P.osu, DQ),
  pair("r08", "Legon -> Tetteh Quarshie Interchange", P.legon, TQ),
  pair("r09", "Madina -> Kwame Nkrumah Interchange", P.madina, KN),
  pair("r10", "Dzorwulu -> Tetteh Quarshie Interchange", P.dzorwulu, TQ),
  pair("r11", "Kaneshie -> Kwame Nkrumah Interchange", P.kaneshie, KN),
  pair("r12", "Labone -> Danquah Circle", P.labone, DQ),
  pair("r13", "Ridge -> Kwame Nkrumah Interchange", P.ridge, KN),
  pair("r14", "Danquah Circle -> Madina", DQ, P.madina),
  pair("r15", "Achimota -> Osu", P.achimota, P.osu),
  pair("r16", "Accra Central -> Madina", P.accraCentral, P.madina),
  pair("r17", "East Legon -> Kwame Nkrumah Interchange", P.eastLegon, KN),
  pair("r18", "Tetteh Quarshie Interchange -> Osu", TQ, P.osu),
  pair("r19", "Airport -> Accra Central", P.airport, P.accraCentral),
  pair("r20", "Spintex -> Danquah Circle", P.spintex, DQ),
  pair("r21", "Kaneshie -> Tetteh Quarshie Interchange", P.kaneshie, TQ),
  pair("r22", "Legon -> Danquah Circle", P.legon, DQ),
  pair("r23", "East Legon -> Accra Central", P.eastLegon, P.accraCentral),
  pair("r24", "Abeka -> Adabraka (through Kwame Nkrumah Interchange area)", P.abeka, P.adabraka),
  // the real Phase 2 failure class (auto + exclude_unpaved => no path); see test/approach.integration.test.ts
  pair("r25", "Phase 2 failing pair (corridor tetteh-quarshie-accra-central)", { lat: 5.60198221293278, lon: -0.2261231006379239 }, { lat: 5.578112799362279, lon: -0.2297016521100886 }),
];
