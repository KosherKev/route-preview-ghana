// Fuzzy landmark search over the landmarks table (pg_trgm, migration 006). Parameterised queries only.

export const MAX_QUERY_CHARS = 100;
export const MAX_LIMIT = 20;
export const DEFAULT_LIMIT = 5;

export interface SearchParams { q: string; near?: { lat: number; lon: number }; limit: number }

export interface LandmarkMatch {
  name: string; category: string; lat: number; lon: number;
  /** metres from `near`; null when `near` was not given */
  distance_m: number | null;
  /** trigram similarity 0..1 */
  score: number;
}

export interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

/** Safe to echo to the client: only ever built from our own fixed messages. */
export class SearchInputError extends Error {}

const NUM = /^-?\d+(?:\.\d+)?$/;

export function parseSearchParams(sp: URLSearchParams): SearchParams {
  const q = sp.get("q");
  if (q === null) throw new SearchInputError("q is required");
  const qt = q.trim().replace(/\s+/g, " ");
  if (qt.length === 0) throw new SearchInputError("q must not be empty");
  if ([...qt].length > MAX_QUERY_CHARS) throw new SearchInputError(`q must be at most ${MAX_QUERY_CHARS} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(qt)) throw new SearchInputError("q must not contain control characters");

  let near: SearchParams["near"];
  const nearRaw = sp.get("near");
  if (nearRaw !== null) {
    const parts = nearRaw.split(",").map((s) => s.trim());
    const lat = parts.length === 2 && NUM.test(parts[0]!) ? Number(parts[0]) : NaN;
    const lon = parts.length === 2 && NUM.test(parts[1]!) ? Number(parts[1]) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new SearchInputError("near must be 'lat,lon' with finite coordinates (lat -90..90, lon -180..180)");
    }
    near = { lat, lon };
  }

  let limit = DEFAULT_LIMIT;
  const limRaw = sp.get("limit");
  if (limRaw !== null) {
    if (!/^\d+$/.test(limRaw) || Number(limRaw) < 1 || Number(limRaw) > MAX_LIMIT) {
      throw new SearchInputError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    limit = Number(limRaw);
  }
  return { q: qt, near, limit };
}

// Match when the whole name is trigram-similar to the query (%) or the query is similar to a word run inside the name (<%).
// Rank: similarity first, then nearer first (exact similarity ties only, e.g. the 58 stations called "Total"), then name for determinism.
const SQL = `
WITH p AS (SELECT landmarks_norm($1::text) AS q),
     o AS (SELECT CASE WHEN $2::float8 IS NULL THEN NULL
                       ELSE ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography END AS g)
SELECT l.name, l.category, ST_Y(l.geom) AS lat, ST_X(l.geom) AS lon,
       CASE WHEN o.g IS NULL THEN NULL ELSE ST_Distance(l.geom::geography, o.g) END AS distance_m,
       similarity(landmarks_norm(l.name), p.q) AS score
  FROM landmarks l, p, o
 WHERE l.name IS NOT NULL
   AND (landmarks_norm(l.name) % p.q OR p.q <% landmarks_norm(l.name))
 ORDER BY score DESC, distance_m ASC NULLS LAST, l.name ASC, l.osm_id ASC
 LIMIT $4::int`;

export async function searchLandmarks(db: Queryable, p: SearchParams): Promise<LandmarkMatch[]> {
  const r = await db.query(SQL, [p.q, p.near?.lat ?? null, p.near?.lon ?? null, p.limit]);
  return r.rows.map((x) => ({
    name: String(x.name),
    category: String(x.category),
    lat: Number(x.lat),
    lon: Number(x.lon),
    distance_m: x.distance_m === null ? null : Math.round(Number(x.distance_m)),
    score: Math.round(Number(x.score) * 1000) / 1000,
  }));
}
