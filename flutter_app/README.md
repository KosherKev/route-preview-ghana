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
fixture). The player slows each segment to `kFlyoverEffectiveSpeedMps = 10.0` m/s (`lib/flyover/timeline.dart`), the
street-clip nominal speed, so the later hybrid timeline moves at one pace. It scales each segment's keyframe times by one
factor (route metres the keyframes cover / 10 / manifest duration); easing is kept as given, and the manifest and
keyframes are never changed. On the fixture's 670.3 m timeline that is about 67 s. The on-screen speed control
(0.5x, 1x, 2x) multiplies the playback clock on top of that; scrubbing is unaffected. `--dart-define=PLAYBACK_SPEED=2`
sets the starting speed.

## Real map (5B-2a)

The app draws the real Accra map from two dev tile files read at runtime from `Documents/tiles/` in its own sandbox:
`accra.pmtiles` (OSM vector tiles: building, road, water) and `accra-terrain.pmtiles` (Copernicus GLO-30 Terrarium
raster-dem). They are never in the repo or the app assets. `tool/push_dev_tiles.sh` copies them from
`~/dev/.scratch/tiles/` into the simulator container and refuses if a SHA-256 differs from `SHA256SUMS`. If either file is
missing or invalid the app shows a message and falls back to the synthetic fixture, never a blank map.

- Style: `assets/style/route_preview_style.json` (template; no remote URLs, glyphs or sprites, so no text labels). Layers
  `landuse` and `sea` are optional: absent from today's tiles, they draw nothing and appear once the tiles gain them.
- Buildings: height from the data where tagged (`height`, or `building:levels` times 3 m); otherwise an ESTIMATE of 4 to
  14 m from a stable hash of the feature id (MapLibre expressions cannot read footprint area). The banner and info panel say
  heights are estimated. `lib/style/building_height.dart` is the reference; a test runs the real style expression against it.
- Route: `assets/fixtures/accra-real-manifest.json`, one manifest fetched from the preview API (OSM routing and camera
  keyframes only), validated against the manifest schema in the tests.
- Terrain: hillshade only. `setTerrain` and `setSky` are unsupported by `maplibre_gl` 0.28.0 on iOS (see the D3 note).
- Attribution: the info button shows OpenStreetMap and the Copernicus string from the tile metadata.

## Run and test

```
flutter pub get
flutter analyze
flutter test
flutter run -d <ios-simulator-id> --dart-define=AUTOPLAY=true   # AUTOPLAY starts the flyover on launch
```

The player runs the manifest's own offsets (a timeline can start before the nominal approach window) and has play,
pause and scrub. Street-video segments (5B-2), overlays (5B-2) and offline bundle import (5B-3) are not part of this phase.
