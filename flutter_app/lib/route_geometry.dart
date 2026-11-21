import 'dart:math' as math;

/// A route as the manifest describes it: the polyline6 of the whole route, with offsets in metres along it.
/// Distances are accumulated with the haversine formula and then scaled so the total equals the manifest's own
/// `route.lengthM`, so an `offsetM` from a keyframe lands where the manifest means it.
class RouteGeometry {
  /// [lat, lon] pairs.
  final List<List<double>> points;

  /// Cumulative distance in metres at each point, scaled to [lengthM].
  final List<double> cumulativeM;
  final double lengthM;

  RouteGeometry._(this.points, this.cumulativeM, this.lengthM);

  static const double _earthRadiusM = 6371008.8;

  /// Decodes an encoded polyline with 6 digits of precision.
  static List<List<double>> decodePolyline6(String encoded) {
    final out = <List<double>>[];
    var index = 0, lat = 0, lon = 0;
    int next() {
      var result = 0, shift = 0;
      int b;
      do {
        if (index >= encoded.length) throw const FormatException('truncated polyline6');
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      return (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
    }

    while (index < encoded.length) {
      lat += next();
      lon += next();
      out.add([lat / 1e6, lon / 1e6]);
    }
    return out;
  }

  factory RouteGeometry.fromPolyline6(String encoded, {required double lengthM}) {
    final pts = decodePolyline6(encoded);
    final cum = <double>[0];
    for (var i = 1; i < pts.length; i++) {
      cum.add(cum.last + haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    }
    final raw = cum.isEmpty ? 0.0 : cum.last;
    final scale = raw > 0 ? lengthM / raw : 1.0;
    return RouteGeometry._(pts, [for (final c in cum) c * scale], lengthM);
  }

  /// Length of the decoded polyline before scaling to the manifest length (for sanity checks).
  static double rawLengthM(String encoded) {
    final pts = decodePolyline6(encoded);
    var total = 0.0;
    for (var i = 1; i < pts.length; i++) {
      total += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    }
    return total;
  }

  static double haversineM(double lat1, double lon1, double lat2, double lon2) {
    double rad(double d) => d * math.pi / 180;
    final dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    final a = math.pow(math.sin(dLat / 2), 2) + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.pow(math.sin(dLon / 2), 2);
    return 2 * _earthRadiusM * math.asin(math.min(1.0, math.sqrt(a)));
  }

  /// The point at [offsetM] along the route, clamped to the ends.
  List<double> pointAt(double offsetM) {
    if (points.isEmpty) throw StateError('empty route');
    final o = offsetM.clamp(0.0, lengthM).toDouble();
    for (var i = 1; i < points.length; i++) {
      if (cumulativeM[i] >= o) return _lerp(i, o);
    }
    return points.last;
  }

  List<double> _lerp(int i, double o) {
    final seg = cumulativeM[i] - cumulativeM[i - 1];
    final f = seg <= 0 ? 0.0 : (o - cumulativeM[i - 1]) / seg;
    final a = points[i - 1], b = points[i];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  /// GeoJSON positions ([lon, lat]) of the part of the route between [fromM] and [toM] (clamped and ordered).
  List<List<double>> sliceLonLat(double fromM, double toM) {
    if (points.isEmpty) return const [];
    final a = fromM.clamp(0.0, lengthM).toDouble();
    final b = toM.clamp(0.0, lengthM).toDouble();
    if (b <= a) return const [];
    final start = pointAt(a), end = pointAt(b);
    final out = <List<double>>[
      [start[1], start[0]],
    ];
    for (var i = 0; i < points.length; i++) {
      if (cumulativeM[i] > a && cumulativeM[i] < b) out.add([points[i][1], points[i][0]]);
    }
    out.add([end[1], end[0]]);
    return out;
  }

  Map<String, dynamic> lineFeatureCollection(double fromM, double toM) {
    final coords = sliceLonLat(fromM, toM);
    return {
      'type': 'FeatureCollection',
      'features': [
        if (coords.length >= 2)
          {'type': 'Feature', 'properties': <String, dynamic>{}, 'geometry': {'type': 'LineString', 'coordinates': coords}},
      ],
    };
  }

  Map<String, dynamic> get fullLine => lineFeatureCollection(0, lengthM);

  /// A destination marker: the point plus a small square footprint (for the extruded pole), about [halfSideM] each way.
  static Map<String, dynamic> destinationCollection(double lat, double lon, {double halfSideM = 2.5}) {
    final dLat = halfSideM / 111320.0;
    final dLon = halfSideM / (111320.0 * math.cos(lat * math.pi / 180));
    final ring = [
      [lon - dLon, lat - dLat],
      [lon + dLon, lat - dLat],
      [lon + dLon, lat + dLat],
      [lon - dLon, lat + dLat],
      [lon - dLon, lat - dLat],
    ];
    return {
      'type': 'FeatureCollection',
      'features': [
        {'type': 'Feature', 'properties': <String, dynamic>{}, 'geometry': {'type': 'Point', 'coordinates': [lon, lat]}},
        {'type': 'Feature', 'properties': <String, dynamic>{}, 'geometry': {'type': 'Polygon', 'coordinates': [ring]}},
      ],
    };
  }
}
