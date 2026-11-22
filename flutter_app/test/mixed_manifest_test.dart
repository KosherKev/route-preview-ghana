import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema/json_schema.dart';

import 'support/mixed.dart';

/// The hand-authored mixed manifest (generated from the real Accra route by tool/make_mixed_fixture.py) must be a valid 5A
/// manifest, so it is a fair stand-in for what the API sends, and it must stay synthetic.
void main() {
  final text = File('assets/fixtures/mixed-manifest.json').readAsStringSync();
  final json = jsonDecode(text) as Map<String, dynamic>;

  test('validates against the manifest JSON Schema in the repo', () {
    final schema = JsonSchema.create(jsonDecode(File('../docs/api/preview-manifest.schema.json').readAsStringSync()) as Map<String, dynamic>);
    final result = schema.validate(json);
    expect(result.isValid, isTrue, reason: result.errors.join('\n'));
  });

  test('has the segment cases the current schema allows (a flyover on every segment)', () {
    final segs = (json['segments'] as List).cast<Map<String, dynamic>>();
    expect([for (final s in segs) '${s['mode']}/${s['playback']}/${s['status']}/${s['flyover'] == null ? 'noflyover' : 'flyover'}'], [
      'STREET_VIDEO/clip/ready/flyover',
      'BIRDS_EYE_3D/flyover/null/flyover',
      'STREET_VIDEO/flyover/not_rendered/flyover',
      'STREET_VIDEO/clip/ready/flyover',
    ]);
  });

  test('segments are contiguous and cover the timeline', () {
    final segs = (json['segments'] as List).cast<Map<String, dynamic>>();
    for (var i = 1; i < segs.length; i++) {
      expect(segs[i]['startM'], segs[i - 1]['endM']);
    }
    expect(segs.first['startM'], (json['timeline'] as Map)['startM']);
    expect((segs.last['endM'] as num).toDouble(), closeTo(((json['timeline'] as Map)['endM'] as num).toDouble(), 0.01));
    expect(((json['timeline'] as Map)['startM'] as num), lessThan(((json['approach'] as Map)['startM'] as num)), reason: 'the start offset before the approach window is exercised');
  });

  test('is synthetic: nothing from Mapillary, no real imagery sources, no URLs, no tokens', () {
    final lower = text.toLowerCase();
    for (final w in ['mapillary', 'http://', 'https://', 'token', 'secret', 'password']) {
      expect(lower, isNot(contains(w)), reason: w);
    }
    expect((json['attribution'] as Map)['sources'], ['synthetic-test']);
    expect(json['sourcesExcluded'], isEmpty);
    expect((json['warnings'] as List).single, contains('SYNTHETIC'));
  });

  test('parses with the app parser', () {
    expect(mixedManifest().overlays.turns, isNotEmpty);
  });
}
