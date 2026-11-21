# D3 follow-up: MapLibre plugin for the Flutter app (Phase 5B-1, 2026-11-21)

D3 fixed the renderer as MapLibre Native. This note records which Flutter plugin wraps it, what was checked, and what the
5B-1 probes found. It does not reopen D3.

## Choice: `maplibre_gl` 0.28.0 (pinned exactly)

- Wraps MapLibre Native on iOS and Android (native views, not a web renderer).
- Maintained: published 2026-11-03, regular releases (0.26.1 in May to 0.28.0 in November 2026), repository
  `maplibre/flutter-maplibre-gl`.
- Licence: BSD-3-Clause (pub.dev tags `license:bsd-3-clause`, OSI approved).
- Its changelog documents PMTiles support (MapLibre Native iOS 6.14, Android 11.9) and fill-extrusion layers on iOS and Android.
- Needs iOS 15.5 or later (`flutter build` refused 15.0: "requires a higher minimum iOS deployment version"). The app targets 15.5.

## Alternatives considered

| Option | Why not (now) |
| --- | --- |
| `maplibre` 0.4.0 (`maplibre/flutter-maplibre`) | Also MapLibre Native and BSD-3, but 0.4.0 shipped 2026-11-18 (days old) and its README and changelog say nothing about PMTiles or fill-extrusion. Worth a re-check before Phase 6. |
| `flutter_map` plus vector tiles | Pure Dart renderer, not MapLibre Native, no native 3D extrusion. Conflicts with D3. |
| Mapbox Maps SDK for Flutter | Proprietary licence and account token. Conflicts with the free/open stack (D4). |
| Own FFI binding to maplibre-native | Far more work than the plugin for no gain at this stage. |

## What 5B-1 verified on an iOS 27.2 simulator (iPhone 17)

- **Fill-extrusion works.** 90 synthetic buildings extruded from a GeoJSON source with data-driven `fill-extrusion-height`
  and colour. The flyover drives the camera frame by frame with `moveCamera`; no plugin animation is used, so scrubbing is exact.
- **`pmtiles://` works: YES (with limits).** A synthetic one-tile PMTiles v3 archive (three invented squares with a `height`
  property, made by `flutter_app/tool/make_probe_pmtiles.py`) loaded as a `type: vector` source through
  `pmtiles://file:///...`. Rendered features: 6 (3 squares times a `fill` and a `fill-extrusion` layer) with heights 120, 60 and 20, and
  the extrusions drew at those heights. It worked uncompressed and with gzip-compressed directory, metadata and tile
  (what typical archives use). Entry point: `flutter_app/lib/probe_pmtiles_main.dart`.
  - Not tested: the real 21 MB `accra.pmtiles` (it lives on servermac only), loading from an app asset or the app sandbox
    on a real device (the simulator can read a host path), and an `http(s)` range-request source.

## Product boundary notes

- No location permission, plugin or code anywhere in the app; `myLocationEnabled: false`. The built `Info.plist` has no
  location keys.
- `MapLibre.framework` links the system CoreLocation library (a dependency of the SDK), and the plugin has a class named
  `LocationPuckMapView`. Neither can prompt for or read a position without a usage-description key and
  `myLocationEnabled`, which the app never sets; `test/product_boundary_test.dart` fails if either appears.
- Building the iOS app needs CocoaPods to fetch the `MapLibre` pod (an xcframework from the official project) from the
  network. The resolved versions are pinned in `flutter_app/ios/Podfile.lock`.

## Evaluation: `maplibre` 0.4.0 vs `maplibre_gl` 0.28.0 (Phase 5B-1 follow-up, 2026-11-21)

Report only: the app was not switched. Disk was above 10 GiB, so this is a real comparison: a throwaway project outside the
repo (`~/dev/.scratch/maplibre-eval`) ran the PMTiles probe and the fixture scene on `maplibre` 0.4.0 on the same iOS 27.2
simulator (iPhone 17).

| | `maplibre_gl` 0.28.0 (current) | `maplibre` 0.4.0 |
| --- | --- | --- |
| Maintenance | Published 2026-11-03; steady releases since May 2026; 137 likes, 150/160 pub points | Published 2026-11-18 (days old), moved to the `maplibre/flutter-maplibre` hosted project; 73 likes, 160/160 points. **0.4.0 is a ground-up rewrite** (new backend, new API, migration guide). |
| Licence | BSD-3-Clause | BSD-3-Clause (the native library it downloads is maplibre-native, BSD-2) |
| iOS | iOS 15.5 or later; built here through CocoaPods (`MapLibre` pod). pub.dev also tags it SwiftPM-capable, which this project does not use. | iOS 15 or later; **Swift Package Manager only**, no CocoaPods |
| Native binary | `MapLibre` pod xcframework: 7.6 MB device slice, 16 MB universal simulator slice | One C library `maplibre-native-c` downloaded by a build hook from the official GitHub release, SHA-256 checked against digests pinned inside the published package; 9.4 MB (arm64 simulator, debug app) |
| Rendering | Native platform view | Renders into a Flutter `Texture`; gestures handled in Flutter |
| `pmtiles://` | Works (probe, plain and gzip) | Works (same probe, plain and gzip: 6 features, heights 120, 60, 20) |
| Fill-extrusion | Works (fixture and probe) | Works (fixture and probe), but `MapOptions.maxPitch` defaults to 60 and must be raised to 80 for our keyframes |
| Camera | `moveCamera` / `animateCamera` with `CameraUpdate` | `moveCamera` / `animateCamera` with `CameraUpdate.position` and `CameraAnimation.ease` / `fly`; per-frame `moveCamera` from the manifest keyframes worked |
| Location | Opt-in flags on the map widget (`myLocationEnabled`, tracking mode), a `LocationPuckMapView` class, and `MapLibre.framework` links the system CoreLocation library | Only an opt-in `UserLocationLayer` widget (the permission manager was removed); **the built simulator app links no CoreLocation** (`otool -L` on the Runner and the native framework), and its `Info.plist` has no location keys |
| Package size | 1.8 MB pub archive | About 0.34 MB for the three packages |

What the build needed for 0.4.0 on this machine:

- Flutter's Swift Package Manager is switched **off** in this machine's global Flutter settings, and the plugin is SwiftPM-only,
  so the build failed with "plugins only compatible with Swift Package Manager". A per-project `pubspec.yaml` setting did not
  override it. The run used a scratch settings directory (`XDG_CONFIG_HOME`) with SwiftPM enabled, so the real setting is
  untouched. Adopting 0.4.x would mean migrating the iOS project off CocoaPods and enabling SwiftPM for everyone who builds it.
- The build hook downloads a prebuilt library from GitHub releases. The digest check makes that a verified artifact, but it
  is still a binary fetched at build time, which is a supply-chain surface `maplibre_gl` (a CocoaPods dependency) shares in a
  different form.

### Recommendation: stay on `maplibre_gl` 0.28.0 for 5B-2

There is no blocker with `maplibre_gl` and no functional win in 0.4.0: both load `pmtiles://` and draw data-driven
fill-extrusions on iOS. 0.4.0 is days old, a full rewrite, SwiftPM-only (a toolchain change here), and needs a
build-time binary download. Its real advantages are a smaller location surface (no CoreLocation linked, opt-in
`UserLocationLayer`) and Flutter-texture rendering, which may matter for compositing overlays and video over the map.

Switching is cheap if needed: the map is built in one place (`lib/flyover_map.dart`), the style can stay JSON, and the
boundary test only needs `UserLocationLayer` added to its forbidden names.

**Switch trigger.** Move to `maplibre` when any one of these is true:

1. `maplibre_gl` has no release for 6 months, or a Flutter or Xcode update breaks its CocoaPods build and no `maplibre_gl`
   release fixes it within one release cycle.
2. Phase 5B-2 overlay or street-video compositing over the map hits a platform-view limitation (z-order, clipping, gesture
   or video-texture sharing) that cannot be worked around, and the texture-based map fixes it in a spike.
3. `maplibre` has shipped at least two patch releases after 0.4.0 without regressions in its changelog, and the team's Flutter
   toolchain has SwiftPM enabled by default (no global setting change needed).

Re-check at the start of Phase 6 even if none has fired.

## 5B-2a findings: style features in `maplibre_gl` 0.28.0 on iOS (2026-11-21)

| Feature | Result |
| --- | --- |
| 3D terrain (`setTerrain`) | **No.** Throws `UnsupportedError` on iOS ("MapLibre Native does not implement 3D terrain yet"). Web only. Hillshade only is shipped. |
| Sky / atmosphere (`setSky`) | **No.** Same `UnsupportedError`. |
| Fog | **No** API in the plugin. Fallback: a Flutter gradient at the top of the screen that fades in with camera pitch. |
| Ambient occlusion | **No** API. Fallback: the style `light` (softened to 0.3 intensity) and `fill-extrusion-vertical-gradient`. |
| Hillshade from `raster-dem` PMTiles | **Yes.** Loads from the app sandbox; effect is subtle on flat Accra (surface model, so it shows urban texture). |
| `pmtiles://file:///` from the app sandbox | **Yes**, vector and Terrarium raster-dem. Real device not tested. |
| Feature ids in expressions | **Yes**: `["id"]` works on the real tiles (every feature carries an id), used for the stable height estimate. |
