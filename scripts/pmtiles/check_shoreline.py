#!/usr/bin/env python3
"""Independent shoreline check: compare the sea polygon (GeoPackage written by build_sea.py) with the OSM natural=coastline ways
(extracted by osm_coast.py). OSM rule: land is on the LEFT of a coastline way's direction, water on the right.
Usage: check_shoreline.py COAST.json SEA.gpkg|V2.pmtiles [--spacing-m 500] [--offset-m 100]
With a .pmtiles file the z14 `sea` features of the tiles are used (tile-edge cuts are not counted as shoreline), i.e. the shipped artefact.
Reports offsets (distance from coastline sample points to the nearest sea polygon edge: median, p95, max, worst 5), then classifies
test points (offset left/right of the coast by --offset-m, plus named OSM nodes) with the sea polygon. Exit 1 if the fix thresholds
are hit (median > 40 m, p95 > 100 m, or any land point classified as sea)."""
import json, math, os, sqlite3, struct, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BBOX = (-0.40, 5.45, 0.05, 5.80)
K = 111320.0
COSL = math.cos(math.radians(5.6))

def xy(lon, lat): return np.stack([np.asarray(lon) * K * COSL, np.asarray(lat) * K], axis=-1)

def read_sea(path):
    b = sqlite3.connect(path).execute("select geom from sea").fetchone()[0]
    i = 8; assert b[i] == 1 and struct.unpack_from("<I", b, i + 1)[0] == 6
    n = struct.unpack_from("<I", b, i + 5)[0]; i += 9; polys = []
    for _ in range(n):
        nr = struct.unpack_from("<I", b, i + 5)[0]; i += 9; rings = []
        for _ in range(nr):
            np_ = struct.unpack_from("<I", b, i)[0]; i += 4
            rings.append(np.frombuffer(b, "<f8", np_ * 2, i).reshape(-1, 2)); i += np_ * 16
        polys.append(rings)
    return polys

class TileSea:
    """z14 `sea` features of a PMTiles file: edges (lon/lat, tile-boundary cuts excluded) and a point-in-sea test."""
    def __init__(self, path):
        from pmtiles.tile import tileid_to_zxy
        from stats import header, walk, z_of, unz, layers
        from verify_tiles import feature_geom
        b = open(path, "rb").read(); h = header(b); self.tiles = {}; ea, eb = [], []
        for tid, off, ln in walk(b, h):
            if z_of(tid) != 14: continue
            _, tx, ty = tileid_to_zxy(tid); n = 1 << 14
            for name, keys, vals, feats in layers(unz(b[off:off + ln], h["tile_compression"])):
                if name != "sea": continue
                for f in feats:
                    for r in feature_geom(f)[1]:
                        self.tiles.setdefault((tx, ty), []).append(r)
                        for (x1, y1), (x2, y2) in zip(r, r[1:]):
                            if (x1 == x2 and (x1 <= 0 or x1 >= 4096)) or (y1 == y2 and (y1 <= 0 or y1 >= 4096)): continue
                            ea.append(self.ll(tx, ty, x1, y1)); eb.append(self.ll(tx, ty, x2, y2))
        self.A = xy(*np.array(ea).T); self.B = xy(*np.array(eb).T)
    @staticmethod
    def ll(tx, ty, x, y):
        n = 1 << 14
        return ((tx + x / 4096) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + y / 4096) / n)))))
    def insea(self, lon, lat):
        n = 1 << 14; fx = (lon + 180) / 360 * n; fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        px, py = (fx - int(fx)) * 4096, (fy - int(fy)) * 4096; inside = False
        for r in self.tiles.get((int(fx), int(fy)), []):
            for (x1, y1), (x2, y2) in zip(r, r[1:]):
                if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1: inside = not inside
        return inside

class GpkgSea:
    def __init__(self, path):
        self.polys = read_sea(path); SA, SB = [], []
        for rings in self.polys:
            for r in rings:
                p = xy(r[:, 0], r[:, 1]); SA.append(p[:-1]); SB.append(p[1:])
        self.A = np.concatenate(SA); self.B = np.concatenate(SB)
    def insea(self, lon, lat): return pip(lon, lat, self.polys)

def pip(px, py, polys):
    inside = False
    for rings in polys:
        for r in rings:
            x1, y1, x2, y2 = r[:-1, 0], r[:-1, 1], r[1:, 0], r[1:, 1]
            c = ((y1 > py) != (y2 > py)) & (px < (x2 - x1) * (py - y1) / np.where(y2 == y1, 1, y2 - y1) + x1)
            if c.sum() % 2: inside = not inside
    return inside

def seg_dist(P, A, B):
    """distance from each point in P (n,2) to the nearest segment A[k]-B[k] (m,2), plus the index and signed side (cross > 0: P left of A->B)."""
    out = np.empty(len(P)); idx = np.empty(len(P), int); side = np.empty(len(P))
    d = B - A; L2 = (d ** 2).sum(1); L2[L2 == 0] = 1
    for n, p in enumerate(P):
        t = np.clip(((p - A) * d).sum(1) / L2, 0, 1)
        q = A + t[:, None] * d
        dd = np.hypot(*(p - q).T)
        k = int(np.argmin(dd)); out[n] = dd[k]; idx[n] = k
        side[n] = d[k, 0] * (p[1] - A[k, 1]) - d[k, 1] * (p[0] - A[k, 0])
    return out, idx, side

def main(coast_json, gpkg, spacing=500.0, off=100.0):
    data = json.load(open(coast_json)); sea = TileSea(gpkg) if gpkg.endswith('.pmtiles') else GpkgSea(gpkg)
    # coastline restricted to the build bbox
    cl = []
    for seg in data["coast"]:
        a = np.array(seg); m = (a[:, 0] >= BBOX[0]) & (a[:, 0] <= BBOX[2]) & (a[:, 1] >= BBOX[1]) & (a[:, 1] <= BBOX[3])
        run = []
        for p, ok in zip(a, m):
            if ok: run.append(p)
            else:
                if len(run) > 1: cl.append(np.array(run))
                run = []
        if len(run) > 1: cl.append(np.array(run))
    A = np.concatenate([xy(s[:-1, 0], s[:-1, 1]) for s in cl]); B = np.concatenate([xy(s[1:, 0], s[1:, 1]) for s in cl])
    print(f"coastline: {len(cl)} segments inside the bbox, {len(A)} edges, {np.hypot(*(B - A).T).sum() / 1000:.1f} km")
    # sample points along the coast every spacing metres
    samples = []
    for s in cl:
        p = xy(s[:, 0], s[:, 1]); d = np.hypot(*np.diff(p, axis=0).T); cum = np.concatenate([[0], np.cumsum(d)])
        for t in np.arange(0, cum[-1], spacing):
            k = min(int(np.searchsorted(cum, t, "right")) - 1, len(d) - 1)
            f = (t - cum[k]) / d[k] if d[k] else 0
            samples.append(s[k] + f * (s[k + 1] - s[k]))
    samples = np.array(samples); samples = samples[np.argsort(samples[:, 0])]
    SA, SB = sea.A, sea.B
    off_m, _, _ = seg_dist(xy(samples[:, 0], samples[:, 1]), SA, SB)
    print(f"offset samples: {len(samples)} points every {spacing:.0f} m along the coast, west to east (lon {samples[0,0]:.4f} to {samples[-1,0]:.4f})")
    med, p95, mx = float(np.median(off_m)), float(np.percentile(off_m, 95)), float(off_m.max())
    print(f"offset to the sea polygon edge (m): median {med:.1f}, p95 {p95:.1f}, max {mx:.1f}")
    print("worst 5 (lat, lon, offset m):")
    for k in np.argsort(-off_m)[:5]: print(f"  {samples[k,1]:.5f}, {samples[k,0]:.5f}  {off_m[k]:.1f}")
    # test points: offset left (land) and right (sea) of the coast; the expected class comes from the direction rule applied to the point itself
    fails = []; rows = []
    def classify(lon, lat):
        d, k, side = seg_dist(xy([lon], [lat]), A, B)
        return "land" if side[0] > 0 else "sea", float(d[0])
    pick = np.linspace(0, len(samples) - 1, 24).astype(int)
    sp = xy(samples[:, 0], samples[:, 1])
    land_n = sea_n = 0
    for k in pick:
        d, ki, _ = seg_dist(sp[k:k + 1], A, B); v = (B[ki[0]] - A[ki[0]]); v /= np.hypot(*v)
        left = np.array([-v[1], v[0]])
        for sgn, want in ((1, "land"), (-1, "sea")):
            q = sp[k] + sgn * left * off
            lon, lat = q[0] / (K * COSL), q[1] / K
            if not (BBOX[0] < lon < BBOX[2] and BBOX[1] < lat < BBOX[3]): continue
            got, _ = classify(lon, lat)
            if got != want: continue  # the rule disagrees with the intended side (e.g. a narrow spit): do not use as a test point
            if (want == "land" and land_n >= 24) or (want == "sea" and sea_n >= 24): continue
            land_n += want == "land"; sea_n += want == "sea"
            rows.append((f"coast offset {sgn * off:+.0f} m", lat, lon, want))
    for nd in data["nodes"]:
        got, d = classify(nd["lon"], nd["lat"])
        rows.append((f"OSM node {nd['id']} {nd['tags'].get('name') or nd['tags']}", nd["lat"], nd["lon"], got))
    for nm, la, lo in (("reviewer's Osu Castle point", 5.5400, -0.1845), ("reviewer's Labadi Beach Hotel point", 5.5543, -0.1578)):
        rows.append((nm, la, lo, classify(lo, la)[0]))
    print(f"test points ({len(rows)}): expected class by the OSM coastline direction rule; polygon says:")
    nl = ns = 0
    for label, lat, lon, want in rows:
        x, y = lon * K * COSL, lat * K
        insea = sea.insea(lon, lat); got = "sea" if insea else "land"
        ok = got == want; nl += want == "land"; ns += want == "sea"
        print(f"  {'PASS' if ok else 'FAIL'} {label} ({lat:.5f}, {lon:.5f}) rule={want} polygon={got}")
        if not ok: fails.append((label, lat, lon, want))
    land_as_sea = [f for f in fails if f[3] == "land"]
    print(f"{len(rows)} points ({nl} land, {ns} sea) checked, {len(fails)} failures, {len(land_as_sea)} land points classified as sea")
    trig = med > 40 or p95 > 100 or land_as_sea
    print("FIX NEEDED" if trig else "SHORELINE WITHIN THRESHOLDS")
    sys.exit(1 if trig else 0)

if __name__ == "__main__":
    a = sys.argv[1:]
    sp = float(a[a.index("--spacing-m") + 1]) if "--spacing-m" in a else 500.0
    of = float(a[a.index("--offset-m") + 1]) if "--offset-m" in a else 100.0
    main(a[0], a[1], sp, of)
