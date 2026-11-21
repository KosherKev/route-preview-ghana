import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../fixture.dart';
import '../flyover/manifest.dart';
import '../route_geometry.dart';
import '../style/route_preview_style.dart';
import '../tiles/dev_tiles.dart';

/// One attribution entry for the info panel.
class Attribution {
  final String title;
  final String text;
  const Attribution(this.title, this.text);
}

/// What the flyover screen plays: a manifest, the style to draw it on, and the few hooks the map needs. Two kinds:
/// [TileScene] (real OSM vector tiles plus Copernicus terrain from the app sandbox, the real Accra route) and
/// [FixtureScene] (the 5B-1 synthetic fixture, used when the tiles are not there).
abstract class Scene {
  PreviewManifest get manifest;
  String get styleJson;

  /// Two-line banner shown over the map.
  String get bannerTitle;
  String get bannerNote;

  /// Set when the app fell back from the real tiles; shown prominently.
  String? get fallbackMessage;
  List<Attribution> get attributions;

  /// Background colour of the style, used for the horizon fade overlay (null = no overlay).
  int? get horizonColor;

  Future<void> onStyleLoaded(MapLibreMapController map);

  /// Called as the camera moves along the route; [offsetM] is metres along the route.
  Future<void> onProgress(MapLibreMapController map, double offsetM);
}

/// The 5B-1 synthetic fixture on the plain style: invented route and buildings. Also the fallback when tiles are missing.
class FixtureScene implements Scene {
  final Fixture fixture;
  @override
  final String? fallbackMessage;
  FixtureScene(this.fixture, {this.fallbackMessage});

  @override
  PreviewManifest get manifest => fixture.manifest;
  @override
  String get styleJson => fixture.styleJson;
  @override
  String get bannerTitle => 'SYNTHETIC FIXTURE · pre-trip preview';
  @override
  String get bannerNote => 'Invented route and buildings. Heights are approximate.';
  @override
  List<Attribution> get attributions => const [Attribution('Fixture', 'Invented route and buildings; no real map data.')];
  @override
  int? get horizonColor => null;

  @override
  Future<void> onStyleLoaded(MapLibreMapController map) async {
    await map.addGeoJsonSource('route', fixture.route);
    await map.addGeoJsonSource('buildings', fixture.buildings);
    await map.addLineLayer(
      'route',
      'route-line',
      const LineLayerProperties(lineColor: '#d6336c', lineWidth: 5, lineCap: 'round', lineJoin: 'round'),
    );
    await map.addFillExtrusionLayer(
      'buildings',
      'buildings-3d',
      const FillExtrusionLayerProperties(
        // Real OSM heights are rare, so most buildings carry a flagged default: colour them differently so the
        // extrusions never read as measured heights.
        fillExtrusionColor: [
          'case',
          ['==', ['get', 'height_source'], 'osm'],
          '#8fa3b8',
          '#cfc6b4',
        ],
        fillExtrusionHeight: ['get', 'height'],
        fillExtrusionBase: 0,
        fillExtrusionOpacity: 0.92,
      ),
    );
    debugPrint('[flyover] fixture style ready, ${(fixture.buildings['features'] as List).length} buildings');
  }

  @override
  Future<void> onProgress(MapLibreMapController map, double offsetM) async {}
}

/// Real tiles from the sandbox: OSM vectors (roads, water, buildings; landuse and sea once the tiles have them) plus
/// Copernicus terrain hillshade, with the real Accra route from the manifest and the completed part following playback.
class TileScene implements Scene {
  @override
  final PreviewManifest manifest;
  final DevTilesResult tiles;
  final RouteGeometry route;

  /// Drawn layers: hillshade can be turned off (evidence pair).
  final bool hillshade;

  /// Dev probe: try the 3D terrain and sky calls (unsupported on iOS) and report the result in the banner.
  final bool probeUnsupported;

  @override
  final String styleJson;

  String _probeResult = '';
  double _lastDoneEndM = -1;
  bool _busy = false;

  TileScene._(this.manifest, this.tiles, this.route, this.styleJson, this.hillshade, this.probeUnsupported);

  factory TileScene.create({
    required PreviewManifest manifest,
    required String styleTemplate,
    required DevTilesResult tiles,
    bool hillshade = true,
    bool probeUnsupported = false,
  }) {
    final route = RouteGeometry.fromPolyline6(manifest.routePolyline6, lengthM: manifest.routeLengthM);
    final dest = manifest.destination!;
    final style = RoutePreviewStyle.build(
      styleTemplate,
      vectorUrl: tiles.vectorUrl,
      terrainUrl: tiles.terrainUrl,
      route: route.fullLine,
      destination: RouteGeometry.destinationCollection(dest[0], dest[1]),
      hillshade: hillshade,
    );
    return TileScene._(manifest, tiles, route, style, hillshade, probeUnsupported);
  }

  @override
  String? get fallbackMessage => null;
  @override
  String get bannerTitle => 'Accra · pre-trip preview';
  @override
  String get bannerNote =>
      'Most building heights are ESTIMATED (about 4 to 14 m), not measured.${_probeResult.isEmpty ? '' : '\n$_probeResult'}';
  @override
  int? get horizonColor => 0xFFECE8DD;

  /// Strips the HTML tags of the tile attribution: `<a href="...">&copy; OpenStreetMap contributors</a>`.
  static String plainText(String html) => html
      .replaceAll(RegExp(r'<[^>]*>'), '')
      .replaceAll('&copy;', '©')
      .replaceAll('&amp;', '&')
      .trim();

  @override
  List<Attribution> get attributions => [
        Attribution(
          'Map data',
          '${plainText(tiles.vector?.attribution ?? '© OpenStreetMap contributors')}\n'
          'https://www.openstreetmap.org/copyright',
        ),
        // Exactly the string in the terrain tile file's metadata (docs/data/terrain.md is not on main yet).
        Attribution('Terrain', tiles.terrain?.attribution ?? ''),
        const Attribution(
          'Route and heights',
          'The route and camera keyframes come from the preview API and are derived from OpenStreetMap routing data. '
              'Most building heights are not in OpenStreetMap: heights are real for tagged buildings, levels times 3 m '
              'where building:levels is set, and otherwise an estimate of 4 to 14 m from a stable hash of the building id '
              '(not a measurement, and not a footprint-based estimate). Do not read a building height as accurate.',
        ),
      ];

  @override
  Future<void> onStyleLoaded(MapLibreMapController map) async {
    debugPrint('[flyover] tile style ready: vector=${tiles.vector?.minZoom}-${tiles.vector?.maxZoom} '
        'layers=${tiles.vector?.vectorLayers} terrain=${tiles.terrain?.minZoom}-${tiles.terrain?.maxZoom} hillshade=$hillshade');
    if (probeUnsupported) {
      final out = <String>[];
      try {
        await map.setTerrain(const TerrainProperties(source: 'terrain', exaggeration: 1.2));
        out.add('setTerrain: ok');
      } catch (e) {
        out.add('setTerrain: ${e.runtimeType}');
        debugPrint('[probe] setTerrain -> $e');
      }
      try {
        await map.setSky(const SkyProperties());
        out.add('setSky: ok');
      } catch (e) {
        out.add('setSky: ${e.runtimeType}');
        debugPrint('[probe] setSky -> $e');
      }
      _probeResult = out.join(' · ');
    }
  }

  /// The completed part of the route (from where the flyover starts to the camera) is drawn brighter. Updates are
  /// throttled to every 2 m and one at a time.
  @override
  Future<void> onProgress(MapLibreMapController map, double offsetM) async {
    if (_busy || (offsetM - _lastDoneEndM).abs() < 2) return;
    _busy = true;
    try {
      _lastDoneEndM = offsetM;
      await map.setGeoJsonSource('route-done', route.lineFeatureCollection(manifest.timelineStartM, offsetM));
    } finally {
      _busy = false;
    }
  }
}
