// Mapillary Graph API v4 implementation of the StreetImagerySource interface.
// The token is read by the caller from MAPILLARY_TOKEN and sent only as an Authorization header;
// it is never put in a URL, an error message or a log line.
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
  creator?: { id?: string; username?: string };
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
  license: string;
}

// Mapillary publishes street-level imagery under CC BY-SA 4.0. Legal review is deferred to Phase 6.
export const MAPILLARY_LICENSE = "CC-BY-SA-4.0";

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

export function toFrameRow(img: MapillaryImage): FrameRow | null {
  const g = img.computed_geometry ?? img.geometry;
  if (!g) return null;
  const [lon, lat] = g.coordinates;
  const cap = img.captured_at;
  const capIso = cap == null ? null : new Date(typeof cap === "number" ? cap : Number(cap) || cap).toISOString();
  return {
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
    license: MAPILLARY_LICENSE,
  };
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

function parseRetryAfterMs(h: string | null, now: number): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
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
    };
  }

  attribution(): string {
    return "Imagery from Mapillary contributors, CC BY-SA 4.0 (mapillary.com)";
  }

  /** Raw images inside a bbox (large boxes are tiled). */
  async imagesInBBox(bbox: BBox): Promise<MapillaryImage[]> {
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

  async frameRowsInBBox(bbox: BBox): Promise<FrameRow[]> {
    return (await this.imagesInBBox(bbox)).map(toFrameRow).filter((r): r is FrameRow => r !== null);
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
    const url = new URL("/images", this.o.baseUrl);
    url.search = new URLSearchParams({ ...params, fields: FRAME_FIELDS.join(","), limit: String(this.o.pageLimit) }).toString();
    const out: MapillaryImage[] = [];
    let next: string | null = url.toString();
    while (next) {
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
      await this.throttle();
      let res: Response;
      try {
        res = await this.o.fetchImpl(url, { headers: { Authorization: `OAuth ${this.token}` } });
      } catch (e) {
        if (attempt >= this.o.maxRetries) throw new Error(`Mapillary request failed: ${(e as Error).name}`);
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
