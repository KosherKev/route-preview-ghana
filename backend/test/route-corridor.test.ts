import { describe, expect, it } from "vitest";
import { Corridor, cellBBox, DEFAULT_CORRIDOR } from "../src/ingest/routeCorridor";

// A straight east-west line at lat 5.6007 from lon -0.2 to -0.19 (about 1.1 km).
const line = [{ lat: 5.6007, lon: -0.2 }, { lat: 5.6007, lon: -0.19 }];
const mLat = 111_320;

describe("Corridor", () => {
  it("contains points within the half-width and excludes points beyond it", () => {
    const c = new Corridor([line]);
    expect(c.contains({ lat: 5.6007, lon: -0.195 })).toBe(true);
    expect(c.contains({ lat: 5.6007 + 25 / mLat, lon: -0.195 })).toBe(true);
    expect(c.contains({ lat: 5.6007 + 35 / mLat, lon: -0.195 })).toBe(false);
    expect(c.contains({ lat: 5.62, lon: -0.195 })).toBe(false);
  });
  it("does not extend far past the ends of the line", () => {
    const c = new Corridor([line]);
    expect(c.contains({ lat: 5.6007, lon: -0.2 - 20 / (mLat * Math.cos((5.6 * Math.PI) / 180)) })).toBe(true);
    expect(c.contains({ lat: 5.6007, lon: -0.21 })).toBe(false);
  });
  it("requests only the cells the line touches, in a narrow strip", () => {
    const cells = new Corridor([line]).cellList();
    const deg = DEFAULT_CORRIDOR.cellDeg;
    // 0.01 deg of longitude spans 5 or 6 cells; lat 5.6007 +/- 40 m sits in one cell row.
    expect(cells.length).toBeGreaterThanOrEqual(5);
    expect(cells.length).toBeLessThanOrEqual(8);
    for (const [ix, iy] of cells) {
      const [w, s, e, n] = cellBBox(ix, iy, deg);
      expect(e - w).toBeCloseTo(deg, 12);
      expect(n - s).toBeCloseTo(deg, 12);
    }
  });
  it("shares cells between overlapping routes (no duplicate requests)", () => {
    const a = new Corridor([line]).cellList();
    const both = new Corridor([line, line]).cellList();
    expect(both).toEqual(a);
  });
  it("every point inside the corridor falls in a requested cell", () => {
    const c = new Corridor([line]);
    const want = new Set(c.cellList().map(([x, y]) => `${x}:${y}`));
    for (let lon = -0.2005; lon <= -0.1895; lon += 0.0003) for (let dy = -40; dy <= 40; dy += 5) {
      const p = { lat: 5.6007 + dy / mLat, lon };
      if (c.contains(p)) expect(want.has(`${Math.floor(p.lon / 0.002)}:${Math.floor(p.lat / 0.002)}`)).toBe(true);
    }
  });
  it("rejects an empty input", () => {
    expect(() => new Corridor([])).toThrow();
  });
});
