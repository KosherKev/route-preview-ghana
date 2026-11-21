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

/// Clip keys look like `671625527824/forward.mp4` (schema: `^[0-9]{1,15}/[a-z]+\.mp4$`). The pattern also makes a key
/// safe to use as a path below `Documents/clips/`: it cannot contain `..`, a leading slash or a second separator.
final RegExp kClipKeyPattern = RegExp(r'^[0-9]{1,15}/[a-z]+\.mp4$');

/// A street-video clip the manifest says is ready on the server. The app plays it only from a file already on the
/// device (`Documents/clips/<key>`); it is never fetched. Only fields of the 5A schema are read ([sha256] is optional and
/// not in the schema today; a later schema may add it, and then the push script and the player check it).
class ClipInfo {
  final String key;
  final double durationSec;
  final int bytes;
  final double lengthM;
  final String? sha256;
  const ClipInfo({required this.key, required this.durationSec, required this.bytes, required this.lengthM, this.sha256});
}

/// A turn marker: static data keyed by distance along the route (never a GPS fix).
class TurnOverlay {
  final double offsetM;
  final String maneuver;
  final String direction; // left | right | straight | uturn
  final String kind; // turn | roundabout | merge | ramp_or_fork | other
  final String? streetName;
  final double windowStartM;
  final double windowEndM;
  const TurnOverlay({
    required this.offsetM,
    required this.maneuver,
    required this.direction,
    required this.kind,
    required this.streetName,
    required this.windowStartM,
    required this.windowEndM,
  });
}

class LandmarkOverlay {
  final double offsetM;
  final String name;
  final String category;
  final String? kind;
  final String side; // left | right
  final double distanceM;
  const LandmarkOverlay({
    required this.offsetM,
    required this.name,
    required this.category,
    required this.kind,
    required this.side,
    required this.distanceM,
  });
}

class Overlays {
  final List<TurnOverlay> turns;
  final List<LandmarkOverlay> landmarks;
  const Overlays({this.turns = const [], this.landmarks = const []});
}

/// Imagery attribution and sources, as the manifest reports them.
class ManifestAttribution {
  final List<String> sources;
  final List<String> creators;
  final List<String> licenses;
  final List<String> sourceUrls;
  final bool requiresLogoAndLink;
  const ManifestAttribution({
    this.sources = const [],
    this.creators = const [],
    this.licenses = const [],
    this.sourceUrls = const [],
    this.requiresLogoAndLink = false,
  });
}

class Segment {
  final int index;
  final String mode;
  final double startM;
  final double endM;
  final String playback; // 'clip' | 'flyover'
  final FlyoverPlan? flyover;

  /// 'ready' | 'not_rendered' | null (a BIRDS_EYE_3D segment).
  final String? status;

  /// Set when the server has a ready clip for this segment (`playback` is then 'clip'). The flyover plan may be null
  /// (today's API) or present (after the tailnet follow-up): the player handles both.
  final ClipInfo? clip;
  const Segment({
    required this.index,
    required this.mode,
    required this.startM,
    required this.endM,
    required this.playback,
    required this.flyover,
    this.status,
    this.clip,
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

  /// The whole route: its length in metres and its polyline6 (offsets everywhere in the manifest are metres along it).
  final double routeLengthM;
  final String routePolyline6;

  /// Destination as [lat, lon]; null only for hand-built manifests in tests.
  final List<double>? destination;

  /// Always true today (D1: the imagery is prototype-only); the UI shows a badge whenever it is.
  final bool prototype;
  final Overlays overlays;
  final ManifestAttribution attribution;

  /// Sources removed by the imagery kill switch on the server.
  final List<String> sourcesExcluded;

  const PreviewManifest({
    required this.timelineStartM,
    required this.timelineEndM,
    required this.approachStartM,
    required this.approachEndM,
    required this.segments,
    this.routeLengthM = 0,
    this.routePolyline6 = '',
    this.destination,
    this.prototype = true,
    this.overlays = const Overlays(),
    this.attribution = const ManifestAttribution(),
    this.sourcesExcluded = const [],
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
    final route = _obj(root['route'], 'route');
    _noUnknown(route, const {'lengthM', 'timeSec', 'polyline6'}, 'route');
    final polyline = route['polyline6'];
    if (polyline is! String) {
      throw const ManifestFormatException('route.polyline6 must be a string');
    }
    final dest = _obj(root['destination'], 'destination');
    _noUnknown(dest, const {'lat', 'lon'}, 'destination');
    final overlays = _overlays(root['overlays']);
    final attribution = _attribution(root['attribution']);
    final excluded = _strings(root['sourcesExcluded'], 'sourcesExcluded');
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
      routeLengthM: _num(route['lengthM'], 'route.lengthM', min: 0),
      routePolyline6: polyline,
      destination: [
        _num(dest['lat'], 'destination.lat', min: -90, max: 90),
        _num(dest['lon'], 'destination.lon', min: -180, max: 180),
      ],
      prototype: root['prototype'] == true,
      overlays: overlays,
      attribution: attribution,
      sourcesExcluded: excluded,
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
    final status = s['status'];
    if (status != null && status != 'ready' && status != 'not_rendered') {
      throw ManifestFormatException('$where.status must be ready, not_rendered or null');
    }
    final clip = s['clip'] == null ? null : _clip(s['clip'], '$where.clip');
    if (playback == 'flyover' && fly == null) {
      throw ManifestFormatException('$where plays a flyover but has no flyover plan');
    }
    if (playback == 'clip' && clip == null) {
      throw ManifestFormatException('$where plays a clip but has no clip');
    }
    if (playback == 'flyover' && clip != null) {
      throw ManifestFormatException('$where plays a flyover but carries a clip');
    }
    return Segment(
      index: _num(s['index'], '$where.index', min: 0).toInt(),
      mode: mode as String,
      startM: _num(s['startM'], '$where.startM', min: 0),
      endM: _num(s['endM'], '$where.endM', min: 0),
      playback: playback as String,
      flyover: fly,
      status: status as String?,
      clip: clip,
    );
  }

  static const _clipKeys = {
    'edge_id', 'direction', 'key', 'status', 'durationSec', 'fps', 'speedMps', 'bytes', 'lengthM', 'servePath',
    'startPose', 'endPose', 'sha256',
  };

  static ClipInfo _clip(Object? raw, String where) {
    final c = _obj(raw, where);
    _noUnknown(c, _clipKeys, where);
    final key = c['key'];
    if (key is! String || !kClipKeyPattern.hasMatch(key)) {
      throw ManifestFormatException('$where.key is not a valid clip key');
    }
    if (c['status'] != 'ready') throw ManifestFormatException('$where.status must be ready');
    final sha = c['sha256'];
    if (sha != null && (sha is! String || !RegExp(r'^[0-9a-f]{64}$').hasMatch(sha))) {
      throw ManifestFormatException('$where.sha256 must be 64 lowercase hex characters');
    }
    return ClipInfo(
      key: key,
      durationSec: _num(c['durationSec'], '$where.durationSec', min: 0),
      bytes: _num(c['bytes'], '$where.bytes', min: 0).toInt(),
      lengthM: _num(c['lengthM'], '$where.lengthM', min: 0),
      sha256: sha as String?,
    );
  }

  static List<String> _strings(Object? v, String where) {
    if (v is! List) throw ManifestFormatException('$where must be an array');
    return [
      for (final e in v)
        e is String ? e : throw ManifestFormatException('$where must contain only strings'),
    ];
  }

  static ManifestAttribution _attribution(Object? raw) {
    final a = _obj(raw, 'attribution');
    _noUnknown(a, const {'bySource', 'sources', 'creators', 'licenses', 'sourceUrls', 'requiresLogoAndLink'}, 'attribution');
    return ManifestAttribution(
      sources: _strings(a['sources'], 'attribution.sources'),
      creators: _strings(a['creators'], 'attribution.creators'),
      licenses: _strings(a['licenses'], 'attribution.licenses'),
      sourceUrls: _strings(a['sourceUrls'], 'attribution.sourceUrls'),
      requiresLogoAndLink: a['requiresLogoAndLink'] == true,
    );
  }

  static Overlays _overlays(Object? raw) {
    final o = _obj(raw, 'overlays');
    _noUnknown(o, const {'turns', 'landmarks', 'turnWindowM', 'landmarkOptions'}, 'overlays');
    final turns = o['turns'], landmarks = o['landmarks'];
    if (turns is! List || landmarks is! List) {
      throw const ManifestFormatException('overlays.turns and overlays.landmarks must be arrays');
    }
    return Overlays(
      turns: [
        for (var i = 0; i < turns.length; i++)
          () {
            final w = 'overlays.turns[$i]';
            final t = _obj(turns[i], w);
            _noUnknown(t, const {'offsetM', 'maneuver', 'direction', 'kind', 'streetName', 'window'}, w);
            final win = _obj(t['window'], '$w.window');
            _noUnknown(win, const {'startM', 'endM'}, '$w.window');
            final dir = t['direction'];
            if (dir is! String || !const {'left', 'right', 'straight', 'uturn'}.contains(dir)) {
              throw ManifestFormatException('$w.direction is not a known direction');
            }
            if (t['maneuver'] is! String || t['kind'] is! String) {
              throw ManifestFormatException('$w.maneuver and $w.kind must be strings');
            }
            final street = t['streetName'];
            if (street != null && street is! String) throw ManifestFormatException('$w.streetName must be a string or null');
            return TurnOverlay(
              offsetM: _num(t['offsetM'], '$w.offsetM', min: 0),
              maneuver: t['maneuver'] as String,
              direction: dir,
              kind: t['kind'] as String,
              streetName: street as String?,
              windowStartM: _num(win['startM'], '$w.window.startM', min: 0),
              windowEndM: _num(win['endM'], '$w.window.endM', min: 0),
            );
          }(),
      ],
      landmarks: [
        for (var i = 0; i < landmarks.length; i++)
          () {
            final w = 'overlays.landmarks[$i]';
            final l = _obj(landmarks[i], w);
            _noUnknown(l, const {'offsetM', 'name', 'category', 'kind', 'side', 'distanceM', 'lat', 'lon', 'osm'}, w);
            final name = l['name'], side = l['side'];
            if (name is! String || name.isEmpty) throw ManifestFormatException('$w.name must be a non-empty string');
            if (side != 'left' && side != 'right') throw ManifestFormatException('$w.side must be left or right');
            if (l['category'] is! String) throw ManifestFormatException('$w.category must be a string');
            final kind = l['kind'];
            if (kind != null && kind is! String) throw ManifestFormatException('$w.kind must be a string or null');
            return LandmarkOverlay(
              offsetM: _num(l['offsetM'], '$w.offsetM', min: 0),
              name: name,
              category: l['category'] as String,
              kind: kind as String?,
              side: side as String,
              distanceM: _num(l['distanceM'], '$w.distanceM', min: 0),
            );
          }(),
      ],
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
