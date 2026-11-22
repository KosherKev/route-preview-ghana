import 'dart:math' as math;

import '../route_geometry.dart';
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

/// Default effective flyover speed, metres of route per second of preview clock. The manifest's own flyover
/// durations assume a nominal 30 m/s, which is too fast to read an approach, so the player slows each segment to this
/// speed by scaling its keyframe times. The manifest and its keyframes are never changed.
/// This is the ONE place the 1x speed is set: 14 m/s (was 10; Kevin found 10 too slow on long approaches).
const double kFlyoverEffectiveSpeedMps = 14.0;

/// What plays for one manifest segment.
enum SegmentSource {
  /// A BIRDS_EYE_3D segment: the manifest's keyframes.
  flyover,

  /// A STREET_VIDEO segment whose clip file is on this device.
  streetVideo,

  /// A STREET_VIDEO segment with no local clip: its flyover keyframes instead.
  flyoverFallback,

  /// A STREET_VIDEO segment with no local clip and no flyover keyframes: the map follows the route and the screen
  /// says so; the timeline still advances at the segment's own pace.
  noPreview,
}

/// One segment on the preview clock.
class TimelineSegment {
  final int index;
  final String mode;
  final SegmentSource source;
  final double startT;
  final double durationSec;
  final double startOffsetM;
  final double endOffsetM;

  /// Set for [SegmentSource.streetVideo]: the clip key (`Documents/clips/<key>`).
  final String? clipKey;
  final FlyoverPlan? plan;

  /// Multiplier from manifest keyframe time to preview-clock time (flyover sources only).
  final double scale;

  const TimelineSegment._({
    required this.index,
    required this.mode,
    required this.source,
    required this.startT,
    required this.durationSec,
    required this.startOffsetM,
    required this.endOffsetM,
    required this.clipKey,
    required this.plan,
    required this.scale,
  });

  double get endT => startT + durationSec;
}

/// Pitch and zoom of the camera that follows the route in sections that have no flyover keyframes.
const double kFollowPitchDeg = 55;
const double kFollowZoom = 17;

/// Plays the manifest's segments back to back on a preview clock (seconds): the hybrid timeline.
///
/// - BIRDS_EYE_3D segments play their flyover keyframes.
/// - STREET_VIDEO segments play their clip when its key is in `availableClips` (files already on the device), else
///   their flyover keyframes if the manifest has them ([SegmentSource.flyoverFallback]), else the map follows the route
///   ([SegmentSource.noPreview]) for the segment's length at the effective speed.
///
/// The timeline is driven by the manifest's own offsets: [startOffsetM] is `timeline.startM`, which can be before
/// `approach.startM` (a ready clip is never cut, so a timeline may begin ahead of the nominal approach window).
/// Nothing here assumes a 500 m window. Speed comes only from the keyframes, the clip's own length, and one constant
/// factor per flyover segment ([kFlyoverEffectiveSpeedMps]); there are no extra speed ramps.
class FlyoverTimeline {
  final double startOffsetM;
  final double endOffsetM;
  final double approachStartM;
  final List<TimelineSegment> segments;
  final double totalDurationSec;
  final RouteGeometry? _route;

  FlyoverTimeline._(this.startOffsetM, this.endOffsetM, this.approachStartM, this.segments, this.totalDurationSec, this._route);

  /// [effectiveSpeedMps] is the speed the camera should cover the route at (default [kFlyoverEffectiveSpeedMps]):
  /// each flyover segment's keyframe times are scaled so (route metres the keyframes cover) / (segment duration) equals
  /// it. Easing is kept as given. Pass null to play flyovers at the manifest's own nominal timing. A segment whose
  /// keyframes do not advance along the route (zero metres) keeps the manifest timing.
  ///
  /// [availableClips] are the clip keys that exist on this device. Segments that need route geometry for their camera
  /// (street video and no-preview sections) use the manifest's route.
  factory FlyoverTimeline.fromManifest(
    PreviewManifest m, {
    double? effectiveSpeedMps = kFlyoverEffectiveSpeedMps,
    Set<String> availableClips = const {},
  }) {
    if (effectiveSpeedMps != null && !(effectiveSpeedMps > 0)) {
      throw ArgumentError.value(effectiveSpeedMps, 'effectiveSpeedMps', 'must be > 0');
    }
    final paceMps = effectiveSpeedMps ?? kFlyoverEffectiveSpeedMps;
    final route = m.routePolyline6.isEmpty ? null : RouteGeometry.fromPolyline6(m.routePolyline6, lengthM: m.routeLengthM);
    final timed = <TimelineSegment>[];
    var t = 0.0;
    for (final s in m.segments) {
      final clip = s.clip;
      final plan = s.flyover;
      final SegmentSource source;
      if (s.playback == 'clip' && clip != null && availableClips.contains(clip.key)) {
        source = SegmentSource.streetVideo;
      } else if (plan != null) {
        source = s.mode == 'STREET_VIDEO' ? SegmentSource.flyoverFallback : SegmentSource.flyover;
      } else {
        source = SegmentSource.noPreview;
      }

      double duration;
      var scale = 1.0;
      double startM = s.startM, endM = s.endM;
      switch (source) {
        case SegmentSource.flyover:
        case SegmentSource.flyoverFallback:
          final spanM = plan!.keyframes.last.offsetM - plan.keyframes.first.offsetM;
          scale = (effectiveSpeedMps == null || spanM <= 0) ? 1.0 : spanM / effectiveSpeedMps / plan.durationSec;
          duration = plan.durationSec * scale;
          startM = plan.keyframes.first.offsetM;
          endM = plan.keyframes.last.offsetM;
        case SegmentSource.streetVideo:
          duration = clip!.durationSec > 0 ? clip.durationSec : (s.endM - s.startM) / paceMps;
        case SegmentSource.noPreview:
          duration = (s.endM - s.startM) / paceMps;
      }
      if (duration <= 0) duration = 0.001;
      if ((source == SegmentSource.streetVideo || source == SegmentSource.noPreview) && (route == null || route.points.length < 2)) {
        throw StateError('segment ${s.index} needs the route geometry for its camera, but the manifest route is empty');
      }
      timed.add(TimelineSegment._(
        index: s.index,
        mode: s.mode,
        source: source,
        startT: t,
        durationSec: duration,
        startOffsetM: startM,
        endOffsetM: endM,
        clipKey: source == SegmentSource.streetVideo ? clip!.key : null,
        plan: (source == SegmentSource.flyover || source == SegmentSource.flyoverFallback) ? plan : null,
        scale: scale,
      ));
      t += duration;
    }
    return FlyoverTimeline._(m.timelineStartM, m.timelineEndM, m.approachStartM, List.unmodifiable(timed), t, route);
  }

  /// The segment playing at [t]; a boundary instant belongs to the next segment, and the end belongs to the last.
  TimelineSegment segmentAt(double t) {
    t = clamp(t);
    var seg = segments.first;
    for (final s in segments) {
      if (s.startT <= t) seg = s;
    }
    return seg;
  }

  /// Seconds into the segment playing at [t].
  double localSec(double t) => clamp(t) - segmentAt(t).startT;

  /// Route offset (metres along the route) of the camera at [t].
  double offsetAt(double t) => cameraAt(t).offsetM;

  /// The route polyline, when the manifest has one (the chase camera needs it).
  RouteGeometry? get route => _route;

  /// The rider's route position at [t] for the chase camera: constant speed within a flyover section (linear in time
  /// between the section's first and last keyframe offsets), so the chase camera never slows to a stop at a keyframe
  /// the way the eased keyframes do. Other sections already move linearly. Segment boundaries and offsets are unchanged.
  double chaseOffsetAt(double t) {
    t = clamp(t);
    final seg = segmentAt(t);
    if (seg.plan == null) return cameraAt(t).offsetM;
    final f = ((t - seg.startT) / seg.durationSec).clamp(0.0, 1.0);
    return seg.startOffsetM + (seg.endOffsetM - seg.startOffsetM) * f;
  }

  /// Clamps [t] to the clock range.
  double clamp(double t) => t.isNaN ? 0 : t.clamp(0.0, totalDurationSec).toDouble();

  CameraState cameraAt(double t) {
    t = clamp(t);
    final seg = segmentAt(t);
    final plan = seg.plan;
    if (plan != null) return _interpolate(plan.keyframes, (t - seg.startT) / seg.scale);
    return _followRoute(seg, ((t - seg.startT) / seg.durationSec).clamp(0.0, 1.0));
  }

  /// A camera that rides the route (street video and no-preview sections): centre on the route point, look about 30 m
  /// ahead, fixed pitch and zoom.
  CameraState _followRoute(TimelineSegment seg, double progress) {
    final route = _route!;
    final off = seg.startOffsetM + (seg.endOffsetM - seg.startOffsetM) * progress;
    final here = route.pointAt(off);
    var ahead = route.pointAt(off + 30);
    var from = here;
    if (ahead[0] == here[0] && ahead[1] == here[1]) {
      from = route.pointAt(off - 30);
      ahead = here;
    }
    return CameraState(
      offsetM: off,
      lat: here[0],
      lon: here[1],
      bearingDeg: _bearing(from, ahead),
      pitchDeg: kFollowPitchDeg,
      zoom: kFollowZoom,
    );
  }

  static double _bearing(List<double> a, List<double> b) {
    double rad(double d) => d * math.pi / 180;
    final dLon = rad(b[1] - a[1]);
    final y = math.sin(dLon) * math.cos(rad(b[0]));
    final x = math.cos(rad(a[0])) * math.sin(rad(b[0])) - math.sin(rad(a[0])) * math.cos(rad(b[0])) * math.cos(dLon);
    final deg = math.atan2(y, x) * 180 / math.pi;
    return (deg + 360) % 360;
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
