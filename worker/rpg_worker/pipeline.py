"""plan -> fetch -> normalise -> stabilise -> interpolate / crossfade -> encode -> cache. PROTOTYPE clips only."""
from __future__ import annotations

import json
import shutil
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import ffmpeg as ff
from .fetch import MapillaryFetcher
from .gaps import plan_gaps
from .interpolate import Interpolator, interpolate_pair, steps_for_gap
from .normalise import normalise
from .stabilise import stabilise_sequence
from .storage import ClipStorage, clip_key

DEFAULT_SPEED_MPS = 10.0
MAX_BRIDGE_FRAMES = 6


@dataclass
class ClipConfig:
    speed_mps: float = DEFAULT_SPEED_MPS
    fps: int = ff.FPS
    crf: int = ff.CRF
    target_step_m: float = 2.5
    max_interp_per_gap: int = 3


@dataclass
class Keyframe:
    pos_m: float
    img: np.ndarray
    kind: str  # "source" | "interpolated" | "bridge"


@dataclass
class ClipResult:
    edge_id: int
    direction: str
    clip_key: str
    duration_s: float
    fps: int
    speed_mps: float
    frame_count: int
    source_frames: int
    interpolated_frames: int
    bridge_frames: int
    bridges_used: int
    interpolator: str
    file_bytes: int
    encode_seconds: float
    start_pose: dict
    end_pose: dict
    render_params: dict = field(default_factory=dict)
    reused: bool = False

    def to_json(self) -> dict:
        d = asdict(self)
        d.pop("reused")
        return d


def hold_durations(positions_m: list[float], start_m: float, end_m: float, speed_mps: float) -> list[float]:
    """Seconds each keyframe is shown at a constant virtual speed: each keyframe owns the span between the midpoints to its
    neighbours, the first from the segment start and the last to the segment end. Sums to (end - start) / speed."""
    if not positions_m:
        return []
    bounds = [start_m] + [(a + b) / 2.0 for a, b in zip(positions_m, positions_m[1:])] + [end_m]
    return [max(0.0, (bounds[i + 1] - bounds[i]) / speed_mps) for i in range(len(positions_m))]


def write_concat_list(paths: list[Path], durations: list[float], out: Path) -> None:
    lines = []
    for p, d in zip(paths, durations):
        lines += [f"file '{p}'", f"duration {d:.6f}"]
    lines.append(f"file '{paths[-1]}'")  # concat demuxer quirk: the last file needs repeating for its duration to count
    out.write_text("\n".join(lines) + "\n")


def build_keyframes(
    plan: dict, imgs: list[np.ndarray], interp: Interpolator, ffmpeg_bin: str, cfg: ClipConfig,
) -> list[Keyframe]:
    frames = plan["frames"]
    offsets = [f["offsetM"] for f in frames]
    gaps = plan_gaps(offsets, plan["bridges"])  # raises GapError loudly: >30 m, unlisted bridge, or mis-tiered bridge
    keys = [Keyframe(offsets[0], imgs[0], "source")]
    for g in gaps:
        a, b = imgs[g.index], imgs[g.index + 1]
        if g.kind == "interpolate":
            n = steps_for_gap(g.gap_m, cfg.target_step_m, cfg.max_interp_per_gap)
            if n > 0:
                for k, im in enumerate(interpolate_pair(interp, a, b, g.gap_m, n), start=1):
                    keys.append(Keyframe(g.start_m + g.gap_m * k / (n + 1), im, "interpolated"))
        else:  # crossfade bridge: FFmpeg xfade, never an interpolator
            n = steps_for_gap(g.gap_m, cfg.target_step_m, MAX_BRIDGE_FRAMES, min_steps=1)
            with tempfile.TemporaryDirectory(prefix="rpg-xf-") as d:
                d = Path(d)
                cv2.imwrite(str(d / "a.png"), a)
                cv2.imwrite(str(d / "b.png"), b)
                ff.run(ff.crossfade_cmd(ffmpeg_bin, d / "a.png", d / "b.png", d / "x%03d.png", n))
                xs = [cv2.imread(str(d / f"x{i:03d}.png")) for i in range(2, n + 2)]  # x001 is frame a itself
            if any(x is None for x in xs):
                raise RuntimeError("crossfade produced fewer frames than requested")
            for k, im in enumerate(xs, start=1):
                keys.append(Keyframe(g.start_m + g.gap_m * k / (n + 1), im, "bridge"))
        keys.append(Keyframe(g.end_m, b, "source"))
    return keys


def build_clip(
    plan: dict, storage: ClipStorage, fetcher: MapillaryFetcher | None, interp: Interpolator, ffmpeg_bin: str,
    frames_cache: Path, cfg: ClipConfig | None = None, work_root: Path | None = None,
) -> ClipResult:
    cfg = cfg or ClipConfig()
    edge_id, direction = int(plan["edge_id"]), plan["direction"]
    if storage.exists(edge_id, direction):  # cache hit: no fetch, no encode
        res = ClipResult(**{**storage.meta(edge_id, direction)["result"]})
        res.reused = True
        return res
    frames = plan["frames"]
    offsets = [f["offsetM"] for f in frames]
    plan_gaps(offsets, plan["bridges"])  # fail before any download
    if fetcher is None:
        raise RuntimeError("no fetcher: frames are not cached and downloading is not configured")
    raw: list[np.ndarray] = []
    for f in frames:
        p = frames_cache / f"{f['image_id']}.jpg"
        fetcher.download(f["image_id"], p)
        im = cv2.imread(str(p))
        if im is None:
            raise RuntimeError(f"cached frame {f['image_id']} is unreadable")
        raw.append(normalise(im))
    imgs, tilt = stabilise_sequence(raw)
    keys = build_keyframes(plan, imgs, interp, ffmpeg_bin, cfg)

    seg = plan["segment"]
    work = Path(tempfile.mkdtemp(prefix="rpg-clip-", dir=work_root))
    try:
        paths = []
        for i, k in enumerate(keys):
            p = work / f"k{i:04d}.jpg"
            cv2.imwrite(str(p), k.img, [cv2.IMWRITE_JPEG_QUALITY, 95])
            paths.append(p)
        durs = hold_durations([k.pos_m for k in keys], offsets[0], offsets[-1], cfg.speed_mps)
        write_concat_list(paths, durs, work / "list.txt")
        out = work / "clip.mp4"
        t0 = time.monotonic()
        ff.run(ff.encode_cmd(ffmpeg_bin, work / "list.txt", out, cfg.fps, cfg.crf))
        enc = time.monotonic() - t0
        size = out.stat().st_size
        duration = (offsets[-1] - offsets[0]) / cfg.speed_mps
        n_int = sum(k.kind == "interpolated" for k in keys)
        n_br = sum(k.kind == "bridge" for k in keys)
        pose = lambda f: {"lat": f["lat"], "lon": f["lon"], "heading_deg": f["heading_deg"]}  # noqa: E731
        res = ClipResult(
            edge_id=edge_id, direction=direction, clip_key=clip_key(edge_id, direction), duration_s=round(duration, 3), fps=cfg.fps,
            speed_mps=cfg.speed_mps, frame_count=round(duration * cfg.fps), source_frames=len(frames), interpolated_frames=n_int,
            bridge_frames=n_br, bridges_used=len(plan["bridges"]), interpolator=interp.name, file_bytes=size,
            encode_seconds=round(enc, 2), start_pose=pose(frames[0]), end_pose=pose(frames[-1]),
            render_params={
                "crf": cfg.crf, "preset": ff.PRESET, "codec": "h264", "width": 1280, "height": 720, "faststart": True,
                "max_interp_per_gap": cfg.max_interp_per_gap, "target_step_m": cfg.target_step_m,
                "mean_stabilise_correction_deg": round(float(np.mean(np.abs(tilt))), 3), "segment_length_m": seg["lengthM"],
            },
        )
        storage.put(edge_id, direction, out, {"result": res.to_json(), "plan_route": plan.get("routeId")})
        return res
    finally:
        shutil.rmtree(work, ignore_errors=True)
