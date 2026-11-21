# Preview timeline API (Phase 5A)

`POST /preview` returns a versioned timeline manifest for a pre-trip route preview: the route, the last ~500 m ("approach window"), the
ordered segments the client plays (street clip or 3D flyover), turn markers, landmark callouts, capture-year indicators and the imagery
attribution. The client (the Phase 5B Flutter app, or any app embedding the API, D5) plays it on a preview clock.

The JSON Schema is [preview-manifest.schema.json](preview-manifest.schema.json) (draft-07, `manifestVersion` 1). Every object in it has
`additionalProperties: false`, so a client can reject anything it does not know. Tests validate real builder output against it and prove
malformed manifests fail (`backend/test/preview-schema.test.ts`).

## Product boundary (enforced in code and tests)

Pre-trip preview only. The manifest is a function of a fixed origin and destination. **No endpoint, parameter or field accepts or stores a
live position, device location or "current position".** `POST /preview` rejects any body field outside the documented list with a 400
(so `current_position` is refused, not ignored). Turn events and landmark callouts are static data keyed by distance along the route
(`offsetM`); the client moves along them with its own preview clock, never with a GPS fix. The Flutter app must not request any location
permission. `backend/test/product-boundary.test.ts` greps the API surface and the schema for live/device/current-position names and for
unknown-field-tolerant schema objects.

## Request

`POST /preview`, `Content-Type: application/json`, loopback only (same binding rules as `/approach`).

| Field | Meaning |
| --- | --- |
| `origin`, `destination` | `{lat, lon}` inside Ghana, or `origin_query` / `destination_query` (a place name, one form per end). |
| `costing` | `motor_scooter` or `auto`. |
| `approach_length_m` | 50..5000, default 500: length of the approach window. |
| `decision_window_m` | 10..500, default 80: width of the window around each maneuver. |
| `landmark_max_distance_m` | 5..200, default 40: landmarks farther from the route are ignored. |
| `landmark_max_per_100m` | integer 1..10, default 3. |

Names resolve exactly as for `/approach` (landmarks table, then Photon). An ambiguous or unconfident name returns the same 422
`application/problem+json` disambiguation response (`title`, `field`, `query`, `degraded`, `candidates`); the client picks a candidate and
resends coordinates. All errors are RFC 9457 problem JSON.

## Response (200)

Top level: `manifestVersion` (1), `prototype` (always `true`: the imagery is prototype-only, D1, and nothing derived from it is served
publicly), `degraded`, `costing`, `unpavedFallback`, `warnings`, `origin`, `destination`, `resolved` (only for named ends), `route`
(`lengthM`, `timeSec`, `polyline6`), `approach`, `timeline`, `nominal`, `segments`, `overlays`, `captureYears`, `attribution`,
`sourcesExcluded`.

- `degraded: true` means a place-name lookup ran without its Photon stage (same meaning as `/geocode`). The route is unaffected.
- `approach` is the last `approach_length_m` of the route. `timeline` is the span the segments actually cover: it starts at
  `approach.startM`, or earlier when a street segment with a ready clip overlaps the window, because a clip is played whole and is never cut.
- `segments` are ordered and contiguous, and cover `timeline` (a flyover sliver shorter than 1 m is dropped). Offsets are metres along the route polyline.

### Segments

Each segment has `index`, `mode` (`STREET_VIDEO` or `BIRDS_EYE_3D`), `startM`, `endM`, `lengthM`, `polyline6` (its geometry), `playback`
(`clip` or `flyover`: what the client plays), `playbackReason`, `nominalDurationSec`, `nominalSpeedMps`, `bridges` (crossfade bridges
inside a street segment, at most 2, same-sequence only), `captureYears` (min and max capture year of the frames in a street segment, for the
capture-date indicator; null for flyover) and:

| Case | `status` | `clip` | `clipRef` | `flyover` | `playback` |
| --- | --- | --- | --- | --- | --- |
| Street segment, clip rendered and cached | `ready` | clip detail (below) | `{edge_id, direction, key}` | camera plan (fallback) | `clip` |
| Street segment, no usable clip | `not_rendered` | **null** | `{edge_id, direction, key}` | camera plan | `flyover` (reason `clip_not_rendered`) |
| Flyover segment | null | null | null | camera plan | `flyover` (reason from the classifier: `no_frames`, `run_too_short`, `gap_too_large`, `level_uncertain`) |

`flyover` is present on EVERY segment. For a street segment with a ready clip it is the fallback: **a client plays the clip when it can
fetch it, and otherwise plays the flyover for that segment.** Over the tailnet the clip door is shut (403), so tailnet clients always take the
flyover path. No new field and no `manifestVersion` bump: the schema only tightens `flyover` from "null for a ready clip" to "always a camera
plan" (a client that ignored `flyover` on clip segments keeps working; a client that rejected non-null `flyover` there must be updated).

A clip is `ready` only when a `clips` row exists for the segment's first edge and direction `forward`, the file is in the local clip cache and
the stored length is within 5 m of the segment length. `POST /preview` never triggers rendering. `clip` detail: `edge_id`, `direction`, `key`,
`status`, `durationSec`, `fps`, `speedMps`, `bytes`, `lengthM`, `servePath`, `startPose`, `endPose`. `servePath` is the dev-only path described
in [clip serving](dev-clip-serving.md); it is not a public URL and works only with `PROTOTYPE_CLIP_SERVING=1` on loopback.

### Flyover camera plan

`flyover` is renderer-neutral data (MapLibre Native animates it later): `durationSec`, `nominalSpeedMps` and `keyframes`. Each keyframe is
`{t, offsetM, lat, lon, bearingDeg, pitchDeg, zoom, easing}`: `t` is seconds into the segment and strictly increases, `offsetM` is the route
position of the camera centre and never decreases, `bearingDeg` is in [0, 360) and changes by at most 20 degrees between keyframes
(shortest arc), `pitchDeg` is 0..80, `zoom` is 12..19, and `easing` (`linear` or `cubic-in-out`) says how to interpolate to the next keyframe.
The shape is swoop in (wide and flat to cruise), follow (the centre rides the route, the bearing looks about 60 m ahead), settle (only on the
segment that ends at the destination: closer and steeper). Durations are nominal (30 m/s, clamped to 6..90 s, so a very long flyover
segment reports a higher nominal speed). **Speed ramps are client work** and are not computed here.

### Overlays

- `overlays.turns`: `{offsetM, maneuver, direction, kind, streetName, window}` for Valhalla maneuvers whose decision window overlaps the
  timeline. `maneuver` is a stable name (`left`, `slight_right`, `roundabout_enter`, `exit_left`, ...); `direction` is `left`, `right`,
  `straight` or `uturn`; `window` is the decision-point window (`decision_window_m` wide, clipped to the route). Start, destination and
  "continue" maneuvers are omitted and spoken instruction text is never included. These are static markers for the preview, not guidance.
- `overlays.landmarks`: `{offsetM, name, category, kind, side, distanceM, lat, lon, osm}` from the `landmarks` table within
  `landmark_max_distance_m` of the route. `side` is `left` or `right` of the direction of travel (a landmark exactly on the centreline counts
  as `right`). De-duplicated (same name within 100 m, or the same OSM object in two categories: the closest to the route is kept), at most
  `landmark_max_per_100m` per 100 m of route (closest first), unnamed landmarks dropped, ordered by `offsetM`.
- `captureYears` (top level) is the min and max capture year over the street segments in the timeline; null when there are none.

### Attribution

`attribution` is built from the frames inside the street segments of the timeline: `bySource[]`, `sources`, `creators`, `licenses`,
`sourceUrls` and `requiresLogoAndLink` (true when any source, today Mapillary, requires its logo and a link back). Empty and `false` for an
all-flyover manifest. `sourcesExcluded` lists sources removed by the kill switch (`IMAGERY_SOURCES_DISABLED`): their frames never reach the
classifier, so affected stretches become flyover segments.

## Example (shape only, no imagery)

```json
{
  "manifestVersion": 1, "prototype": true, "degraded": false, "costing": "motor_scooter",
  "route": {"lengthM": 3189.4, "timeSec": 402, "polyline6": "..."},
  "approach": {"requestedLengthM": 500, "lengthM": 500, "startM": 2689.4, "endM": 3189.4, "wholeRoute": false},
  "timeline": {"startM": 2653.7, "endM": 3189.4, "lengthM": 535.7},
  "segments": [
    {"index": 0, "mode": "STREET_VIDEO", "playback": "clip", "status": "ready", "clip": {"key": "671625527824/forward.mp4", "status": "ready"}, "flyover": {"keyframes": ["..."]}},
    {"index": 1, "mode": "BIRDS_EYE_3D", "playback": "flyover", "status": null, "clip": null, "flyover": {"keyframes": ["..."]}}
  ],
  "overlays": {"turns": [{"offsetM": 2800.1, "maneuver": "left", "direction": "left"}], "landmarks": ["..."]},
  "attribution": {"requiresLogoAndLink": true, "sources": ["mapillary"]}
}
```

## Offline bundle: `POST /preview/bundle`

Same request body, errors and disambiguation as `POST /preview`. It builds the preview, then packages it into **one local tar file** under
`data/bundles/` (gitignored, mode 600) for the app on a simulator or emulator, and answers with a description of that file (path, size,
`contentHash`, `expiresAt`, ...). Nothing is uploaded, published or served, and no endpoint renders a clip. Contents:

| Path | What |
| --- | --- |
| `bundle.json` | Envelope: `bundleVersion` 1, `prototype: true`, `shareable: false`, `createdAt`, `expiresAt`, `contentHash`, `hashAlgorithm`, `files[]` (path, bytes, sha256), `clips[]`, `attribution`, `requiresLogoAndLink`, `tiles: {reserved: true, files: []}`, `notice` |
| `preview.json` | The preview manifest, verbatim |
| `clips/<edge>_<direction>.mp4` | Each READY clip |
| `tiles/` | Reserved, empty (PMTiles slices come later) |

- **Size cap**: 25 MB by default (`BUNDLE_MAX_BYTES`), measured on the finished archive. Above it the request fails with 413
  `application/problem+json` ("Bundle too large", with the actual and permitted sizes); nothing is written.
- **Expiry**: `expiresAt` is `createdAt` + 7 days by default (`BUNDLE_TTL_DAYS`). A client must discard an expired bundle.
- **Content hash**: sha256 over the canonical (key-sorted) preview manifest and, for each clip sorted by key, `key bytes sha256(clip)`. It
  contains no timestamp, so it is stable for the same manifest and clips and changes if either changes, even by one byte of one clip. The
  envelope records it so a client can detect changed imagery. It lives in the `bundle.json` envelope, not in `preview.json` (a hash
  inside the manifest it covers would be circular). Exact algorithm, client verification steps, mismatch handling and a worked
  example: [bundle-content-hash.md](bundle-content-hash.md).
- **Kill switch**: a clip whose recorded sources include one disabled by `IMAGERY_SOURCES_DISABLED` is refused (403), as is a manifest whose
  attribution names a disabled source. Unregistered or uncached clips are refused (409).
- A bundle is a prototype artefact and not shareable. Prototype clips are bundled (never published) only because this is a local file for
  development; `isClipServable` is unchanged.

Tests: `backend/test/bundle.test.ts`.
