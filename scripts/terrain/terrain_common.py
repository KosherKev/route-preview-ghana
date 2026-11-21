"""Shared helpers: Copernicus GLO-30 mosaic, bilinear sampling, Web Mercator maths, Terrarium codec."""
import math
import numpy as np
import tifffile

TILE = 256
# Same bounds as scripts/pmtiles/build-accra.sh: lon_min,lat_min,lon_max,lat_max
BBOX = (-0.40, 5.45, 0.05, 5.80)
MINZOOM, MAXZOOM = 6, 13


class Mosaic:
    """Cells laid side by side on one regular lon/lat grid (GeoTIFF raster type is PixelIsPoint: sample i sits exactly at lon0 + i*dx, lat0 - j*dy; 3600 px per degree)."""

    def __init__(self, paths):
        cells = []
        for p in paths:
            with tifffile.TiffFile(p) as t:
                pg = t.pages[0]
                sx, sy = pg.tags["ModelPixelScaleTag"].value[:2]
                lon0, lat0 = pg.tags["ModelTiepointTag"].value[3:5]
                a = pg.asarray().astype(np.float32)
            cells.append((lon0, lat0, sx, sy, a))
        cells.sort(key=lambda c: c[0])
        self.lon0, self.lat0, self.dx, self.dy = cells[0][:4]
        for c in cells:
            assert c[1] == self.lat0 and c[2] == self.dx and c[3] == self.dy, "cells must share a latitude band and spacing"
        for a, b in zip(cells, cells[1:]):
            assert abs(a[0] + a[4].shape[1] * a[2] - b[0]) < 1e-9, "cells must be contiguous"
        self.a = np.concatenate([c[4] for c in cells], axis=1)
        self.a[~np.isfinite(self.a)] = 0.0  # nodata / ocean -> 0 m
        self.h, self.w = self.a.shape

    def sample(self, lon, lat):
        """Bilinear sample at lon/lat arrays; 0 m outside the downloaded extent."""
        fx = (lon - self.lon0) / self.dx
        fy = (self.lat0 - lat) / self.dy
        inside = (fx >= 0) & (fx <= self.w - 1) & (fy >= 0) & (fy <= self.h - 1)
        fx = np.clip(fx, 0, self.w - 1)
        fy = np.clip(fy, 0, self.h - 1)
        x0 = np.minimum(np.floor(fx).astype(np.int64), self.w - 2)
        y0 = np.minimum(np.floor(fy).astype(np.int64), self.h - 2)
        tx, ty = fx - x0, fy - y0
        a = self.a
        v = (a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x0 + 1] * tx * (1 - ty)
             + a[y0 + 1, x0] * (1 - tx) * ty + a[y0 + 1, x0 + 1] * tx * ty)
        return np.where(inside, v, 0.0)


def tile_pixel_lonlat(z, x, y):
    """lon/lat (256x256 arrays, row-major) of pixel centres of tile z/x/y."""
    n = TILE * (1 << z)
    px = x * TILE + np.arange(TILE) + 0.5
    py = y * TILE + np.arange(TILE) + 0.5
    lon = px / n * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py / n))))
    return np.broadcast_to(lon[None, :], (TILE, TILE)), np.broadcast_to(lat[:, None], (TILE, TILE))


def lonlat_to_tile(z, lon, lat):
    n = 1 << z
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    y = int(math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))
    return x, y


def tiles_for_bbox(z, bbox=BBOX):
    x0, y1 = lonlat_to_tile(z, bbox[0], bbox[1])  # south-west -> max y
    x1, y0 = lonlat_to_tile(z, bbox[2], bbox[3])
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]


def encode_terrarium(h):
    """height = R*256 + G + B/256 - 32768 (floor, so error is below 1/256 m)."""
    v = np.floor((np.clip(h, -32768, 32767.99) + 32768.0) * 256.0).astype(np.int64)
    return np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], axis=-1).astype(np.uint8)


def decode_terrarium(rgb):
    rgb = rgb.astype(np.float64)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0
