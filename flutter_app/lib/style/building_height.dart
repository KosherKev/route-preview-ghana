/// Building heights for the extrusion layer.
///
/// The vector tiles carry `height_source` = "height" (an OSM height tag, rare: about 0.04% of buildings in the Accra
/// tiles), "levels" (building:levels) or "default" (nothing known, about 75%). The style computes the height in an
/// expression (see `fill-extrusion-height` in assets/style/route_preview_style.json); this file is the reference
/// implementation of the same rules, and test/building_height_test.dart evaluates the real style expression and checks
/// that both agree.
///
/// The tag values are strings in the tiles and can be messy ("30'", "0", "2-3"), so anything that is not a plain positive
/// number is treated as unknown and falls through to the next rule.
library;

/// Height of one storey, metres, for `building:levels`.
const double kLevelHeightM = 3.0;

/// Range of the ESTIMATE applied to "default" buildings, metres. These two numbers are also baked into the style
/// expression (`4 + (... % 11)`), and the test fails if they drift apart.
const double kEstimateMinM = 4.0;
const double kEstimateMaxM = 14.0;

/// The height the app documents for "default" buildings in the flagged-default text (README, info panel).
const double kDocumentedDefaultM = 6.0;

class BuildingHeight {
  /// Extrusion height in metres.
  final double meters;

  /// True when [meters] is an ESTIMATE, not a value taken from the data.
  final bool isEstimate;
  const BuildingHeight(this.meters, {required this.isEstimate});

  @override
  bool operator ==(Object other) => other is BuildingHeight && other.meters == meters && other.isEstimate == isEstimate;
  @override
  int get hashCode => Object.hash(meters, isEstimate);
  @override
  String toString() => 'BuildingHeight($meters m, ${isEstimate ? 'ESTIMATE' : 'data'})';
}

/// ESTIMATE of a building's height from a stable hash of its feature id: an integer from [kEstimateMinM] to
/// [kEstimateMaxM]. Deterministic, so a building never changes height between frames, tiles or runs.
///
/// Deviation from "by footprint area": MapLibre style expressions have no polygon-area operator and the tile files
/// cannot be changed, so the footprint is not available to the style. The hash spreads heights over 4 to 14 m so the
/// skyline is not a flat slab; it carries no information about the real building. Never present it as measured.
double estimateHeightM(int featureId) {
  final h = (((featureId % 1009) * 7919) % 1013) % 11; // 0..10
  return kEstimateMinM + h;
}

/// Strict positive number from a tag string, or null (not a number, zero, negative, empty, units such as `'`).
double? parsePositive(String? raw) {
  if (raw == null) return null;
  final v = double.tryParse(raw);
  if (v == null || !v.isFinite || v <= 0) return null;
  return v;
}

/// The height rules, in order:
/// 1. `height_source` "height" with a positive numeric `height`: that value (metres).
/// 2. `height_source` "levels" with a positive numeric `building:levels`: levels times [kLevelHeightM].
/// 3. Otherwise an ESTIMATE from [estimateHeightM] (also for "default", and for "height"/"levels" whose value is
///    unusable). The estimate is never applied when rule 1 or 2 applies.
BuildingHeight buildingHeight({
  required String? heightSource,
  String? height,
  String? levels,
  required int featureId,
}) {
  if (heightSource == 'height') {
    final v = parsePositive(height);
    if (v != null) return BuildingHeight(v, isEstimate: false);
  }
  if (heightSource == 'levels') {
    final v = parsePositive(levels);
    if (v != null) return BuildingHeight(v * kLevelHeightM, isEstimate: false);
  }
  return BuildingHeight(estimateHeightM(featureId), isEstimate: true);
}
