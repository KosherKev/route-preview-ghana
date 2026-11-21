import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/overlays/overlay_logic.dart';
import 'package:route_preview/overlays/overlay_stack.dart';

import 'support/mixed.dart';

TurnOverlay turn(double off, {String man = 'left', String dir = 'left', String? street = 'Main St', double lead = 80}) =>
    TurnOverlay(offsetM: off, maneuver: man, direction: dir, kind: 'turn', streetName: street, windowStartM: off - lead, windowEndM: off);
LandmarkOverlay mark(double off, {String name = 'Cafe', String side = 'left', String category = 'amenity', String? kind = 'cafe'}) =>
    LandmarkOverlay(offsetM: off, name: name, category: category, kind: kind, side: side, distanceM: 10);

void main() {
  group('visibility by offset', () {
    test('a turn shows inside its decision window and not before or after', () {
      final o = Overlays(turns: [turn(1000)]);
      expect(visibleOverlays(o, 919.9), isEmpty);
      expect(visibleOverlays(o, 920), hasLength(1));
      expect(visibleOverlays(o, 960), hasLength(1));
      expect(visibleOverlays(o, 1000), hasLength(1));
      expect(visibleOverlays(o, 1000.1), isEmpty);
    });

    test('a landmark shows 80 m before its offset until 20 m after', () {
      final o = Overlays(landmarks: [mark(500)]);
      expect(visibleOverlays(o, 419.9), isEmpty);
      expect(visibleOverlays(o, 420), hasLength(1));
      expect(visibleOverlays(o, 520), hasLength(1));
      expect(visibleOverlays(o, 520.1), isEmpty);
      expect(kLandmarkLeadM, 80);
      expect(kLandmarkTrailM, 20);
    });

    test('on the mixed manifest the overlays come and go along the route', () {
      final o = mixedManifest().overlays;
      List<String> ids(double off) => [for (final i in visibleOverlays(o, off)) i.id];
      expect(ids(4800), ['landmark-0']); // cafe at 4850 is within 80 m
      expect(ids(4950), ['turn-0']); // the left turn window 4920-5000
      expect(ids(5300), isEmpty);
      expect(ids(5420), ['turn-1', 'landmark-2']); // slight right (5370-5450) first, then the market at 5460
      expect(ids(5720), ['landmark-3']);
    });
  });

  group('how many show at once', () {
    test('never more than 3, turns first, then nearest landmarks', () {
      final o = Overlays(
        turns: [turn(1000), turn(1010, man: 'right', dir: 'right')],
        landmarks: [mark(1005, name: 'A'), mark(1030, name: 'B'), mark(1060, name: 'C')],
      );
      final v = visibleOverlays(o, 990);
      expect(v, hasLength(kMaxOverlays));
      expect(kMaxOverlays, 3);
      expect([for (final i in v) i.kind], [OverlayKind.turn, OverlayKind.turn, OverlayKind.landmark]);
      expect(v.last.title, 'A', reason: 'the nearest landmark wins the last slot');
    });

    test('max can be changed and zero shows nothing', () {
      final o = Overlays(turns: [turn(100)], landmarks: [mark(100)]);
      expect(visibleOverlays(o, 60, max: 1), hasLength(1));
      expect(visibleOverlays(o, 60, max: 0), isEmpty);
    });
  });

  group('text comes from the manifest fields only', () {
    test('turn: maneuver and street, and the distance to the decision point', () {
      final v = visibleOverlays(Overlays(turns: [turn(1000, man: 'slight_right', dir: 'right', street: 'Oxford Street')]), 920).single;
      expect(v.title, 'Slight right · Oxford Street');
      expect(v.subtitle, 'in 80 m');
      expect(visibleOverlays(Overlays(turns: [turn(1000)]), 998).single.subtitle, 'now');
      expect(visibleOverlays(Overlays(turns: [turn(1000, street: null)]), 960).single.title, 'Left');
    });

    test('landmark: name, kind (or category) and side', () {
      expect(visibleOverlays(Overlays(landmarks: [mark(500, name: 'Test Pharmacy', kind: 'pharmacy', side: 'right')]), 480).single.subtitle, 'Pharmacy · on the right');
      expect(visibleOverlays(Overlays(landmarks: [mark(500, kind: null, category: 'shop')]), 480).single.subtitle, 'Shop · on the left');
    });

    test('humanize', () {
      expect(humanize('roundabout_enter'), 'Roundabout enter');
      expect(humanize('left'), 'Left');
      expect(humanize(''), '');
    });
  });

  group('the overlay widgets', () {
    Widget host(Overlays o, double off) => MaterialApp(home: Scaffold(body: Align(alignment: Alignment.bottomLeft, child: OverlayStack(overlays: o, offsetM: off))));

    testWidgets('cards appear and disappear as the offset moves', (tester) async {
      final o = mixedManifest().overlays;
      await tester.pumpWidget(host(o, 4950));
      expect(find.text('Left · Synthetic Street'), findsOneWidget);
      expect(find.byKey(const Key('overlay-turn-0')), findsOneWidget);
      await tester.pumpWidget(host(o, 5300));
      expect(find.byKey(const Key('overlay-turn-0')), findsNothing);
      expect(find.byType(Container), findsNothing);
      await tester.pumpWidget(host(o, 5200));
      expect(find.text('Test Pharmacy'), findsOneWidget);
    });

    testWidgets('no more than 3 cards, and they do not take touches', (tester) async {
      final o = Overlays(turns: [turn(1000), turn(1005)], landmarks: [mark(1000, name: 'A'), mark(1001, name: 'B')]);
      await tester.pumpWidget(host(o, 990));
      expect(find.byWidgetPredicate((w) => w.key.toString().contains('overlay-turn') || w.key.toString().contains('overlay-landmark')), findsNWidgets(3));
      expect(find.byType(IgnorePointer), findsWidgets);
    });
  });
}
