import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/style/route_preview_style.dart';

Map<String, dynamic> _template() =>
    jsonDecode(File('assets/style/route_preview_style.json').readAsStringSync()) as Map<String, dynamic>;

List<Map<String, dynamic>> _layers(Map<String, dynamic> s) => (s['layers'] as List).cast<Map<String, dynamic>>();

/// Layers and fields of accra-v2.pmtiles, from the small committed JSON made from its metadata (never from the tile file).
final Map<String, Set<String>> _tileFields = () {
  final j = jsonDecode(File('test/fixtures/v2_layers.json').readAsStringSync()) as Map<String, dynamic>;
  return {
    for (final l in (j['layers'] as List).cast<Map<String, dynamic>>()) l['id'] as String: (l['fields'] as List).cast<String>().toSet(),
  };
}();

final List<String> _landuseClasses =
    ((jsonDecode(File('test/fixtures/v2_layers.json').readAsStringSync()) as Map)['landuseClasses'] as List).cast<String>();

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

  test('every referenced source-layer exists in the v2 layer list', () {
    for (final l in _layers(style)) {
      final sl = l['source-layer'];
      if (sl != null) expect(_tileFields.keys, contains(sl), reason: 'layer ${l['id']} uses source-layer $sl');
    }
    expect(_tileFields.keys.toSet(), {'building', 'road', 'water', 'landuse', 'sea'});
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
    expect(usesOptional, {'landuse', 'sea', 'sea-shore'});
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
      'land', 'landuse', 'sea', 'sea-shore', 'hillshade', 'water',
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

  test('roads, buildings and the route are all above sea, sea-shore and hillshade (harbour piers and port buildings stay visible)', () {
    final ids = [for (final l in _layers(style)) l['id'] as String];
    final topOfBase = [ids.indexOf('sea'), ids.indexOf('sea-shore'), ids.indexOf('hillshade')].reduce(math.max);
    for (final id in ids) {
      if (id.startsWith('road-') || id.startsWith('route-') || id.startsWith('buildings-') || id.startsWith('destination-')) {
        expect(ids.indexOf(id), greaterThan(topOfBase), reason: id);
      }
    }
    expect(ids.indexOf('landuse'), lessThan(ids.indexOf('sea')), reason: 'sea over landuse: OSM landuse runs into the shore');
  });

  test('landuse: one colour per v2 class, subtle (opacity at most 0.9, lighter than the roads), no antialias cost', () {
    final l = _layers(style).firstWhere((l) => l['id'] == 'landuse');
    expect(l['source-layer'], 'landuse');
    expect(l['type'], 'fill');
    final p = l['paint'] as Map<String, dynamic>;
    final match = p['fill-color'] as List; // ["match", ["get","class"], k1, c1, ..., fallback]
    expect(match[1], ['get', 'class']);
    final keys = <String>[];
    final colours = <String, String>{};
    for (var i = 2; i + 1 < match.length; i += 2) {
      for (final k in (match[i] is List ? match[i] as List : [match[i]])) {
        keys.add(k as String);
        colours[k] = match[i + 1] as String;
      }
    }
    expect(keys.toSet(), _landuseClasses.toSet(), reason: 'exactly the classes the v2 tiles carry');
    expect(keys.length, keys.toSet().length, reason: 'no class listed twice');
    expect(match.last, isA<String>(), reason: 'a fallback colour for an unknown class');
    expect(p['fill-opacity'] as num, lessThanOrEqualTo(0.9));
    expect(p['fill-antialias'], false);
    int channel(String hex, int i) => int.parse(hex.substring(1 + 2 * i, 3 + 2 * i), radix: 16);
    for (final e in colours.entries) {
      for (var i = 0; i < 3; i++) {
        expect(channel(e.value, i), greaterThanOrEqualTo(0xa0), reason: '${e.key} is a light tint, so roads and buildings stay dominant');
      }
    }
    for (final g in ['park', 'forest', 'grass', 'pitch']) {
      expect(channel(colours[g]!, 1), greaterThan(channel(colours[g]!, 0)), reason: '$g is green');
      expect(channel(colours[g]!, 1), greaterThan(channel(colours[g]!, 2)), reason: '$g is green');
    }
    expect(colours['airport'], isNot(colours['residential']));
  });

  test('sea: soft blue fill and a thin lighter shore line, both from the sea layer', () {
    final sea = _layers(style).firstWhere((l) => l['id'] == 'sea');
    final shore = _layers(style).firstWhere((l) => l['id'] == 'sea-shore');
    expect([sea['source-layer'], shore['source-layer']], ['sea', 'sea']);
    expect(shore['type'], 'line');
    int sum(String hex) => [for (var i = 0; i < 3; i++) int.parse(hex.substring(1 + 2 * i, 3 + 2 * i), radix: 16)].reduce((a, b) => a + b);
    final fill = (sea['paint'] as Map)['fill-color'] as String;
    final edge = (shore['paint'] as Map)['line-color'] as String;
    expect(sum(edge), greaterThan(sum(fill)), reason: 'the shore line is lighter than the sea');
    final w = (shore['paint'] as Map)['line-width'] as List;
    expect((w.last as num), lessThanOrEqualTo(2), reason: 'thin');
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

    Map<String, dynamic> built({bool hillshade = true, String vectorUrl = 'pmtiles://file:///x/accra-v2.pmtiles'}) => jsonDecode(RoutePreviewStyle.build(
          template,
          vectorUrl: vectorUrl,
          terrainUrl: 'pmtiles://file:///x/accra-terrain.pmtiles',
          route: route,
          destination: dest,
          hillshade: hillshade,
        )) as Map<String, dynamic>;

    test('substitutes the tile URLs and GeoJSON, leaving no placeholder', () {
      final out = jsonEncode(built());
      expect(out, isNot(contains('{{')));
      final src = built()['sources'] as Map;
      expect((src['osm'] as Map)['url'], 'pmtiles://file:///x/accra-v2.pmtiles');
      expect((src['terrain'] as Map)['url'], 'pmtiles://file:///x/accra-terrain.pmtiles');
      expect((src['route'] as Map)['data'], route);
      expect(((src['route-done'] as Map)['data'] as Map)['features'], isEmpty);
    });

    test('a v1-only run (no landuse or sea in the tiles) still builds a valid style: same layers, only tile-dependent ones draw nothing', () {
      final style = built(vectorUrl: 'pmtiles://file:///x/accra.pmtiles');
      expect((style['sources'] as Map)['osm']['url'], 'pmtiles://file:///x/accra.pmtiles');
      final ids = [for (final l in _layers(style)) l['id'] as String];
      expect(ids, containsAll(['landuse', 'sea', 'sea-shore', 'water', 'buildings-3d', 'road-main']));
      expect(jsonEncode(style), isNot(contains('{{')));
      final optional = ((style['metadata'] as Map)['optionalSourceLayers'] as List).cast<String>().toSet();
      expect(optional, {'landuse', 'sea'}, reason: 'the layers that may be absent are declared');
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
