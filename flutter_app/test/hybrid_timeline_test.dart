import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/flyover/player_controller.dart';
import 'package:route_preview/flyover/timeline.dart';

import 'support/mixed.dart';

FlyoverTimeline _tl({Set<String> clips = const {kClipA}, PreviewManifest? m}) =>
    FlyoverTimeline.fromManifest(m ?? mixedManifest(), availableClips: clips);

/// What an OLD server may still send: the two ready-clip segments with `flyover: null`. The current schema forbids it
/// (docs/api/preview-manifest.schema.json requires a flyover on every segment), so the fixture no longer has it and the
/// parser and timeline are fed this edit directly.
void _oldServerNoFlyover(Map<String, dynamic> j) {
  for (final i in [0, 3]) {
    ((j['segments'] as List)[i] as Map<String, dynamic>)['flyover'] = null;
  }
}

void main() {
  group('the segment cases of the current schema (a flyover on every segment)', () {
    test('clip present, clip missing with flyover (not_rendered and ready-but-absent), plain flyover', () {
      final t = _tl(); // only clip A is on the device
      expect([for (final s in t.segments) s.source], [
        SegmentSource.streetVideo, // 0: clip 900001 is local
        SegmentSource.flyover, // 1: BIRDS_EYE_3D
        SegmentSource.flyoverFallback, // 2: STREET_VIDEO not_rendered, has keyframes
        SegmentSource.flyoverFallback, // 3: clip 900002 is not local, the ready clip carries keyframes
      ]);
      expect(t.segments[0].clipKey, kClipA);
      expect(t.segments[3].clipKey, isNull);
    });

    test('no clips at all: the street sections fall back to their flyover, the flyover section is unchanged', () {
      final t = _tl(clips: const {});
      expect([for (final s in t.segments) s.source], [SegmentSource.flyoverFallback, SegmentSource.flyover, SegmentSource.flyoverFallback, SegmentSource.flyoverFallback]);
    });

    test('both clips present: both play as street video', () {
      final t = _tl(clips: const {kClipA, kClipB});
      expect([for (final s in t.segments) s.source], [SegmentSource.streetVideo, SegmentSource.flyover, SegmentSource.flyoverFallback, SegmentSource.streetVideo]);
    });

    test('a ready clip that also carries flyover keyframes (the tailnet follow-up) falls back to them when the clip is missing', () {
      final m = mixedManifest((j) {
        final seg = (j['segments'] as List)[0] as Map<String, dynamic>;
        seg['flyover'] = (((j['segments'] as List)[1] as Map<String, dynamic>)['flyover']);
      });
      expect(_tl(m: m, clips: const {}).segments[0].source, SegmentSource.flyoverFallback);
      expect(_tl(m: m, clips: const {kClipA}).segments[0].source, SegmentSource.streetVideo, reason: 'a local clip still wins');
    });

    test('an unknown clip key on the device never counts (only the manifest\'s own keys)', () {
      expect(_tl(clips: const {'900009/forward.mp4'}).segments[0].source, SegmentSource.flyoverFallback);
    });
  });

  group('NEGATIVE: an old server sends a ready clip segment with flyover null', () {
    PreviewManifest old() => mixedManifest(_oldServerNoFlyover);

    test('the parser still accepts it (the app handles both cases)', () {
      final segs = old().segments;
      expect([segs[0].flyover, segs[3].flyover], [null, null]);
      expect(segs[1].flyover, isNotNull);
    });

    test('clip present plays; clip missing without flyover is a clear no-preview section, never a crash', () {
      final t = _tl(m: old());
      expect([for (final s in t.segments) s.source], [SegmentSource.streetVideo, SegmentSource.flyover, SegmentSource.flyoverFallback, SegmentSource.noPreview]);
      expect(_tl(m: old(), clips: const {}).segments[0].source, SegmentSource.noPreview);
    });

    test('the current fixture really has no flyover-less segment (so this group is the only place that case lives)', () {
      for (final s in mixedManifest().segments) {
        expect(s.flyover, isNotNull, reason: 'segment ${s.index}');
      }
    });
  });

  group('timeline maths across segment boundaries', () {
    test('segments are contiguous and their durations add up', () {
      final t = _tl();
      var at = 0.0;
      for (final s in t.segments) {
        expect(s.startT, closeTo(at, 1e-9));
        at += s.durationSec;
      }
      expect(t.totalDurationSec, closeTo(at, 1e-9));
    });

    test('durations: clip = its own length, flyover = metres / 14 m/s, no preview = segment length / 14 m/s', () {
      final t = _tl();
      expect(t.segments[0].durationSec, 8.0); // clip 900001
      expect(t.segments[1].durationSec, closeTo(300 / 14, 0.05)); // 300 m
      expect(t.segments[2].durationSec, closeTo(150 / 14, 0.05)); // 150 m
      expect(t.segments[3].durationSec, closeTo((5727.4711 - 5550) / 14, 0.01)); // no preview, 177.47 m
    });

    test('a segment with no clip and no flyover continues the timeline at its length / pace', () {
      final withClip = _tl(clips: const {kClipA, kClipB});
      final without = _tl();
      expect(withClip.segments[3].durationSec, 9.0, reason: 'clip B is 9 s');
      expect(without.segments[3].durationSec, closeTo(177.4711 / 14, 0.01));
    });

    test('segmentAt: a boundary instant belongs to the next segment, the end to the last, below zero to the first', () {
      final t = _tl();
      expect(t.segmentAt(0).index, 0);
      expect(t.segmentAt(t.segments[1].startT).index, 1);
      expect(t.segmentAt(t.segments[1].startT - 1e-6).index, 0);
      expect(t.segmentAt(t.totalDurationSec).index, 3);
      expect(t.segmentAt(-5).index, 0);
      expect(t.segmentAt(1e9).index, 3);
    });

    test('localSec is the time inside the current segment', () {
      final t = _tl();
      expect(t.localSec(3.5), 3.5);
      expect(t.localSec(t.segments[1].startT + 4), closeTo(4, 1e-9));
    });

    test('the route offset advances monotonically across every boundary, from the manifest start to its end', () {
      final t = _tl();
      var prev = -1.0;
      for (var s = 0.0; s <= t.totalDurationSec; s += 0.25) {
        final o = t.offsetAt(s);
        expect(o, greaterThanOrEqualTo(prev - 1e-6), reason: 't=$s');
        prev = o;
      }
      expect(t.offsetAt(0), closeTo(4800, 1e-6));
      expect(t.offsetAt(t.totalDurationSec), closeTo(5727.47, 0.01));
    });

    test('start offset before the approach window is kept (4800 m start, 5227 m approach)', () {
      final t = _tl();
      expect(t.startOffsetM, 4800);
      expect(t.approachStartM, closeTo(5227.47, 0.01));
      expect(t.offsetAt(0), lessThan(t.approachStartM));
    });

    test('street-video and no-preview cameras ride the route at a fixed pitch and zoom', () {
      final t = _tl(m: mixedManifest(_oldServerNoFlyover)); // segment 3 is a no-preview section only without keyframes
      for (final i in [0, 3]) {
        final s = t.segments[i];
        final c = t.cameraAt(s.startT + s.durationSec / 2);
        expect(c.pitchDeg, kFollowPitchDeg);
        expect(c.zoom, kFollowZoom);
        expect(c.bearingDeg, inInclusiveRange(0, 360));
        expect(c.offsetM, closeTo((s.startOffsetM + s.endOffsetM) / 2, 0.01));
      }
    });

    test('a manifest without route geometry cannot give a camera to a street section', () {
      final m = mixedManifest((j) => (j['route'] as Map<String, dynamic>)['polyline6'] = '');
      expect(() => _tl(m: m), throwsStateError);
    });
  });

  group('player controller on the hybrid timeline', () {
    late FlyoverPlayerController p;
    setUp(() => p = FlyoverPlayerController(_tl()));

    test('scrubbing to any boundary lands in the right segment and keeps play state', () {
      for (final s in p.timeline.segments) {
        p.seek(s.startT);
        expect(p.timeline.segmentAt(p.positionSec).index, s.index);
        expect(p.playing, isFalse);
      }
      p.seek(1e9);
      expect(p.positionSec, p.durationSec);
    });

    test('playing runs through every boundary to the end and stops there', () {
      p.play();
      final seen = <int>{};
      var guard = 0;
      while (p.playing && guard++ < 100000) {
        p.advance(0.1);
        seen.add(p.timeline.segmentAt(p.positionSec).index);
      }
      expect(seen, {0, 1, 2, 3});
      expect(p.atEnd, isTrue);
      expect(p.playing, isFalse);
    });

    test('the speed multiplier moves the clock across a boundary twice as fast', () {
      p.setSpeed(2);
      p.play();
      p.advance(4.5); // 9 s of clock: past the 8 s clip into the flyover
      expect(p.timeline.segmentAt(p.positionSec).index, 1);
    });
  });

  group('parsing the clip and flyover combinations', () {
    test('playback clip requires a clip; playback flyover forbids one', () {
      expect(() => mixedManifest((j) => ((j['segments'] as List)[0] as Map<String, dynamic>)['clip'] = null), throwsA(isA<ManifestFormatException>()));
      expect(() => mixedManifest((j) {
            final s = (j['segments'] as List)[1] as Map<String, dynamic>;
            s['clip'] = ((j['segments'] as List)[0] as Map<String, dynamic>)['clip'];
          }), throwsA(isA<ManifestFormatException>()));
    });

    test('a clip key that could escape the clips folder is rejected', () {
      for (final bad in ['../x/forward.mp4', '/abs/forward.mp4', '12/../forward.mp4', '12/forward.mp4/x', 'a/forward.mp4', '12/Forward.mp4']) {
        expect(
            () => mixedManifest((j) {
                  final c = ((j['segments'] as List)[0] as Map<String, dynamic>)['clip'] as Map<String, dynamic>;
                  c['key'] = bad;
                }),
            throwsA(isA<ManifestFormatException>()),
            reason: bad);
      }
    });

    test('parses the mixed manifest: clips, overlays, attribution and the prototype flag', () {
      final m = mixedManifest();
      expect(m.prototype, isTrue);
      expect(m.segments[0].clip!.key, kClipA);
      expect(m.segments[0].clip!.durationSec, 8.0);
      expect(m.segments[2].status, 'not_rendered');
      expect(m.overlays.turns.length, 3);
      expect(m.overlays.landmarks.length, 4);
      expect(m.attribution.sources, ['synthetic-test']);
      expect(m.sourcesExcluded, isEmpty);
    });
  });
}
