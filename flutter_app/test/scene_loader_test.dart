import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/scene/scene.dart';
import 'package:route_preview/scene/scene_loader.dart';
import 'package:route_preview/style/route_preview_style.dart';
import 'package:route_preview/tiles/dev_tiles.dart';

import 'support/file_asset_bundle.dart';
import 'support/pmtiles_builder.dart';

/// Fails the real style asset, to prove a broken style falls back instead of leaving a blank map.
class _BrokenStyleBundle extends FileAssetBundle {
  @override
  Future<ByteData> load(String key) {
    if (key == RoutePreviewStyle.asset) return Future.value(ByteData.sublistView(Uint8List.fromList(utf8.encode('{not json'))));
    return super.load(key);
  }
}

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('scene'));
  tearDown(() => dir.deleteSync(recursive: true));

  void putBoth() {
    writePmtiles(dir, kVectorTilesFile, pmtilesBytes(tileType: 1, gzipMetadata: true, metadata: {
      'attribution': '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>',
    }));
    writePmtiles(dir, kTerrainTilesFile, pmtilesBytes(tileType: 2, minZoom: 6, maxZoom: 13, metadata: {'attribution': 'terrain attribution'}));
  }

  test('no tiles: the 5B-1 fixture plays, with a message saying why (never a blank map)', () async {
    final s = await loadScene(tilesDir: dir, bundle: FileAssetBundle());
    expect(s, isA<FixtureScene>());
    expect(s.fallbackMessage, allOf(contains(kVectorTilesFile), contains(kTerrainTilesFile), contains('fixture')));
    expect(s.styleJson, isNotEmpty);
    expect(s.manifest.segments, isNotEmpty);
    expect(s.bannerTitle, contains('SYNTHETIC'));
  });

  test('one tile file missing also falls back to the fixture', () async {
    writePmtiles(dir, kVectorTilesFile, pmtilesBytes(tileType: 1));
    final s = await loadScene(tilesDir: dir, bundle: FileAssetBundle());
    expect(s, isA<FixtureScene>());
    expect(s.fallbackMessage, contains('$kTerrainTilesFile is missing'));
  });

  test('a corrupt tile file falls back to the fixture, without throwing', () async {
    putBoth();
    File('${dir.path}/$kVectorTilesFile').writeAsStringSync('garbage');
    final s = await loadScene(tilesDir: dir, bundle: FileAssetBundle());
    expect(s, isA<FixtureScene>());
    expect(s.fallbackMessage, contains('not a valid PMTiles file'));
  });

  test('both tiles present: the real scene, on the real Accra route, with the tile URLs in the style', () async {
    putBoth();
    final s = await loadScene(tilesDir: dir, bundle: FileAssetBundle());
    expect(s, isA<TileScene>());
    expect(s.fallbackMessage, isNull);
    expect(s.manifest.segments.single.mode, 'BIRDS_EYE_3D');
    expect(s.manifest.routeLengthM, closeTo(5727.47, 0.01));
    expect(s.styleJson, isNot(contains('{{')));
    final src = (jsonDecode(s.styleJson) as Map)['sources'] as Map;
    expect((src['osm'] as Map)['url'], 'pmtiles://${Uri.file('${dir.path}/$kVectorTilesFile')}');
    expect((src['terrain'] as Map)['url'], 'pmtiles://${Uri.file('${dir.path}/$kTerrainTilesFile')}');
    expect(((src['route'] as Map)['data'] as Map)['features'], hasLength(1));
    expect(((src['destination'] as Map)['data'] as Map)['features'], hasLength(2));
  });

  test('hillshade off hides only the hillshade layer', () async {
    putBoth();
    final s = await loadScene(tilesDir: dir, bundle: FileAssetBundle(), hillshade: false);
    final layers = ((jsonDecode(s.styleJson) as Map)['layers'] as List).cast<Map>();
    expect(layers.firstWhere((l) => l['id'] == 'hillshade')['layout'], {'visibility': 'none'});
    expect(layers.where((l) => l['layout'] != null && (l['layout'] as Map).containsKey('visibility')), hasLength(1));
  });

  test('a broken style asset falls back to the fixture with a message', () async {
    putBoth();
    final s = await loadScene(tilesDir: dir, bundle: _BrokenStyleBundle());
    expect(s, isA<FixtureScene>());
    expect(s.fallbackMessage, contains('Could not build the real map'));
  });

  test('attributions: OpenStreetMap text, and the terrain string exactly as in the tile metadata', () async {
    putBoth();
    final s = await loadScene(tilesDir: dir, bundle: FileAssetBundle());
    final byTitle = {for (final a in s.attributions) a.title: a.text};
    expect(byTitle['Map data'], contains('© OpenStreetMap contributors'));
    expect(byTitle['Map data'], contains('openstreetmap.org/copyright'));
    expect(byTitle['Terrain'], 'terrain attribution');
    expect(byTitle['Route and heights'], allOf(contains('estimate'), contains('4 to 14 m'), contains('not a measurement')));
  });

  test('the banner says most building heights are estimated', () async {
    putBoth();
    final s = await loadScene(tilesDir: dir, bundle: FileAssetBundle());
    expect(s.bannerNote, contains('ESTIMATED'));
  });

  test('plainText strips tags and entities', () {
    expect(TileScene.plainText('<a href="x" target="_blank">&copy; OpenStreetMap contributors</a>'), '© OpenStreetMap contributors');
  });
}
