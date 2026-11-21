"""Frame interpolation back ends and the one guarded entry point.

Interpolation is allowed ONLY between consecutive frames strictly under 15 m apart: interpolate_pair() asserts it and
raises, so a bridge (15 to 30 m) can never reach an interpolator by construction."""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from . import ffmpeg as ff
from .gaps import RIFE_CEILING_M, GapError


class Interpolator(Protocol):
    name: str

    def interpolate(self, a: np.ndarray, b: np.ndarray, n: int) -> list[np.ndarray]:
        """n evenly spaced intermediate frames strictly between a and b."""


class HoldInterpolator:
    """Plain frame hold: no new frames are made; the timeline holds the nearest real frame."""
    name = "hold"

    def interpolate(self, a: np.ndarray, b: np.ndarray, n: int) -> list[np.ndarray]:
        return []


class MinterpolateInterpolator:
    name = "minterpolate"

    def __init__(self, ffmpeg_bin: str):
        self.ffmpeg = ffmpeg_bin

    def interpolate(self, a: np.ndarray, b: np.ndarray, n: int) -> list[np.ndarray]:
        if n <= 0:
            return []
        with tempfile.TemporaryDirectory(prefix="rpg-mi-") as d:
            d = Path(d)
            cv2.imwrite(str(d / "in1.png"), a)
            cv2.imwrite(str(d / "in2.png"), b)
            cv2.imwrite(str(d / "in3.png"), b)  # minterpolate emits nothing from only 2 frames; a repeated b gives a..b in n + 2 frames
            ff.run(ff.minterpolate_cmd(self.ffmpeg, d / "in%d.png", d / "o%03d.png", n))
            outs = [cv2.imread(str(d / f"o{i:03d}.png")) for i in range(2, n + 2)]  # o001 is frame a itself
        if any(o is None for o in outs):
            raise RuntimeError("minterpolate produced fewer frames than requested")
        return outs


class RifeInterpolator:
    """rife-ncnn-vulkan (official release binary), one call per intermediate timestep."""
    name = "rife"

    def __init__(self, binary: Path, model: str, timeout_s: float = 600.0):
        self.binary, self.model, self.timeout_s = Path(binary), model, timeout_s

    def interpolate(self, a: np.ndarray, b: np.ndarray, n: int) -> list[np.ndarray]:
        outs = []
        with tempfile.TemporaryDirectory(prefix="rpg-rife-") as d:
            d = Path(d)
            cv2.imwrite(str(d / "a.png"), a)
            cv2.imwrite(str(d / "b.png"), b)
            for k in range(1, n + 1):
                t = k / (n + 1)
                cmd = [str(self.binary), "-0", str(d / "a.png"), "-1", str(d / "b.png"), "-o", str(d / f"o{k}.png"), "-m", self.model, "-s", f"{t:.4f}"]
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout_s, cwd=self.binary.parent)
                img = cv2.imread(str(d / f"o{k}.png"))
                if r.returncode != 0 or img is None:
                    raise RuntimeError(f"rife failed ({r.returncode}): {r.stderr[-300:]}")
                outs.append(img)
        return outs


def interpolate_pair(interp: Interpolator, a: np.ndarray, b: np.ndarray, gap_m: float, n: int) -> list[np.ndarray]:
    """The only way the pipeline reaches an interpolator. Refuses any gap of 15 m or more."""
    if round(gap_m * 1000) >= round(RIFE_CEILING_M * 1000):
        raise GapError(f"refusing to interpolate across a {gap_m:.3f} m gap (limit: strictly under {RIFE_CEILING_M:.0f} m)")
    out = interp.interpolate(a, b, n)
    if len(out) not in (0, n):
        raise RuntimeError(f"interpolator returned {len(out)} frames, expected {n}")
    return out


def steps_for_gap(gap_m: float, target_step_m: float = 2.5, max_steps: int = 3, min_steps: int = 0) -> int:
    """Number of intermediate frames to place in a gap: aim for one distinct image about every target_step_m metres."""
    return max(min_steps, min(max_steps, round(gap_m / target_step_m) - 1))
