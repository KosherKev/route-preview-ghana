import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/tiles/dev_tiles.dart';
import 'package:route_preview/tiles/pmtiles_info.dart';

/// Tests that read the REAL tile files from TILES_SRC (default ~/dev/.scratch/tiles). The tiles are never in the repo.
/// A missing file FAILS these tests; a silent skip was flagged as a false green. Set ALLOW_MISSING_TILES=1 to opt out
/// explicitly (the tests are then reported as skipped, with the reason).
String get _tilesDir => Platform.environment['TILES_SRC'] ?? '${Platform.environment['HOME']}/dev/.scratch/tiles';
bool get _optOut => Platform.environment['ALLOW_MISSING_TILES'] == '1';

void main() {
  final v2 = File('$_tilesDir/$kVectorV2TilesFile');
  final v1 = File('$_tilesDir/$kVectorTilesFile');
  final terrain = File('$_tilesDir/$kTerrainTilesFile');

  /// Returns true when the test may run; fails when a file is missing and the opt-out is not set.
  bool need(List<File> files) {
    final missing = [for (final f in files) if (!f.existsSync()) f.path];
    if (missing.isEmpty) return true;
    if (_optOut) {
      markTestSkipped('ALLOW_MISSING_TILES=1 and missing: ${missing.join(', ')}');
      return false;
    }
    fail('tile files are missing: ${missing.join(', ')}. Set TILES_SRC, or ALLOW_MISSING_TILES=1 to opt out explicitly.');
  }

  test('the real v2 metadata matches the committed layer list (test/fixtures/v2_layers.json)', () async {
    if (!need([v2])) return;
    final info = await PmtilesInfo.read(v2);
    final expected = jsonDecode(File('test/fixtures/v2_layers.json').readAsStringSync()) as Map<String, dynamic>;
    final real = {for (final l in (info.metadata['vector_layers'] as List).cast<Map>()) l['id'] as String: l};
    final want = {for (final l in (expected['layers'] as List).cast<Map>()) l['id'] as String: l};
    expect(real.keys.toSet(), want.keys.toSet());
    for (final id in want.keys) {
      expect((real[id]!['fields'] as Map).keys.toList()..sort(), want[id]!['fields'], reason: '$id fields');
      expect([real[id]!['minzoom'], real[id]!['maxzoom']], [want[id]!['minzoom'], want[id]!['maxzoom']], reason: '$id zooms');
    }
    expect(info.attribution, contains('OpenStreetMap contributors'));
    expect(info.attribution, isNot(contains('Copernicus')));
  });

  test('with the real files, loadDevTiles prefers v2; without v2 it uses v1', () async {
    if (!need([v2, v1, terrain])) return;
    final dir = Directory.systemTemp.createTempSync('realtiles');
    addTearDown(() => dir.deleteSync(recursive: true));
    Link('${dir.path}/$kTerrainTilesFile').createSync(terrain.path);
    Link('${dir.path}/$kVectorTilesFile').createSync(v1.path);
    final onlyV1 = await loadDevTiles(dir);
    expect(onlyV1.usable, isTrue);
    expect(onlyV1.vectorFile, kVectorTilesFile);
    expect(onlyV1.vector!.vectorLayers, isNot(contains('sea')));
    Link('${dir.path}/$kVectorV2TilesFile').createSync(v2.path);
    final both = await loadDevTiles(dir);
    expect(both.vectorFile, kVectorV2TilesFile);
    expect(both.vector!.vectorLayers, containsAll(['building', 'road', 'water', 'landuse', 'sea']));
    expect(both.vectorUrl, endsWith('/$kVectorV2TilesFile'));
  });

  test('the opt-out variable is the only way a missing file is not a failure', () {
    // Guard on the guard: with no opt-out, need() on a file that cannot exist must throw a test failure.
    if (_optOut) return;
    expect(() => need([File('/nonexistent/$kVectorV2TilesFile')]), throwsA(isA<TestFailure>()));
  });
}
