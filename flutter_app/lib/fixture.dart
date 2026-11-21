import 'dart:convert';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;

import 'flyover/manifest.dart';

/// The SYNTHETIC offline scene (see tool/make_fixture.py): an invented route and invented buildings.
/// It is read from bundled assets only; nothing here touches the network.
class Fixture {
  final PreviewManifest manifest;
  final String styleJson;
  final Map<String, dynamic> buildings;
  final Map<String, dynamic> route;

  const Fixture({
    required this.manifest,
    required this.styleJson,
    required this.buildings,
    required this.route,
  });

  static const _dir = 'assets/fixtures';

  static Future<Fixture> load([AssetBundle? bundle]) async {
    final b = bundle ?? rootBundle;
    return Fixture(
      manifest: PreviewManifest.parse(await b.loadString('$_dir/manifest.json')),
      styleJson: await b.loadString('$_dir/style.json'),
      buildings: jsonDecode(await b.loadString('$_dir/buildings.geojson')) as Map<String, dynamic>,
      route: jsonDecode(await b.loadString('$_dir/route.geojson')) as Map<String, dynamic>,
    );
  }
}
