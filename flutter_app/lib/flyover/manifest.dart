import 'dart:convert';

/// Thrown when a manifest is not a valid Phase 5A preview manifest (v1).
class ManifestFormatException implements Exception {
  final String message;
  const ManifestFormatException(this.message);
  @override
  String toString() => 'ManifestFormatException: $message';
}

enum Easing { linear, cubicInOut }

/// One camera keyframe, exactly as defined in docs/api/preview-manifest.md:
/// `t` is seconds into the segment, `offsetM` the route position of the camera centre.
class Keyframe {
  final double t;
  final double offsetM;
  final double lat;
  final double lon;
  final double bearingDeg;
  final double pitchDeg;
  final double zoom;
  final Easing easing;

  const Keyframe({
    required this.t,
    required this.offsetM,
    required this.lat,
    required this.lon,
    required this.bearingDeg,
    required this.pitchDeg,
    required this.zoom,
    required this.easing,
  });
}

class FlyoverPlan {
  final double durationSec;
  final List<Keyframe> keyframes;
  const FlyoverPlan({required this.durationSec, required this.keyframes});
}

class Segment {
  final int index;
  final String mode;
  final double startM;
  final double endM;
  final String playback; // 'clip' | 'flyover'
  final FlyoverPlan? flyover;
  const Segment({
    required this.index,
    required this.mode,
    required this.startM,
    required this.endM,
    required this.playback,
    required this.flyover,
  });
}

/// The slice of the 5A manifest the flyover player needs. Full draft-07 schema validation runs in the tests
/// (against docs/api/preview-manifest.schema.json); this parser enforces the same rules the player depends on and,
/// like the schema, rejects unknown fields (`additionalProperties: false`).
class PreviewManifest {
  final double timelineStartM;
  final double timelineEndM;
  final double approachStartM;
  final double approachEndM;
  final List<Segment> segments;

  const PreviewManifest({
    required this.timelineStartM,
    required this.timelineEndM,
    required this.approachStartM,
    required this.approachEndM,
    required this.segments,
  });

  static const _topKeys = {
    'manifestVersion', 'prototype', 'degraded', 'costing', 'unpavedFallback', 'warnings', 'origin', 'destination',
    'resolved', 'route', 'approach', 'timeline', 'nominal', 'segments', 'overlays', 'captureYears', 'attribution',
    'sourcesExcluded',
  };
  static const _segmentKeys = {
    'index', 'mode', 'startM', 'endM', 'lengthM', 'polyline6', 'playback', 'playbackReason', 'nominalDurationSec',
    'nominalSpeedMps', 'status', 'clipRef', 'clip', 'bridges', 'captureYears', 'flyover',
  };
  static const _keyframeKeys = {'t', 'offsetM', 'lat', 'lon', 'bearingDeg', 'pitchDeg', 'zoom', 'easing'};

  factory PreviewManifest.parse(String source) {
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException catch (e) {
      throw ManifestFormatException('not JSON: ${e.message}');
    }
    final root = _obj(decoded, 'manifest');
    _noUnknown(root, _topKeys, 'manifest');
    if (root['manifestVersion'] != 1) {
      throw const ManifestFormatException('manifestVersion must be 1');
    }
    if (root['prototype'] != true) {
      throw const ManifestFormatException('prototype must be true');
    }
    final timeline = _obj(root['timeline'], 'timeline');
    _noUnknown(timeline, const {'startM', 'endM', 'lengthM'}, 'timeline');
    final approach = _obj(root['approach'], 'approach');
    _noUnknown(approach, const {'requestedLengthM', 'lengthM', 'startM', 'endM', 'wholeRoute'}, 'approach');
    final segs = root['segments'];
    if (segs is! List || segs.isEmpty) {
      throw const ManifestFormatException('segments must be a non-empty array');
    }
    final manifest = PreviewManifest(
      timelineStartM: _num(timeline['startM'], 'timeline.startM', min: 0),
      timelineEndM: _num(timeline['endM'], 'timeline.endM', min: 0),
      approachStartM: _num(approach['startM'], 'approach.startM', min: 0),
      approachEndM: _num(approach['endM'], 'approach.endM', min: 0),
      segments: [for (var i = 0; i < segs.length; i++) _segment(segs[i], i)],
    );
    if (manifest.timelineEndM < manifest.timelineStartM) {
      throw const ManifestFormatException('timeline ends before it starts');
    }
    return manifest;
  }

  static Segment _segment(Object? raw, int i) {
    final where = 'segments[$i]';
    final s = _obj(raw, where);
    _noUnknown(s, _segmentKeys, where);
    final playback = s['playback'];
    if (playback != 'clip' && playback != 'flyover') {
      throw ManifestFormatException('$where.playback must be clip or flyover');
    }
    final mode = s['mode'];
    if (mode != 'STREET_VIDEO' && mode != 'BIRDS_EYE_3D') {
      throw ManifestFormatException('$where.mode must be STREET_VIDEO or BIRDS_EYE_3D');
    }
    final flyRaw = s['flyover'];
    final FlyoverPlan? fly = flyRaw == null ? null : _flyover(flyRaw, '$where.flyover');
    if (playback == 'flyover' && fly == null) {
      throw ManifestFormatException('$where plays a flyover but has no flyover plan');
    }
    return Segment(
      index: _num(s['index'], '$where.index', min: 0).toInt(),
      mode: mode as String,
      startM: _num(s['startM'], '$where.startM', min: 0),
      endM: _num(s['endM'], '$where.endM', min: 0),
      playback: playback as String,
      flyover: fly,
    );
  }

  static FlyoverPlan _flyover(Object? raw, String where) {
    final f = _obj(raw, where);
    _noUnknown(f, const {'durationSec', 'nominalSpeedMps', 'keyframes'}, where);
    final kfs = f['keyframes'];
    if (kfs is! List || kfs.length < 3) {
      throw ManifestFormatException('$where.keyframes needs at least 3 keyframes');
    }
    final parsed = <Keyframe>[];
    for (var i = 0; i < kfs.length; i++) {
      final kw = '$where.keyframes[$i]';
      final k = _obj(kfs[i], kw);
      _noUnknown(k, _keyframeKeys, kw);
      final kf = Keyframe(
        t: _num(k['t'], '$kw.t', min: 0),
        offsetM: _num(k['offsetM'], '$kw.offsetM', min: 0),
        lat: _num(k['lat'], '$kw.lat', min: -90, max: 90),
        lon: _num(k['lon'], '$kw.lon', min: -180, max: 180),
        bearingDeg: _num(k['bearingDeg'], '$kw.bearingDeg', min: 0, maxExclusive: 360),
        pitchDeg: _num(k['pitchDeg'], '$kw.pitchDeg', min: 0, max: 80),
        zoom: _num(k['zoom'], '$kw.zoom', min: 12, max: 19),
        easing: switch (k['easing']) {
          'linear' => Easing.linear,
          'cubic-in-out' => Easing.cubicInOut,
          _ => throw ManifestFormatException('$kw.easing must be linear or cubic-in-out'),
        },
      );
      if (parsed.isNotEmpty) {
        if (kf.t <= parsed.last.t) {
          throw ManifestFormatException('$kw.t must strictly increase');
        }
        if (kf.offsetM < parsed.last.offsetM) {
          throw ManifestFormatException('$kw.offsetM must not decrease');
        }
      }
      parsed.add(kf);
    }
    return FlyoverPlan(
      durationSec: _num(f['durationSec'], '$where.durationSec', exclusiveMin: 0),
      keyframes: List.unmodifiable(parsed),
    );
  }

  static Map<String, Object?> _obj(Object? v, String where) {
    if (v is Map<String, Object?>) return v;
    throw ManifestFormatException('$where must be an object');
  }

  static void _noUnknown(Map<String, Object?> m, Set<String> allowed, String where) {
    for (final k in m.keys) {
      if (!allowed.contains(k)) {
        throw ManifestFormatException('$where has unknown field "$k"');
      }
    }
  }

  static double _num(Object? v, String where,
      {double? min, double? max, double? maxExclusive, double? exclusiveMin}) {
    if (v is! num || !v.isFinite) {
      throw ManifestFormatException('$where must be a finite number');
    }
    final d = v.toDouble();
    if (min != null && d < min) throw ManifestFormatException('$where must be >= $min');
    if (exclusiveMin != null && d <= exclusiveMin) throw ManifestFormatException('$where must be > $exclusiveMin');
    if (max != null && d > max) throw ManifestFormatException('$where must be <= $max');
    if (maxExclusive != null && d >= maxExclusive) throw ManifestFormatException('$where must be < $maxExclusive');
    return d;
  }
}
