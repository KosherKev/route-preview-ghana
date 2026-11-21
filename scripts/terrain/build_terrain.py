#!/usr/bin/env python3
"""Build accra-terrain.pmtiles (Terrarium raster-dem PNG tiles) from Copernicus GLO-30 GeoTIFF cells.
Usage: build_terrain.py SRC_DIR OUT.pmtiles     (deterministic: same inputs give the same bytes)"""
import glob, io, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write
from terrain_common import *

ATTRIBUTION = ("produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 "
               "provided under COPERNICUS by the European Union and ESA; all rights reserved")


def png_bytes(rgb):
    b = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(b, format="PNG", compress_level=9, optimize=True)
    return b.getvalue()


def main(src, out):
    t0 = time.time()
    m = Mosaic(sorted(glob.glob(os.path.join(src, "*.tif"))))
    tiles = sorted((zxy_to_tileid(z, x, y), z, x, y) for z in range(MINZOOM, MAXZOOM + 1) for x, y in tiles_for_bbox(z))
    e7 = lambda v: int(round(v * 1e7))
    header = {"version": 3, "tile_compression": Compression.NONE, "tile_type": TileType.PNG,
              "min_lon_e7": e7(BBOX[0]), "min_lat_e7": e7(BBOX[1]), "max_lon_e7": e7(BBOX[2]), "max_lat_e7": e7(BBOX[3]),
              "center_zoom": 10, "center_lon_e7": e7((BBOX[0] + BBOX[2]) / 2), "center_lat_e7": e7((BBOX[1] + BBOX[3]) / 2)}
    metadata = {"name": "accra-terrain", "description": "Copernicus GLO-30 DSM, Terrarium-encoded raster-dem tiles for Greater Accra",
                "type": "baselayer", "format": "png", "encoding": "terrarium", "tileSize": TILE, "version": "1",
                "bounds": list(BBOX), "minzoom": MINZOOM, "maxzoom": MAXZOOM,
                "center": [(BBOX[0] + BBOX[2]) / 2, (BBOX[1] + BBOX[3]) / 2, 10],
                "license": "Copernicus DEM GLO-30 (ESA/EU free licence; see docs/data/terrain.md)", "attribution": ATTRIBUTION,
                "source": "https://copernicus-dem-30m.s3.amazonaws.com/ (AWS Open Data, COP-DEM_GLO-30-DGED)",
                "caveat": "Digital Surface Model: building and tree heights are included. Ocean and nodata are 0 m."}
    with write(out) as w:
        for tid, z, x, y in tiles:
            lon, lat = tile_pixel_lonlat(z, x, y)
            w.write_tile(tid, png_bytes(encode_terrarium(m.sample(lon, lat))))
        w.finalize(header, metadata)
    print(f"tiles={len(tiles)} bytes={os.path.getsize(out)} seconds={time.time()-t0:.1f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
