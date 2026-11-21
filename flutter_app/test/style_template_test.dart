import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/style/route_preview_style.dart';

Map<String, dynamic> _template() =>
    jsonDecode(File('assets/style/route_preview_style.json').readAsStringSync()) as Map<String, dynamic>;

List<Map<String, dynamic>> _layers(Map<String, dynamic> s) => (s['layers'] as List).cast<Map<String, dynamic>>();

/// Layers and fields of the real accra.pmtiles, from its metadata (planetiler). The tiles themselves are not in the repo.
const _tileFields = <String, Set<String>>{
  'building': {'building', 'building:levels', 'height', 'height_source', 'min_height', 'name'},
  'road': {'bridge', 'highway', 'name', 'tunnel'},
  'water': {'name', 'natural'},
};

void main() {
  late Map<String, dynamic> style;
  setUpAll(() => style = _template());

  test('the template is valid JSON for style spec version 8', () {
    expect(style['version'], 8);
    expect(_layers(style), isNotEmpty);
  });

  test('no glyphs and no sprite: text labels are out of scope and nothing is fetched for them', () {
    expect(style.containsKey('glyphs'), isFalse);
    expect(style.containsKey('sprite'), isFalse);
  });

  test('every layer references a declared source', () {
    final sources = (style['sources'] as Map).keys.toSet();
    for (final l in _layers(style)) {
      final s = l['source'];
      if (s != null) expect(sources, contains(s), reason: 'layer ${l['id']}');
    }
  });

  test('every source-layer exists in the tiles or is on the explicit optional list', () {
    final optional = ((style['metadata'] as Map)['optionalSourceLayers'] as List).cast<String>().toSet();
    expect(optional, {'landuse', 'sea'}, reason: 'the optional list is explicit and names exactly the layers the tiles may gain');
    final real = _tileFields.keys.toSet();
    for (final l in _layers(style)) {
      final sl = l['source-layer'];
      if (sl == null) continue;
      expect(real.union(optional), contains(sl), reason: 'layer ${l['id']} uses source-layer $sl');
    }
  });

  test('the layers that need absent tile layers are exactly the optional ones', () {
    final optional = ((style['metadata'] as Map)['optionalSourceLayers'] as List).cast<String>().toSet();
    final usesOptional = _layers(style).where((l) => optional.contains(l['source-layer'])).map((l) => l['id']).toSet();
    expect(usesOptional, {'landuse', 'sea'});
  });

  test('attribute names used on real layers exist in the tile metadata', () {
    final getRef = RegExp(r'\["get","([^"]+)"\]');
    for (final l in _layers(style)) {
      final sl = l['source-layer'];
      if (!_tileFields.containsKey(sl)) continue;
      final text = jsonEncode([l['paint'], l['filter'], l['layout']]);
      for (final m in getRef.allMatches(text)) {
        expect(_tileFields[sl], contains(m.group(1)), reason: 'layer ${l['id']} reads "${m.group(1)}" from $sl');
      }
    }
  });

  test('no http or https URL anywhere except attribution links', () {
    final found = <String>[];
    void walk(Object? node, String key) {
      if (node is String) {
        if (RegExp(r'https?://').hasMatch(node) && key != 'attribution') found.add('$key: $node');
      } else if (node is List) {
        for (final e in node) {
          walk(e, key);
        }
      } else if (node is Map) {
        node.forEach((k, v) => walk(v, k as String));
      }
    }

    walk(style, '');
    expect(found, isEmpty);
  });

  test('only known placeholders appear, and every one is used', () {
    final text = File('assets/style/route_preview_style.json').readAsStringSync();
    final used = RegExp(r'\{\{[A-Z_]+\}\}').allMatches(text).map((m) => m.group(0)!).toSet();
    expect(used, RoutePreviewStyle.placeholders);
  });

  test('layers are in the specified order', () {
    final ids = [for (final l in _layers(style)) l['id'] as String];
    int at(String id) => ids.indexOf(id);
    final order = [
      'land', 'landuse', 'sea', 'water', 'hillshade',
      'road-minor-casing', 'road-minor', 'road-tertiary-casing', 'road-tertiary',
      'road-main-casing', 'road-main', 'road-highway-casing', 'road-highway',
      'route-glow', 'route-casing', 'route-line', 'route-done', 'buildings-3d', 'destination-pole',
    ];
    for (var i = 0; i < order.length; i++) {
      expect(at(order[i]), greaterThanOrEqualTo(0), reason: order[i]);
      if (i > 0) expect(at(order[i]), greaterThan(at(order[i - 1])), reason: '${order[i]} after ${order[i - 1]}');
    }
    expect(at('land'), 0);
  });

  test('buildings: extrusion with vertical gradient, from zoom 13, over the style light', () {
    final b = _layers(style).firstWhere((l) => l['id'] == 'buildings-3d');
    expect(b['type'], 'fill-extrusion');
    expect(b['source-layer'], 'building');
    expect(b['minzoom'], 13);
    expect((b['paint'] as Map)['fill-extrusion-vertical-gradient'], true);
    expect(style['light'], isNotNull);
  });

  test('hillshade: raster-dem source (Terrarium), low exaggeration, light from the north-west', () {
    final src = (style['sources'] as Map)['terrain'] as Map;
    expect(src['type'], 'raster-dem');
    expect(src['encoding'], 'terrarium');
    final h = _layers(style).firstWhere((l) => l['id'] == 'hillshade');
    final p = h['paint'] as Map;
    expect(p['hillshade-illumination-direction'], 315);
    expect(p['hillshade-exaggeration'] as num, lessThanOrEqualTo(0.4));
  });

  test('roads are layered by class (minor first, motorways last) so major roads cross minor ones cleanly', () {
    final ids = [for (final l in _layers(style)) l['id'] as String];
    const groups = ['minor', 'tertiary', 'main', 'highway'];
    for (var i = 0; i < groups.length; i++) {
      expect(ids.indexOf('road-${groups[i]}-casing'), lessThan(ids.indexOf('road-${groups[i]}')), reason: 'casing under fill: ${groups[i]}');
      if (i > 0) {
        expect(ids.indexOf('road-${groups[i]}-casing'), greaterThan(ids.indexOf('road-${groups[i - 1]}')),
            reason: '${groups[i]} is drawn after the less important ${groups[i - 1]}');
      }
    }
  });

  test('every highway class is drawn by exactly one road group', () {
    final classes = [
      'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
      'tertiary', 'tertiary_link', 'unclassified', 'residential', 'service', 'living_street', 'track', 'footway',
    ];
    final fills = _layers(style).where((l) => RegExp(r'^road-(minor|tertiary|main|highway)$').hasMatch(l['id'] as String)).toList();
    expect(fills, hasLength(4));
    // Evaluate each group's filter: ["all", ["!", ["has", "tunnel"]], ["match", ["get","highway"], [list], A, B]].
    bool inGroup(Map<String, dynamic> l, String cls) {
      final m = (l['filter'] as List)[2] as List;
      final list = (m[2] as List).cast<String>();
      return list.contains(cls) == (m[3] == true);
    }

    for (final c in classes) {
      expect(fills.where((l) => inGroup(l, c)).length, 1, reason: 'class $c');
    }
  });

  test('road width grows from minor to motorway at the highest zoom', () {
    double z17(String id) {
      final w = _layers(style).firstWhere((l) => l['id'] == id)['paint']['line-width'] as List; // interpolate ... 17, value
      final v = w[w.length - 1];
      if (v is num) return v.toDouble();
      return ((v as List).whereType<num>()).reduce(math.max).toDouble(); // match: largest class in the group
    }

    final fills = ['road-minor', 'road-tertiary', 'road-main', 'road-highway'].map(z17).toList();
    for (var i = 1; i < fills.length; i++) {
      expect(fills[i], greaterThan(fills[i - 1]));
    }
    for (final g in ['minor', 'tertiary', 'main', 'highway']) {
      expect(z17('road-$g-casing'), greaterThan(z17('road-$g')), reason: 'casing is wider than the fill: $g');
    }
  });

  group('build()', () {
    const route = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString', 'coordinates': [[-0.19, 5.6], [-0.2, 5.56]]}}]};
    const dest = {'type': 'FeatureCollection', 'features': <dynamic>[]};
    final template = File('assets/style/route_preview_style.json').readAsStringSync();

    Map<String, dynamic> built({bool hillshade = true}) => jsonDecode(RoutePreviewStyle.build(
          template,
          vectorUrl: 'pmtiles://file:///x/accra.pmtiles',
          terrainUrl: 'pmtiles://file:///x/accra-terrain.pmtiles',
          route: route,
          destination: dest,
          hillshade: hillshade,
        )) as Map<String, dynamic>;

    test('substitutes the tile URLs and GeoJSON, leaving no placeholder', () {
      final out = jsonEncode(built());
      expect(out, isNot(contains('{{')));
      final src = built()['sources'] as Map;
      expect((src['osm'] as Map)['url'], 'pmtiles://file:///x/accra.pmtiles');
      expect((src['terrain'] as Map)['url'], 'pmtiles://file:///x/accra-terrain.pmtiles');
      expect((src['route'] as Map)['data'], route);
      expect(((src['route-done'] as Map)['data'] as Map)['features'], isEmpty);
    });

    test('hillshade can be hidden without removing the layer', () {
      Map<String, dynamic> hill(Map<String, dynamic> s) => _layers(s).firstWhere((l) => l['id'] == 'hillshade');
      expect(hill(built())['layout'], isNull);
      expect((hill(built(hillshade: false))['layout'] as Map)['visibility'], 'none');
    });

    test('a path with quotes or spaces cannot break the style', () {
      final out = RoutePreviewStyle.build(
        template,
        vectorUrl: 'pmtiles://file:///a b/"q"/accra.pmtiles',
        terrainUrl: 'pmtiles://file:///t.pmtiles',
        route: route,
        destination: dest,
      );
      expect(((jsonDecode(out) as Map)['sources'] as Map)['osm']['url'], 'pmtiles://file:///a b/"q"/accra.pmtiles');
    });

    test('the built style has no remote URL either', () {
      final out = jsonEncode(built());
      expect(RegExp(r'https?://').allMatches(out).length, 1, reason: 'only the OSM attribution link');
      expect(out, contains('openstreetmap.org/copyright'));
    });
  });
}
