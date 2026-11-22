#!/usr/bin/env python3
"""Orientation test: is the sea SOUTH of the coast and the land NORTH of it? Reads the final GeoPackage (SEA_GPKG, default data/tmp/sea.gpkg) and the
built tiles (TILES, default data/accra-v2.pmtiles) and checks hand-written coordinates; none of them comes from build_sea.py or from the
coastline rule. Each transect longitude below was read off the raw OSM natural=coastline way (data/tmp/coast.json) and the two points are
the coast latitude -/+ 0.0045 deg (about 500 m): S is 500 m south of the coast (must be sea), N is 500 m north (must be land). The coast
runs roughly east-west here, so a vertical offset is the right direction; at Tema it is tilted about 30 degrees, so the perpendicular distance is about 440 m.
Run: data/tools/tiles-venv/bin/python -I scripts/pmtiles/test_orientation.py   (SEA_GPKG / TILES env vars point it at other files)
The test fails if the sea layer is inverted (see test_detects_inversion and the run recorded in docs/data/tiles.md)."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
GPKG = os.environ.get("SEA_GPKG", os.path.join(ROOT, "data", "tmp", "sea.gpkg"))
TILES = os.environ.get("TILES", os.path.join(ROOT, "data", "accra-v2.pmtiles"))

# (lon, coast lat read off the OSM coastline way at that lon): south is sea, north is land. 11 transects across lon -0.38 to -0.04 (single-valued coast only; the Tema harbour pieces are left out).
TRANSECTS = [(-0.38, 5.48602), (-0.34, 5.50320), (-0.30, 5.51358), (-0.26, 5.52124), (-0.22, 5.53055), (-0.19, 5.54460), (-0.16, 5.55485),
             (-0.13, 5.56424), (-0.10, 5.57796), (-0.07, 5.59570), (-0.04, 5.61221)]
OFFSET = 0.0045
INLAND = {  # hand-written, well known inland places (lat, lon)
    "Kotoka International Airport": (5.6052, -0.1668), "Kwame Nkrumah Circle": (5.5706, -0.2174), "Accra Mall": (5.6219, -0.1732),
    "Osu Castle (named way, see docs)": (5.54684, -0.18423), "Labadi Beach Hotel (named way, see docs)": (5.56353, -0.13753),
}
OPEN_SEA = {"Gulf of Guinea off Weija": (5.46, -0.35), "off Osu": (5.50, -0.18), "off Labadi": (5.51, -0.14), "off Tema port": (5.60, 0.02),
            "south of Korle Bu": (5.49, -0.23)}

def pip_rings(x, y, rings):
    inside = False
    for r in rings:
        for (x1, y1), (x2, y2) in zip(r, r[1:]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: inside = not inside
    return inside

def checks(is_sea):
    """Yield (label, expected_sea, actual_sea) for every hand-written point; is_sea(lon, lat) -> bool."""
    for lon, lat in TRANSECTS:
        yield f"500 m south of the coast at lon {lon}", True, is_sea(lon, lat - OFFSET)
        yield f"500 m north of the coast at lon {lon}", False, is_sea(lon, lat + OFFSET)
    for n, (lat, lon) in INLAND.items(): yield f"inland {n}", False, is_sea(lon, lat)
    for n, (lat, lon) in OPEN_SEA.items(): yield f"open sea {n}", True, is_sea(lon, lat)

def wrong(is_sea): return [(l, e) for l, e, a in checks(is_sea) if a != e]

class Orientation(unittest.TestCase):
    def test_transect_count(self): self.assertGreaterEqual(len(TRANSECTS), 10)
    def test_geopackage(self):
        if not os.path.exists(GPKG): self.skipTest("no GeoPackage: " + GPKG)
        from check_shoreline import read_sea
        polys = read_sea(GPKG)
        self.both(lambda lon, lat: any(pip_rings(lon, lat, [p[0]]) and not any(pip_rings(lon, lat, [h]) for h in p[1:]) for p in polys))
    def test_tiles(self):
        if not os.path.exists(TILES): self.skipTest("no tiles: " + TILES)
        from check_shoreline import TileSea
        ts = TileSea(TILES)
        self.both(ts.insea)
    def both(self, is_sea):
        total = len(list(checks(is_sea)))
        self.assertEqual(wrong(is_sea), [])
        # inversion guard: with the sea layer flipped (sea where land is) every single check must fail
        self.assertEqual(len(wrong(lambda lon, lat: not is_sea(lon, lat))), total)

if __name__ == "__main__":
    unittest.main(verbosity=2)
