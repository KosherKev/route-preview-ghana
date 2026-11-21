import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/info_panel.dart';
import 'package:route_preview/scene/scene.dart';
import 'package:route_preview/scene/scene_loader.dart';
import 'package:route_preview/tiles/dev_tiles.dart';

import 'support/file_asset_bundle.dart';
import 'support/mixed.dart';
import 'support/pmtiles_builder.dart';

/// The Copernicus string as written in the terrain tile file's metadata (docs/data/terrain.md is not on main yet).
const copernicus =
    'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('panel'));
  tearDown(() => dir.deleteSync(recursive: true));

  testWidgets('the info panel shows the OpenStreetMap and Copernicus DEM attribution and the height notes', (tester) async {
    writePmtiles(dir, kVectorTilesFile, pmtilesBytes(tileType: 1, gzipMetadata: true, metadata: {
      'attribution': '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
    }));
    writePmtiles(dir, kTerrainTilesFile, pmtilesBytes(tileType: 2, minZoom: 6, maxZoom: 13, metadata: {'attribution': copernicus}));
    final scene = await tester.runAsync(() => loadScene(tilesDir: dir, bundle: FileAssetBundle()));

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: InfoPanel(scene: scene!))));
    expect(find.text('About this map'), findsOneWidget);
    expect(find.textContaining('never synced to live GPS'), findsOneWidget);
    expect(find.textContaining('© OpenStreetMap contributors'), findsOneWidget);
    expect(find.textContaining('openstreetmap.org/copyright'), findsOneWidget);
    expect(find.text(copernicus), findsOneWidget, reason: 'the Copernicus string must appear exactly as in the tile metadata');
    expect(find.textContaining('not a measurement'), findsOneWidget);
  });

  testWidgets('the fixture fallback panel says the data is invented', (tester) async {
    final scene = await tester.runAsync(() => loadScene(tilesDir: dir, bundle: FileAssetBundle()));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: InfoPanel(scene: scene!))));
    expect(find.textContaining('Invented route and buildings'), findsOneWidget);
  });

  testWidgets('the panel lists the manifest attribution: sources, creators, licences, the prototype note and any exclusion', (tester) async {
    final m = mixedManifest((j) {
      j['sourcesExcluded'] = ['mapillary'];
      (j['attribution'] as Map<String, dynamic>)['requiresLogoAndLink'] = true;
    });
    final scene = RouteOnlyScene.create(manifest: m, message: 'x');
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: InfoPanel(scene: scene))));
    expect(find.text('Imagery sources'), findsOneWidget);
    expect(find.textContaining('Sources: synthetic-test'), findsOneWidget);
    expect(find.textContaining('Creators: Test pattern generator'), findsOneWidget);
    expect(find.textContaining('Licences: CC0-1.0'), findsOneWidget);
    expect(find.textContaining('require their logo and a link back'), findsOneWidget);
    expect(find.textContaining('Excluded by the server (kill switch): mapillary'), findsOneWidget);
    expect(find.text('Prototype'), findsOneWidget);
    expect(find.textContaining('prototype-only'), findsOneWidget);
  });

  testWidgets('with no street imagery the panel says so', (tester) async {
    final m = PreviewManifest.parse(File('assets/fixtures/accra-real-manifest.json').readAsStringSync());
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: InfoPanel(scene: RouteOnlyScene.create(manifest: m, message: 'x')))));
    expect(find.textContaining('No street imagery in this preview'), findsOneWidget);
  });
}
