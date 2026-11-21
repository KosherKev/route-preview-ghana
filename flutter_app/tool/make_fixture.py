"""Generate the SYNTHETIC offline fixture under assets/fixtures/.

Everything here is invented: the route, the building footprints and heights, the clock. No imagery,
nothing derived from Mapillary, no real survey data. The coordinates only place the invented scene
near Accra so the numbers look plausible.

Run from flutter_app/:  python3 tool/make_fixture.py
"""
import json
import math
import os
import random

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "fixtures")
LAT0, LON0 = 5.5900, -0.2000
M_LAT = 111_320.0
M_LON = 111_320.0 * math.cos(math.radians(LAT0))


def to_ll(x, y):
    return (LAT0 + y / M_LAT, LON0 + x / M_LON)


def chaikin(pts, n):
    for _ in range(n):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        out.append(pts[-1])
        pts = out
    return pts


# Invented route in local metres (x east, y north).
WAYPOINTS = [(0, 0), (0, 260), (170, 400), (470, 420), (620, 560), (640, 900)]
ROUTE = chaikin([(float(x), float(y)) for x, y in WAYPOINTS], 3)
CUM = [0.0]
for a, b in zip(ROUTE, ROUTE[1:]):
    CUM.append(CUM[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
LENGTH = CUM[-1]


def point_at(off):
    off = max(0.0, min(LENGTH, off))
    for i in range(1, len(CUM)):
        if CUM[i] >= off:
            seg = CUM[i] - CUM[i - 1]
            f = 0.0 if seg == 0 else (off - CUM[i - 1]) / seg
            a, b = ROUTE[i - 1], ROUTE[i]
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
    return ROUTE[-1]


def bearing_deg(a, b):
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 360.0


def cut(start, end):
    pts = [point_at(start)]
    pts += [p for p, c in zip(ROUTE, CUM) if start < c < end]
    pts.append(point_at(end))
    return pts


def polyline6(points_xy):
    out, plat, plon = [], 0, 0
    for x, y in points_xy:
        lat, lon = to_ll(x, y)
        la, lo = round(lat * 1e6), round(lon * 1e6)
        for d in (la - plat, lo - plon):
            v = ~(d << 1) if d < 0 else d << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = la, lo
    return "".join(out)


def ang_diff(a, b):
    return ((b - a + 540.0) % 360.0) - 180.0


def keyframes(start, end, duration, settle):
    """Swoop in (first segment only is wide), follow, optional settle. Spacing keeps bearing steps <= 20 deg."""
    n = max(4, int(math.ceil((end - start) / 25.0)))
    kfs, prev_b = [], None
    for i in range(n + 1):
        f = i / n
        off = start + (end - start) * f
        c = point_at(off)
        b = bearing_deg(c, point_at(min(LENGTH, off + 60.0)))
        if prev_b is not None:
            step = ang_diff(prev_b, b)
            if abs(step) > 20.0:
                b = (prev_b + math.copysign(20.0, step)) % 360.0
        prev_b = b
        pitch, zoom = 62.0, 17.0
        if settle and f > 0.7:
            k = (f - 0.7) / 0.3
            pitch, zoom = 62.0 + 10.0 * k, 17.0 + 1.2 * k
        lat, lon = to_ll(*c)
        kfs.append({
            "t": round(duration * f, 3), "offsetM": round(off, 2),
            "lat": round(lat, 6), "lon": round(lon, 6),
            "bearingDeg": round(b % 360.0, 2), "pitchDeg": round(pitch, 1), "zoom": round(zoom, 2),
            "easing": "linear" if i == 0 else "cubic-in-out",
        })
    return kfs


def main():
    os.makedirs(OUT, exist_ok=True)
    length = round(LENGTH, 1)
    appr_start = round(length - 500.0, 1)
    tl_start = round(appr_start - 170.3, 1)  # a "clip" segment overlapping the window: starts before it
    split = round(appr_start + 40.0, 1)
    segs = []
    for idx, (s, e, settle) in enumerate([(tl_start, split, False), (split, length, True)]):
        seg_len = round(e - s, 1)
        dur = round(min(90.0, max(6.0, seg_len / 30.0)), 1)
        base = {
            "index": idx, "startM": s, "endM": e, "lengthM": seg_len,
            "polyline6": polyline6(cut(s, e)), "playback": "flyover",
            "nominalDurationSec": dur, "nominalSpeedMps": round(seg_len / dur, 2),
            "bridges": [], "captureYears": None,
        }
        fly = {"durationSec": dur, "nominalSpeedMps": round(seg_len / dur, 2), "keyframes": keyframes(s, e, dur, settle)}
        if idx == 0:  # street segment whose clip was never rendered -> flyover fallback
            base.update(mode="STREET_VIDEO", playbackReason="clip_not_rendered", status="not_rendered",
                        clipRef={"edge_id": 1, "direction": "forward", "key": "1/forward.mp4"}, clip=None, flyover=fly)
        else:
            base.update(mode="BIRDS_EYE_3D", playbackReason="no_frames", status=None, clipRef=None, clip=None, flyover=fly)
        segs.append(base)
    o, d = to_ll(*ROUTE[0]), to_ll(*ROUTE[-1])
    manifest = {
        "manifestVersion": 1, "prototype": True, "degraded": False, "costing": "motor_scooter", "unpavedFallback": False,
        "warnings": ["SYNTHETIC FIXTURE: invented route and buildings, no real data."],
        "origin": {"lat": round(o[0], 6), "lon": round(o[1], 6)},
        "destination": {"lat": round(d[0], 6), "lon": round(d[1], 6)},
        "route": {"lengthM": length, "timeSec": round(length / 6.0, 1), "polyline6": polyline6(ROUTE)},
        "approach": {"requestedLengthM": 500, "lengthM": 500, "startM": appr_start, "endM": length, "wholeRoute": False},
        "timeline": {"startM": tl_start, "endM": length, "lengthM": round(length - tl_start, 1)},
        "nominal": {"streetSpeedMps": 6, "flyoverSpeedMps": 30, "note": "synthetic fixture"},
        "segments": segs,
        "overlays": {"turns": [], "landmarks": [], "turnWindowM": 80,
                     "landmarkOptions": {"maxDistanceM": 40, "maxPer100m": 3, "dedupeWithinM": 100}},
        "captureYears": None,
        "attribution": {"bySource": [], "sources": [], "creators": [], "licenses": [], "sourceUrls": [], "requiresLogoAndLink": False},
        "sourcesExcluded": [],
    }

    rnd = random.Random(20261121)
    placed = []
    feats = []
    for _ in range(4000):
        if len(feats) >= 90:
            break
        off = rnd.uniform(-60, LENGTH + 60)
        c = point_at(off)
        b = math.radians(bearing_deg(point_at(max(0, off - 5)), point_at(min(LENGTH, off + 5))))
        side = rnd.choice((-1, 1))
        dist = rnd.uniform(22, 70)
        cx = c[0] + side * dist * math.cos(b)
        cy = c[1] - side * dist * math.sin(b)
        if any(math.hypot(cx - px, cy - py) < 30 for px, py in placed):
            continue
        if min(math.hypot(cx - p[0], cy - p[1]) for p in (point_at(k * 5.0) for k in range(int(LENGTH // 5) + 1))) < 20:
            continue
        w, h = rnd.uniform(10, 22), rnd.uniform(10, 22)
        corners = []
        for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
            rx = dx * math.cos(b) + dy * math.sin(b)
            ry = -dx * math.sin(b) + dy * math.cos(b)
            lat, lon = to_ll(cx + rx, cy + ry)
            corners.append([round(lon, 6), round(lat, 6)])
        corners.append(corners[0])
        real = rnd.random() < 0.15
        height = round(rnd.choice((12, 15, 18, 24, 30, 42)), 1) if real else 9.0
        feats.append({"type": "Feature", "properties": {"height": height, "height_source": "osm" if real else "default"},
                      "geometry": {"type": "Polygon", "coordinates": [corners]}})
        placed.append((cx, cy))

    route_ll = [[round(to_ll(*p)[1], 6), round(to_ll(*p)[0], 6)] for p in ROUTE]
    files = {
        "manifest.json": manifest,
        "buildings.geojson": {"type": "FeatureCollection", "features": feats},
        "route.geojson": {"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": route_ll}},
        "style.json": {
            "version": 8, "name": "route-preview-offline",
            "light": {"anchor": "viewport", "color": "#ffffff", "intensity": 0.45, "position": [1.15, 210, 38]},
            "sources": {},
            "layers": [{"id": "background", "type": "background", "paint": {"background-color": "#e8e3d6"}}],
        },
    }
    for name, obj in files.items():
        with open(os.path.join(OUT, name), "w") as f:
            json.dump(obj, f, separators=(",", ":"))
            f.write("\n")
    print("route %.1f m, timeline %.1f..%.1f (approach starts %.1f), %d buildings" % (length, tl_start, length, appr_start, len(feats)))


if __name__ == "__main__":
    main()
