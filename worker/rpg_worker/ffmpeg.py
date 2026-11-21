"""Thin, testable FFmpeg/ffprobe layer: command builders (pure) plus a runner. Binaries come from RPG_FFMPEG / RPG_FFPROBE,
then worker/bin/, then PATH."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

WORKER_BIN = Path(__file__).resolve().parents[1] / "bin"

CRF = 27  # 26 to 28 allowed
PRESET = "medium"
FPS = 10


class ToolMissing(RuntimeError):
    pass


def find_tool(name: str, env_var: str) -> str:
    cands = [os.environ.get(env_var), str(WORKER_BIN / name), shutil.which(name)]
    for c in cands:
        if c and Path(c).exists() and os.access(c, os.X_OK):
            return c
    raise ToolMissing(f"{name} not found (set {env_var}, or place it in worker/bin/, or put it on PATH)")


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{Path(cmd[0]).name} failed ({r.returncode}): {r.stderr[-400:]}")
    return r


def crossfade_cmd(ffmpeg: str, a: Path, b: Path, out_pattern: Path, n_out: int, fps: int = FPS) -> list[str]:
    """FFmpeg xfade between two stills. The two stills are each shown for 1 s at `fps`, with a 1 s crossfade, so the
    output is the fade itself; we emit n_out evenly spaced frames of it (fps scaled so the fade yields n_out + 2 frames:
    the two ends are dropped by the caller, only the strictly interior frames are used)."""
    total = n_out + 1  # frames across the fade including one end
    return [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-loop", "1", "-framerate", str(total), "-t", "1", "-i", str(a),
        "-loop", "1", "-framerate", str(total), "-t", "1", "-i", str(b),
        "-filter_complex", f"[0:v][1:v]xfade=transition=fade:duration=1:offset=0,fps={total},format=yuv420p,format=rgb24",
        "-frames:v", str(total), str(out_pattern),
    ]


def minterpolate_cmd(ffmpeg: str, in_pattern: Path, out_pattern: Path, n: int) -> list[str]:
    """Two stills at 1 fps in, motion-compensated interpolation to n + 1 fps out: output frames 1..n lie between them."""
    return [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-i", str(in_pattern),
        "-vf", f"minterpolate=fps={n + 1}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1", "-frames:v", str(n + 2), str(out_pattern),
    ]


def encode_cmd(ffmpeg: str, concat_list: Path, out: Path, fps: int = FPS, crf: int = CRF, preset: str = PRESET) -> list[str]:
    """720p H.264 mp4 from a concat list (file/duration lines): fixed output frame rate, faststart, no overlays."""
    if not 26 <= crf <= 28:
        raise ValueError("crf must be 26 to 28")
    return [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-vf", f"fps={fps},scale=1280:720,format=yuv420p", "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-r", str(fps), "-fps_mode", "cfr", "-an", "-movflags", "+faststart", str(out),
    ]


def probe(ffprobe: str, path: Path) -> dict:
    r = run([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    return json.loads(r.stdout)


def faststart(path: Path) -> bool:
    """True when the moov atom precedes mdat (a progressive-download mp4)."""
    data = Path(path).read_bytes()
    moov, mdat = data.find(b"moov"), data.find(b"mdat")
    return 0 <= moov < mdat if mdat >= 0 else moov >= 0
