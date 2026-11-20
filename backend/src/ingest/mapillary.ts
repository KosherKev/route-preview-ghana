// Mapillary Graph API v4 implementation of the StreetImagerySource interface.
// The token is read by the caller from MAPILLARY_TOKEN and sent only as an Authorization header;
// it is never put in a URL, an error message or a log line.
import { assertSourceEnabled } from "../imagery/sources";
import type { ImageFrame, StreetImagerySource } from "../patterns/imagerySource";

export type BBox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];

export const FRAME_FIELDS = [
  "id", "sequence", "computed_geometry", "geometry", "computed_compass_angle", "compass_angle",
  "captured_at", "is_pano", "camera_type", "width", "height", "quality_score", "creator",
] as const;

/** Raw v4 image record (only the fields we request). */
export interface MapillaryImage {
  id: string;
  sequence?: string;
  computed_geometry?: { type: "Point"; coordinates: [number, number] };
  geometry?: { type: "Point"; coordinates: [number, number] };
  computed_compass_angle?: number;
  compass_angle?: number;
  captured_at?: number | string;
  is_pano?: boolean;
  camera_type?: string;
  width?: number;
  height?: number;
  quality_score?: number;
  creator?: { id?: string; username?: string | null } | null;
  /** Not requested today (the v4 images endpoint does not report a licence); honoured if a source ever states one. */
  license?: string;
}

/** Row shape for the PostGIS `frames` table. */
export interface FrameRow {
  image_id: string;
  sequence_id: string | null;
  lon: number;
  lat: number;
  computed_compass_angle: number | null;
  is_pano: boolean;
  camera_type: string | null;
  width: number | null;
  height: number | null;
  quality_score: number | null;
  captured_at: string | null;
  source: "mapillary";
  creator: string | null;
  /** Mapillary username of the contributor (null when the API did not return one). */
  creator_username: string | null;
  /** Link back to the Mapillary image page (see mapillaryImageUrl). */
  source_url: string;
  license: string;
}

// Used ONLY when the source does not state a licence for an image (the v4 API does not). Mapillary publishes
// street-level imagery under CC BY-SA 4.0. Legal review is deferred to Phase 6.
export const DEFAULT_MAPILLARY_LICENSE = "CC-BY-SA-4.0";

/** Mapillary image page for an image id (documented in backend/README.md). */
export function mapillaryImageUrl(imageId: string): string {
  return `https://www.mapillary.com/app/?pKey=${encodeURIComponent(imageId)}`;
}

export interface MapillaryOptions {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  baseUrl?: string;
  /** Minimum gap between request starts. */
  minIntervalMs?: number;
  maxRetries?: number;
  pageLimit?: number;
  /** Largest bbox side per request, in degrees (the API caps bbox area). */
  maxBBoxSideDeg?: number;
  /** Per-request timeout (default DEFAULT_REQUEST_TIMEOUT_MS). A timeout is a retryable failure. */
  requestTimeoutMs?: number;
  /** Refuse to ingest a bbox needing more tiles (requests) than this (default DEFAULT_MAX_TILES). */
  maxTiles?: number;
}

/** Default per-request timeout for Mapillary calls. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Upper bound on any Retry-After we honour, so a hostile header cannot stall the process. */
export const MAX_RETRY_AFTER_MS = 60_000;
/** Default cap on tiles (one or more requests each) per ingest run; override with --max-tiles. */
export const DEFAULT_MAX_TILES = 400;

/** Reject bad bboxes: out-of-range, non-finite, min>=max, or crossing the antimeridian (unsupported). */
export function validateBBox(b: BBox): void {
  const [w, s, e, n] = b;
  if (![w, s, e, n].every(Number.isFinite)) throw new Error("bbox values must be finite numbers");
  if (w < -180 || w > 180 || e < -180 || e > 180) throw new Error("bbox longitude must be within [-180, 180]");
  if (s < -90 || s > 90 || n < -90 || n > 90) throw new Error("bbox latitude must be within [-90, 90]");
  if (w > e) {
    throw new Error("bbox crosses the antimeridian (minLon > maxLon), which is not supported; split it into two bboxes");
  }
  if (w === e) throw new Error("bbox must satisfy minLon < maxLon");
  if (s >= n) throw new Error("bbox must satisfy minLat < maxLat");
}

/** Number of tiles tileBBox would produce, without building them. */
export function countTiles(b: BBox, maxSideDeg: number): number {
  const [w, s, e, n] = b;
  return Math.max(1, Math.ceil((e - w) / maxSideDeg)) * Math.max(1, Math.ceil((n - s) / maxSideDeg));
}

export function requireToken(env: NodeJS.ProcessEnv = process.env): string {
  const t = env.MAPILLARY_TOKEN?.trim();
  if (!t) {
    throw new Error(
      "MAPILLARY_TOKEN is not set. Add it to .env (git-ignored) to run a live ingestion; nothing was requested.",
    );
  }
  return t;
}

/** Parse captured_at: epoch-ms number (0 allowed), numeric string, or ISO string. null when invalid. */
export function parseCapturedAt(cap: number | string): string | null {
  let ms: number;
  if (typeof cap === "number") ms = cap;
  else if (/^\s*-?\d+\s*$/.test(cap)) ms = Number(cap);
  else ms = Date.parse(cap);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type SkipReason = "no_geometry" | "invalid_captured_at";
export type RowResult = { row: FrameRow } | { skip: SkipReason };

/** Converts one image; never throws on bad captured_at (reason has no payload and no token). */
export function convertImage(img: MapillaryImage): RowResult {
  const g = img.computed_geometry ?? img.geometry;
  if (!g) return { skip: "no_geometry" };
  const [lon, lat] = g.coordinates;
  const cap = img.captured_at;
  let capIso: string | null = null;
  if (cap != null) {
    capIso = parseCapturedAt(cap);
    if (capIso === null) return { skip: "invalid_captured_at" };
  }
  return {
    row: {
      image_id: String(img.id),
      sequence_id: img.sequence ?? null,
      lon,
      lat,
      computed_compass_angle: img.computed_compass_angle ?? img.compass_angle ?? null,
      is_pano: img.is_pano ?? false,
      camera_type: img.camera_type ?? null,
      width: img.width ?? null,
      height: img.height ?? null,
      quality_score: img.quality_score ?? null,
      captured_at: capIso,
      source: "mapillary",
      creator: img.creator?.username ?? img.creator?.id ?? null,
      creator_username: typeof img.creator?.username === "string" && img.creator.username !== "" ? img.creator.username : null,
      source_url: mapillaryImageUrl(String(img.id)),
      license: img.license || DEFAULT_MAPILLARY_LICENSE,
    },
  };
}

export function toFrameRow(img: MapillaryImage): FrameRow | null {
  const r = convertImage(img);
  return "row" in r ? r.row : null;
}

export interface IngestRows {
  rows: FrameRow[];
  skipped: Record<SkipReason, number>;
}

/** Split a bbox into tiles no larger than maxSideDeg per side. */
export function tileBBox(b: BBox, maxSideDeg: number): BBox[] {
  const [w, s, e, n] = b;
  const nx = Math.max(1, Math.ceil((e - w) / maxSideDeg));
  const ny = Math.max(1, Math.ceil((n - s) / maxSideDeg));
  const out: BBox[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      out.push([
        w + ((e - w) * i) / nx, s + ((n - s) * j) / ny,
        w + ((e - w) * (i + 1)) / nx, s + ((n - s) * (j + 1)) / ny,
      ]);
  return out;
}

/**
 * Parse Retry-After (delta-seconds or HTTP-date) to ms, capped at MAX_RETRY_AFTER_MS.
 * Negative, NaN or unparseable values return null (caller uses its own backoff); a past date means 0.
 */
export function parseRetryAfterMs(h: string | null, now: number): number | null {
  if (!h || !h.trim()) return null;
  const secs = Number(h);
  let ms: number;
  if (Number.isFinite(secs)) {
    if (secs < 0) return null;
    ms = secs * 1000;
  } else {
    const at = Date.parse(h);
    if (Number.isNaN(at)) return null;
    ms = Math.max(0, at - now);
  }
  return Math.min(MAX_RETRY_AFTER_MS, ms);
}

export class MapillarySource implements StreetImagerySource {
  readonly id = "mapillary";
  private readonly o: Required<Omit<MapillaryOptions, "token">>;
  private readonly token: string;
  private lastStart = Number.NEGATIVE_INFINITY;

  constructor(opts: MapillaryOptions) {
    if (!opts.token) throw new Error("MapillarySource needs a token");
    this.token = opts.token;
    this.o = {
      fetchImpl: opts.fetchImpl ?? fetch,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      now: opts.now ?? Date.now,
      baseUrl: opts.baseUrl ?? "https://graph.mapillary.com",
      minIntervalMs: opts.minIntervalMs ?? 250,
      maxRetries: opts.maxRetries ?? 5,
      pageLimit: opts.pageLimit ?? 2000,
      maxBBoxSideDeg: opts.maxBBoxSideDeg ?? 0.09,
      requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxTiles: opts.maxTiles ?? DEFAULT_MAX_TILES,
    };
  }

  attribution(): string {
    return "Imagery from Mapillary contributors, CC BY-SA 4.0 (mapillary.com)";
  }

  /** Raw images inside a bbox (large boxes are tiled). */
  async imagesInBBox(bbox: BBox): Promise<MapillaryImage[]> {
    assertSourceEnabled(this.id);
    validateBBox(bbox);
    const tiles = countTiles(bbox, this.o.maxBBoxSideDeg);
    if (tiles > this.o.maxTiles) {
      throw new Error(`bbox needs ${tiles} tiles, above the limit of ${this.o.maxTiles}; use a smaller bbox or raise --max-tiles`);
    }
    const seen = new Map<string, MapillaryImage>();
    for (const tile of tileBBox(bbox, this.o.maxBBoxSideDeg)) {
      for (const img of await this.query({ bbox: tile.join(",") })) seen.set(String(img.id), img);
    }
    return [...seen.values()];
  }

  /** Raw images within radiusM metres of a point. */
  async imagesNear(lon: number, lat: number, radiusM: number): Promise<MapillaryImage[]> {
    return this.query({ closeto: `${lon},${lat}`, radius: String(radiusM) });
  }

  /** Rows plus per-reason skip counts (images without geometry or with an unparseable captured_at). */
  async frameRowsWithStats(bbox: BBox): Promise<IngestRows> {
    const out: IngestRows = { rows: [], skipped: { no_geometry: 0, invalid_captured_at: 0 } };
    for (const img of await this.imagesInBBox(bbox)) {
      const r = convertImage(img);
      if ("row" in r) out.rows.push(r.row);
      else out.skipped[r.skip]++;
    }
    return out;
  }

  async frameRowsInBBox(bbox: BBox): Promise<FrameRow[]> {
    return (await this.frameRowsWithStats(bbox)).rows;
  }

  /** StreetImagerySource: frames within bufferM of a [lat, lon] path, ordered along it. */
  async framesAlong(path: readonly (readonly [number, number])[], bufferM: number): Promise<ImageFrame[]> {
    if (path.length === 0) return [];
    const mPerDegLat = 111_320;
    const midLat = path.reduce((a, p) => a + p[0], 0) / path.length;
    const mPerDegLon = mPerDegLat * Math.cos((midLat * Math.PI) / 180);
    const dLat = bufferM / mPerDegLat, dLon = bufferM / mPerDegLon;
    const lats = path.map((p) => p[0]), lons = path.map((p) => p[1]);
    const rows = await this.frameRowsInBBox([
      Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat,
    ]);

    const xy = (lat: number, lon: number): [number, number] => [lon * mPerDegLon, lat * mPerDegLat];
    const hits: { row: FrameRow; along: number }[] = [];
    for (const row of rows) {
      const [px, py] = xy(row.lat, row.lon);
      let best = Infinity, bestAlong = 0, cum = 0;
      for (let i = 0; i < Math.max(1, path.length - 1); i++) {
        const [ax, ay] = xy(...(path[i] as [number, number]));
        const [bx, by] = xy(...((path[i + 1] ?? path[i]) as [number, number]));
        const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
        const d = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
        if (d < best) { best = d; bestAlong = cum + t * Math.sqrt(len2); }
        cum += Math.sqrt(len2);
      }
      if (best <= bufferM) hits.push({ row, along: bestAlong });
    }
    hits.sort((a, b) => a.along - b.along);
    return hits.map(({ row }) => ({
      lat: row.lat,
      lon: row.lon,
      headingDeg: row.computed_compass_angle ?? 0,
      capturedAt: row.captured_at ?? "",
      ref: `mapillary:${row.image_id}`,
    }));
  }

  private async query(params: Record<string, string>): Promise<MapillaryImage[]> {
    assertSourceEnabled(this.id); // kill switch, read at call time: no request is made when mapillary is disabled
    const url = new URL("/images", this.o.baseUrl);
    url.search = new URLSearchParams({ ...params, fields: FRAME_FIELDS.join(","), limit: String(this.o.pageLimit) }).toString();
    const out: MapillaryImage[] = [];
    let next: string | null = url.toString();
    while (next) {
      assertSourceEnabled(this.id); // re-checked before EVERY page: flipping the switch mid-paging stops follow-up pages
      const body = await this.get(next);
      out.push(...(body.data ?? []));
      next = this.sanitizeNext(body.paging?.next);
    }
    return out;
  }

  /** Only follow paging links on the API host, and never carry a token in the query string. */
  private sanitizeNext(next?: string): string | null {
    if (!next) return null;
    const u = new URL(next);
    if (u.origin !== new URL(this.o.baseUrl).origin) return null;
    u.searchParams.delete("access_token");
    return u.toString();
  }

  private async throttle() {
    const wait = this.lastStart + this.o.minIntervalMs - this.o.now();
    if (wait > 0) await this.o.sleep(wait);
    this.lastStart = this.o.now();
  }

  private async get(url: string): Promise<{ data?: MapillaryImage[]; paging?: { next?: string } }> {
    for (let attempt = 0; ; attempt++) {
      assertSourceEnabled(this.id); // and before every retry attempt, so a retry loop cannot outlive a kill
      await this.throttle();
      let res: Response;
      try {
        res = await this.o.fetchImpl(url, {
          headers: { Authorization: `OAuth ${this.token}` },
          signal: AbortSignal.timeout(this.o.requestTimeoutMs),
        });
      } catch (e) {
        if (attempt >= this.o.maxRetries) {
          const name = (e as Error).name;
          const timedOut = name === "TimeoutError" || name === "AbortError";
          throw new Error(timedOut
            ? `Mapillary request timed out after ${this.o.requestTimeoutMs} ms (${attempt + 1} attempts)`
            : `Mapillary request failed: ${name}`);
        }
        await this.o.sleep(Math.min(30_000, 1000 * 2 ** attempt));
        continue;
      }
      if (res.ok) return (await res.json()) as any;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.o.maxRetries) {
        throw new Error(`Mapillary API error: HTTP ${res.status}${retryable ? ` after ${attempt + 1} attempts` : ""}`);
      }
      const ra = parseRetryAfterMs(res.headers.get("retry-after"), this.o.now());
      await this.o.sleep(ra ?? Math.min(30_000, 1000 * 2 ** attempt));
    }
  }
}
