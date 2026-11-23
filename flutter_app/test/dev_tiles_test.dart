import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/tiles/dev_tiles.dart';
import 'package:route_preview/tiles/pmtiles_info.dart';

import 'support/pmtiles_builder.dart';

const _osm = '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('devtiles'));
  tearDown(() => dir.deleteSync(recursive: true));

  void putVector({Map<String, dynamic>? meta, bool gz = true}) => writePmtiles(
      dir,
      kVectorTilesFile,
      pmtilesBytes(tileType: 1, minZoom: 0, maxZoom: 14, gzipMetadata: gz, metadata: meta ?? {
        'attribution': _osm,
        'vector_layers': [
          {'id': 'building', 'minzoom': 13, 'maxzoom': 14},
          {'id': 'road'},
          {'id': 'water'},
        ],
      }));
  void putV2({int tileType = 1}) => writePmtiles(
      dir,
      kVectorV2TilesFile,
      pmtilesBytes(tileType: tileType, minZoom: 0, maxZoom: 14, gzipMetadata: true, metadata: {
        'attribution': _osm,
        'vector_layers': [
          {'id': 'building', 'minzoom': 13, 'maxzoom': 14},
          {'id': 'landuse', 'minzoom': 10, 'maxzoom': 14},
          {'id': 'road'},
          {'id': 'sea', 'minzoom': 8, 'maxzoom': 14},
          {'id': 'water'},
        ],
      }));
  void putTerrain() => writePmtiles(dir, kTerrainTilesFile,
      pmtilesBytes(tileType: 2, minZoom: 6, maxZoom: 13, metadata: {'attribution': 'produced using Copernicus WorldDEM-30', 'encoding': 'terrarium'}));

  group('PmtilesInfo', () {
    test('reads the header and (gzip or plain) metadata', () {
      final gz = PmtilesInfo.parse(pmtilesBytes(minZoom: 2, maxZoom: 9, gzipMetadata: true, metadata: {'attribution': 'a', 'vector_layers': [{'id': 'road'}]}));
      expect([gz.tileType, gz.minZoom, gz.maxZoom, gz.attribution], [1, 2, 9, 'a']);
      expect(gz.vectorLayers, ['road']);
      final plain = PmtilesInfo.parse(pmtilesBytes(tileType: 2, metadata: {'attribution': 'b'}));
      expect([plain.tileType, plain.attribution], [2, 'b']);
      expect(plain.vectorLayers, isEmpty);
    });

    test('rejects what is not PMTiles v3', () {
      expect(() => PmtilesInfo.parse(pmtilesBytes(magic: 'NotTile')), throwsA(isA<PmtilesFormatException>()));
      expect(() => PmtilesInfo.parse(pmtilesBytes(version: 2)), throwsA(isA<PmtilesFormatException>()));
      expect(() => PmtilesInfo.parse(pmtilesBytes().sublist(0, 100)), throwsA(isA<PmtilesFormatException>()));
    });
  });

  group('loadDevTiles', () {
    test('both files valid: usable, with pmtiles:// file URLs and the tile metadata', () async {
      putVector();
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.message, isNull);
      expect(r.vectorUrl, startsWith('pmtiles://file:///'));
      expect(r.vectorUrl, endsWith('/$kVectorTilesFile'));
      expect(r.terrainUrl, endsWith('/$kTerrainTilesFile'));
      expect(r.vector!.vectorLayers, ['building', 'road', 'water']);
      expect(r.terrain!.attribution, 'produced using Copernicus WorldDEM-30');
    });

    test('v2 present: v2 is used (even with v1 beside it), with a one-line note naming it', () async {
      putV2();
      putVector();
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.vectorFile, kVectorV2TilesFile);
      expect(r.hasSeaAndLandUse, isTrue);
      expect(r.vectorUrl, endsWith('/$kVectorV2TilesFile'));
      expect(r.vector!.vectorLayers, containsAll(['landuse', 'sea']));
      expect(r.note, allOf(contains(kVectorV2TilesFile), isNot(contains('\n'))));
    });

    test('v2 absent, v1 present: v1 is used, and the note says sea and land use need v2', () async {
      putVector();
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.vectorFile, kVectorTilesFile);
      expect(r.hasSeaAndLandUse, isFalse);
      expect(r.vectorUrl, endsWith('/$kVectorTilesFile'));
      expect(r.note, allOf(contains(kVectorTilesFile), contains('Sea and land use need $kVectorV2TilesFile'), isNot(contains('\n'))));
    });

    test('v2 present but broken, v1 fine: v1 is used and the note says why v2 is not', () async {
      File('${dir.path}/$kVectorV2TilesFile').writeAsStringSync('garbage');
      putVector();
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.vectorFile, kVectorTilesFile);
      expect(r.note, contains('$kVectorV2TilesFile is not a valid PMTiles file'));
    });

    test('v2 present as the wrong kind of archive is not used', () async {
      putV2(tileType: 2);
      putVector();
      putTerrain();
      expect((await loadDevTiles(dir)).vectorFile, kVectorTilesFile);
    });

    test('neither v2 nor v1: not usable (the fixture takes over), and the message names both', () async {
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isFalse);
      expect(r.vectorFile, isEmpty);
      expect(r.message, allOf(contains('$kVectorV2TilesFile is missing'), contains('$kVectorTilesFile is missing'), contains('fixture')));
    });

    test('v2 alone with the terrain file is enough', () async {
      putV2();
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.vectorFile, kVectorV2TilesFile);
    });

    test('a missing directory or no files: not usable, the message names both files and the fixture fallback', () async {
      final missing = await loadDevTiles(Directory('${dir.path}/nope'));
      expect(missing.usable, isFalse);
      expect(missing.message, allOf(contains(kVectorV2TilesFile), contains(kVectorTilesFile), contains('fixture'), contains('push_dev_tiles')));
      expect((await loadDevTiles(dir)).usable, isFalse);
    });

    test('terrain present: both URLs, hasTerrain, no terrain note', () async {
      putVector();
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.hasTerrain, isTrue);
      expect(r.terrainUrl, endsWith('/$kTerrainTilesFile'));
      expect(r.terrainNote, isNull);
    });

    test('terrain absent: still usable, no terrain URL, and the one-line note', () async {
      putVector();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.message, isNull);
      expect(r.hasTerrain, isFalse);
      expect(r.terrainUrl, isEmpty);
      expect(r.terrainNote, 'terrain not installed: no hillshade');
      expect(r.terrainProblem, isNull, reason: 'absent is not a problem');
      expect(r.vectorUrl, endsWith('/$kVectorTilesFile'));
    });

    test('terrain absent with v2: v2 is used and there is still no hillshade', () async {
      putV2();
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.vectorFile, kVectorV2TilesFile);
      expect(r.terrainUrl, isEmpty);
    });

    test('terrain file broken or the wrong kind: treated as not installed, with the reason kept, never an error', () async {
      putVector();
      writePmtiles(dir, kTerrainTilesFile, pmtilesBytes(tileType: 1)); // vector where terrain is expected
      final r = await loadDevTiles(dir);
      expect(r.usable, isTrue);
      expect(r.hasTerrain, isFalse);
      expect(r.terrainNote, kNoTerrainNote);
      expect(r.terrainProblem, contains('$kTerrainTilesFile is not a terrain archive'));
    });

    test('vector missing but terrain present: not usable (the fixture takes over)', () async {
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isFalse);
      expect(r.message, contains('$kVectorTilesFile is missing'));
    });

    test('a file that is not PMTiles, or the wrong kind, is reported, not thrown', () async {
      File('${dir.path}/$kVectorTilesFile').writeAsStringSync('this is not a tile archive');
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isFalse);
      expect(r.message, contains('$kVectorTilesFile is not a valid PMTiles file'));
    });

    test('an empty or truncated file is reported', () async {
      File('${dir.path}/$kVectorTilesFile').writeAsBytesSync(const []);
      putTerrain();
      final r = await loadDevTiles(dir);
      expect(r.usable, isFalse);
      expect(r.message, contains(kVectorTilesFile));
    });
  });
}
