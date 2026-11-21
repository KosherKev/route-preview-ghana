import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/info_panel.dart';
import 'package:route_preview/scene/scene_loader.dart';
import 'package:route_preview/tiles/dev_tiles.dart';

import 'support/file_asset_bundle.dart';
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
}
