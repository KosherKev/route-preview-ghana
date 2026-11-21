import cv2
import numpy as np
import pytest

from rpg_worker.normalise import MAX_CROP_FRACTION, crop_fraction, normalise
from rpg_worker.stabilise import MAX_TILT_DEG, estimate_tilt_deg, rotate_level, smooth_angles, stabilise_sequence


def test_every_aspect_becomes_1280x720():
    for w, h in [(2048, 1536), (1024, 768), (1920, 1080), (1000, 1000), (640, 1136), (3000, 500), (320, 240)]:
        out = normalise(np.full((h, w, 3), 90, np.uint8))
        assert out.shape == (720, 1280, 3), (w, h)


def test_4_3_is_cropped_not_letterboxed():
    img = np.zeros((1536, 2048, 3), np.uint8)
    img[:, :, 1] = 200
    out = normalise(img)
    assert crop_fraction(2048, 1536) == pytest.approx(0.25)
    assert crop_fraction(2048, 1536) <= MAX_CROP_FRACTION
    assert out[:, :, 1].min() == 200  # fully filled, no black bars


def test_square_is_letterboxed_with_black_bars_not_stretched():
    img = np.full((1000, 1000, 3), 255, np.uint8)
    assert crop_fraction(1000, 1000) > MAX_CROP_FRACTION
    out = normalise(img)
    assert out[:, :10].max() == 0 and out[:, -10:].max() == 0  # side bars
    cols = np.where(out[360].max(axis=1) > 0)[0]
    assert cols.max() - cols.min() + 1 == pytest.approx(720, abs=2)  # a 720x720 picture: aspect preserved


def test_16_9_passthrough_dimensions():
    assert normalise(np.zeros((1080, 1920, 3), np.uint8)).shape[:2] == (720, 1280)


def scene(tilt_deg, w=1280, h=720):
    img = np.full((h, w, 3), 140, np.uint8)
    img[: h // 2] = (210, 190, 160)  # sky over ground: a clear horizon edge
    img[h // 2:] = (60, 90, 70)
    for x in range(0, w, 160):
        cv2.line(img, (x, h // 2 + 30), (x + 60, h // 2 + 30), (20, 20, 20), 3)
    m = cv2.getRotationMatrix2D((w / 2, h / 2), -tilt_deg, 1.0)  # rotate the scene clockwise by tilt_deg
    return cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REPLICATE)


@pytest.mark.parametrize("tilt", [-3.5, -2.0, 3.0, 3.9])
def test_estimates_and_removes_tilt(tilt):
    img = scene(tilt)
    est = estimate_tilt_deg(img)
    assert est is not None and est == pytest.approx(tilt, abs=1.0)
    fixed = rotate_level(img, est)
    resid = estimate_tilt_deg(fixed)
    assert resid is None or abs(resid) < 1.0
    assert fixed.shape == img.shape


def test_level_image_is_left_alone():
    img = scene(0.0)
    est = estimate_tilt_deg(img)
    assert est is None or abs(est) < 0.6
    assert np.array_equal(rotate_level(img, 0.0), img)


def test_no_evidence_means_no_correction():
    noise = np.random.default_rng(0).integers(0, 255, (720, 1280, 3), dtype=np.uint8)
    imgs, applied = stabilise_sequence([cv2.GaussianBlur(noise, (61, 61), 0)])
    assert applied == [0.0]


def test_correction_is_clamped():
    img = scene(0.0)
    out = rotate_level(img, 30.0)
    ref = rotate_level(img, MAX_TILT_DEG)
    assert np.array_equal(out, ref)


def test_smoothing_rejects_one_outlier_and_fills_gaps():
    assert smooth_angles([2.0, 2.1, 9.0, 2.0, 2.2]) == [2.0, 2.1, 2.1, 2.1, 2.0] or max(smooth_angles([2.0, 2.1, 9.0, 2.0, 2.2])) < 3
    assert smooth_angles([None, None]) == [0.0, 0.0]
    assert smooth_angles([None, 3.0])[0] == 3.0
