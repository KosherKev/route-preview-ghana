"""Author assets/fixtures/mixed-manifest.json: a SYNTHETIC manifest with all four segment cases, for tests and demos.

It reuses the real Accra route geometry from accra-real-manifest.json (OSM routing only) and invents everything else:
clip keys, names, overlays and the attribution. No Mapillary data, no imagery.

  seg 0  STREET_VIDEO  ready, clip 900001/forward.mp4 (the demo/test clip is pushed to the device), flyover null
  seg 1  BIRDS_EYE_3D  flyover keyframes
  seg 2  STREET_VIDEO  not_rendered, flyover keyframes            (clip missing, flyover present)
  seg 3  STREET_VIDEO  ready, clip 900002/forward.mp4 (never on the device), flyover null   (clip missing, no flyover)

Run from flutter_app/:  python3 tool/make_mixed_fixture.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'assets', 'fixtures', 'accra-real-manifest.json')
OUT = os.path.join(HERE, '..', 'assets', 'fixtures', 'mixed-manifest.json')
real = json.load(open(SRC))
POLY = real['route']['polyline6']
LENGTH = real['route']['lengthM']


def decode(enc):
    pts, i, lat, lon = [], 0, 0, 0
    while i < len(enc):
        for which in (0, 1):
            r = s = 0
            while True:
                b = ord(enc[i]) - 63
                i += 1
                r |= (b & 0x1f) << s
                s += 5
                if b < 0x20:
                    break
            d = ~(r >> 1) if r & 1 else r >> 1
            if which == 0:
                lat += d
            else:
                lon += d
        pts.append((lat / 1e6, lon / 1e6))
    return pts


def hav(a, b):
    r = 6371008.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl, dn = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dl / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dn / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(h)))


PTS = decode(POLY)
CUM = [0.0]
for a, b in zip(PTS, PTS[1:]):
    CUM.append(CUM[-1] + hav(a, b))
SCALE = LENGTH / CUM[-1]
CUM = [c * SCALE for c in CUM]


def at(off):
    off = max(0.0, min(LENGTH, off))
    for i in range(1, len(CUM)):
        if CUM[i] >= off:
            f = 0 if CUM[i] == CUM[i - 1] else (off - CUM[i - 1]) / (CUM[i] - CUM[i - 1])
            a, b = PTS[i - 1], PTS[i]
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
    return PTS[-1]


def bearing(a, b):
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(math.radians(b[0]))
    x = math.cos(math.radians(a[0])) * math.sin(math.radians(b[0])) - math.sin(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def keyframes(start, end, duration):
    n = max(3, int(math.ceil((end - start) / 40.0)))
    out, prev = [], None
    for i in range(n + 1):
        f = i / n
        off = start + (end - start) * f
        c = at(off)
        b = bearing(c, at(min(LENGTH, off + 60)))
        if prev is not None:
            d = ((b - prev + 540) % 360) - 180
            if abs(d) > 20:
                b = (prev + math.copysign(20, d)) % 360
        prev = b
        out.append({'t': round(duration * f, 3), 'offsetM': round(off, 2), 'lat': round(c[0], 6), 'lon': round(c[1], 6),
                    'bearingDeg': round(b % 360, 2), 'pitchDeg': 60.0, 'zoom': 16.5, 'easing': 'linear' if i == 0 else 'cubic-in-out'})
    return out


def flyover(start, end):
    dur = round(max(6.0, min(90.0, (end - start) / 30.0)), 3)
    return {'durationSec': dur, 'nominalSpeedMps': round((end - start) / dur, 2), 'keyframes': keyframes(start, end, dur)}


def clip(key, dur, length):
    return {'edge_id': int(key.split('/')[0]), 'direction': 'forward', 'key': key, 'status': 'ready', 'durationSec': dur, 'fps': 24,
            'speedMps': round(length / dur, 2), 'bytes': CLIP_BYTES.get(key, 200000), 'lengthM': length, 'servePath': '/clips/' + key,
            'startPose': {}, 'endPose': {}}


def seg(i, mode, s, e, playback, reason, status, clipref, clp, fly, years):
    return {'index': i, 'mode': mode, 'startM': s, 'endM': e, 'lengthM': round(e - s, 2), 'polyline6': '', 'playback': playback,
            'playbackReason': reason, 'nominalDurationSec': (clp or fly or {'durationSec': 10})['durationSec'],
            'nominalSpeedMps': 10, 'status': status, 'clipRef': clipref, 'clip': clp, 'bridges': [], 'captureYears': years, 'flyover': fly}


CLIP_BYTES = {'900001/forward.mp4': 381093}  # the demo clip made by tool/make_test_clip.swift
CLIP_A, CLIP_B = '900001/forward.mp4', '900002/forward.mp4'
ref = lambda k: {'edge_id': int(k.split('/')[0]), 'direction': 'forward', 'key': k}
b1, b2, b3 = 5100.0, 5400.0, 5550.0
segments = [
    seg(0, 'STREET_VIDEO', 4800.0, b1, 'clip', 'clip_ready', 'ready', ref(CLIP_A), clip(CLIP_A, 8.0, b1 - 4800.0), None, {'min': 2024, 'max': 2024}),
    seg(1, 'BIRDS_EYE_3D', b1, b2, 'flyover', 'no_frames', None, None, None, flyover(b1, b2), None),
    seg(2, 'STREET_VIDEO', b2, b3, 'flyover', 'clip_not_rendered', 'not_rendered', ref('900003/forward.mp4'), None, flyover(b2, b3), {'min': 2024, 'max': 2024}),
    seg(3, 'STREET_VIDEO', b3, LENGTH, 'clip', 'clip_ready', 'ready', ref(CLIP_B), clip(CLIP_B, 9.0, LENGTH - b3), None, {'min': 2024, 'max': 2024}),
]


def landmark(off, name, cat, kind, side, dist, osm):
    p = at(off)
    return {'offsetM': off, 'name': name, 'category': cat, 'kind': kind, 'side': side, 'distanceM': dist, 'lat': round(p[0], 6), 'lon': round(p[1], 6), 'osm': osm}


def turn(off, man, direction, kind, street):
    return {'offsetM': off, 'maneuver': man, 'direction': direction, 'kind': kind, 'streetName': street, 'window': {'startM': off - 80, 'endM': off}}


manifest = {
    'manifestVersion': 1, 'prototype': True, 'degraded': False, 'costing': 'motor_scooter', 'unpavedFallback': False,
    'warnings': ['SYNTHETIC mixed manifest: invented clips, overlays and attribution on the real Accra route geometry.'],
    'origin': real['origin'], 'destination': real['destination'],
    'route': real['route'],
    'approach': {'requestedLengthM': 500, 'lengthM': 500, 'startM': round(LENGTH - 500, 2), 'endM': LENGTH, 'wholeRoute': False},
    'timeline': {'startM': 4800.0, 'endM': round(LENGTH, 2), 'lengthM': round(LENGTH - 4800.0, 2)},
    'nominal': {'streetSpeedMps': 10, 'flyoverSpeedMps': 30, 'note': 'synthetic'},
    'segments': segments,
    'overlays': {
        'turns': [turn(5000.0, 'left', 'left', 'turn', 'Synthetic Street'), turn(5450.0, 'slight_right', 'right', 'turn', None),
                  turn(5650.0, 'roundabout_enter', 'straight', 'roundabout', 'Test Roundabout')],
        'landmarks': [landmark(4850.0, 'Synthetic Cafe', 'amenity', 'cafe', 'left', 12.0, 'node/1'),
                      landmark(5200.0, 'Test Pharmacy', 'amenity', 'pharmacy', 'right', 18.5, 'node/2'),
                      landmark(5460.0, 'Sample Market', 'shop', 'marketplace', 'left', 25.0, 'way/3'),
                      landmark(5700.0, 'Demo Fuel Station', 'amenity', 'fuel', 'right', 9.0, 'node/4')],
        'turnWindowM': 80, 'landmarkOptions': {'maxDistanceM': 40, 'maxPer100m': 3, 'dedupeWithinM': 100},
    },
    'captureYears': {'min': 2024, 'max': 2024},
    'attribution': {
        'bySource': [{'source': 'synthetic-test', 'creators': ['Test pattern generator'], 'licenses': ['CC0-1.0'], 'sourceUrls': [], 'requiresLogoAndLink': False}],
        'sources': ['synthetic-test'], 'creators': ['Test pattern generator'], 'licenses': ['CC0-1.0'], 'sourceUrls': [], 'requiresLogoAndLink': False,
    },
    'sourcesExcluded': [],
}
with open(OUT, 'w') as f:
    json.dump(manifest, f, indent=1)
    f.write('\n')
print('wrote', os.path.relpath(OUT), 'segments', [(s['index'], s['mode'], s['playback'], s['status']) for s in segments])
