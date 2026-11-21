"""Horizon / tilt stabilisation with OpenCV.

Per frame: estimate the roll angle from long, near-horizontal edges (Canny + probabilistic Hough, length-weighted median),
smooth the angles across the sequence with a moving median so the clip does not jitter, then rotate each frame by the
negative smoothed angle about its centre with a zoom that keeps the borders covered. Corrections are clamped to
MAX_TILT_DEG and skipped when too few usable lines are found (so a frame with no horizon evidence is left alone)."""
from __future__ import annotations

import math
from collections.abc import Sequence

import cv2
import numpy as np

MAX_TILT_DEG = 8.0
HORIZONTAL_WINDOW_DEG = 20.0  # only lines within this many degrees of horizontal count as horizon evidence
MIN_EVIDENCE = 0.3  # total length of near-horizontal lines, as a fraction of image width


def estimate_tilt_deg(img: np.ndarray) -> float | None:
    """Roll in degrees (positive = the scene appears rotated clockwise on screen, i.e. lines slope downward to the right),
    or None when there is not enough evidence."""
    h, w = img.shape[:2]
    scale = 640.0 / w if w > 640 else 1.0
    small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale != 1.0 else img
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 60, 160)
    sh, sw = edges.shape
    min_len = int(sw * 0.15)
    lines = cv2.HoughLinesP(edges, 1, math.pi / 360, threshold=40, minLineLength=min_len, maxLineGap=int(sw * 0.04))
    if lines is None:
        return None
    angles, weights = [], []
    for x1, y1, x2, y2 in lines[:, 0]:
        ang = math.degrees(math.atan2(y2 - y1, x2 - x1))  # image y points down, so +ang = slopes downward to the right
        if ang > 90:
            ang -= 180
        elif ang < -90:
            ang += 180
        if abs(ang) <= HORIZONTAL_WINDOW_DEG:
            angles.append(ang)
            weights.append(math.hypot(x2 - x1, y2 - y1))
    if not angles or sum(weights) < MIN_EVIDENCE * sw:
        return None
    order = np.argsort(angles)
    a, wts = np.array(angles)[order], np.array(weights)[order]
    cum = np.cumsum(wts)
    return float(a[int(np.searchsorted(cum, cum[-1] / 2.0))])  # weighted median


def smooth_angles(angles: Sequence[float | None], window: int = 5) -> list[float]:
    """Moving median over the sequence; None (no evidence) is treated as 'use neighbours', or 0 if there are none."""
    vals = [a for a in angles if a is not None]
    if not vals:
        return [0.0] * len(angles)
    filled: list[float] = []
    last = None
    for a in angles:
        if a is not None:
            last = a
        filled.append(last if last is not None else vals[0])
    half = window // 2
    out = []
    for i in range(len(filled)):
        seg = sorted(filled[max(0, i - half): i + half + 1])
        out.append(seg[len(seg) // 2])
    return out


def rotate_level(img: np.ndarray, tilt_deg: float) -> np.ndarray:
    """Undo `tilt_deg` (clamped), zooming just enough that no black corner shows."""
    t = max(-MAX_TILT_DEG, min(MAX_TILT_DEG, tilt_deg))
    if abs(t) < 0.05:
        return img
    h, w = img.shape[:2]
    rad = math.radians(abs(t))
    zoom = math.cos(rad) + (max(w / h, h / w)) * math.sin(rad)
    # cv2 positive angle = counter-clockwise; scene tilted clockwise by t needs a counter-clockwise rotation by t.
    m = cv2.getRotationMatrix2D((w / 2, h / 2), t, zoom)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def stabilise_sequence(images: Sequence[np.ndarray]) -> tuple[list[np.ndarray], list[float]]:
    """Returns (levelled images, applied correction in degrees per frame)."""
    smoothed = smooth_angles([estimate_tilt_deg(im) for im in images])
    return [rotate_level(im, a) for im, a in zip(images, smoothed)], smoothed
