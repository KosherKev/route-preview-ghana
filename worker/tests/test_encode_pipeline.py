import json
import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest

from rpg_worker import ffmpeg as ff
from rpg_worker.gaps import GapError
from rpg_worker.interpolate import HoldInterpolator, MinterpolateInterpolator
from rpg_worker.pipeline import ClipConfig, build_clip, build_keyframes, hold_durations, write_concat_list
from rpg_worker.storage import LocalClipStorage, clip_key

try:
    FFMPEG = ff.find_tool("ffmpeg", "RPG_FFMPEG")
except ff.ToolMissing:
    FFMPEG = None
needs_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")


def test_encode_command_parameters():
    cmd = ff.encode_cmd("ffmpeg", Path("l.txt"), Path("o.mp4"))
    joined = " ".join(cmd)
    for needle in ["libx264", "-crf 27", "+faststart", "scale=1280:720", "format=yuv420p", "-fps_mode cfr", "-r 10", "-an"]:
        assert needle in joined
    assert "drawtext" not in joined and "overlay" not in joined  # no burned-in overlays
    assert "-crf 26" in " ".join(ff.encode_cmd("f", Path("l"), Path("o"), crf=26))
    for bad in (25, 29):
        with pytest.raises(ValueError):
            ff.encode_cmd("f", Path("l"), Path("o"), crf=bad)


def test_crossfade_uses_xfade_and_minterpolate_is_separate():
    xf = " ".join(ff.crossfade_cmd("ffmpeg", Path("a.png"), Path("b.png"), Path("x%03d.png"), 3))
    assert "xfade=transition=fade" in xf and "minterpolate" not in xf
    assert "minterpolate" in " ".join(ff.minterpolate_cmd("ffmpeg", Path("i%d.png"), Path("o%03d.png"), 3))


def test_constant_speed_durations_sum_to_length_over_speed():
    d = hold_durations([0, 8, 16, 24], 0, 24, 10.0)
    assert sum(d) == pytest.approx(2.4)
    assert d[0] == pytest.approx(0.4) and d[1] == pytest.approx(0.8)
    assert sum(hold_durations([0, 5, 20], 0, 20, 5.0)) == pytest.approx(4.0)
    assert hold_durations([], 0, 0, 10.0) == []


def test_concat_list_repeats_last_file(tmp_path):
    write_concat_list([Path("a.jpg"), Path("b.jpg")], [1.0, 2.0], tmp_path / "l.txt")
    lines = (tmp_path / "l.txt").read_text().splitlines()
    assert lines == ["file 'a.jpg'", "duration 1.000000", "file 'b.jpg'", "duration 2.000000", "file 'b.jpg'"]


def test_storage_keys_and_reuse(tmp_path):
    st = LocalClipStorage(tmp_path)
    assert clip_key(42, "forward") == "42/forward.mp4"
    with pytest.raises(ValueError):
        clip_key(42, "../x")
    assert not st.exists(42, "forward")
    src = tmp_path / "src.mp4"
    src.write_bytes(b"x")
    st.put(42, "forward", src, {"result": {"a": 1}})
    assert st.exists(42, "forward") and not st.exists(42, "reverse") and not st.exists(43, "forward")
    assert st.meta(42, "forward")["prototype"] is True


class Boom:
    def download(self, *a, **k):
        raise AssertionError("must not fetch on a cache hit")


def _result_json():
    return {
        "edge_id": 7, "direction": "forward", "clip_key": "7/forward.mp4", "duration_s": 1.0, "fps": 10, "speed_mps": 10.0, "frame_count": 10,
        "source_frames": 2, "interpolated_frames": 0, "bridge_frames": 0, "bridges_used": 0, "interpolator": "hold", "file_bytes": 1,
        "encode_seconds": 0.1, "start_pose": {}, "end_pose": {}, "render_params": {},
    }


def test_second_run_reuses_cached_clip_without_fetch_or_encode(tmp_path):
    st = LocalClipStorage(tmp_path)
    src = tmp_path / "s.mp4"
    src.write_bytes(b"x")
    st.put(7, "forward", src, {"result": _result_json()})
    plan = {"edge_id": 7, "direction": "forward", "frames": [], "bridges": [], "segment": {}}
    res = build_clip(plan, st, Boom(), HoldInterpolator(), "/nonexistent/ffmpeg", tmp_path / "frames")
    assert res.reused is True and res.edge_id == 7


def test_gap_failure_happens_before_any_download(tmp_path):
    plan = {"edge_id": 8, "direction": "forward", "bridges": [], "segment": {"lengthM": 50},
            "frames": [{"image_id": "a", "offsetM": 0, "lat": 0, "lon": 0, "heading_deg": 0}, {"image_id": "b", "offsetM": 40, "lat": 0, "lon": 0, "heading_deg": 0}]}
    with pytest.raises(GapError):
        build_clip(plan, LocalClipStorage(tmp_path), Boom(), HoldInterpolator(), "ffmpeg", tmp_path / "f")


def _img(v):
    im = np.full((720, 1280, 3), v, np.uint8)
    cv2.putText(im, str(v), (200, 400), cv2.FONT_HERSHEY_SIMPLEX, 6, (255, 255, 255), 8)
    return im


def test_keyframes_use_interpolator_only_for_small_gaps_and_xfade_for_bridge(tmp_path):
    class Spy:
        name = "spy"
        gaps_seen = []

        def interpolate(self, a, b, n):
            Spy.gaps_seen.append(n)
            return [a] * n

    plan = {"frames": [{"offsetM": 0}, {"offsetM": 10}, {"offsetM": 30}, {"offsetM": 38}], "bridges": [{"startM": 10, "endM": 30}]}
    imgs = [_img(v) for v in (30, 90, 150, 210)]
    if not FFMPEG:
        pytest.skip("ffmpeg not installed (bridge path needs xfade)")
    assert FFMPEG
    keys = build_keyframes(plan, imgs, Spy(), FFMPEG, ClipConfig())
    kinds = [k.kind for k in keys]
    assert kinds.count("bridge") >= 1 and kinds.count("source") == 4
    assert len(Spy.gaps_seen) == 2  # gaps 0-10 and 30-38 only; the 20 m bridge never reached the interpolator
    pos = [k.pos_m for k in keys]
    assert pos == sorted(pos)
    bridge_imgs = [k.img for k in keys if k.kind == "bridge"]
    assert all(30 < float(b.mean()) < 210 for b in bridge_imgs)


@needs_ffmpeg
def test_end_to_end_encode_probe_and_cache(tmp_path):
    frames_cache = tmp_path / "frames"
    frames_cache.mkdir()
    for i, v in enumerate((40, 100, 160, 220)):
        cv2.imwrite(str(frames_cache / f"i{i}.jpg"), _img(v))

    class Fetch:
        def download(self, image_id, dest):
            return False

    plan = {"edge_id": 99, "direction": "forward", "routeId": "t", "segment": {"lengthM": 38},
            "bridges": [{"startM": 10, "endM": 30}],
            "frames": [{"image_id": f"i{i}", "offsetM": o, "lat": 5.6 + i * 1e-4, "lon": -0.18, "heading_deg": 10.0} for i, o in enumerate((0, 10, 30, 38))]}
    st = LocalClipStorage(tmp_path / "clips")
    res = build_clip(plan, st, Fetch(), MinterpolateInterpolator(FFMPEG), FFMPEG, frames_cache, ClipConfig(), tmp_path)
    assert res.bridges_used == 1 and res.bridge_frames >= 1 and res.reused is False
    info = ff.stream_info(FFMPEG, st.path(99, "forward"))
    assert (info["codec"], info["width"], info["height"], info["pix_fmt"]) == ("h264", 1280, 720, "yuv420p")
    assert info["duration_s"] == pytest.approx(3.8, abs=0.3)
    assert info["fps"] == 10.0 and info["faststart"] is True
    again = build_clip(plan, st, None, HoldInterpolator(), FFMPEG, frames_cache, ClipConfig(), tmp_path)
    assert again.reused is True
