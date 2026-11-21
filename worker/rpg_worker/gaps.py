"""Gap rules for building a clip from a classified STREET_VIDEO segment (mirrors the classifier; owner-confirmed 2026-11-20).

- gap < 15 m: INTERPOLATE (RIFE / minterpolate / hold).
- 15 m <= gap <= 30 m and listed in the segment's bridges: FFmpeg CROSSFADE, never interpolation.
- anything else (a >30 m gap, or a 15-30 m gap that is not a listed bridge, or a listed bridge that is not 15-30 m): fail loudly."""
from __future__ import annotations

from dataclasses import dataclass

RIFE_CEILING_M = 15.0
BRIDGE_MAX_M = 30.0
_MM = 1000


class GapError(RuntimeError):
    pass


def _mm(x: float) -> int:
    return round(x * _MM)


@dataclass(frozen=True)
class Gap:
    index: int  # between frame index and index + 1
    start_m: float
    end_m: float
    gap_m: float
    kind: str  # "interpolate" or "crossfade"


def plan_gaps(offsets_m: list[float], bridges: list[dict]) -> list[Gap]:
    bridge_keys = {(_mm(b["startM"]), _mm(b["endM"])) for b in bridges}
    used: set[tuple[int, int]] = set()
    out: list[Gap] = []
    for i in range(len(offsets_m) - 1):
        a, b = offsets_m[i], offsets_m[i + 1]
        g = b - a
        if g < 0:
            raise GapError(f"frames are not ordered along the route (offset {a} then {b})")
        key = (_mm(a), _mm(b))
        if _mm(g) > _mm(BRIDGE_MAX_M):
            raise GapError(f"gap of {g:.3f} m between frames {i} and {i + 1} exceeds the 30 m ceiling inside a street segment")
        if _mm(g) >= _mm(RIFE_CEILING_M):
            if key not in bridge_keys:
                raise GapError(f"gap of {g:.3f} m between frames {i} and {i + 1} is in the bridge tier but is not in the segment's bridge list")
            used.add(key)
            out.append(Gap(i, a, b, g, "crossfade"))
        else:
            if key in bridge_keys:
                raise GapError(f"listed bridge at {a}-{b} is {g:.3f} m, below the 15 m bridge tier; refusing")
            out.append(Gap(i, a, b, g, "interpolate"))
    missing = bridge_keys - used
    if missing:
        raise GapError(f"{len(missing)} listed bridge(s) do not match any consecutive frame pair")
    return out
