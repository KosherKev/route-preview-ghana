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


def _imageio_ffmpeg() -> str | None:
    """The static ffmpeg bundled in the hash-pinned imageio-ffmpeg wheel (worker/requirements-ffmpeg.txt)."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def find_tool(name: str, env_var: str) -> str:
    cands = [os.environ.get(env_var), str(WORKER_BIN / name), shutil.which(name)]
    if name == "ffmpeg":
        cands.append(_imageio_ffmpeg())
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
    """Stills a, b, b at 1 fps in, motion-compensated interpolation to n + 1 fps out: output 1 is a, 2..n+1 lie between, n+2 is b."""
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
        "-vf", f"fps={fps},scale=1280:720:in_range=full:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-r", str(fps), "-fps_mode", "cfr", "-an", "-movflags", "+faststart", str(out),
    ]


def probe(ffprobe: str, path: Path) -> dict:
    r = run([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    return json.loads(r.stdout)


def top_level_boxes(path: Path) -> list[str]:
    """Names of the top-level MP4 boxes in file order (pure-Python box walk)."""
    import struct
    out, size = [], Path(path).stat().st_size
    with open(path, "rb") as f:
        pos = 0
        while pos + 8 <= size:
            f.seek(pos)
            n, name = struct.unpack(">I4s", f.read(8))
            if n == 1:
                n = struct.unpack(">Q", f.read(8))[0]
            elif n == 0:
                n = size - pos
            if n < 8:
                break
            out.append(name.decode("latin1"))
            pos += n
    return out


def faststart(path: Path) -> bool:
    """True when the top-level moov box precedes mdat (a progressive-download mp4)."""
    b = top_level_boxes(path)
    return "moov" in b and "mdat" in b and b.index("moov") < b.index("mdat")


def stream_info(ffmpeg: str, path: Path) -> dict:
    """ffprobe substitute: parse `ffmpeg -i` stream lines (codec, pixel format, size, fps) and duration."""
    import re
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    t = r.stderr
    v = re.search(r"Stream #\d+:\d+.*?: Video: (\w+)[^,]*, (\w+)(?:\([^)]*\))?, (\d+)x(\d+)[^,]*, .*?([\d.]+) fps", t)
    d = re.search(r"Duration: (\d+):(\d+):([\d.]+)", t)
    if not v or not d:
        raise RuntimeError("could not read stream info from ffmpeg -i output")
    return {"codec": v.group(1), "pix_fmt": v.group(2).split("(")[0], "width": int(v.group(3)), "height": int(v.group(4)), "fps": float(v.group(5)),
            "duration_s": int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)), "faststart": faststart(path)}
