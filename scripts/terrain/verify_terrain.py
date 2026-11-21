#!/usr/bin/env python3
"""Verify accra-terrain.pmtiles against the source GeoTIFFs.
Usage: verify_terrain.py SRC_DIR TERRAIN.pmtiles"""
import collections, glob, io, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from pmtiles.reader import Reader, MmapSource
from pmtiles.tile import tileid_to_zxy, deserialize_directory
from terrain_common import *


def ref_bilinear(m, lon, lat):
    """Independent scalar bilinear (PixelIsPoint grid), 0 outside the source extent."""
    fx, fy = (lon - m.lon0) / m.dx, (m.lat0 - lat) / m.dy
    if not (0 <= fx <= m.w - 1 and 0 <= fy <= m.h - 1):
        return 0.0
    x0, y0 = min(int(fx), m.w - 2), min(int(fy), m.h - 2)
    tx, ty = fx - x0, fy - y0
    a = m.a
    return float(a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x0 + 1] * tx * (1 - ty) + a[y0 + 1, x0] * (1 - tx) * ty + a[y0 + 1, x0 + 1] * tx * ty)


def main(src, pm):
    m = Mosaic(sorted(glob.glob(os.path.join(src, "*.tif"))))
    f = open(pm, "rb")
    r = Reader(MmapSource(f))
    h, md = r.header(), r.metadata()
    print("header:", {k: (v.name if hasattr(v, "name") else v) for k, v in h.items()})
    print("metadata keys:", sorted(md))
    assert md["encoding"] == "terrarium" and md["tileSize"] == 256 and md["minzoom"] == MINZOOM and md["maxzoom"] == MAXZOOM
    assert md["attribution"] and md["bounds"] == list(BBOX)
    assert h["min_zoom"] == MINZOOM and h["max_zoom"] == MAXZOOM and h["clustered"]

    cache = {}
    def tile(z, x, y):
        k = (z, x, y)
        if k not in cache:
            b = r.get(z, x, y)
            cache[k] = None if b is None else decode_terrarium(np.asarray(Image.open(io.BytesIO(b)).convert("RGB")))
        return cache[k]

    # per-zoom tile counts: every expected tile present and a 256x256 RGB PNG
    counts = collections.Counter()
    for z in range(MINZOOM, MAXZOOM + 1):
        for x, y in tiles_for_bbox(z):
            t = tile(z, x, y)
            assert t is not None and t.shape == (256, 256), (z, x, y)
            counts[z] += 1
    print("tiles per zoom:", dict(counts), "total", sum(counts.values()), "header addressed_tiles_count", h["addressed_tiles_count"])
    assert sum(counts.values()) == h["addressed_tiles_count"]

    rng = random.Random(20261121)
    # A: 300 random tile pixels (pixel centres) across all zooms vs source bilinear at that centre
    errs = collections.defaultdict(list)
    for _ in range(300):
        z = rng.randint(MINZOOM, MAXZOOM)
        x, y = rng.choice(tiles_for_bbox(z))
        i, j = rng.randrange(256), rng.randrange(256)
        lon, lat = tile_pixel_lonlat(z, x, y)
        errs[z].append(abs(tile(z, x, y)[j, i] - ref_bilinear(m, float(lon[j, i]), float(lat[j, i]))))
    allerr = np.concatenate([np.array(v) for v in errs.values()])
    print(f"A pixel-centre points n={len(allerr)} mean_abs_err={allerr.mean():.5f} m max_abs_err={allerr.max():.5f} m")
    # B: 300 random geographic points inside the bbox, tile value bilinear-interpolated between pixel centres
    errb = collections.defaultdict(list)
    for _ in range(300):
        z = rng.randint(MINZOOM, MAXZOOM)
        lon, lat = rng.uniform(BBOX[0], BBOX[2]), rng.uniform(BBOX[1], BBOX[3])
        x, y = lonlat_to_tile(z, lon, lat)
        n = 256 * (1 << z)
        px = (lon + 180) / 360 * n - x * 256 - 0.5
        py = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - y * 256 - 0.5
        if not (0 <= px < 255 and 0 <= py < 255):
            continue  # needs the neighbour tile; skipped for simplicity
        i, j = int(px), int(py); tx, ty = px - i, py - j
        t = tile(z, x, y)
        v = t[j, i] * (1 - tx) * (1 - ty) + t[j, i + 1] * tx * (1 - ty) + t[j + 1, i] * (1 - tx) * ty + t[j + 1, i + 1] * tx * ty
        errb[z].append(abs(v - ref_bilinear(m, lon, lat)))
    allb = np.concatenate([np.array(v) for v in errb.values()])
    print(f"B arbitrary points (interpolated from tile) n={len(allb)} mean_abs_err={allb.mean():.4f} m max_abs_err={allb.max():.3f} m")
    for z in sorted(errb):
        print(f"   z{z}: n={len(errb[z])} mean={np.mean(errb[z]):.3f} max={np.max(errb[z]):.3f}")

    # seams: last column of tile vs first column of its east neighbour (and rows for south neighbour), all zooms
    for z in range(MINZOOM, MAXZOOM + 1):
        ts = set(tiles_for_bbox(z)); raw, exc = [], []
        for x, y in ts:
            for dx, dy in ((1, 0), (0, 1)):
                if (x + dx, y + dy) in ts:
                    a, b = tile(z, x, y), tile(z, x + dx, y + dy)
                    ea, eb = (a[:, -1], b[:, 0]) if dx else (a[-1, :], b[0, :])
                    ca, cb = (tile_pixel_lonlat(z, x, y), tile_pixel_lonlat(z, x + dx, y + dy))
                    pa = (ca[0][:, -1], ca[1][:, -1], cb[0][:, 0], cb[1][:, 0]) if dx else (ca[0][-1, :], ca[1][-1, :], cb[0][0, :], cb[1][0, :])
                    sa = np.array([ref_bilinear(m, float(u), float(v)) for u, v in zip(pa[0], pa[1])])
                    sb = np.array([ref_bilinear(m, float(u), float(v)) for u, v in zip(pa[2], pa[3])])
                    raw.append(np.abs(ea - eb)); exc.append(np.abs((ea - eb) - (sa - sb)))
        if raw:
            raw, exc = np.concatenate(raw), np.concatenate(exc)
            print(f"seam z{z}: pairs-pixels={len(raw)} raw_adjacent_diff mean={raw.mean():.3f} max={raw.max():.3f} m | deviation from source step max={exc.max():.4f} m")
        else:
            print(f"seam z{z}: no adjacent pairs")

    allv = np.concatenate([tile(MAXZOOM, x, y).ravel() for x, y in tiles_for_bbox(MAXZOOM)])
    print(f"z{MAXZOOM} elevation min={allv.min():.2f} max={allv.max():.2f} mean={allv.mean():.2f} m; source mosaic bbox max={m.a.max():.2f}")
    print("OK")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
