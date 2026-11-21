import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/flyover/player_controller.dart';
import 'package:route_preview/flyover/timeline.dart';

import 'support/manifest_builder.dart';

FlyoverTimeline _timeline([Map<String, dynamic>? m]) => FlyoverTimeline.fromManifest(PreviewManifest.parse(manifestString(m)));

void main() {
  group('timeline maths', () {
    test('total duration is the sum of the flyover durations', () {
      expect(_timeline().totalDurationSec, 30);
    });

    test('t = 0 is the first keyframe exactly', () {
      final c = _timeline().cameraAt(0);
      expect(c.offsetM, 600);
      expect(c.zoom, 17);
      expect(c.bearingDeg, 90);
    });

    test('starts at the manifest timeline offset, not at the nominal approach start', () {
      final t = _timeline();
      expect(t.startOffsetM, 600);
      expect(t.approachStartM, 700);
      expect(t.cameraAt(0).offsetM, t.startOffsetM, reason: 'played from the manifest offsets');
      expect(t.cameraAt(0).offsetM, lessThan(t.approachStartM));
      // 600 m with a 500 m assumption would be wrong: the timeline is 500 m long here but starts 100 m before the window.
      expect(t.endOffsetM - t.startOffsetM, 500);
    });

    test('keyframe instants return the keyframe values', () {
      final t = _timeline();
      expect(t.cameraAt(5).offsetM, closeTo(700, 1e-9));
      expect(t.cameraAt(10).offsetM, closeTo(800, 1e-9)); // segment boundary belongs to the second segment
      expect(t.cameraAt(20).offsetM, closeTo(950, 1e-9));
    });

    test('linear segments interpolate in time with no extra speed ramps', () {
      final t = _timeline();
      expect(t.cameraAt(15).offsetM, closeTo(875, 1e-9)); // halfway between 800 (t=10) and 950 (t=20)
      expect(t.cameraAt(12.5).offsetM, closeTo(837.5, 1e-9));
      expect(t.cameraAt(25).offsetM, closeTo(1025, 1e-9));
    });

    test('cubic-in-out eases between the pair: midpoint exact, quarter point slower than linear', () {
      final m = manifest(segments: [
        segment(0, 0, 100, [kf(0, 0, easing: 'cubic-in-out'), kf(10, 100), kf(20, 100)]),
      ]);
      final t = _timeline(m);
      expect(t.cameraAt(5).offsetM, closeTo(50, 1e-9));
      expect(t.cameraAt(2.5).offsetM, closeTo(6.25, 1e-9)); // 4 * 0.25^3 * 100
      expect(t.cameraAt(2.5).offsetM, lessThan(25));
      expect(t.cameraAt(7.5).offsetM, closeTo(93.75, 1e-9));
    });

    test('scrubbing out of range clamps to the ends', () {
      final t = _timeline();
      expect(t.clamp(-5), 0);
      expect(t.clamp(1e9), 30);
      expect(t.clamp(double.nan), 0);
      expect(t.cameraAt(-5).offsetM, 600);
      expect(t.cameraAt(99).offsetM, 1100);
    });

    test('a segment holds its last keyframe when its duration outlasts the keyframes', () {
      final m = manifest(segments: [
        segment(0, 0, 100, [kf(0, 0), kf(4, 50), kf(8, 100)], duration: 10),
      ]);
      final t = _timeline(m);
      expect(t.totalDurationSec, 10);
      expect(t.cameraAt(9).offsetM, 100);
    });

    test('bearing takes the shortest arc across north', () {
      expect(FlyoverTimeline.lerpBearing(350, 10, 0.5), closeTo(0, 1e-9));
      expect(FlyoverTimeline.lerpBearing(350, 10, 0.25), closeTo(355, 1e-9));
      expect(FlyoverTimeline.lerpBearing(10, 350, 0.5), closeTo(0, 1e-9));
      expect(FlyoverTimeline.lerpBearing(90, 100, 0.5), closeTo(95, 1e-9));
      for (var p = 0.0; p <= 1.0; p += 0.1) {
        final b = FlyoverTimeline.lerpBearing(350, 10, p);
        expect(b, inInclusiveRange(0, 360));
      }
    });

    test('a manifest with a clip segment is refused (street video is Phase 5B-2)', () {
      final m = manifest(segments: [
        segment(0, 0, 100, [kf(0, 0), kf(5, 50), kf(10, 100)], playback: 'clip', mode: 'STREET_VIDEO'),
      ]);
      expect(() => _timeline(m), throwsStateError);
    });
  });

  group('player controller', () {
    late FlyoverPlayerController p;
    setUp(() => p = FlyoverPlayerController(_timeline()));

    test('starts paused at 0', () {
      expect(p.playing, isFalse);
      expect(p.positionSec, 0);
      expect(p.camera.offsetM, 600);
    });

    test('advance does nothing while paused', () {
      p.advance(5);
      expect(p.positionSec, 0);
    });

    test('play then advance moves the clock; pause freezes it', () {
      p.play();
      p.advance(4);
      expect(p.positionSec, 4);
      p.pause();
      p.advance(4);
      expect(p.positionSec, 4);
      expect(p.playing, isFalse);
    });

    test('scrub jumps to a position, keeps play state, and clamps', () {
      p.seek(12);
      expect(p.positionSec, 12);
      expect(p.playing, isFalse);
      p.play();
      p.seek(-3);
      expect(p.positionSec, 0);
      expect(p.playing, isTrue);
      p.seek(999);
      expect(p.positionSec, 30);
    });

    test('reaching the end stops playback and clamps', () {
      p.play();
      p.advance(100);
      expect(p.positionSec, 30);
      expect(p.atEnd, isTrue);
      expect(p.playing, isFalse);
      expect(p.camera.offsetM, 1100);
    });

    test('play from the end restarts at 0', () {
      p.seek(30);
      p.play();
      expect(p.positionSec, 0);
      expect(p.playing, isTrue);
    });

    test('ignores non-positive time steps', () {
      p.play();
      p.advance(0);
      p.advance(-1);
      expect(p.positionSec, 0);
    });

    test('notifies listeners on changes only', () {
      var n = 0;
      p.addListener(() => n++);
      p.play(); // 1
      p.play(); // no change
      p.advance(1); // 2
      p.seek(1); // no change (already 1)
      p.seek(2); // 3
      p.pause(); // 4
      p.pause(); // no change
      expect(n, 4);
    });
  });
}
