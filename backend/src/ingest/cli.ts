// Usage:
//   npm run ingest:mapillary -- --bbox minLon,minLat,maxLon,maxLat
//   npm run ingest:mapillary -- --corridor tetteh-quarshie-accra-central
// Add --max-tiles N to raise the per-run tile cap (default 400) for an intentionally large bbox.
// Stops with a clear message (before any network or DB access) when MAPILLARY_TOKEN is unset (exit 3), or when the
// kill switch IMAGERY_SOURCES_DISABLED lists mapillary (exit 4).
import pg from "pg";
import { dbConfig, loadEnv } from "../config";
import { assertSourceEnabled, SourceDisabledError } from "../imagery/sources";
import { CORRIDORS } from "./corridors";
import { DEFAULT_MAX_TILES, MapillarySource, requireToken, validateBBox, type BBox } from "./mapillary";
import { upsertFrames } from "./store";

function parseArgs(argv: string[]): BBox {
  const get = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const corridor = get("--corridor");
  if (corridor) {
    const b = CORRIDORS[corridor];
    if (!b) throw new Error(`unknown corridor "${corridor}"; known: ${Object.keys(CORRIDORS).join(", ")}`);
    validateBBox(b);
    return b;
  }
  const raw = get("--bbox");
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) {
    throw new Error("usage: --bbox minLon,minLat,maxLon,maxLat | --corridor <name>");
  }
  const [w, s, e, n] = parts as [number, number, number, number];
  validateBBox([w, s, e, n]); // range, min<max, antimeridian
  return [w, s, e, n];
}

function parseMaxTiles(argv: string[]): number {
  const i = argv.indexOf("--max-tiles");
  if (i < 0) return DEFAULT_MAX_TILES;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error("--max-tiles must be a positive integer");
  return n;
}

async function main() {
  loadEnv();
  assertSourceEnabled("mapillary"); // kill switch: refuse before any argument, token, network or DB work
  const bbox = parseArgs(process.argv.slice(2));
  const token = requireToken(); // throws before anything is requested
  const source = new MapillarySource({ token, maxTiles: parseMaxTiles(process.argv.slice(2)) });
  const { rows, skipped } = await source.frameRowsWithStats(bbox);
  const client = new pg.Client(dbConfig());
  await client.connect();
  try {
    console.log(`upserted ${await upsertFrames(client, rows)} frames (source=mapillary) for bbox ${bbox.join(",")}`);
    console.log(`skipped ${skipped.invalid_captured_at + skipped.no_geometry} images (invalid_captured_at=${skipped.invalid_captured_at}, no_geometry=${skipped.no_geometry})`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(String((e as Error).message ?? e));
  process.exit(e instanceof SourceDisabledError ? 4 : e instanceof Error && e.message.startsWith("MAPILLARY_TOKEN") ? 3 : 1);
});
