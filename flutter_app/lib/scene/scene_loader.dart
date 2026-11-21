import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show AssetBundle, rootBundle;
import 'package:path_provider/path_provider.dart';

import '../clips/clip_store.dart';
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

/// `Documents/clips` inside the app sandbox.
Future<Directory> sandboxClipsDir() async {
  final docs = await getApplicationDocumentsDirectory();
  return Directory('${docs.path}/clips');
}

/// A scene for [manifest] (from the live API or any other source): the real tiles when both files are in [tilesDir],
/// else the route on a plain background with a message. Clips found in [clipsDir] play; nothing is ever downloaded.
Future<Scene> sceneForManifest(
  PreviewManifest manifest, {
  required String sourceLabel,
  Directory? tilesDir,
  Directory? clipsDir,
  AssetBundle? bundle,
  bool hillshade = true,
}) async {
  final b = bundle ?? rootBundle;
  final clips = ClipStore(clipsDir ?? await sandboxClipsDir());
  final available = await clips.available(manifest);
  final tiles = await loadDevTiles(tilesDir ?? await sandboxTilesDir());
  if (tiles.usable) {
    try {
      return TileScene.create(
        manifest: manifest,
        styleTemplate: await b.loadString(RoutePreviewStyle.asset),
        tiles: tiles,
        hillshade: hillshade,
        availableClips: available,
        clipStore: clips,
        sourceLabel: sourceLabel,
      );
    } on Object catch (e) {
      debugPrint('[flyover] tile scene failed: $e');
    }
  }
  return RouteOnlyScene.create(
    manifest: manifest,
    message: tiles.usable ? 'Could not build the map style. Showing the route only.' : (tiles.message ?? 'Map tiles not available.'),
    availableClips: available,
    clipStore: clips,
    sourceLabel: sourceLabel,
  );
}

/// Picks the scene for the BUNDLED fixture route: the real tiles when both files are in [tilesDir], else the 5B-1 fixture with a message saying why.
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
