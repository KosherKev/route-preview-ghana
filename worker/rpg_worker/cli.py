"""python -m rpg_worker.cli build [--plans DIR] [--interpolator hold|minterpolate|rife]   (run from worker/ with the venv)."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import ffmpeg as ff
from . import paths
from .budget import Budget
from .fetch import MapillaryFetcher
from .interpolate import HoldInterpolator, MinterpolateInterpolator, RifeInterpolator
from .pipeline import ClipConfig, build_clip
from .storage import LocalClipStorage


def read_token(file: Path = paths.TOKEN_FILE) -> str:
    """The token comes from MAPILLARY_TOKEN or the gitignored .env.mapillary; it is never printed."""
    t = os.environ.get("MAPILLARY_TOKEN", "").strip()
    if t:
        return t
    if file.exists():
        for line in file.read_text().splitlines():
            if line.startswith("MAPILLARY_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plans", type=Path, default=paths.PLANS)
    ap.add_argument("--interpolator", choices=["hold", "minterpolate", "rife"], default="minterpolate")
    ap.add_argument("--rife-binary", type=Path)
    ap.add_argument("--rife-model", default="rife-v4.6")
    ap.add_argument("--speed", type=float, default=10.0)
    ap.add_argument("--prefetch-only", action="store_true", help="download and cache the plans' frames, nothing else (needs no ffmpeg)")
    a = ap.parse_args(argv)
    if a.prefetch_only:
        budget = Budget(paths.BUDGET_FILE)
        fetcher = MapillaryFetcher(read_token(), budget)
        new = 0
        for pf in sorted(a.plans.glob("*.json")):
            for f in json.loads(pf.read_text())["plan"]["frames"]:
                new += fetcher.download(f["image_id"], paths.FRAMES_CACHE / f"{f['image_id']}.jpg")
        print(f"prefetched {new} new frames; budget: downloads {budget.downloads}/{budget.max_downloads}, api calls {budget.api_calls}")
        return 0
    ffmpeg_bin = ff.find_tool("ffmpeg", "RPG_FFMPEG")
    interp = {"hold": lambda: HoldInterpolator(), "minterpolate": lambda: MinterpolateInterpolator(ffmpeg_bin),
              "rife": lambda: RifeInterpolator(a.rife_binary, a.rife_model)}[a.interpolator]()
    budget = Budget(paths.BUDGET_FILE)
    fetcher = MapillaryFetcher(read_token(), budget)
    storage = LocalClipStorage(paths.CLIPS_CACHE)
    paths.RESULTS.mkdir(parents=True, exist_ok=True)
    for pf in sorted(a.plans.glob("*.json")):
        plan = json.loads(pf.read_text())["plan"]
        res = build_clip(plan, storage, fetcher, interp, ffmpeg_bin, paths.FRAMES_CACHE, ClipConfig(speed_mps=a.speed))
        (paths.RESULTS / pf.name).write_text(json.dumps(res.to_json(), indent=2))
        print(f"{pf.name}: {'reused cached clip' if res.reused else 'built'}; {res.duration_s}s, {res.frame_count} frames, "
              f"{res.interpolated_frames} interpolated, {res.bridge_frames} bridge, {res.file_bytes} bytes, encode {res.encode_seconds}s")
    print(f"budget: downloads {budget.downloads}/{budget.max_downloads}, api calls {budget.api_calls}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
