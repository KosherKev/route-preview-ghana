#!/usr/bin/env python3
"""Build sea polygons for the Accra tiles from the Copernicus GLO-30 DEM and write them as a GeoPackage Planetiler can read.

Method: ocean candidates are DEM cells with elevation <= 0 m or nodata. Only the candidates that are 4-connected to the open sea
(flood fill seeded from the southern edge of the crop) are kept, so inland 0 m pits and lagoons that are cut off from the sea by
land are not marked as sea. The mask is vectorised along cell edges, rings are simplified (Douglas-Peucker) and written as WKB.
Usage: build_sea.py SRC_DIR OUT.gpkg [--tolerance-m 40]        (deterministic: same inputs give the same bytes)
"""
import glob, math, os, sqlite3, struct, sys, time
import numpy as np
import tifffile

# build-accra.sh bounds: lon_min,lat_min,lon_max,lat_max. The crop is wider so the sea does not end inside a border tile.
BBOX = (-0.40, 5.45, 0.05, 5.80)
CROP = (-0.90, 5.00, 0.55, 6.00)  # lon_min, lat_min, lon_max, lat_max (the DEM cells cover lon -1..1, lat 5..6)


def load_mosaic(src):
    cells = []
    for p in sorted(glob.glob(os.path.join(src, "*.tif"))):
        with tifffile.TiffFile(p) as t:
            pg = t.pages[0]
            dx, dy = pg.tags["ModelPixelScaleTag"].value[:2]
            lon0, lat0 = pg.tags["ModelTiepointTag"].value[3:5]
            cells.append((lon0, lat0, dx, dy, pg.asarray().astype(np.float32)))
    cells.sort(key=lambda c: c[0])
    lon0, lat0, dx, dy = cells[0][:4]
    for a, b in zip(cells, cells[1:]):
        assert abs(a[0] + a[4].shape[1] * a[2] - b[0]) < 1e-9, "cells must be contiguous"
        assert a[1] == lat0 and a[2] == dx and a[3] == dy
    return lon0, lat0, dx, dy, np.concatenate([c[4] for c in cells], axis=1)


def flood(cand, seeds):
    """4-connected flood fill of cand from seeds (iterative frontier dilation, no scipy)."""
    reached = seeds & cand
    frontier = reached.copy()
    while frontier.any():
        n = np.zeros_like(frontier)
        n[1:] |= frontier[:-1]; n[:-1] |= frontier[1:]; n[:, 1:] |= frontier[:, :-1]; n[:, :-1] |= frontier[:, 1:]
        frontier = n & cand & ~reached
        reached |= frontier
    return reached


def boundary_edges(m):
    """Directed cell-edge segments with the sea on the right (y down). Returns {start: [end, ...]}."""
    p = np.pad(m, 1, constant_values=False)
    c = p[1:-1, 1:-1]
    edges = {}
    def add(mask, f):
        for r, cc in zip(*np.nonzero(mask)):
            a, b = f(int(cc), int(r))
            edges.setdefault(a, []).append(b)
    add(c & ~p[:-2, 1:-1], lambda x, y: ((x, y), (x + 1, y)))          # top neighbour is land: go east
    add(c & ~p[1:-1, 2:], lambda x, y: ((x + 1, y), (x + 1, y + 1)))   # right neighbour is land: go south
    add(c & ~p[2:, 1:-1], lambda x, y: ((x + 1, y + 1), (x, y + 1)))   # bottom neighbour is land: go west
    add(c & ~p[1:-1, :-2], lambda x, y: ((x, y + 1), (x, y)))          # left neighbour is land: go north
    return edges


def trace_rings(edges):
    rings = []
    # deterministic order: start from the smallest remaining vertex
    for start in sorted(edges):
        while edges.get(start):
            ring = [start]
            cur, prev = edges[start].pop(), start
            while True:
                ring.append(cur)
                if cur == start:
                    break
                outs = edges[cur]
                if len(outs) > 1:  # checkerboard vertex: turn right so diagonal sea cells stay separate (4-connected)
                    d = (cur[0] - prev[0], cur[1] - prev[1])
                    def turn(o):
                        e = (o[0] - cur[0], o[1] - cur[1])
                        return d[0] * e[1] - d[1] * e[0]  # y down: positive cross = right turn
                    outs.sort(key=turn)
                prev, cur = cur, outs.pop()
            rings.append(ring)
    return rings


def dp(pts, eps):
    """Douglas-Peucker on an open polyline (numpy Nx2), iterative; returns kept indices."""
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        seg = b - a
        L = math.hypot(*seg)
        q = pts[i + 1:j] - a
        d = np.hypot(q[:, 0], q[:, 1]) if L == 0 else np.abs(seg[0] * q[:, 1] - seg[1] * q[:, 0]) / L
        k = int(np.argmax(d))
        if d[k] > eps:
            k += i + 1
            keep[k] = True
            stack.append((i, k)); stack.append((k, j))
    return np.nonzero(keep)[0]


def simplify_ring(ring, eps):
    pts = np.array(ring[:-1], float)
    far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    if far == 0:
        return None
    a = pts[:far + 1]; b = np.vstack([pts[far:], pts[:1]])
    ia, ib = dp(a, eps), dp(b, eps)
    out = np.vstack([a[ia], b[ib][1:]])
    return out if len(out) >= 4 else None  # closed: last == first


def area(p):
    return 0.5 * float(np.sum(p[:-1, 0] * p[1:, 1] - p[1:, 0] * p[:-1, 1]))


def pip(pt, poly):
    x, y = pt; xs, ys = poly[:, 0], poly[:, 1]
    x1, y1, x2, y2 = xs[:-1], ys[:-1], xs[1:], ys[1:]
    cross = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / np.where(y2 == y1, 1, (y2 - y1)) + x1)
    return bool(cross.sum() % 2)


def wkb_multipolygon(polys):
    out = struct.pack("<BII", 1, 6, len(polys))
    for rings in polys:
        out += struct.pack("<BII", 1, 3, len(rings))
        for r in rings:
            out += struct.pack("<I", len(r)) + np.asarray(r, "<f8").tobytes()
    return out


def write_gpkg(path, wkb, bounds):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.executescript("""
PRAGMA application_id = 1196444487; PRAGMA user_version = 10200;
CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL,
  organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '',
  last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL,
  srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
CREATE TABLE sea (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom BLOB, class TEXT);
""")
    db.executemany("INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)", [
        ("Undefined cartesian SRS", -1, "NONE", -1, "undefined", None),
        ("Undefined geographic SRS", 0, "NONE", 0, "undefined", None),
        ("WGS 84 geodetic", 4326, "EPSG", 4326,
         'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]', None)])
    # 'last_change' is fixed so the file is reproducible
    db.execute("INSERT INTO gpkg_contents VALUES ('sea','features','sea','Copernicus GLO-30 derived sea mask','2026-01-01T00:00:00.000Z',?,?,?,?,4326)", bounds)
    db.execute("INSERT INTO gpkg_geometry_columns VALUES ('sea','geom','MULTIPOLYGON',4326,0,0)")
    header = b"GP" + struct.pack("<BBi", 0, 1, 4326)  # version 0, flags: little-endian, no envelope
    db.execute("INSERT INTO sea (geom, class) VALUES (?, 'ocean')", (header + wkb,))
    db.commit(); db.close()


def main(src, out, tol_m=40.0):
    t0 = time.time()
    lon0, lat0, dx, dy, a = load_mosaic(src)
    c0 = int(round((CROP[0] - lon0) / dx)); c1 = int(round((CROP[2] - lon0) / dx)) + 1
    r0 = int(round((lat0 - CROP[3]) / dy)); r1 = int(round((lat0 - CROP[1]) / dy)) + 1
    z = a[r0:r1, c0:c1]
    cand = ~np.isfinite(z) | (z <= 0.0)
    seeds = np.zeros_like(cand)
    seeds[-1, :] = True  # the southern edge of the crop (lat 5.0) is open sea
    sea = flood(cand, seeds)
    print(f"crop {z.shape}, ocean candidates {int(cand.sum())}, connected to open sea {int(sea.sum())}")
    eps = tol_m / 111320.0 / dx  # tolerance in cell units (about 1 cell = 30 m)
    rings = trace_rings(boundary_edges(sea))
    to_lonlat = lambda p: np.stack([lon0 + (c0 + p[:, 0] - 0.5) * dx, lat0 - (r0 + p[:, 1] - 0.5) * dy], axis=1)
    outers, holes = [], []
    for r in rings:
        s = simplify_ring(r, eps)
        if s is None:
            continue
        s = to_lonlat(s)
        (outers if area(np.array(r, float)) > 0 else holes).append(s)
    outers.sort(key=lambda p: -abs(area(p)))
    polys = [[o] for o in outers]
    for h in holes:
        for poly in polys:
            if pip(h[0], poly[0]):
                poly.append(h); break
    # outer rings counter-clockwise in lon/lat (y up), holes clockwise: rings were traced y down, so the lon/lat conversion flips them
    fixed = []
    for poly in polys:
        fixed.append([np.ascontiguousarray(r if (area(r) > 0) == (i == 0) else r[::-1]) for i, r in enumerate(poly)])
    wkb = wkb_multipolygon(fixed)
    write_gpkg(out, wkb, (CROP[0], CROP[1], CROP[2], CROP[3]))
    nv = sum(len(r) for p in fixed for r in p)
    print(f"polygons {len(fixed)}, holes {sum(len(p) - 1 for p in fixed)}, vertices {nv}, bytes {os.path.getsize(out)}, seconds {time.time() - t0:.1f}")


if __name__ == "__main__":
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    tol = float(sys.argv[sys.argv.index("--tolerance-m") + 1]) if "--tolerance-m" in sys.argv else 40.0
    if "--tolerance-m" in sys.argv:
        args.remove(sys.argv[sys.argv.index("--tolerance-m") + 1])
    main(args[0], args[1], tol)
