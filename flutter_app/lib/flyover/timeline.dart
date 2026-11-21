import 'manifest.dart';

/// The camera at one instant of the preview clock.
class CameraState {
  final double offsetM;
  final double lat;
  final double lon;
  final double bearingDeg;
  final double pitchDeg;
  final double zoom;
  const CameraState({
    required this.offsetM,
    required this.lat,
    required this.lon,
    required this.bearingDeg,
    required this.pitchDeg,
    required this.zoom,
  });
}

class _TimedSegment {
  final double startT;
  final FlyoverPlan plan;
  const _TimedSegment(this.startT, this.plan);
  double get endT => startT + plan.durationSec;
}

/// Plays the manifest's flyover segments back to back on a preview clock (seconds).
///
/// The timeline is driven by the manifest's own offsets: [startOffsetM] is `timeline.startM`, which can be before
/// `approach.startM` (a ready clip is never cut, so a timeline may begin ahead of the nominal approach window).
/// Nothing here assumes a 500 m window. Speed comes only from the keyframes: time maps to the camera linearly
/// through each keyframe pair (with that pair's easing); there are no extra speed ramps.
class FlyoverTimeline {
  final double startOffsetM;
  final double endOffsetM;
  final double approachStartM;
  final List<_TimedSegment> _segments;
  final double totalDurationSec;

  FlyoverTimeline._(this.startOffsetM, this.endOffsetM, this.approachStartM, this._segments, this.totalDurationSec);

  /// Street-video segments are Phase 5B-2; a manifest with a `clip` segment is refused here, not silently skipped.
  factory FlyoverTimeline.fromManifest(PreviewManifest m) {
    final timed = <_TimedSegment>[];
    var t = 0.0;
    for (final s in m.segments) {
      final plan = s.flyover;
      if (s.playback != 'flyover' || plan == null) {
        throw StateError('segment ${s.index} plays a clip; street-video playback is Phase 5B-2');
      }
      timed.add(_TimedSegment(t, plan));
      t += plan.durationSec;
    }
    return FlyoverTimeline._(m.timelineStartM, m.timelineEndM, m.approachStartM, List.unmodifiable(timed), t);
  }

  /// Clamps [t] to the clock range.
  double clamp(double t) => t.isNaN ? 0 : t.clamp(0.0, totalDurationSec).toDouble();

  CameraState cameraAt(double t) {
    t = clamp(t);
    // Last segment whose start is <= t (so the boundary instant belongs to the next segment).
    var seg = _segments.first;
    for (final s in _segments) {
      if (s.startT <= t) seg = s;
    }
    return _interpolate(seg.plan.keyframes, t - seg.startT);
  }

  static CameraState _interpolate(List<Keyframe> k, double local) {
    if (local <= k.first.t) return _state(k.first);
    if (local >= k.last.t) return _state(k.last);
    var i = 0;
    while (i < k.length - 2 && k[i + 1].t <= local) {
      i++;
    }
    final a = k[i], b = k[i + 1];
    final raw = (local - a.t) / (b.t - a.t);
    final p = a.easing == Easing.cubicInOut ? _cubicInOut(raw) : raw;
    double lerp(double x, double y) => x + (y - x) * p;
    return CameraState(
      offsetM: lerp(a.offsetM, b.offsetM),
      lat: lerp(a.lat, b.lat),
      lon: lerp(a.lon, b.lon),
      bearingDeg: lerpBearing(a.bearingDeg, b.bearingDeg, p),
      pitchDeg: lerp(a.pitchDeg, b.pitchDeg),
      zoom: lerp(a.zoom, b.zoom),
    );
  }

  static CameraState _state(Keyframe k) => CameraState(
      offsetM: k.offsetM, lat: k.lat, lon: k.lon, bearingDeg: k.bearingDeg, pitchDeg: k.pitchDeg, zoom: k.zoom);

  static double _cubicInOut(double p) => p < 0.5 ? 4 * p * p * p : 1 - _cube(-2 * p + 2) / 2;
  static double _cube(double x) => x * x * x;

  /// Interpolates a bearing along the shortest arc; the result is in [0, 360).
  static double lerpBearing(double a, double b, double p) {
    final delta = ((b - a + 540) % 360) - 180;
    final r = (a + delta * p) % 360;
    return r < 0 ? r + 360 : r;
  }
}
