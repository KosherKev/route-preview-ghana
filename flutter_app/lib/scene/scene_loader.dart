import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show AssetBundle, rootBundle;
import 'package:path_provider/path_provider.dart';

import '../fixture.dart';
import '../flyover/manifest.dart';
import '../style/route_preview_style.dart';
import '../tiles/dev_tiles.dart';
import 'scene.dart';

/// The real Accra route fixture (a manifest fetched once from the preview API; see the README).
const String kRealManifestAsset = 'assets/fixtures/accra-real-manifest.json';

/// `Documents/tiles` inside the app sandbox.
Future<Directory> sandboxTilesDir() async {
  final docs = await getApplicationDocumentsDirectory();
  return Directory('${docs.path}/tiles');
}

/// Picks the scene: the real tiles when both files are in [tilesDir], else the 5B-1 fixture with a message saying why.
/// Never returns a blank map and never throws for missing or broken tiles.
Future<Scene> loadScene({
  Directory? tilesDir,
  AssetBundle? bundle,
  bool hillshade = true,
  bool probeUnsupported = false,
}) async {
  final b = bundle ?? rootBundle;
  final dir = tilesDir ?? await sandboxTilesDir();
  final tiles = await loadDevTiles(dir);
  if (!tiles.usable) {
    debugPrint('[flyover] ${tiles.message}');
    return FixtureScene(await Fixture.load(b), fallbackMessage: tiles.message);
  }
  try {
    return TileScene.create(
      manifest: PreviewManifest.parse(await b.loadString(kRealManifestAsset)),
      styleTemplate: await b.loadString(RoutePreviewStyle.asset),
      tiles: tiles,
      hillshade: hillshade,
      probeUnsupported: probeUnsupported,
    );
  } on Object catch (e) {
    // A broken style or manifest must not leave a blank map either.
    debugPrint('[flyover] real scene failed: $e');
    return FixtureScene(await Fixture.load(b), fallbackMessage: 'Could not build the real map ($e). Showing the synthetic fixture instead.');
  }
}
