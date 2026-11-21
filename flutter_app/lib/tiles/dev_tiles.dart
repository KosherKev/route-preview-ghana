import 'dart:io';

import 'pmtiles_info.dart';

/// The two dev tile files the app reads at runtime from `Documents/tiles/` inside its own sandbox. They are never in the
/// repo or in the app assets (OSM data and a Copernicus DEM, large and not for a public repo); `tool/push_dev_tiles.sh`
/// copies them into the simulator container after checking their SHA-256 sums.
const String kVectorTilesFile = 'accra.pmtiles';
const String kTerrainTilesFile = 'accra-terrain.pmtiles';

class DevTilesResult {
  /// True when both files are present and look like the right kind of PMTiles archive.
  final bool usable;

  /// Human-readable reason when not [usable]; shown to the user, with the fixture as the fallback map.
  final String? message;
  final String vectorUrl;
  final String terrainUrl;
  final PmtilesInfo? vector;
  final PmtilesInfo? terrain;

  const DevTilesResult({
    required this.usable,
    this.message,
    this.vectorUrl = '',
    this.terrainUrl = '',
    this.vector,
    this.terrain,
  });
}

/// Looks for both tile files in [dir] (`Documents/tiles`). Never throws: every problem becomes a [DevTilesResult] with a
/// message, so the caller can fall back to the 5B-1 fixture instead of showing a blank map.
Future<DevTilesResult> loadDevTiles(Directory dir) async {
  final problems = <String>[];
  Future<PmtilesInfo?> check(String name, int wantedType, String kind) async {
    final f = File('${dir.path}/$name');
    if (!await f.exists()) {
      problems.add('$name is missing');
      return null;
    }
    try {
      final info = await PmtilesInfo.read(f);
      if (info.tileType != wantedType) {
        problems.add('$name is not a $kind archive (tile type ${info.tileType})');
        return null;
      }
      return info;
    } on PmtilesFormatException catch (e) {
      problems.add('$name is not a valid PMTiles file (${e.message})');
      return null;
    } on FileSystemException catch (e) {
      problems.add('$name cannot be read (${e.message})');
      return null;
    }
  }

  final vector = await check(kVectorTilesFile, PmtilesInfo.tileTypeMvt, 'vector');
  final terrain = await check(kTerrainTilesFile, PmtilesInfo.tileTypePng, 'terrain');
  if (problems.isNotEmpty) {
    return DevTilesResult(
      usable: false,
      message: 'Map tiles not available: ${problems.join('; ')}. Showing the synthetic fixture instead. '
          'Copy the tiles into Documents/tiles (tool/push_dev_tiles.sh) and restart.',
      vector: vector,
      terrain: terrain,
    );
  }
  return DevTilesResult(
    usable: true,
    vectorUrl: 'pmtiles://${Uri.file('${dir.path}/$kVectorTilesFile')}',
    terrainUrl: 'pmtiles://${Uri.file('${dir.path}/$kTerrainTilesFile')}',
    vector: vector,
    terrain: terrain,
  );
}
