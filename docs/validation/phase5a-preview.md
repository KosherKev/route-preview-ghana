# Phase 5A verification record (2026-11-21)

Real commands against the live local PostGIS and Valhalla, `MAPILLARY_TOKEN` unset (`env -u MAPILLARY_TOKEN`), zero Mapillary calls (the
backend never reaches Mapillary for any of this: preview reads stored frames, the clip cache and the `landmarks` table). Photon stayed
stopped (every name lookup answered from the local landmarks table with `degraded: true`). No imagery was saved anywhere in the repo; the
clip cache copy and the bundle live under gitignored `data/`.

## Requests used (coordinates only)

All `POST /preview` with `"costing": "motor_scooter"`, origin Kwame Nkrumah Interchange `{"lat": 5.5696, "lon": -0.2152}`:

| Route | Destination | What it shows |
| --- | --- | --- |
| A | `{"lat": 5.575256, "lon": -0.188504}` | A ready prototype clip (edge 671625527824, 2.8 MB), a street segment with no clip (`not_rendered`) and two flyover segments. The clip starts before the 500 m approach window, so `timeline.startM` (2653.8) is earlier than `approach.startM` (2824.1). |
| B | `{"lat": 5.576621, "lon": -0.187788}` | Street segment with no rendered clip: `status: not_rendered`, `clip: null`, flyover keyframes to play instead. |
| C | origin `{"lat": 6.6885, "lon": -1.6244}` (Kumasi), destination `{"lat": 6.7010, "lon": -1.6000}` | All flyover (`no_frames`), empty attribution, `requiresLogoAndLink: false`. |

Each response validated against `docs/api/preview-manifest.schema.json` with ajv (draft-07, strict): all three VALID. Ambiguous name
(`origin_query: "Total"`, 5 candidates): 422 `application/problem+json`. A body carrying `current_position`: 400 "unknown field".

## Manifest example, route A (abbreviated, no polylines or imagery)

```json
{
 "manifestVersion": 1,
 "prototype": true,
 "degraded": false,
 "route": {
  "lengthM": 3324.1
 },
 "approach": {
  "requestedLengthM": 500,
  "lengthM": 500,
  "startM": 2824.1,
  "endM": 3324.1,
  "wholeRoute": false
 },
 "timeline": {
  "startM": 2653.8,
  "endM": 3324.1,
  "lengthM": 670.2
 },
 "segments": [
  {
   "index": 0,
   "mode": "STREET_VIDEO",
   "startM": 2653.8,
   "endM": 2824.4,
   "playback": "clip",
   "playbackReason": "clip_ready",
   "status": "ready",
   "nominalDurationSec": 17.1,
   "captureYears": {
    "min": 2024,
    "max": 2024
   },
   "clip": {
    "edge_id": 671625527824,
    "direction": "forward",
    "key": "671625527824/forward.mp4",
    "status": "ready",
    "durationSec": 17.051,
    "bytes": 2812277,
    "servePath": "/clips/671625527824/forward.mp4"
   }
  },
  {
   "index": 1,
   "mode": "BIRDS_EYE_3D",
   "startM": 2824.4,
   "endM": 3061.1,
   "playback": "flyover",
   "playbackReason": "level_uncertain",
   "status": null,
   "nominalDurationSec": 7.9,
   "captureYears": null,
   "flyover": {
    "durationSec": 7.9,
    "keyframes": 9,
    "first": {
     "t": 0,
     "offsetM": 2824.37,
     "bearingDeg": 124.53,
     "pitchDeg": 35,
     "zoom": 14.5
    },
    "last": {
     "t": 7.89,
     "offsetM": 3061.1,
     "bearingDeg": 29.15,
     "pitchDeg": 60,
     "zoom": 16
    }
   }
  },
  {
   "index": 2,
   "mode": "STREET_VIDEO",
   "startM": 3061.1,
   "endM": 3133.8,
   "playback": "flyover",
   "playbackReason": "clip_not_rendered",
   "status": "not_rendered",
   "nominalDurationSec": 6,
   "captureYears": {
    "min": 2024,
    "max": 2024
   },
   "clipRef": {
    "edge_id": 670786667024,
    "direction": "forward",
    "key": "670786667024/forward.mp4"
   },
   "flyover": {
    "durationSec": 6,
    "keyframes": 7,
    "first": {
     "t": 0,
     "offsetM": 3061.1,
     "bearingDeg": 29.15,
     "pitchDeg": 60,
     "zoom": 16
    },
    "last": {
     "t": 6,
     "offsetM": 3133.8,
     "bearingDeg": 24.21,
     "pitchDeg": 60,
     "zoom": 16
    }
   }
  },
  {
   "index": 3,
   "mode": "BIRDS_EYE_3D",
   "startM": 3133.8,
   "endM": 3324.1,
   "playback": "flyover",
   "playbackReason": "level_uncertain",
   "status": null,
   "nominalDurationSec": 6.3,
   "captureYears": null,
   "flyover": {
    "durationSec": 6.3,
    "keyframes": 8,
    "first": {
     "t": 0,
     "offsetM": 3133.8,
     "bearingDeg": 24.21,
     "pitchDeg": 60,
     "zoom": 16
    },
    "last": {
     "t": 6.34,
     "offsetM": 3324.08,
     "bearingDeg": 30.39,
     "pitchDeg": 68,
     "zoom": 17.5
    }
   }
  }
 ],
 "overlays": {
  "turns": [
   {
    "offsetM": 2638.0,
    "maneuver": "fork_right",
    "direction": "right",
    "kind": "ramp_or_fork",
    "streetName": "Ring Road Central"
   },
   {
    "offsetM": 2864.4,
    "maneuver": "roundabout_enter",
    "direction": "straight",
    "kind": "roundabout",
    "streetName": "Ako Adjei Interchange"
   },
   {
    "offsetM": 2941.5,
    "maneuver": "roundabout_exit",
    "direction": "straight",
    "kind": "roundabout",
    "streetName": "Independence Avenue"
   }
  ],
  "landmarks": [
   {
    "offsetM": 2753.5,
    "name": "Sankara",
    "category": "tro_tro_stop",
    "side": "left",
    "distanceM": 35.1
   },
   {
    "offsetM": 3095.0,
    "name": "Sankara",
    "category": "tro_tro_stop",
    "side": "right",
    "distanceM": 4.1
   }
  ]
 },
 "captureYears": {
  "min": 2024,
  "max": 2024
 },
 "attribution": {
  "sources": [
   "mapillary"
  ],
  "creators": [
   "RabiatuHijabGirl1"
  ],
  "licenses": [
   "CC-BY-SA-4.0"
  ],
  "requiresLogoAndLink": true
 },
 "sourcesExcluded": []
}
```

## Transcript

```
##### default server (clip serving OFF)
HTTP/1.1 404 Not Found
content-type: application/problem+json
preview A HTTP 200
preview B HTTP 200
preview C HTTP 200
/tmp/finalA.json VALID 
/tmp/finalB.json VALID 
/tmp/finalC.json VALID 
ambiguous HTTP 422 application/problem+json
Ambiguous place origin_query 5 candidates
{"type":"about:blank","title":"Invalid request","status":400,"detail":"unknown field \"current_position\""} <- live-position field HTTP 400
##### PROTOTYPE_CLIP_SERVING=1, loopback
--- HEAD
HTTP/1.1 200 OK
content-type: video/mp4
accept-ranges: bytes
x-prototype: true
cache-control: no-store
x-content-type-options: nosniff
content-length: 2812277
Date: Sat, 21 Nov 2026 12:17:31 GMT
Connection: keep-alive
Keep-Alive: timeout=5

--- Range 0-99 headers only
HTTP/1.1 206 Partial Content
content-type: video/mp4
accept-ranges: bytes
x-prototype: true
cache-control: no-store
x-content-type-options: nosniff
content-length: 100
content-range: bytes 0-99/2812277
Date: Sat, 21 Nov 2026 12:17:31 GMT
Connection: keep-alive
Keep-Alive: timeout=5

--- Range unsatisfiable
HTTP/1.1 416 Range Not Satisfiable
content-type: video/mp4
accept-ranges: bytes
x-prototype: true
cache-control: no-store
x-content-type-options: nosniff
content-range: bytes */2812277
content-length: 0
Date: Sat, 21 Nov 2026 12:17:31 GMT
Connection: keep-alive
Keep-Alive: timeout=5

--- traversal (--path-as-is)
/clips/../.env -> 400
/clips/671625527824/../../.env -> 400
/clips/%2e%2e/.env -> 400
/clips/671625527824/forward.mp4/../.. -> 400
unregistered /clips/123/forward.mp4 -> 404
##### kill switch IMAGERY_SOURCES_DISABLED=mapillary + clip serving ON
HTTP/1.1 403 Forbidden
content-type: application/problem+json
content-length: 110
preview with kill switch HTTP 200
modes ['BIRDS_EYE_3D'] sourcesExcluded ['mapillary']
```

## Offline bundle for route A (real, not committed)

`POST /preview/bundle` with the route A request, written to `data/bundles/1d87bb44b4f4cecf.rpgbundle.tar` (gitignored, mode 600):
2,837,504 bytes (cap 25 MB), tar sha256 `bd75f5418f3ca174ac42ecc8756c69ede261a0446448eb7c79521078d7f15bfa`, `contentHash`
`1d87bb44b4f4cecf26a924a886861fd1583c4e95611058509679d2b15b29b8fa`, 7-day expiry, `prototype: true`, `shareable: false`, one clip
(`clips/671625527824_forward.mp4`, 2,812,277 bytes, sha256 `c8528412ee653a7885572757ea6f474d27fce32ef8f41ba689929d664fa69f1e`),
`preview.json` 17,101 bytes, empty reserved `tiles/`. System `tar -tvf` reads it.

## Test suites per commit (vitest / pytest / tsc, token unset)

| Commit | vitest | pytest | tsc |
| --- | --- | --- | --- |
| main e25e7a3 (baseline) | 363 passed, 2 skipped | 48 | ok |
| Add flyover camera keyframes to sceneDirector | 373 passed, 2 skipped | 48 | ok |
| Add turn event and landmark callout derivation | 382 passed, 2 skipped | 48 | ok |
| Add preview manifest builder, JSON Schema and boundary tests | 413 passed, 2 skipped | 48 | ok |
| Add POST /preview endpoint with Postgres-backed lookups | 423 passed, 2 skipped | 48 | ok |
| Add flag-gated loopback dev clip serving | 438 passed, 2 skipped | 48 | ok |
| Add offline preview bundle packaging | 453 passed, 2 skipped | 48 | ok |
| Add PMTiles spike script, stats tool and report | 453 passed, 2 skipped | 48 | ok |

The 2 skipped tests are the pre-existing Photon-needed ones (Photon is stopped by default).
