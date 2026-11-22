import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/diagnostics/frame_monitor.dart';
import 'package:route_preview/diagnostics/frame_overlay.dart';
import 'package:route_preview/diagnostics/frame_stats.dart';

void main() {
  group('frame statistics maths', () {
    test('average, nearest-rank p99, and the 16.7 / 33.4 ms counts', () {
      final s = FrameStats();
      // 100 frames: 98 at 5 ms, one at 20 ms (over 16.7), one at 40 ms (over 33.4 too).
      for (var i = 0; i < 98; i++) {
        s.add(buildMs: 5, rasterMs: 1);
      }
      s.add(buildMs: 20, rasterMs: 2);
      s.add(buildMs: 3, rasterMs: 40);
      expect(s.frames, 100);
      expect(s.over16, 2);
      expect(s.over33, 1);
      expect(s.avgMs, closeTo((98 * 5 + 20 + 40) / 100, 1e-9));
      expect(s.percentile(50), 5);
      expect(s.p99Ms, 20, reason: 'rank ceil(0.99 * 100) = 99th value of the sorted frames');
      expect(s.percentile(100), 40);
      expect(s.maxMs, 40);
    });

    test('a frame costs the slower of build and raster (they run on different threads)', () {
      final s = FrameStats()..add(buildMs: 4, rasterMs: 9);
      expect(s.avgMs, 9);
      expect(s.avgBuildMs, 4);
      expect(s.avgRasterMs, 9);
    });

    test('the window keeps only the last 300 frames, the totals keep all', () {
      final s = FrameStats();
      for (var i = 0; i < 300; i++) {
        s.add(buildMs: 50, rasterMs: 1); // slow, early
      }
      for (var i = 0; i < 300; i++) {
        s.add(buildMs: 2, rasterMs: 1); // fast, recent
      }
      expect(s.windowCount, 300);
      expect(s.avgMs, 2, reason: 'the slow early frames have left the window');
      expect(s.p99Ms, 2);
      expect(s.frames, 600);
      expect(s.over33, 300, reason: 'the dropped-frame counts are for the whole run');
      expect(s.runAvgMs, closeTo(26, 1e-9));
      expect(s.runP99Ms, 50);
    });

    test('empty stats are zeros, reset clears everything', () {
      final s = FrameStats();
      expect([s.avgMs, s.p99Ms, s.maxMs, s.runP99Ms], [0, 0, 0, 0]);
      s.add(buildMs: 40, rasterMs: 1);
      s.reset();
      expect([s.frames, s.over16, s.over33, s.windowCount], [0, 0, 0, 0]);
    });

    test('the report is plain text with the preset, averages, p99 and counts', () {
      final s = FrameStats()..add(buildMs: 20, rasterMs: 1);
      final r = s.report(preset: 'Close');
      expect(r, contains('camera preset: Close'));
      expect(r, contains('avg 20.0 ms'));
      expect(r, contains('p99 20.0 ms'));
      expect(r, contains('over 16.7 ms: 1, over 33.4 ms: 0'));
    });
  });

  group('frame overlay', () {
    testWidgets('shows the numbers and the preset; copy report puts the text on the clipboard and writes nothing else', (tester) async {
      final monitor = FrameMonitor();
      monitor.stats.add(buildMs: 8, rasterMs: 2);
      monitor.stats.add(buildMs: 40, rasterMs: 2);
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String;
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      var done = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: FrameOverlay(monitor: monitor, presetLabel: 'Close', onCopied: () => done++)),
      ));
      expect(find.text('view: Close'), findsOneWidget);
      expect(find.text('avg 24.0 · p99 40.0 ms'), findsOneWidget);
      expect(find.text('>16.7 ms: 1 · >33 ms: 1'), findsOneWidget);
      await tester.tap(find.byKey(const Key('frame-copy')));
      await tester.pump();
      expect(done, 1);
      expect(copied, contains('camera preset: Close'));
      expect(copied, contains('frames: 2'));
    });

    test('the monitor is off by default and collects nothing until enabled', () {
      final m = FrameMonitor();
      expect(m.enabled, isFalse);
      expect(m.stats.frames, 0);
    });
  });
}
