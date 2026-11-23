import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/player_controller.dart';
import 'package:route_preview/flyover/timeline.dart';
import 'package:route_preview/prototype_badge.dart';
import 'package:route_preview/segment_strip.dart';

import 'support/mixed.dart';

void main() {
  late FlyoverPlayerController p;
  Future<void> pump(WidgetTester t, {bool oldServerNoFlyover = false}) async {
    final m = mixedManifest(oldServerNoFlyover
        ? (j) {
            for (final i in [0, 3]) {
              ((j['segments'] as List)[i] as Map<String, dynamic>)['flyover'] = null; // an old server; the schema forbids it now
            }
          }
        : null);
    p = FlyoverPlayerController(FlyoverTimeline.fromManifest(m, availableClips: const {kClipA}));
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
      3: 'Flyover fallback (no local clip)', // the ready clip carries keyframes (schema: a flyover on every segment)
    };
    for (final s in t.segments) {
      p.seek(s.startT + s.durationSec / 2);
      await tester.pump();
      expect(find.text('Section ${s.index + 1} of 4 · ${want[s.index]}'), findsOneWidget, reason: 'segment ${s.index}');
    }
  });

  testWidgets('NEGATIVE: an old server with no flyover on a missing clip still labels it "No preview for this section"', (tester) async {
    await pump(tester, oldServerNoFlyover: true);
    p.seek(p.timeline.segments[3].startT + p.timeline.segments[3].durationSec / 2);
    await tester.pump();
    expect(find.text('Section 4 of 4 · No preview for this section'), findsOneWidget);
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
