import 'dart:math' as math;

import 'timeline.dart';

/// Critically damped smoothing of one number (the "smooth damp" spring): it follows a moving target with no overshoot and
/// no steps, whatever the frame rate, because it works from elapsed time. [smoothTimeSec] is roughly how long it takes
/// to catch up.
class SmoothValue {
  double value;
  double _velocity = 0;
  SmoothValue(this.value);

  void snap(double v) {
    value = v;
    _velocity = 0;
  }

  double step(double target, double dtSec, double smoothTimeSec) {
    if (dtSec <= 0) return value;
    final st = math.max(0.0001, smoothTimeSec);
    final omega = 2 / st;
    final x = omega * dtSec;
    final decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    final change = value - target;
    final temp = (_velocity + omega * change) * dtSec;
    _velocity = (_velocity - omega * temp) * decay;
    value = target + (change + temp) * decay;
    return value;
  }
}

/// Smooths a whole [CameraState] (position, heading, pitch, zoom) frame by frame, so the map camera has no visible
/// steps, no heading snaps at corners and no easing restarts. Heading is smoothed on the shortest arc (350 to 10 degrees
/// is a 20 degree move, never a 340 degree spin).
class CameraSmoother {
  final double positionSmoothSec;
  final double headingSmoothSec;
  final double pitchZoomSmoothSec;
  final SmoothValue _lat = SmoothValue(0), _lon = SmoothValue(0), _bearing = SmoothValue(0), _pitch = SmoothValue(0), _zoom = SmoothValue(0);
  bool _started = false;

  CameraSmoother({this.positionSmoothSec = 0.25, this.headingSmoothSec = 0.7, this.pitchZoomSmoothSec = 0.5});

  bool get started => _started;

  /// Jumps straight to [t] (the first frame, a scrub, a section change, a preset change).
  CameraState snap(CameraState t) {
    _lat.snap(t.lat);
    _lon.snap(t.lon);
    _bearing.snap(t.bearingDeg);
    _pitch.snap(t.pitchDeg);
    _zoom.snap(t.zoom);
    _started = true;
    return _current(t.offsetM);
  }

  /// Moves [dtSec] of wall time towards [target] and returns the smoothed camera. The first call snaps.
  CameraState step(CameraState target, double dtSec) {
    if (!_started) return snap(target);
    _lat.step(target.lat, dtSec, positionSmoothSec);
    _lon.step(target.lon, dtSec, positionSmoothSec);
    // Unwrap the target next to the current heading so the spring takes the short way round.
    final cur = _bearing.value;
    final unwrapped = cur + angleDelta(cur, target.bearingDeg);
    _bearing.step(unwrapped, dtSec, headingSmoothSec);
    _pitch.step(target.pitchDeg, dtSec, pitchZoomSmoothSec);
    _zoom.step(target.zoom, dtSec, pitchZoomSmoothSec);
    return _current(target.offsetM);
  }

  CameraState _current(double offsetM) => CameraState(
        offsetM: offsetM,
        lat: _lat.value,
        lon: _lon.value,
        bearingDeg: normalizeDeg(_bearing.value),
        pitchDeg: _pitch.value,
        zoom: _zoom.value,
      );

  /// Signed shortest turn from [from] to [to], in (-180, 180].
  static double angleDelta(double from, double to) {
    final d = ((to - from + 540) % 360) - 180;
    return d == -180 ? 180 : d;
  }

  static double normalizeDeg(double d) {
    final r = d % 360;
    return r < 0 ? r + 360 : r;
  }
}
