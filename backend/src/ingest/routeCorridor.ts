// Route-corridor geometry for the coverage audit: which small map cells a set of route polylines touches, and whether a
// point lies inside the corridor. Pure (no I/O). Cells are fixed lon/lat squares, so adjacent routes share requests.
import { LocalFrame, type LatLon } from "../geo/local";
import type { BBox } from "./mapillary";

export interface CorridorConfig {
  /** Corridor half-width in metres (an image counts when it is within this distance of a route polyline). */
  halfWidthM: number;
  /** Cell side in degrees (0.002 is about 220 m). */
  cellDeg: number;
  /** Sampling step along the polyline, metres. */
  stepM: number;
}

export const DEFAULT_CORRIDOR: CorridorConfig = { halfWidthM: 30, cellDeg: 0.002, stepM: 10 };

export const cellKey = (ix: number, iy: number) => `${ix}:${iy}`;
const cellOf = (p: LatLon, deg: number): [number, number] => [Math.floor(p.lon / deg), Math.floor(p.lat / deg)];

export function cellBBox(ix: number, iy: number, deg: number): BBox {
  return [ix * deg, iy * deg, (ix + 1) * deg, (iy + 1) * deg];
}

/** Distance in metres from p to segment a-b, planar about `frame`. */
function distToSegmentM(frame: LocalFrame, p: LatLon, a: LatLon, b: LatLon): number {
  const q = frame.toXY(p), u = frame.toXY(a), v = frame.toXY(b);
  const dx = v.x - u.x, dy = v.y - u.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - u.x) * dx + (q.y - u.y) * dy) / l2));
  return Math.hypot(q.x - (u.x + t * dx), q.y - (u.y + t * dy));
}

export class Corridor {
  private readonly cells = new Map<string, { a: LatLon; b: LatLon }[]>();
  private readonly frame: LocalFrame;

  constructor(polylines: readonly (readonly LatLon[])[], readonly cfg: CorridorConfig = DEFAULT_CORRIDOR) {
    const all = polylines.flat();
    if (all.length === 0) throw new Error("corridor needs at least one polyline point");
    this.frame = new LocalFrame(all[Math.floor(all.length / 2)]!);
    const margin = cfg.halfWidthM + cfg.stepM; // sample spacing can leave the true nearest point up to stepM away
    const mLat = 111_320;
    for (const line of polylines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]!, b = line[i + 1]!;
        const mLon = mLat * Math.cos((a.lat * Math.PI) / 180);
        const len = Math.hypot((b.lon - a.lon) * mLon, (b.lat - a.lat) * mLat);
        const n = Math.max(1, Math.ceil(len / cfg.stepM));
        for (let k = 0; k <= n; k++) {
          const p = { lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n };
          const dLat = margin / mLat, dLon = margin / mLon;
          const [x0, y0] = cellOf({ lat: p.lat - dLat, lon: p.lon - dLon }, cfg.cellDeg);
          const [x1, y1] = cellOf({ lat: p.lat + dLat, lon: p.lon + dLon }, cfg.cellDeg);
          for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
            const key = cellKey(x, y);
            const list = this.cells.get(key);
            if (!list) this.cells.set(key, [{ a, b }]);
            else if (list[list.length - 1]!.a !== a) list.push({ a, b }); // one entry per segment per cell
          }
        }
      }
    }
  }

  /** Cells (ix, iy) that need to be requested. */
  cellList(): [number, number][] {
    return [...this.cells.keys()].map((k) => k.split(":").map(Number) as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  }

  /** True when the point is within halfWidthM of a route polyline. */
  contains(p: LatLon): boolean {
    const [ix, iy] = cellOf(p, this.cfg.cellDeg);
    const segs = this.cells.get(cellKey(ix, iy));
    if (!segs) return false;
    return segs.some((s) => distToSegmentM(this.frame, p, s.a, s.b) <= this.cfg.halfWidthM);
  }
}
