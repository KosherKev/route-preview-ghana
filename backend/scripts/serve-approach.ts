// Usage: npm run serve   (PORT env, default 8787; binds 127.0.0.1 only)
import pg from "pg";
import { dbConfig, loadEnv } from "../src/config";
import { searchLandmarks } from "../src/geo/landmarkSearch";
import { createGeocoder } from "../src/geo/geocode";
import { photonClient } from "../src/geo/photon";
import { createApproachServer, listenLoopback } from "../src/routing/server";

loadEnv();
const pool = new pg.Pool({ ...dbConfig(), max: 4, statement_timeout: 5000 });
pool.on("error", (e) => console.error(`[pg pool] ${e.message}`));
const port = Number(process.env.PORT ?? 8787);
const server = createApproachServer({
  landmarkSearch: (p) => searchLandmarks(pool, p),
  geocode: createGeocoder({ db: pool, photon: photonClient() }),
  ...(process.env.GEOCODE_DISAMBIGUATION_MARGIN ? { disambiguationMargin: Number(process.env.GEOCODE_DISAMBIGUATION_MARGIN) } : {}),
});
server.on("close", () => void pool.end());
await listenLoopback(server, port);
console.log(`approach service on http://127.0.0.1:${port} (POST /approach, GET /geocode, GET /landmarks/search, GET /health)`);
