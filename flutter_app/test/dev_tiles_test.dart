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

    test('a missing directory or no files: not usable, the message names both files and the fixture fallback', () async {
      final missing = await loadDevTiles(Directory('${dir.path}/nope'));
      expect(missing.usable, isFalse);
      expect(missing.message, allOf(contains(kVectorTilesFile), contains(kTerrainTilesFile), contains('fixture'), contains('push_dev_tiles')));
      expect((await loadDevTiles(dir)).usable, isFalse);
    });

    test('one file missing: not usable and says which', () async {
      putVector();
      final r = await loadDevTiles(dir);
      expect(r.usable, isFalse);
      expect(r.message, contains('$kTerrainTilesFile is missing'));
      expect(r.message, isNot(contains('$kVectorTilesFile is missing')));
    });

    test('a file that is not PMTiles, or the wrong kind, is reported, not thrown', () async {
      File('${dir.path}/$kVectorTilesFile').writeAsStringSync('this is not a tile archive');
      writePmtiles(dir, kTerrainTilesFile, pmtilesBytes(tileType: 1)); // vector where terrain is expected
      final r = await loadDevTiles(dir);
      expect(r.usable, isFalse);
      expect(r.message, contains('$kVectorTilesFile is not a valid PMTiles file'));
      expect(r.message, contains('$kTerrainTilesFile is not a terrain archive'));
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
