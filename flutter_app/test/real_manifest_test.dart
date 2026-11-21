import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema/json_schema.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/flyover/timeline.dart';

/// The real Accra route: one manifest fetched from the preview API for
/// origin 5.6037,-0.1870 to destination 5.5600,-0.2057, costing motor_scooter. It holds only OSM-derived routing and
/// camera keyframes: no imagery, nothing derived from Mapillary.
const _path = 'assets/fixtures/accra-real-manifest.json';

void main() {
  final text = File(_path).readAsStringSync();
  final json = jsonDecode(text) as Map<String, dynamic>;

  test('validates against the manifest JSON Schema in the repo', () {
    final schema = JsonSchema.create(jsonDecode(File('../docs/api/preview-manifest.schema.json').readAsStringSync()) as Map<String, dynamic>);
    final result = schema.validate(json);
    expect(result.isValid, isTrue, reason: result.errors.join('\n'));
  });

  test('is the requested route: Accra, motor_scooter, one BIRDS_EYE_3D flyover segment', () {
    expect(json['costing'], 'motor_scooter');
    expect(json['origin'], {'lat': 5.6037, 'lon': -0.187});
    expect(json['destination'], {'lat': 5.56, 'lon': -0.2057});
    final segs = json['segments'] as List;
    expect(segs, hasLength(1));
    final s = segs.single as Map<String, dynamic>;
    expect(s['mode'], 'BIRDS_EYE_3D');
    expect(s['playback'], 'flyover');
    expect(s['clip'], isNull);
    expect(s['clipRef'], isNull);
    expect((s['flyover']['keyframes'] as List).length, greaterThanOrEqualTo(3));
  });

  test('carries nothing from Mapillary or any street imagery', () {
    expect((json['sourcesExcluded'] as List), isEmpty);
    final attr = json['attribution'] as Map<String, dynamic>;
    expect(attr['sources'], isEmpty);
    expect(attr['creators'], isEmpty);
    expect(attr['requiresLogoAndLink'], isFalse);
    expect(json['captureYears'], isNull);
    final lower = text.toLowerCase();
    for (final word in ['mapillary', 'servepath', '/clips/', 'token', 'secret', 'apikey', 'api_key', 'password']) {
      expect(lower, isNot(contains(word)), reason: word);
    }
  });

  test('parses, and plays from the manifest offsets at about 10 m/s', () {
    final m = PreviewManifest.parse(text);
    final t = FlyoverTimeline.fromManifest(m);
    final lengthM = m.timelineEndM - m.timelineStartM;
    expect(lengthM, closeTo(500, 1e-6));
    expect(t.totalDurationSec, closeTo(lengthM / 10, 0.05));
    expect(t.cameraAt(0).offsetM, closeTo(m.timelineStartM, 1e-6));
    expect(t.cameraAt(t.totalDurationSec).offsetM, closeTo(m.timelineEndM, 1e-6));
    // The existing rule: the timeline may start before the approach window; here it does not need to, and must not start after it.
    expect(m.timelineStartM, lessThanOrEqualTo(m.approachStartM));
    expect(m.routeLengthM, closeTo((json['route']['lengthM'] as num).toDouble(), 1e-9));
    expect(m.destination, [5.56, -0.2057]);
  });
}
