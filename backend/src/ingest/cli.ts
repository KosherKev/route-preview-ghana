// Usage:
//   npm run ingest:mapillary -- --bbox minLon,minLat,maxLon,maxLat
//   npm run ingest:mapillary -- --corridor tetteh-quarshie-accra-central
// Stops with a clear message (before any network or DB access) when MAPILLARY_TOKEN is unset.
import pg from "pg";
import { dbConfig, loadEnv } from "../config";
import { CORRIDORS } from "./corridors";
import { MapillarySource, requireToken, type BBox } from "./mapillary";
import { upsertFrames } from "./store";

function parseArgs(argv: string[]): BBox {
  const get = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const corridor = get("--corridor");
  if (corridor) {
    const b = CORRIDORS[corridor];
    if (!b) throw new Error(`unknown corridor "${corridor}"; known: ${Object.keys(CORRIDORS).join(", ")}`);
    return b;
  }
  const raw = get("--bbox");
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) {
    throw new Error("usage: --bbox minLon,minLat,maxLon,maxLat | --corridor <name>");
  }
  const [w, s, e, n] = parts as [number, number, number, number];
  if (w >= e || s >= n) throw new Error("bbox must satisfy minLon < maxLon and minLat < maxLat");
  return [w, s, e, n];
}

async function main() {
  loadEnv();
  const bbox = parseArgs(process.argv.slice(2));
  const token = requireToken(); // throws before anything is requested
  const source = new MapillarySource({ token });
  const rows = await source.frameRowsInBBox(bbox);
  const client = new pg.Client(dbConfig());
  await client.connect();
  try {
    console.log(`upserted ${await upsertFrames(client, rows)} frames (source=mapillary) for bbox ${bbox.join(",")}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(String((e as Error).message ?? e));
  process.exit(e instanceof Error && e.message.startsWith("MAPILLARY_TOKEN") ? 3 : 1);
});
