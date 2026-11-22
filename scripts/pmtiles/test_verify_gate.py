#!/usr/bin/env python3
"""Tests for the buildings-in-sea gate of verify_tiles.py. Run: data/tools/tiles-venv/bin/python -I scripts/pmtiles/test_verify_gate.py"""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_tiles import bsea_gate

class Gate(unittest.TestCase):
    def test_zero_examined_fails(self):
        self.assertFalse(all(ok for ok, _ in bsea_gate([0, 0], 0)))
    def test_zero_inside_passes(self):
        self.assertTrue(all(ok for ok, _ in bsea_gate([114645, 0], 0)))
    def test_one_inside_fails_with_limit_zero(self):
        self.assertFalse(all(ok for ok, _ in bsea_gate([114645, 1], 0)))

if __name__ == "__main__":
    unittest.main(verbosity=2)
