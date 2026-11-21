import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema/json_schema.dart';
import 'package:route_preview/flyover/manifest.dart';

import 'support/manifest_builder.dart';

String _fixture(String name) => File('assets/fixtures/$name').readAsStringSync();

JsonSchema _schema() => JsonSchema.create(
    jsonDecode(File('../docs/api/preview-manifest.schema.json').readAsStringSync()) as Map<String, dynamic>);

void main() {
  group('keyframe parser', () {
    test('parses the committed fixture manifest', () {
      final m = PreviewManifest.parse(_fixture('manifest.json'));
      expect(m.segments, hasLength(2));
      expect(m.segments.first.flyover!.keyframes.length, greaterThanOrEqualTo(3));
      expect(m.timelineStartM, lessThan(m.approachStartM), reason: 'fixture exercises the pre-approach start');
    });

    test('parses every field of a keyframe', () {
      final m = PreviewManifest.parse(manifestString());
      final k = m.segments[0].flyover!.keyframes[1];
      expect(k.t, 5);
      expect(k.offsetM, 700);
      expect(k.easing, Easing.cubicInOut);
      expect(k.zoom, 17);
      expect(k.pitchDeg, 60);
      expect(k.bearingDeg, 90);
    });

    ManifestFormatException failure(Map<String, dynamic> m) {
      try {
        PreviewManifest.parse(manifestString(m));
      } on ManifestFormatException catch (e) {
        return e;
      }
      fail('expected ManifestFormatException');
    }

    Map<String, dynamic> withKeyframes(List<Map<String, dynamic>> k) =>
        manifest(segments: [segment(0, 600, 800, k)]);

    test('rejects text that is not JSON', () {
      expect(() => PreviewManifest.parse('{nope'), throwsA(isA<ManifestFormatException>()));
    });

    test('rejects manifestVersion other than 1 and prototype false', () {
      expect(failure(manifest()..['manifestVersion'] = 2).message, contains('manifestVersion'));
      expect(failure(manifest()..['prototype'] = false).message, contains('prototype'));
    });

    test('rejects unknown fields like the schema (additionalProperties false)', () {
      expect(failure(manifest()..['current_position'] = {'lat': 1, 'lon': 2}).message, contains('current_position'));
      final k = kf(0, 600)..['speed'] = 3;
      expect(failure(withKeyframes([k, kf(5, 700), kf(10, 800)])).message, contains('speed'));
    });

    test('rejects out-of-range keyframe values', () {
      expect(failure(withKeyframes([kf(0, 600, bearing: 360), kf(5, 700), kf(10, 800)])).message, contains('bearingDeg'));
      expect(failure(withKeyframes([kf(0, 600, pitch: 81), kf(5, 700), kf(10, 800)])).message, contains('pitchDeg'));
      expect(failure(withKeyframes([kf(0, 600, zoom: 11.9), kf(5, 700), kf(10, 800)])).message, contains('zoom'));
      expect(failure(withKeyframes([kf(0, 600, easing: 'bounce'), kf(5, 700), kf(10, 800)])).message, contains('easing'));
    });

    test('rejects non-increasing t, decreasing offsetM and fewer than 3 keyframes', () {
      expect(failure(withKeyframes([kf(0, 600), kf(5, 700), kf(5, 800)])).message, contains('strictly increase'));
      expect(failure(withKeyframes([kf(0, 600), kf(5, 700), kf(10, 650)])).message, contains('offsetM'));
      expect(failure(withKeyframes([kf(0, 600), kf(5, 700)])).message, contains('at least 3'));
    });

    test('rejects a flyover segment without a flyover plan', () {
      final m = manifest(segments: [segment(0, 600, 800, [kf(0, 600), kf(5, 700), kf(10, 800)])]);
      (m['segments'] as List).first['flyover'] = null;
      expect(failure(m).message, contains('no flyover plan'));
    });
  });

  group('JSON Schema (docs/api/preview-manifest.schema.json)', () {
    test('the fixture manifest is valid', () {
      final result = _schema().validate(jsonDecode(_fixture('manifest.json')));
      expect(result.isValid, isTrue, reason: result.errors.join('\n'));
    });

    test('the unit-test manifest builder produces schema-valid manifests', () {
      final result = _schema().validate(manifest());
      expect(result.isValid, isTrue, reason: result.errors.join('\n'));
    });

    test('the schema rejects what the parser rejects (parser and schema agree)', () {
      final schema = _schema();
      final bad = <Map<String, dynamic>>[
        manifest()..['current_position'] = {'lat': 1, 'lon': 2},
        manifest(segments: [segment(0, 600, 800, [kf(0, 600, bearing: 360), kf(5, 700), kf(10, 800)])]),
        manifest(segments: [segment(0, 600, 800, [kf(0, 600, zoom: 11), kf(5, 700), kf(10, 800)])]),
        manifest(segments: [segment(0, 600, 800, [kf(0, 600), kf(5, 700)])]),
      ];
      for (final m in bad) {
        expect(schema.validate(m).isValid, isFalse);
        expect(() => PreviewManifest.parse(jsonEncode(m)), throwsA(isA<ManifestFormatException>()));
      }
    });
  });
}
