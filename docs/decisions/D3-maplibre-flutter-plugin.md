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
