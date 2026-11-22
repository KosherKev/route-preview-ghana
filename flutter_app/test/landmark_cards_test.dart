import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/overlays/overlay_logic.dart';
import 'package:route_preview/overlays/overlay_stack.dart';

LandmarkOverlay mark(double off, String name, String side) =>
    LandmarkOverlay(offsetM: off, name: name, category: 'shop', kind: 'shop', side: side, distanceM: 12, lat: 5.6, lon: -0.2);
TurnOverlay turn(double off, String dir) => TurnOverlay(
    offsetM: off, maneuver: dir, direction: dir, kind: 'turn', streetName: 'Main St', windowStartM: off - 80, windowEndM: off);

Widget host(Overlays o, double off, {double width = 414}) => MaterialApp(
      home: Scaffold(body: Align(alignment: Alignment.bottomCenter, child: SizedBox(width: width, child: OverlayStack(overlays: o, offsetM: off)))),
    );

void main() {
  test('a landmark card appears 80 m before the landmark (one constant) and leaves 20 m after', () {
    expect(kLandmarkLeadM, 80);
    final o = Overlays(landmarks: [mark(500, 'Shop', 'left')]);
    expect(visibleOverlays(o, 419), isEmpty);
    expect(visibleOverlays(o, 420), hasLength(1));
    expect(visibleOverlays(o, 520), hasLength(1));
    expect(visibleOverlays(o, 521), isEmpty);
  });

  test('at most three cards at once, turns first', () {
    final o = Overlays(
      turns: [turn(1000, 'left')],
      landmarks: [mark(1005, 'A', 'left'), mark(1010, 'B', 'right'), mark(1020, 'C', 'left'), mark(1030, 'D', 'right')],
    );
    final v = visibleOverlays(o, 950);
    expect(v, hasLength(3));
    expect(v.first.kind, OverlayKind.turn);
  });

  test('cards go to the side of the road their landmark is on, and to the side of their turn', () {
    final o = Overlays(turns: [turn(1000, 'right')], landmarks: [mark(1005, 'A', 'left'), mark(1010, 'B', 'right')]);
    final byId = {for (final i in visibleOverlays(o, 950)) i.id: i.onRight};
    expect(byId['turn-0'], isTrue);
    expect(byId['landmark-0'], isFalse);
    expect(byId['landmark-1'], isTrue);
  });

  testWidgets('left and right cards stay in their own half, clear of the route line down the middle', (tester) async {
    final o = Overlays(turns: [turn(1000, 'left')], landmarks: [mark(1005, 'Left shop', 'left'), mark(1010, 'Right shop', 'right')]);
    await tester.binding.setSurfaceSize(const Size(414, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(host(o, 950));
    final mid = 414 / 2;
    for (final id in ['turn-0', 'landmark-0']) {
      expect(tester.getRect(find.byKey(Key('overlay-$id'))).right, lessThan(mid), reason: '$id is left of the centre line');
    }
    expect(tester.getRect(find.byKey(const Key('overlay-landmark-1'))).left, greaterThan(mid));
    // A turn and a landmark on the same side stack above one another instead of overlapping.
    final a = tester.getRect(find.byKey(const Key('overlay-turn-0'))), b = tester.getRect(find.byKey(const Key('overlay-landmark-0')));
    expect(a.overlaps(b), isFalse);
  });

  testWidgets('a live offset rebuilds only when the cards change', (tester) async {
    final o = Overlays(landmarks: [mark(1000, 'Shop', 'left')]);
    final offset = ValueNotifier<double>(0);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Align(alignment: Alignment.bottomCenter, child: OverlayStack(overlays: o, offset: offset)))));
    expect(find.text('Shop'), findsNothing);
    offset.value = 925;
    await tester.pump();
    expect(find.text('Shop'), findsOneWidget);
    offset.value = 1030;
    await tester.pump();
    expect(find.text('Shop'), findsNothing);
  });

  test('the manifest landmark position is kept for the map marker (lat and lon are manifest fields)', () {
    final l = mark(1, 'x', 'left');
    expect(l.lat, 5.6);
    expect(l.lon, -0.2);
  });
}
