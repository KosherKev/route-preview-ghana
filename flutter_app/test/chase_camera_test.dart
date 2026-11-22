import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/camera_preset.dart';
import 'package:route_preview/flyover/camera_smoother.dart';
import 'package:route_preview/flyover/chase_camera.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/flyover/timeline.dart';
import 'package:route_preview/route_geometry.dart';

PreviewManifest get _real => PreviewManifest.parse(File('assets/fixtures/accra-real-manifest.json').readAsStringSync());

/// A route that goes north 200 m, turns sharply east for 200 m.
RouteGeometry _lShape() {
  const dLat = 200 / 111320.0;
  final enc = _encode([
    [5.5, -0.2],
    [5.5 + dLat, -0.2],
    [5.5 + dLat, -0.2 + 200 / (111320.0 * 0.99996)],
  ]);
  return RouteGeometry.fromPolyline6(enc, lengthM: 400);
}

String _encode(List<List<double>> pts) {
  final out = StringBuffer();
  var pLat = 0, pLon = 0;
  void put(int v) {
    var x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      out.writeCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out.writeCharCode(x + 63);
  }

  for (final p in pts) {
    final la = (p[0] * 1e6).round(), lo = (p[1] * 1e6).round();
    put(la - pLat);
    put(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out.toString();
}

void main() {
  group('chase camera target', () {
    test('the camera centre is lookAheadM ahead of the route position, on the polyline', () {
      final route = _lShape();
      final cam = ChaseCamera(route);
      final t = cam.targetAt(50, CameraPreset.close);
      final ahead = route.pointAt(50 + CameraPreset.close.lookAheadM);
      expect(t.lat, closeTo(ahead[0], 1e-12));
      expect(t.lon, closeTo(ahead[1], 1e-12));
      expect(t.offsetM, 50);
      expect(t.zoom, CameraPreset.close.zoom);
      expect(t.pitchDeg, CameraPreset.close.pitchDeg);
    });

    test('heading follows the route: north on the first leg, east on the second', () {
      final cam = ChaseCamera(_lShape());
      expect(cam.targetAt(20, CameraPreset.close).bearingDeg, closeTo(0, 0.5));
      expect(cam.targetAt(300, CameraPreset.close).bearingDeg, closeTo(90, 0.5));
    });

    test('heading leans into a corner before reaching it and never jumps in one step', () {
      final cam = ChaseCamera(_lShape());
      var prev = cam.targetAt(0, CameraPreset.close).bearingDeg;
      var maxStep = 0.0;
      for (var o = 0.5; o <= 400; o += 0.5) {
        final b = cam.targetAt(o, CameraPreset.close).bearingDeg;
        maxStep = [maxStep, CameraSmoother.angleDelta(prev, b).abs()].reduce((a, b) => a > b ? a : b);
        prev = b;
      }
      // A 90 degree corner is spread over the 40 m heading window: at most a few degrees per half metre.
      expect(maxStep, lessThan(4));
      expect(cam.targetAt(170, CameraPreset.close).bearingDeg, greaterThan(5), reason: 'already turning 30 m before the corner');
    });

    test('at the start the centre is ahead; at the end it clamps to the destination and the heading stays valid', () {
      final route = _lShape();
      final cam = ChaseCamera(route);
      final start = cam.targetAt(0, CameraPreset.close);
      expect(start.offsetM, 0);
      final end = cam.targetAt(400, CameraPreset.close);
      final last = route.points.last;
      expect(end.lat, closeTo(last[0], 1e-9));
      expect(end.lon, closeTo(last[1], 1e-9));
      expect(end.bearingDeg, closeTo(90, 0.5), reason: 'the window slides back so the last direction is kept');
      expect(cam.targetAt(9999, CameraPreset.close).offsetM, 400);
      expect(cam.targetAt(-50, CameraPreset.close).offsetM, 0);
    });

    test('a very short route (10 m) still gives finite values and the right direction', () {
      final enc = _encode([
        [5.5, -0.2],
        [5.5 + 10 / 111320.0, -0.2],
      ]);
      final route = RouteGeometry.fromPolyline6(enc, lengthM: 10);
      final cam = ChaseCamera(route);
      for (final o in [0.0, 5.0, 10.0]) {
        final t = cam.targetAt(o, CameraPreset.close);
        expect(t.lat.isFinite && t.lon.isFinite && t.bearingDeg.isFinite, isTrue);
        expect(t.bearingDeg, closeTo(0, 0.5));
      }
    });

    test('Standard sits higher and further than Close; High is not a chase preset', () {
      expect(CameraPreset.standard.zoom!, lessThan(CameraPreset.close.zoom!));
      expect(CameraPreset.standard.pitchDeg!, lessThan(CameraPreset.close.pitchDeg!));
      expect(CameraPreset.high.isChase, isFalse);
      expect(CameraPreset.defaultPreset, CameraPreset.close);
      expect(CameraPreset.close.zoom!, inInclusiveRange(17, 17.5));
      expect(CameraPreset.close.pitchDeg!, inInclusiveRange(60, 65));
    });
  });

  group('smoothing', () {
    test('a critically damped value follows its target without overshoot and settles', () {
      final v = SmoothValue(0);
      var maxV = 0.0;
      for (var i = 0; i < 600; i++) {
        maxV = [maxV, v.step(10, 1 / 60, 0.5)].reduce((a, b) => a > b ? a : b);
      }
      expect(maxV, lessThanOrEqualTo(10 + 1e-9));
      expect(v.value, closeTo(10, 1e-3));
    });

    test('the result does not depend on the frame rate', () {
      double run(double dt) {
        final v = SmoothValue(0);
        for (var t = 0.0; t < 1.0 - 1e-9; t += dt) {
          v.step(10, dt, 0.5);
        }
        return v.value;
      }

      expect(run(1 / 120), closeTo(run(1 / 30), 0.05));
    });

    test('bearing takes the short way round 360 to 0', () {
      final s = CameraSmoother();
      CameraState at(double b) => CameraState(offsetM: 0, lat: 5, lon: 0, bearingDeg: b, pitchDeg: 60, zoom: 17);
      s.snap(at(350));
      var prev = 350.0, maxStep = 0.0;
      for (var i = 0; i < 120; i++) {
        final b = s.step(at(10), 1 / 60).bearingDeg;
        maxStep = [maxStep, CameraSmoother.angleDelta(prev, b).abs()].reduce((a, b) => a > b ? a : b);
        prev = b;
      }
      expect(maxStep, lessThan(3), reason: 'no 340 degree spin');
      expect(prev, closeTo(10, 0.5));
    });

    test('snap jumps at once and the first step snaps', () {
      final s = CameraSmoother();
      CameraState at(double lat) => CameraState(offsetM: 0, lat: lat, lon: 0, bearingDeg: 0, pitchDeg: 60, zoom: 17);
      expect(s.step(at(5), 1 / 60).lat, 5);
      expect(s.snap(at(6)).lat, 6);
    });
  });

  group('continuity on the real Osu to Korle Gonno route, with its corners', () {
    // Plays the whole timeline frame by frame at 60 Hz and measures every frame-to-frame step of the SMOOTHED camera.
    for (final speed in [1.0, 4.0]) {
      test('${speed}x Close: no heading snap, no position step beyond the speed, pitch and zoom constant', () {
        final m = _real;
        final tl = FlyoverTimeline.fromManifest(m);
        final cam = ChaseCamera(tl.route!);
        final smoother = CameraSmoother();
        const dt = 1 / 60;
        CameraState? prev;
        var maxBearingStep = 0.0, maxMoveM = 0.0, maxZoomStep = 0.0, frames = 0;
        for (var t = 0.0; t <= tl.totalDurationSec; t += dt * speed) {
          final c = smoother.step(cam.targetAt(tl.chaseOffsetAt(t), CameraPreset.close), dt);
          if (prev != null) {
            final d = CameraSmoother.angleDelta(prev.bearingDeg, c.bearingDeg).abs();
            if (d > maxBearingStep) maxBearingStep = d;
            final mv = RouteGeometry.haversineM(prev.lat, prev.lon, c.lat, c.lon);
            if (mv > maxMoveM) maxMoveM = mv;
            final dz = (prev.zoom - c.zoom).abs();
            if (dz > maxZoomStep) maxZoomStep = dz;
          }
          prev = c;
          frames++;
        }
        expect(frames, greaterThan(100));
        // 14 m/s * speed / 60 Hz, with a little room for the smoothing catching up on a corner.
        expect(maxMoveM, lessThan(14 * speed / 60 * 1.6));
        expect(maxBearingStep, lessThan(1.5 * speed), reason: 'degrees per frame; the real route turns about 20 degrees over 30 m');
        expect(maxZoomStep, lessThan(0.01));
      });
    }

    test('the chase offset moves at a constant 14 m/s inside the flyover section (no easing stops)', () {
      final tl = FlyoverTimeline.fromManifest(_real);
      var minV = double.infinity, maxV = 0.0;
      for (var t = 0.0; t < tl.totalDurationSec - 0.1; t += 0.1) {
        final v = (tl.chaseOffsetAt(t + 0.1) - tl.chaseOffsetAt(t)) / 0.1;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      expect(minV, closeTo(14, 1e-6));
      expect(maxV, closeTo(14, 1e-6));
      // The keyframe camera, by contrast, comes to a stop at the eased ends.
      var kfMin = double.infinity;
      for (var t = 0.0; t < tl.totalDurationSec - 0.1; t += 0.1) {
        final v = (tl.cameraAt(t + 0.1).offsetM - tl.cameraAt(t).offsetM) / 0.1;
        if (v < kfMin) kfMin = v;
      }
      expect(kfMin, lessThan(13), reason: 'the old keyframe easing slows down, which is part of what looked jerky');
    });

    test('playback duration of the real route at each speed (1x is about 14 m/s)', () {
      final tl = FlyoverTimeline.fromManifest(_real);
      final lengthM = _real.timelineEndM - _real.timelineStartM;
      expect(tl.totalDurationSec, closeTo(lengthM / 14, 0.05));
      for (final s in [0.5, 1.0, 2.0, 4.0]) {
        // ignore: avoid_print
        print('real route ${lengthM.toStringAsFixed(0)} m at ${s}x: ${(tl.totalDurationSec / s).toStringAsFixed(1)} s');
      }
    });
  });
}
