import 'dart:math' as math;

import '../route_geometry.dart';
import 'camera_preset.dart';
import 'timeline.dart';

/// A camera computed from the route polyline alone: it follows the route position [offsetM] at a low altitude and moderate
/// pitch, with its centre [CameraPreset.lookAheadM] ahead of the rider's position so the road ahead and the buildings and
/// junctions beside it are on screen. Pure function of the route and the offset; the frame-to-frame smoothing is
/// [CameraSmoother]'s job.
///
/// The heading is the average direction of the route over the next [CameraPreset.headingAheadM] metres (several samples,
/// weighted towards the near end), so it leans into a corner before the camera reaches it and never jumps at a vertex.
class ChaseCamera {
  final RouteGeometry route;
  const ChaseCamera(this.route);

  /// Samples used for the heading average.
  static const int _headingSamples = 6;

  CameraState targetAt(double offsetM, CameraPreset preset) {
    assert(preset.isChase, 'the High preset uses the manifest keyframes, not the chase camera');
    final len = route.lengthM;
    final here = offsetM.clamp(0.0, len).toDouble();
    final centreOff = (here + preset.lookAheadM).clamp(0.0, len).toDouble();
    final centre = route.pointAt(centreOff);
    return CameraState(
      offsetM: here,
      lat: centre[0],
      lon: centre[1],
      bearingDeg: headingAt(here, preset.headingAheadM),
      pitchDeg: preset.pitchDeg!,
      zoom: preset.zoom!,
    );
  }

  /// Direction of travel at [offsetM], averaged over the next [aheadM] metres. Near the end of the route (or on a route
  /// shorter than [aheadM]) the window slides back so there is always a direction; a route with no length faces north.
  double headingAt(double offsetM, double aheadM) {
    final len = route.lengthM;
    if (len <= 0 || route.points.length < 2) return 0;
    final span = math.min(aheadM, len);
    final from = (offsetM + span > len ? len - span : offsetM).clamp(0.0, len).toDouble();
    var sx = 0.0, sy = 0.0;
    var prev = route.pointAt(from);
    for (var i = 1; i <= _headingSamples; i++) {
      // Nearer samples count more, so the turn is led into rather than anticipated too early.
      final w = (_headingSamples + 1 - i).toDouble();
      final off = from + span * i / _headingSamples;
      final p = route.pointAt(off);
      final b = _bearingRad(prev, p);
      if (!(p[0] == prev[0] && p[1] == prev[1])) {
        sx += w * math.sin(b);
        sy += w * math.cos(b);
      }
      prev = p;
    }
    if (sx == 0 && sy == 0) return 0;
    return (math.atan2(sx, sy) * 180 / math.pi + 360) % 360;
  }

  static double _bearingRad(List<double> a, List<double> b) {
    double rad(double d) => d * math.pi / 180;
    final dLon = rad(b[1] - a[1]);
    final y = math.sin(dLon) * math.cos(rad(b[0]));
    final x = math.cos(rad(a[0])) * math.sin(rad(b[0])) - math.sin(rad(a[0])) * math.cos(rad(b[0])) * math.cos(dLon);
    return math.atan2(y, x);
  }
}
