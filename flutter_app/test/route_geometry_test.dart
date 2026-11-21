import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/route_geometry.dart';

/// Polyline6 encoder for the round-trip test.
String encode6(List<List<double>> pts) {
  final out = StringBuffer();
  var pLat = 0, pLon = 0;
  void put(int v) {
    var n = v < 0 ? ~(v << 1) : (v << 1);
    while (n >= 0x20) {
      out.writeCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out.writeCharCode(n + 63);
  }

  for (final p in pts) {
    final la = (p[0] * 1e6).round(), lo = (p[1] * 1e6).round();
    put(la - pLat);
    put(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out.toString();
}

double _len(List<List<double>> lonLat) {
  var t = 0.0;
  for (var i = 1; i < lonLat.length; i++) {
    t += RouteGeometry.haversineM(lonLat[i - 1][1], lonLat[i - 1][0], lonLat[i][1], lonLat[i][0]);
  }
  return t;
}

void main() {
  final real = jsonDecode(File('assets/fixtures/accra-real-manifest.json').readAsStringSync()) as Map<String, dynamic>;
  final poly = real['route']['polyline6'] as String;
  final lengthM = (real['route']['lengthM'] as num).toDouble();

  test('polyline6 round trip, negative and large deltas', () {
    final pts = [
      [5.6037, -0.187], [5.60371, -0.18702], [5.59, -0.2], [5.56, -0.2057], [-33.8688, 151.2093], [0.0, 0.0],
    ];
    final back = RouteGeometry.decodePolyline6(encode6(pts));
    expect(back.length, pts.length);
    for (var i = 0; i < pts.length; i++) {
      expect(back[i][0], closeTo(pts[i][0], 1e-6));
      expect(back[i][1], closeTo(pts[i][1], 1e-6));
    }
  });

  test('a truncated polyline is rejected', () {
    expect(() => RouteGeometry.decodePolyline6(encode6([[5.6, -0.2]]).substring(0, 3)), throwsFormatException);
  });

  test('the real route runs from the origin to the destination and its length matches the manifest', () {
    final r = RouteGeometry.fromPolyline6(poly, lengthM: lengthM);
    expect(r.points.length, greaterThan(50));
    // The route snaps to roads, so the ends are near (not exactly at) the requested points.
    expect(RouteGeometry.haversineM(r.points.first[0], r.points.first[1], 5.6037, -0.1870), lessThan(60));
    expect(RouteGeometry.haversineM(r.points.last[0], r.points.last[1], 5.5600, -0.2057), lessThan(60));
    final raw = RouteGeometry.rawLengthM(poly);
    expect((raw - lengthM).abs() / lengthM, lessThan(0.01), reason: 'decoded length $raw vs manifest $lengthM');
    expect(r.cumulativeM.last, closeTo(lengthM, 1e-6), reason: 'scaled to the manifest length');
    for (var i = 1; i < r.cumulativeM.length; i++) {
      expect(r.cumulativeM[i], greaterThanOrEqualTo(r.cumulativeM[i - 1]));
    }
  });

  test('the real keyframes lie on the real route at their offsets (offsets mean what the manifest says)', () {
    final r = RouteGeometry.fromPolyline6(poly, lengthM: lengthM);
    final kfs = (real['segments'][0]['flyover']['keyframes'] as List).cast<Map<String, dynamic>>();
    for (final k in kfs) {
      final p = r.pointAt((k['offsetM'] as num).toDouble());
      final d = RouteGeometry.haversineM(p[0], p[1], (k['lat'] as num).toDouble(), (k['lon'] as num).toDouble());
      expect(d, lessThan(3), reason: 'keyframe at ${k['offsetM']} m is $d m from the route point');
    }
  });

  test('slices follow the offsets and clamp', () {
    final r = RouteGeometry.fromPolyline6(poly, lengthM: lengthM);
    final s = r.sliceLonLat(5227.5, 5527.5);
    expect(_len(s), closeTo(300, 3));
    expect(r.sliceLonLat(100, 100), isEmpty);
    expect(r.sliceLonLat(200, 100), isEmpty);
    final all = r.sliceLonLat(-50, lengthM + 50);
    expect(_len(all), closeTo(lengthM, lengthM * 0.01));
    expect(all.first, [r.points.first[1], r.points.first[0]]);
    expect(all.last, [r.points.last[1], r.points.last[0]]);
    final fc = r.lineFeatureCollection(0, 0.5);
    expect(fc['features'], isNotEmpty, reason: 'a 0.5 m slice is still a line');
    expect(r.lineFeatureCollection(10, 10)['features'], isEmpty);
  });

  test('pointAt is exact at the ends and monotone along the route', () {
    final r = RouteGeometry.fromPolyline6(poly, lengthM: lengthM);
    expect(r.pointAt(0), r.points.first);
    expect(r.pointAt(lengthM), r.points.last);
    expect(r.pointAt(-10), r.points.first);
    expect(r.pointAt(lengthM + 10), r.points.last);
    var prev = 0.0;
    for (var o = 0.0; o <= lengthM; o += 97) {
      final p = r.pointAt(o);
      final d = RouteGeometry.haversineM(r.points.first[0], r.points.first[1], p[0], p[1]);
      expect(d + 1, greaterThanOrEqualTo(math.min(prev, d)));
      prev = d;
    }
  });

  test('the destination marker is a point plus a small closed square', () {
    final fc = RouteGeometry.destinationCollection(5.56, -0.2057);
    final feats = (fc['features'] as List).cast<Map<String, dynamic>>();
    expect(feats.map((f) => f['geometry']['type']), ['Point', 'Polygon']);
    final ring = (feats[1]['geometry']['coordinates'] as List).first as List;
    expect(ring.length, 5);
    expect(ring.first, ring.last);
    final w = RouteGeometry.haversineM(5.56, (ring[0] as List)[0] as double, 5.56, (ring[1] as List)[0] as double);
    expect(w, closeTo(5, 0.2));
  });
}
