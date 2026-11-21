import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/flyover/player_controller.dart';
import 'package:route_preview/flyover/timeline.dart';

import 'support/manifest_builder.dart';

/// The maths tests below assert exact numbers at the manifest's own timing, so they play it unscaled.
/// The 10 m/s default has its own group further down.
FlyoverTimeline _timeline([Map<String, dynamic>? m, double? effectiveSpeedMps]) =>
    FlyoverTimeline.fromManifest(PreviewManifest.parse(manifestString(m)), effectiveSpeedMps: effectiveSpeedMps);

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

  group('effective speed (default 10 m/s)', () {
    FlyoverTimeline scaled([Map<String, dynamic>? m, double? speed = kFlyoverEffectiveSpeedMps]) => _timeline(m, speed);

    test('the default is a named constant of 10 m/s (the street-clip nominal speed)', () {
      expect(kFlyoverEffectiveSpeedMps, 10.0);
      // fromManifest with no argument uses it.
      final byDefault = FlyoverTimeline.fromManifest(PreviewManifest.parse(manifestString()));
      expect(byDefault.totalDurationSec, scaled().totalDurationSec);
    });

    test('segment durations become metres / 10 m/s (200 m -> 20 s, 300 m -> 30 s)', () {
      final t = scaled();
      expect(t.totalDurationSec, closeTo(50, 1e-9));
      expect(t.cameraAt(20).offsetM, closeTo(800, 1e-9)); // the boundary between the two segments
    });

    test('keyframe times scale by one factor per segment', () {
      // Manifest keyframe t=5 (offset 700) is now at 5 * (20 / 10) = 10 s.
      expect(scaled().cameraAt(10).offsetM, closeTo(700, 1e-9));
      expect(scaled().cameraAt(35).offsetM, closeTo(950, 1e-9)); // manifest t=10 of segment 1 -> 20 + 15
    });

    test('the camera advances at 10 m/s along a linear segment', () {
      final t = scaled();
      final a = t.cameraAt(25).offsetM, b = t.cameraAt(45).offsetM;
      expect((b - a) / 20, closeTo(10, 1e-9));
    });

    test('easing is kept as given (cubic-in-out midpoint and quarter point)', () {
      final m = manifest(segments: [
        segment(0, 0, 100, [kf(0, 0, easing: 'cubic-in-out'), kf(10, 100), kf(20, 100)]),
      ]);
      final t = scaled(m); // 100 m / 10 m/s = 10 s; manifest 0..10 now spans 0..5 s
      expect(t.totalDurationSec, closeTo(10, 1e-9));
      expect(t.cameraAt(2.5).offsetM, closeTo(50, 1e-9));
      expect(t.cameraAt(1.25).offsetM, closeTo(6.25, 1e-9));
    });

    test('still starts at the manifest timeline offset, before the approach window', () {
      final t = scaled();
      expect(t.cameraAt(0).offsetM, 600);
      expect(t.cameraAt(0).offsetM, lessThan(t.approachStartM));
    });

    test('scrub clamps to the scaled duration', () {
      final t = scaled();
      expect(t.clamp(-1), 0);
      expect(t.clamp(1e9), closeTo(50, 1e-9));
      expect(t.cameraAt(1e9).offsetM, 1100);
    });

    test('null keeps the manifest timing; a non-positive speed is refused', () {
      expect(_timeline().totalDurationSec, 30);
      expect(() => scaled(null, 0), throwsArgumentError);
      expect(() => scaled(null, -5), throwsArgumentError);
    });

    test('a segment that does not advance along the route keeps the manifest timing', () {
      final m = manifest(segments: [
        segment(0, 600, 600, [kf(0, 600), kf(4, 600), kf(8, 600)]),
      ]);
      expect(scaled(m).totalDurationSec, 8);
    });

    test('the committed fixture: ~10 m/s over its 670.3 m timeline (about 67 s, not the nominal 22.3 s)', () {
      final m = PreviewManifest.parse(File('assets/fixtures/manifest.json').readAsStringSync());
      final nominal = FlyoverTimeline.fromManifest(m, effectiveSpeedMps: null);
      final slowed = FlyoverTimeline.fromManifest(m);
      final lengthM = m.timelineEndM - m.timelineStartM;
      expect(nominal.totalDurationSec, closeTo(22.3, 0.05));
      expect(slowed.totalDurationSec, closeTo(lengthM / 10, 0.05));
      expect(slowed.totalDurationSec, closeTo(67.03, 0.05));
      expect(lengthM / slowed.totalDurationSec, closeTo(10, 0.01));
      expect(slowed.cameraAt(0).offsetM, closeTo(m.timelineStartM, 1e-6));
      expect(slowed.cameraAt(0).offsetM, lessThan(m.approachStartM), reason: 'the pre-approach start is still exercised');
      expect(slowed.cameraAt(slowed.totalDurationSec).offsetM, closeTo(m.timelineEndM, 1e-6));
    });
  });

  group('playback speed control', () {
    late FlyoverPlayerController p;
    setUp(() => p = FlyoverPlayerController(_timeline(null, kFlyoverEffectiveSpeedMps)));

    test('speeds are 0.5x, 1x and 2x; the default is 1x', () {
      expect(kPlaybackSpeeds, [0.5, 1.0, 2.0]);
      expect(p.speed, 1.0);
    });

    test('2x moves the clock twice as fast, 0.5x half as fast', () {
      p.play();
      p.advance(4);
      expect(p.positionSec, 4);
      p.setSpeed(2);
      p.advance(4);
      expect(p.positionSec, 12);
      p.setSpeed(0.5);
      p.advance(4);
      expect(p.positionSec, 14);
    });

    test('scrubbing and the end clamp are unaffected by speed', () {
      p.setSpeed(2);
      p.seek(10);
      expect(p.positionSec, 10);
      p.play();
      p.advance(1000);
      expect(p.positionSec, p.durationSec);
      expect(p.playing, isFalse);
    });

    test('speed survives pause and play; unknown speeds are refused; changes notify', () {
      var n = 0;
      p.addListener(() => n++);
      p.setSpeed(2); // 1
      p.setSpeed(2); // no change
      p.play(); // 2
      p.pause(); // 3
      expect(p.speed, 2);
      expect(n, 3);
      expect(() => p.setSpeed(3), throwsArgumentError);
    });
  });
}
