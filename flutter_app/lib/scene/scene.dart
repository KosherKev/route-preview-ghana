import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../clips/clip_store.dart';
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

/// What the manifest says about its imagery: sources, creators, licences and links, the prototype flag, and any source the
/// server's kill switch removed. Shown in the info panel for every scene.
List<Attribution> manifestAttributions(PreviewManifest m) {
  final a = m.attribution;
  final lines = <String>[];
  if (a.sources.isEmpty) {
    lines.add('No street imagery in this preview: map-only flyover.');
  } else {
    lines.add('Sources: ${a.sources.join(', ')}');
    if (a.creators.isNotEmpty) lines.add('Creators: ${a.creators.join(', ')}');
    if (a.licenses.isNotEmpty) lines.add('Licences: ${a.licenses.join(', ')}');
    if (a.sourceUrls.isNotEmpty) lines.add('Links: ${a.sourceUrls.join('\n')}');
    if (a.requiresLogoAndLink) lines.add('These sources require their logo and a link back.');
  }
  if (m.sourcesExcluded.isNotEmpty) {
    lines.add('Excluded by the server (kill switch): ${m.sourcesExcluded.join(', ')}');
  }
  return [
    Attribution('Imagery sources', lines.join('\n')),
    if (m.prototype)
      const Attribution(
        'Prototype',
        'Street imagery and clips are prototype-only: used on this device for development, never published or shared.',
      ),
  ];
}

/// The landmarks of [m] that carry their own position (the manifest's `lat` and `lon`), as GeoJSON points for a small map marker.
Map<String, dynamic> landmarkCollection(PreviewManifest m) => {
      'type': 'FeatureCollection',
      'features': [
        for (final l in m.overlays.landmarks)
          if (l.lat != null && l.lon != null)
            {
              'type': 'Feature',
              'properties': <String, dynamic>{'name': l.name},
              'geometry': {'type': 'Point', 'coordinates': [l.lon, l.lat]},
            },
      ],
    };

/// Draws a small amber dot at each landmark's position so the rider can match a card to a place on the map. No text
/// labels (no glyph fonts in the style). Does nothing when no landmark has a position.
Future<void> addLandmarkMarkers(MapLibreMapController map, PreviewManifest m) async {
  final fc = landmarkCollection(m);
  if ((fc['features'] as List).isEmpty) return;
  try {
    await map.addGeoJsonSource('landmarks', fc);
    await map.addCircleLayer(
      'landmarks',
      'landmark-dots',
      const CircleLayerProperties(circleRadius: 6, circleColor: '#ffb300', circleStrokeColor: '#ffffff', circleStrokeWidth: 2),
    );
  } on Object catch (e) {
    // The markers are cosmetic: never let them stop the preview.
    debugPrint('[flyover] landmark markers failed: $e');
  }
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

  /// Street-video clips on this device (keys of `Documents/clips`), where the clips are, and a short note on where the
  /// manifest came from ("Live preview API" or "Bundled fixture route").
  Set<String> get availableClips;
  ClipStore? get clipStore;
  String get sourceLabel;

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
  List<Attribution> get attributions =>
      [const Attribution('Fixture', 'Invented route and buildings; no real map data.'), ...manifestAttributions(manifest)];
  @override
  int? get horizonColor => null;
  @override
  Set<String> get availableClips => const {};
  @override
  ClipStore? get clipStore => null;
  @override
  String get sourceLabel => 'Bundled fixture route';

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
  @override
  final Set<String> availableClips;
  @override
  final ClipStore? clipStore;
  @override
  final String sourceLabel;

  String _probeResult = '';
  double _lastDoneEndM = -1;
  bool _busy = false;

  TileScene._(this.manifest, this.tiles, this.route, this.styleJson, this.hillshade, this.probeUnsupported,
      this.availableClips, this.clipStore, this.sourceLabel);

  factory TileScene.create({
    required PreviewManifest manifest,
    required String styleTemplate,
    required DevTilesResult tiles,
    bool hillshade = true,
    bool probeUnsupported = false,
    Set<String> availableClips = const {},
    ClipStore? clipStore,
    String sourceLabel = 'Bundled fixture route',
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
    return TileScene._(manifest, tiles, route, style, hillshade, probeUnsupported, availableClips, clipStore, sourceLabel);
  }

  @override
  String? get fallbackMessage => null;
  @override
  String get bannerTitle => 'Accra · pre-trip preview';
  @override
  String get bannerNote =>
      '$sourceLabel. Most building heights are ESTIMATED (about 4 to 14 m), not measured.${_probeResult.isEmpty ? '' : '\n$_probeResult'}';
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
        // Exactly the string in the terrain tile file's metadata (docs/data/terrain.md).
        if (tiles.hasTerrain)
          Attribution('Terrain', tiles.terrain?.attribution ?? '')
        else
          Attribution('Terrain', tiles.terrainNote ?? kNoTerrainNote),
        Attribution('Tile file', tiles.note ?? ''),
        const Attribution(
          'Route and heights',
          'The route and camera keyframes come from the preview API and are derived from OpenStreetMap routing data. '
              'Most building heights are not in OpenStreetMap: heights are real for tagged buildings, levels times 3 m '
              'where building:levels is set, and otherwise an estimate of 4 to 14 m from a stable hash of the building id '
              '(not a measurement, and not a footprint-based estimate). Do not read a building height as accurate.',
        ),
        ...manifestAttributions(manifest),
      ];

  @override
  Future<void> onStyleLoaded(MapLibreMapController map) async {
    debugPrint('[flyover] tile style ready: vector=${tiles.vector?.minZoom}-${tiles.vector?.maxZoom} '
        'layers=${tiles.vector?.vectorLayers} terrain=${tiles.terrain?.minZoom}-${tiles.terrain?.maxZoom} hillshade=${hillshade && tiles.hasTerrain}');
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
    await addLandmarkMarkers(map, manifest);
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

/// The live (or any) manifest on a plain background: the route, the part already passed, and the destination. Used when
/// the map tiles are not on the device, so a manifest from the API can still be played (the flyover camera follows the
/// route over an empty map). Overlays, clips and the timeline work exactly as on [TileScene].
class RouteOnlyScene implements Scene {
  @override
  final PreviewManifest manifest;
  final RouteGeometry route;
  @override
  final String styleJson;
  @override
  final Set<String> availableClips;
  @override
  final ClipStore? clipStore;
  @override
  final String sourceLabel;
  @override
  final String? fallbackMessage;
  double _lastDoneEndM = -1;
  bool _busy = false;

  RouteOnlyScene._(this.manifest, this.route, this.styleJson, this.availableClips, this.clipStore, this.sourceLabel, this.fallbackMessage);

  factory RouteOnlyScene.create({
    required PreviewManifest manifest,
    required String message,
    Set<String> availableClips = const {},
    ClipStore? clipStore,
    String sourceLabel = 'Live preview API',
  }) {
    final route = RouteGeometry.fromPolyline6(manifest.routePolyline6, lengthM: manifest.routeLengthM);
    final dest = manifest.destination!;
    Map<String, dynamic> src(Map<String, dynamic> data) => {'type': 'geojson', 'data': data};
    Map<String, dynamic> line(String id, String source, String color, num width, {double? blur, double? opacity}) => {
          'id': id,
          'type': 'line',
          'source': source,
          'layout': {'line-cap': 'round', 'line-join': 'round'},
          'paint': {'line-color': color, 'line-width': width, 'line-blur': ?blur, 'line-opacity': ?opacity},
        };
    final style = jsonEncode({
      'version': 8,
      'name': 'route-only',
      'sources': {
        'route': src(route.fullLine),
        'route-done': src({'type': 'FeatureCollection', 'features': <dynamic>[]}),
        'destination': src(RouteGeometry.destinationCollection(dest[0], dest[1])),
      },
      'layers': [
        {'id': 'land', 'type': 'background', 'paint': {'background-color': '#ece8dd'}},
        line('route-glow', 'route', '#ff4d85', 18, blur: 9, opacity: 0.45),
        line('route-casing', 'route', '#ffffff', 10),
        line('route-line', 'route', '#e9779a', 6),
        line('route-done', 'route-done', '#ff1f66', 6.5),
        {
          'id': 'destination-ring',
          'type': 'circle',
          'source': 'destination',
          'filter': ['==', ['geometry-type'], 'Point'],
          'paint': {'circle-radius': 12, 'circle-color': '#ffffff', 'circle-stroke-color': '#ff1f66', 'circle-stroke-width': 3},
        },
      ],
    });
    return RouteOnlyScene._(manifest, route, style, availableClips, clipStore, sourceLabel, message);
  }

  @override
  String get bannerTitle => 'Route only \u00b7 pre-trip preview';
  @override
  String get bannerNote => '$sourceLabel. Map tiles are not on this device, so only the route is drawn.';
  @override
  List<Attribution> get attributions => [
        const Attribution('Map', 'No map tiles are loaded: only the route from the preview API is drawn.'),
        ...manifestAttributions(manifest),
      ];
  @override
  int? get horizonColor => null;

  @override
  Future<void> onStyleLoaded(MapLibreMapController map) async {
    debugPrint('[flyover] route-only style ready');
    await addLandmarkMarkers(map, manifest);
  }

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
