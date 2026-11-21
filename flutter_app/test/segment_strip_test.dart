import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/player_controller.dart';
import 'package:route_preview/flyover/timeline.dart';
import 'package:route_preview/prototype_badge.dart';
import 'package:route_preview/segment_strip.dart';

import 'support/mixed.dart';

void main() {
  late FlyoverPlayerController p;
  Future<void> pump(WidgetTester t) async {
    p = FlyoverPlayerController(FlyoverTimeline.fromManifest(mixedManifest(), availableClips: const {kClipA}));
    await t.pumpWidget(MaterialApp(home: Scaffold(body: Align(alignment: Alignment.bottomCenter, child: SegmentStrip(controller: p)))));
  }

  testWidgets('one block per segment, with the source of the playing section labelled', (tester) async {
    await pump(tester);
    for (var i = 0; i < 4; i++) {
      expect(find.byKey(Key('segment-$i')), findsOneWidget);
    }
    expect(find.text('Section 1 of 4 · Street video (local clip)'), findsOneWidget);
  });

  testWidgets('the label follows the clock across every boundary', (tester) async {
    await pump(tester);
    final t = p.timeline;
    final want = {
      0: 'Street video (local clip)',
      1: 'Flyover',
      2: 'Flyover fallback (no local clip)',
      3: 'No preview for this section',
    };
    for (final s in t.segments) {
      p.seek(s.startT + s.durationSec / 2);
      await tester.pump();
      expect(find.text('Section ${s.index + 1} of 4 · ${want[s.index]}'), findsOneWidget, reason: 'segment ${s.index}');
    }
  });

  testWidgets('tapping a block jumps to the start of that section', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const Key('segment-2')));
    await tester.pump();
    expect(p.positionSec, closeTo(p.timeline.segments[2].startT, 1e-9));
  });

  testWidgets('the position marker moves with the clock', (tester) async {
    await pump(tester);
    final x0 = tester.getTopLeft(find.byKey(const Key('segment-marker'))).dx;
    p.seek(p.durationSec / 2);
    await tester.pump();
    expect(tester.getTopLeft(find.byKey(const Key('segment-marker'))).dx, greaterThan(x0 + 20));
  });

  test('every source has its own label and colour', () {
    final labels = {for (final s in SegmentSource.values) sourceLabel(s)};
    final colors = {for (final s in SegmentSource.values) sourceColor(s)};
    expect(labels, hasLength(4));
    expect(colors, hasLength(4));
  });

  testWidgets('the prototype badge says PROTOTYPE', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: PrototypeBadge())));
    expect(find.text('PROTOTYPE'), findsOneWidget);
  });
}
