import 'dart:convert';

/// Builds a small, schema-shaped manifest for unit tests. Every value is invented.
Map<String, dynamic> kf(double t, double offsetM,
        {double lat = 5.59,
        double lon = -0.2,
        double bearing = 90,
        double pitch = 60,
        double zoom = 17,
        String easing = 'linear'}) =>
    {
      't': t,
      'offsetM': offsetM,
      'lat': lat,
      'lon': lon,
      'bearingDeg': bearing,
      'pitchDeg': pitch,
      'zoom': zoom,
      'easing': easing,
    };

Map<String, dynamic> segment(int index, double startM, double endM, List<Map<String, dynamic>> keyframes,
        {double? duration, String playback = 'flyover', String mode = 'BIRDS_EYE_3D'}) =>
    {
      'index': index,
      'mode': mode,
      'startM': startM,
      'endM': endM,
      'lengthM': endM - startM,
      'polyline6': '',
      'playback': playback,
      'playbackReason': 'no_frames',
      'nominalDurationSec': duration ?? keyframes.last['t'],
      'nominalSpeedMps': 30,
      'status': null,
      'clipRef': null,
      'clip': null,
      'bridges': <dynamic>[],
      'captureYears': null,
      'flyover': playback == 'flyover'
          ? {'durationSec': duration ?? keyframes.last['t'], 'nominalSpeedMps': 30, 'keyframes': keyframes}
          : null,
    };

/// Two flyover segments: 10 s (offsets 600..800) then 20 s (800..1100). The timeline starts at 600, before the
/// approach window (which starts at 700): the 5A "a clip is never cut" case.
Map<String, dynamic> manifest({List<Map<String, dynamic>>? segments}) => {
      'manifestVersion': 1,
      'prototype': true,
      'degraded': false,
      'costing': 'motor_scooter',
      'unpavedFallback': false,
      'warnings': <String>[],
      'origin': {'lat': 5.59, 'lon': -0.2},
      'destination': {'lat': 5.6, 'lon': -0.19},
      'route': {'lengthM': 1100, 'timeSec': 180, 'polyline6': ''},
      'approach': {'requestedLengthM': 400, 'lengthM': 400, 'startM': 700, 'endM': 1100, 'wholeRoute': false},
      'timeline': {'startM': 600, 'endM': 1100, 'lengthM': 500},
      'nominal': {'streetSpeedMps': 6, 'flyoverSpeedMps': 30, 'note': 'test'},
      'segments': segments ??
          [
            segment(0, 600, 800, [kf(0, 600), kf(5, 700, easing: 'cubic-in-out'), kf(10, 800)]),
            segment(1, 800, 1100, [kf(0, 800), kf(10, 950), kf(20, 1100)]),
          ],
      'overlays': {
        'turns': <dynamic>[],
        'landmarks': <dynamic>[],
        'turnWindowM': 80,
        'landmarkOptions': {'maxDistanceM': 40, 'maxPer100m': 3, 'dedupeWithinM': 100}
      },
      'captureYears': null,
      'attribution': {
        'bySource': <dynamic>[],
        'sources': <String>[],
        'creators': <String>[],
        'licenses': <String>[],
        'sourceUrls': <String>[],
        'requiresLogoAndLink': false
      },
      'sourcesExcluded': <String>[],
    };

String manifestString([Map<String, dynamic>? m]) => jsonEncode(m ?? manifest());
