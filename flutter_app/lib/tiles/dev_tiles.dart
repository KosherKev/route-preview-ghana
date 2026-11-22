import 'dart:io';

import 'pmtiles_info.dart';

/// The dev tile files the app reads at runtime from `Documents/tiles/` inside its own sandbox. They are never in the
/// repo or in the app assets (OSM data and a Copernicus DEM, large and not for a public repo); `tool/push_dev_tiles.sh`
/// copies them into the simulator container after checking their SHA-256 sums.
///
/// Vector tiles: v2 (building, road, water, landuse, sea) is preferred; v1 (no landuse, no sea) is the fallback.
const String kVectorV2TilesFile = 'accra-v2.pmtiles';
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

  /// Which vector file is in use (empty when none is), and a one-line note about it for the info panel.
  final String vectorFile;
  final String? note;

  const DevTilesResult({
    required this.usable,
    this.message,
    this.vectorUrl = '',
    this.terrainUrl = '',
    this.vector,
    this.terrain,
    this.vectorFile = '',
    this.note,
  });

  /// True when the vector tiles in use are v2, which carry the `landuse` and `sea` layers.
  bool get hasSeaAndLandUse => vectorFile == kVectorV2TilesFile;
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

  // Prefer v2; fall back to v1 (also when v2 is there but unusable, saying why).
  final v2 = await check(kVectorV2TilesFile, PmtilesInfo.tileTypeMvt, 'vector');
  final v2Problems = List<String>.of(problems);
  PmtilesInfo? vector = v2;
  var vectorFile = v2 == null ? '' : kVectorV2TilesFile;
  if (v2 == null) {
    vector = await check(kVectorTilesFile, PmtilesInfo.tileTypeMvt, 'vector');
    if (vector != null) vectorFile = kVectorTilesFile;
  }
  // v1 was fine: v2 problems are not blocking, they only go into the note. With no vector file at all every problem counts.
  if (vector != null) problems.clear();
  final terrain = await check(kTerrainTilesFile, PmtilesInfo.tileTypePng, 'terrain');
  if (problems.isNotEmpty) {
    return DevTilesResult(
      usable: false,
      message: 'Map tiles not available: ${problems.join('; ')}. Showing the synthetic fixture instead. '
          'Copy the tiles into Documents/tiles (tool/push_dev_tiles.sh) and restart.',
      vector: vector,
      terrain: terrain,
      vectorFile: vectorFile,
    );
  }
  final note = vectorFile == kVectorV2TilesFile
      ? 'Vector tiles in use: $kVectorV2TilesFile (with land use and sea).'
      : 'Vector tiles in use: $kVectorTilesFile. Sea and land use need $kVectorV2TilesFile, which is '
          '${v2Problems.isEmpty ? 'not in Documents/tiles' : 'not usable (${v2Problems.join('; ')})'}.';
  return DevTilesResult(
    usable: true,
    vectorUrl: 'pmtiles://${Uri.file('${dir.path}/$vectorFile')}',
    terrainUrl: 'pmtiles://${Uri.file('${dir.path}/$kTerrainTilesFile')}',
    vector: vector,
    terrain: terrain,
    vectorFile: vectorFile,
    note: note,
  );
}
