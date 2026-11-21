"""Normalise every frame to 1280x720.

Rule (stated and tested): scale the image to COVER the target, then centre-crop. If covering would discard more than
MAX_CROP_FRACTION of either dimension (very tall or very wide sources such as square images), LETTERBOX instead: scale to
fit inside the target and pad with black. Never stretch."""
from __future__ import annotations

import cv2
import numpy as np

OUT_W, OUT_H = 1280, 720
MAX_CROP_FRACTION = 0.35


def crop_fraction(src_w: int, src_h: int, out_w: int = OUT_W, out_h: int = OUT_H) -> float:
    """Fraction of the scaled-to-cover image that a centre crop would discard."""
    scale = max(out_w / src_w, out_h / src_h)
    sw, sh = src_w * scale, src_h * scale
    return 1.0 - (out_w * out_h) / (sw * sh)


def normalise(img: np.ndarray, out_w: int = OUT_W, out_h: int = OUT_H) -> np.ndarray:
    h, w = img.shape[:2]
    if crop_fraction(w, h, out_w, out_h) <= MAX_CROP_FRACTION:
        scale = max(out_w / w, out_h / h)
        nw, nh = max(out_w, round(w * scale)), max(out_h, round(h * scale))
        r = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
        x0, y0 = (nw - out_w) // 2, (nh - out_h) // 2
        return r[y0:y0 + out_h, x0:x0 + out_w].copy()
    scale = min(out_w / w, out_h / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    r = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    canvas = np.zeros((out_h, out_w, 3), dtype=img.dtype)
    x0, y0 = (out_w - nw) // 2, (out_h - nh) // 2
    canvas[y0:y0 + nh, x0:x0 + nw] = r
    return canvas
