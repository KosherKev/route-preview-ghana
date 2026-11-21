// Usage: npm run serve   (PORT env, default 8787; binds 127.0.0.1 only)
import path from "node:path";
import pg from "pg";
import { dbConfig, loadApiEnv } from "../src/config";
import { searchLandmarks } from "../src/geo/landmarkSearch";
import { createGeocoder } from "../src/geo/geocode";
import { photonClient } from "../src/geo/photon";
import { createApproachServer, listenLoopback } from "../src/routing/server";
import { createPreviewBuilder } from "../src/preview/build";
import { createBundler, DEFAULT_BUNDLE_MAX_BYTES, DEFAULT_BUNDLE_TTL_DAYS } from "../src/preview/bundle";
import { createPgClipServing, DEFAULT_CLIPS_DIR, createPgPreviewDeps } from "../src/preview/deps";

loadApiEnv(); // API process: PROTOTYPE_CLIP_SERVING and MAPILLARY_TOKEN are removed even if .env defines them
const pool = new pg.Pool({ ...dbConfig(), max: 4, statement_timeout: 5000 });
pool.on("error", (e) => console.error(`[pg pool] ${e.message}`));
const port = Number(process.env.PORT ?? 8787);
const buildPreview = createPreviewBuilder(createPgPreviewDeps(pool));
const clipServing = createPgClipServing(pool);
const envNum = (k: string, d: number) => { const v = process.env[k]; if (v === undefined || v === "") return d; const n = Number(v); if (!(n > 0) || !Number.isFinite(n)) throw new Error(`${k} must be a positive number`); return n; };
const server = createApproachServer({
  landmarkSearch: (p) => searchLandmarks(pool, p),
  geocode: createGeocoder({ db: pool, photon: photonClient() }),
  preview: buildPreview,
  clipServing,
  bundle: createBundler(buildPreview, {
    clipsDir: DEFAULT_CLIPS_DIR, clips: clipServing, outDir: path.join(path.dirname(DEFAULT_CLIPS_DIR), "bundles"),
    maxBytes: Math.floor(envNum("BUNDLE_MAX_BYTES", DEFAULT_BUNDLE_MAX_BYTES)), ttlDays: envNum("BUNDLE_TTL_DAYS", DEFAULT_BUNDLE_TTL_DAYS),
  }),
  ...(process.env.GEOCODE_DISAMBIGUATION_MARGIN ? { disambiguationMargin: Number(process.env.GEOCODE_DISAMBIGUATION_MARGIN) } : {}),
});
server.on("close", () => void pool.end());
await listenLoopback(server, port);
console.log(`approach service on http://127.0.0.1:${port} (POST /approach, POST /preview, POST /preview/bundle, GET /geocode, GET /landmarks/search, GET /health; dev-only GET /clips/<edge>/<direction>.mp4 is ${process.env.PROTOTYPE_CLIP_SERVING === "1" ? "ON" : "off"})`);
