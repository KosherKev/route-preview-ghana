import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/api/preview_api.dart';
import 'package:route_preview/api/step_tracker.dart';

import 'support/fake_server.dart';

const _req = PreviewRequest(originLat: 5.6037, originLon: -0.187, destLat: 5.56, destLon: -0.2057);

void main() {
  group('StepTracker (fake clock)', () {
    late Duration now;
    late StepTracker t;
    setUp(() {
      now = Duration.zero;
      t = StepTracker(now: () => now);
    });

    test('records each step and the total', () {
      t.begin(StepTracker.lookup);
      now += const Duration(milliseconds: 40);
      t.begin(StepTracker.connect);
      now += const Duration(milliseconds: 250);
      t.begin(StepTracker.firstByte);
      now += const Duration(milliseconds: 1400);
      t.finish();
      expect(t.elapsedOf(StepTracker.lookup), const Duration(milliseconds: 40));
      expect(t.elapsedOf(StepTracker.connect), const Duration(milliseconds: 250));
      expect(t.elapsedOf(StepTracker.firstByte), const Duration(milliseconds: 1400));
      expect(t.totalElapsed, const Duration(milliseconds: 1690));
      expect(t.summary(), 'name lookup 0.0 s · connect 0.3 s · first byte 1.4 s · total 1.7 s');
      expect(t.warning, isNull);
    });

    test('a step over 5 seconds raises the "still trying" message, and it goes when the step ends', () {
      t.begin(StepTracker.connect);
      now += const Duration(seconds: 5);
      expect(t.warning, isNull, reason: 'exactly 5 s is not over 5 s');
      now += const Duration(milliseconds: 1);
      expect(t.warning, 'Waking the Tailscale connection, still trying');
      expect(t.slowStep, StepTracker.connect);
      expect(t.summary(), contains('connect (running) 5.0 s'));
      t.begin(StepTracker.firstByte);
      expect(t.warning, isNull);
    });

    test('a retried step is shown once, with its latest time', () {
      t.begin(StepTracker.connect);
      now += const Duration(seconds: 1);
      t.end();
      t.begin(StepTracker.connect);
      now += const Duration(seconds: 2);
      t.end();
      expect(RegExp('connect').allMatches(t.summary()).length, 1);
      expect(t.elapsedOf(StepTracker.connect), const Duration(seconds: 2));
    });
  });

  group('with the local fake server', () {
    late FakeServer server;
    setUp(() async => server = await FakeServer.start());
    tearDown(() => server.stop());

    test('Test connection records lookup, connect and first byte', () async {
      final tracker = StepTracker();
      final ok = await PreviewApi(server.url).health(tracker: tracker);
      expect(ok, isTrue);
      expect(tracker.elapsedOf(StepTracker.lookup), isNotNull);
      expect(tracker.elapsedOf(StepTracker.connect), isNotNull);
      expect(tracker.elapsedOf(StepTracker.firstByte), isNotNull);
      expect(tracker.currentStep, isNull, reason: 'finished');
      expect(tracker.summary(), allOf(contains('name lookup'), contains('connect'), contains('first byte'), contains('total')));
    });

    test('a slow server: the time lands in first byte, and the request is cut at the timeout with a readable message', () async {
      server.previewDelay = const Duration(seconds: 3);
      final tracker = StepTracker();
      final api = PreviewApi(server.url, timeout: const Duration(milliseconds: 400));
      try {
        await api.preview(_req, tracker: tracker);
        fail('expected a timeout');
      } on ApiException catch (e) {
        expect(e.kind, ApiErrorKind.timeout);
        expect(e.message, contains('did not answer within'));
      }
      expect(tracker.elapsedOf(StepTracker.firstByte) ?? tracker.currentElapsed, lessThan(const Duration(seconds: 2)));
      expect(server.requests.where((r) => r == 'POST /preview').length, 1, reason: 'no retry on a timeout');
    });

    test('the default cap is 20 seconds for preview and the message says so in words', () async {
      final api = PreviewApi(server.url);
      expect(api.timeout, const Duration(seconds: 20));
      // Not waiting 20 s: check the wording through a shorter cap of the same code path.
      server.previewDelay = const Duration(seconds: 3);
      final short = PreviewApi(server.url, timeout: const Duration(seconds: 1));
      final e = await short.preview(_req).then<ApiException?>((_) => null, onError: (Object x) => x as ApiException);
      expect(e!.message, startsWith('The API did not answer within 1 seconds.'));
      expect(e.message, contains('Tailscale'));
    });

    test('an unreachable host fails in the connect step (after the one existing retry), not as a hang', () async {
      final dead = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final port = dead.port;
      await dead.close();
      final tracker = StepTracker();
      try {
        await PreviewApi('http://127.0.0.1:$port', timeout: const Duration(seconds: 5)).health(tracker: tracker);
        fail('expected offline');
      } on ApiException catch (e) {
        expect(e.kind, ApiErrorKind.offline);
      }
      expect(tracker.elapsedOf(StepTracker.lookup), isNotNull);
      expect(tracker.elapsedOf(StepTracker.firstByte), isNull);
    });
  });
}
