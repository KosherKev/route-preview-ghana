#!/usr/bin/env python3
"""Tests for build_sea.py (stdlib unittest + numpy). Run: data/tools/tiles-venv/bin/python -I scripts/pmtiles/test_build_sea.py"""
import json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import build_sea as bs
HERE = os.path.dirname(os.path.abspath(__file__))

def sq(x0, y0, x1, y1, ccw=True):
    p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    return np.array(p if ccw else p[::-1], float)

class Assemble(unittest.TestCase):
    base = {"degenerate_outer": 0, "degenerate_hole": 0}
    def test_hole_inside_outer_is_kept(self):
        fixed, st = bs.assemble([sq(0, 0, 10, 10)], [sq(2, 2, 3, 3, False)], self.base)
        self.assertEqual((len(fixed), len(fixed[0]), st["orphan_hole"]), (1, 2, 0))
    def test_orphan_hole_is_counted(self):
        fixed, st = bs.assemble([sq(0, 0, 10, 10)], [sq(20, 20, 21, 21, False)], self.base)
        self.assertEqual(st["orphan_hole"], 1); self.assertEqual(len(fixed[0]), 1)

class Cli(unittest.TestCase):
    def run_coast(self, segs):
        d = tempfile.mkdtemp(); c = os.path.join(d, "c.json"); g = os.path.join(d, "s.gpkg")
        with open(c, "w") as fh: json.dump({"coast": segs, "nodes": []}, fh)
        r = subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_sea.py"), c, g], capture_output=True, text=True)
        return r, g
    main = [[-1.0, 5.6], [-0.4, 5.55], [0.0, 5.6], [0.7, 5.7]]   # west to east, land on the left (north)
    def test_clean_run_exits_0_and_reports_counts(self):
        r, g = self.run_coast([self.main])
        self.assertEqual(r.returncode, 0, r.stderr); self.assertIn("dropped degenerate rings: outer 0, hole 0; orphan holes (no outer ring): 0", r.stdout); self.assertTrue(os.path.getsize(g) > 0)
    def test_orphan_island_hole_exits_nonzero_and_writes_nothing(self):
        island = [[-0.5, 5.9], [-0.4, 5.9], [-0.4, 5.95], [-0.5, 5.95], [-0.5, 5.9]]  # north of the coast: no sea polygon contains it
        r, g = self.run_coast([self.main, island])
        self.assertNotEqual(r.returncode, 0); self.assertIn("orphan holes (no outer ring): 1", r.stdout); self.assertIn("hole(s) dropped", r.stderr); self.assertFalse(os.path.exists(g))
    def test_island_inside_sea_is_a_hole(self):
        island = [[-0.5, 5.2], [-0.4, 5.2], [-0.4, 5.3], [-0.5, 5.3], [-0.5, 5.2]]
        r, g = self.run_coast([self.main, island])
        self.assertEqual(r.returncode, 0, r.stderr); self.assertIn("island holes 1", r.stdout)
    def test_gap_in_coast_is_refused(self):
        r, g = self.run_coast([self.main[:2], self.main[3:]])
        self.assertNotEqual(r.returncode, 0); self.assertFalse(os.path.exists(g))

class DemMethod(unittest.TestCase):
    """--method dem fails fast with a clear message and writes nothing, on the real DEM (data/terrain/src) when it is present and on a stub dir."""
    def run_dem(self, src):
        g = os.path.join(tempfile.mkdtemp(), "s.gpkg")
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_sea.py"), src, g, "--method", "dem"], capture_output=True, text=True, timeout=30)
        return r, g
    def check(self, src):
        r, g = self.run_dem(src)
        self.assertEqual(r.returncode, 1); self.assertIn("comparison-only", r.stderr); self.assertIn("not production-supported", r.stderr)
        self.assertNotIn("dropped degenerate rings", r.stdout); self.assertFalse(os.path.exists(g))
    def test_refuses_on_empty_dir(self): self.check(tempfile.mkdtemp())
    def test_refuses_on_real_dem(self):
        real = os.path.join(HERE, "..", "..", "data", "terrain", "src")
        if not os.path.isdir(real): self.skipTest("real DEM not present: " + real)
        self.check(real)

if __name__ == "__main__":
    unittest.main(verbosity=2)
