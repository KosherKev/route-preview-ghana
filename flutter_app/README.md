# route_preview (Flutter app)

Pre-trip route preview for Ghana dispatch riders: a 3D MapLibre flyover of the last stretch before the destination.
Phase 5B-1: scaffold, offline fixture and the flyover player. iOS simulator first; Android is not built here.

## Product boundary

**Pre-trip preview only. The app is never synced to live GPS.** It does not request location permission, has no
location plugin, and no code reads a device position. `test/product_boundary_test.dart` fails if `Info.plist` or any
entitlements file gains an `NSLocation*` key, if a location package appears in `pubspec.yaml` / `pubspec.lock`, or if
app source reads or requests a position. The map widget is built in one place (`lib/flyover_map.dart`) with
`myLocationEnabled: false` and `myLocationTrackingMode: MyLocationTrackingMode.none` set explicitly (a widget test asserts
both), and the boundary test also fails on `LocationPuckMapView`, `UserLocation`, `Geolocator`, a tracking mode other than
none, a location permission request, or a map widget that leaves either setting implicit. MapLibre.framework links the
system location library and the plugin ships a location-puck view; neither is used. The camera is driven only by the
manifest's keyframes.

## Toolchain (pinned)

Flutter 3.47.9 (stable) / Dart 3.13.7, pinned in `pubspec.yaml` (`environment`) and `.fvmrc`. `pubspec.lock` is committed.
MapLibre plugin: `maplibre_gl` 0.28.0, see `docs/decisions/D3-maplibre-flutter-plugin.md` in the repo root.

## Offline fixture (synthetic)

`assets/fixtures/` holds an invented route, invented building footprints with heights, a minimal offline style and a
manifest in the Phase 5A format (`docs/api/preview-manifest.md`). Nothing is real or derived from Mapillary, and nothing
loads from the network. Regenerate with `python3 tool/make_fixture.py`.

Only a small share of real Accra buildings have measured heights, so the app shades default-height buildings
differently and says so on screen: extrusions are approximate, never an accurate building height.

## Flyover speed

The manifest's flyover durations assume a nominal 30 m/s, which is too fast to read an approach (22.3 s for the
fixture). The player slows each segment to `kFlyoverEffectiveSpeedMps = 14.0` m/s (`lib/flyover/timeline.dart`, the one
place the 1x speed is set; it was 10 until 5B-2c). It scales each segment's keyframe times by one factor (route metres
the keyframes cover / 14 / manifest duration); easing is kept as given, and the manifest and keyframes are never changed.
The on-screen speed control (0.5x, 1x, 2x, 4x) multiplies the playback clock on top of that; scrubbing is unaffected.
`--dart-define=PLAYBACK_SPEED=2` sets the starting speed. The real Osu to Korle Gonno approach (500 m) plays in
71.4 s at 0.5x, 35.7 s at 1x, 17.9 s at 2x and 8.9 s at 4x.

## Camera (5B-2c)

Three views, chosen with the "view" chips and remembered locally (`camera_preset` in shared_preferences; Close until you pick):

| View | Zoom | Pitch | Centre ahead of the route position | Heading from |
|---|---|---|---|---|
| Close (default) | 17.25 | 62 | 35 m | route direction over the next 40 m |
| Standard | 16 | 55 | 70 m | route direction over the next 70 m |
| High | manifest keyframes (the old overhead view) | | | |

Close and Standard are a chase camera computed from the route polyline (`lib/flyover/chase_camera.dart`): the rider
position moves at a constant speed along the route (no easing stops at keyframes), the heading is a weighted average of the
route direction ahead, so it leans into a corner and never snaps at a vertex. Every frame the camera is smoothed with a
critically damped spring (`lib/flyover/camera_smoother.dart`: position, heading on the shortest arc, pitch, zoom), from
elapsed time, so it is frame-rate independent. The camera is applied with one `moveCamera` per vsync-aligned frame; a
scrub or a section change snaps instead of gliding. The manifest keyframes remain the fallback when there is no route
polyline, and are the High view. `maplibre_gl` 0.28.0 on iOS accepted a 62 degree tilt unclamped (checked by reading
`cameraPosition` back after the first move), and the fill-extrusion buildings (layer minzoom 13, no maxzoom; tiles overzoomed
above z14) stay visible at zoom 17.25.

Landmark cards show 80 m before the landmark (`kLandmarkLeadM`), at most three at once, in a left and a right column (a card
sits on the side of the road its landmark is on, or the side of its turn), so the route line down the middle is clear. A
landmark that has `lat` and `lon` in the manifest also gets a small amber dot on the map.

## Frame overlay (diagnostics)

Long-press the segment strip to show or hide a small overlay: average and 99th percentile frame time of the last 300 frames,
average build and raster time, counts of frames over 16.7 ms and 33.4 ms, and the current view. "Copy report" puts a
plain-text summary on the clipboard. It is off by default, compiled into release builds, keeps everything in memory, and never
writes a file, sends data or touches location. Dev switches: `FRAME_OVERLAY=true` opens with it showing, and
`FRAME_LOG=true` prints the summary to the debug console when the flyover ends.

## Connection diagnostics

The request screen shows per-step elapsed time for Test connection and Preview (name lookup, connect, first byte, total) and
"Waking the Tailscale connection, still trying" once a step has run over 5 seconds. Each request is cut at 20 seconds
(6 s for `/health`) with a readable message. The lookup and connect are small probes of the same host and port on the real
network client; the existing single connection retry is unchanged and nothing new is retried. The name lookup also shows what
the host resolved to ("resolved to 100.101.2.3", first three addresses) and says in plain words when an address is neither
tailnet (100.64.0.0/10) nor private LAN ("This looks like a public address. The API is only reachable inside Tailscale.").
That lookup has its own 5 second cap and is a diagnostic only: if it fails the error is shown and the request goes on as
before. `FAKE_RESOLVED_IP=a.b.c.d` (or `fail`) fakes it for screenshots.

## Real map (5B-2a)

The app draws the real Accra map from dev tile files read at runtime from `Documents/tiles/` in its own sandbox:
`accra-v2.pmtiles` (OSM vector tiles: building, road, water, landuse, sea; see `docs/data/tiles.md`), `accra.pmtiles`
(v1, the same without landuse and sea, used when v2 is absent or unusable) and `accra-terrain.pmtiles` (Copernicus GLO-30
Terrarium raster-dem). They are never in the repo or the app assets. `tool/push_dev_tiles.sh` copies all three from
`~/dev/.scratch/tiles/` into the simulator container and refuses if a SHA-256 differs from `SHA256SUMS`. If no usable vector file is
there the app shows a message and falls back to the synthetic fixture, never a blank map. The terrain file is optional: without it
the map draws with no terrain source and no hillshade layer, and the info panel says "terrain not installed: no hillshade".
The info panel names the vector file in use (with a note that sea and land use need v2 when v1 is in use).

- Style: `assets/style/route_preview_style.json` (template; no remote URLs, glyphs or sprites, so no text labels). Layers
  `landuse` and `sea` come from v2; with v1 they draw nothing. Order, bottom to top: background, landuse, sea (and a thin
  light shore line), hillshade, water, roads with casings, route, buildings, destination pin. Roads and buildings draw above
  sea because piers and port buildings touch it.
- Buildings: height from the data where tagged (`height`, or `building:levels` times 3 m); otherwise an ESTIMATE of 4 to
  14 m from a stable hash of the feature id (MapLibre expressions cannot read footprint area). The banner and info panel say
  heights are estimated. `lib/style/building_height.dart` is the reference; a test runs the real style expression against it.
- Route: `assets/fixtures/accra-real-manifest.json`, one manifest fetched from the preview API (OSM routing and camera
  keyframes only), validated against the manifest schema in the tests.
- Terrain: hillshade only. `setTerrain` and `setSky` are unsupported by `maplibre_gl` 0.28.0 on iOS (see the D3 note).
- Attribution: the info button shows OpenStreetMap (from the vector tile metadata) and the Copernicus string for the
  terrain tiles (from the terrain tile metadata), plus which vector file is in use.
- Tests that read the real tile files (`test/real_tiles_test.dart`, from `TILES_SRC`, default `~/dev/.scratch/tiles`) FAIL
  when a file is missing; `ALLOW_MISSING_TILES=1` opts out explicitly (reported as skipped).

## Live preview (5B-2b)

The first screen asks the preview API for a manifest and plays it as a hybrid timeline.

- **API address** (default the tailnet dev API, stored locally; no secret, no auth header yet), a Test connection button
  (`GET /health`), three saved presets (long-press to save the form into one), typed latitude/longitude with a Ghana sanity
  check, and the costing. No device location and no map-tap picking. If the API is unreachable the screen offers the bundled
  fixture route, labelled as a saved example.
- **Client** (`lib/api/preview_api.dart`): timeouts, one retry for connection failures only, a 4xx problem+json shown by its
  title and detail, 5xx, and every manifest validated by the same parser the player uses before it is played.
- **Hybrid timeline**: each manifest segment plays in order. BIRDS_EYE_3D is a flyover; STREET_VIDEO plays its clip if the file
  is in `Documents/clips/<clip key>`, else its flyover keyframes if it has them ("flyover fallback"), else a clear "no preview
  for this section" state while the timeline continues at the segment's length. A segment strip and a source label show what is
  playing; scrub, pause and speed work across boundaries; the start offset before the approach window is kept.
- **Overlays**: turn cues (shown inside each turn's decision window) and landmark callouts (80 m before to 20 m after), at most
  three at once, with text only from the manifest. A PROTOTYPE badge shows while the manifest says `prototype: true`, and the info
  panel lists the manifest's imagery sources.
- **Clips are dev-only and local**: `tool/push_dev_clips.sh` (hash and size checked) copies them into the simulator sandbox; they are
  never fetched, bundled or committed. See `docs/decisions/D4-video-playback.md`. `tool/make_test_clip.swift` makes a synthetic clip.
- **Fixtures**: `assets/fixtures/mixed-manifest.json` (synthetic, all four segment cases; `tool/make_mixed_fixture.py`) and the
  real Accra route.
- Dev switches (`--dart-define`): `API_BASE_URL`, `PRESET`, `AUTO_PREVIEW_SEC`, plus the earlier `AUTOPLAY`, `AUTOPLAY_DELAY_SEC`,
  `PLAYBACK_SPEED`, `HILLSHADE`, `CAMERA_PRESET=close|standard|high`, `FRAME_LOG`, `FRAME_OVERLAY`.

## Run and test

```
flutter pub get
flutter analyze
flutter test
flutter run -d <ios-simulator-id> --dart-define=AUTOPLAY=true   # AUTOPLAY starts the flyover on launch
```

The player runs the manifest's own offsets (a timeline can start before the nominal approach window) and has play,
pause and scrub. Street-video segments (5B-2), overlays (5B-2) and offline bundle import (5B-3) are not part of this phase.
