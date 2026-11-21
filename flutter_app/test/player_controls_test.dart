import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/flyover/player_controller.dart';
import 'package:route_preview/flyover/timeline.dart';
import 'package:route_preview/player_controls.dart';

import 'support/manifest_builder.dart';

void main() {
  late FlyoverPlayerController player;

  Future<void> pumpControls(WidgetTester tester) async {
    player = FlyoverPlayerController(FlyoverTimeline.fromManifest(PreviewManifest.parse(manifestString())));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: PlayerControls(controller: player, timelineStartM: 600, timelineEndM: 1100),
        ),
      ),
    ));
  }

  testWidgets('shows the clock and the manifest offsets, paused at the start', (tester) async {
    await pumpControls(tester);
    expect(find.text('00.0s / 30.0s'), findsOneWidget);
    expect(find.text('route 600 m  (timeline 600 to 1100 m)'), findsOneWidget);
    expect(find.byIcon(Icons.play_arrow), findsOneWidget);
  });

  testWidgets('play and pause buttons drive the controller', (tester) async {
    await pumpControls(tester);
    await tester.tap(find.byKey(const Key('play-pause')));
    await tester.pump();
    expect(player.playing, isTrue);
    expect(find.byIcon(Icons.pause), findsOneWidget);
    player.advance(5);
    await tester.pump();
    expect(find.text('05.0s / 30.0s'), findsOneWidget);
    await tester.tap(find.byKey(const Key('play-pause')));
    await tester.pump();
    expect(player.playing, isFalse);
    expect(find.byIcon(Icons.play_arrow), findsOneWidget);
  });

  testWidgets('dragging the slider scrubs the timeline and updates the route offset', (tester) async {
    await pumpControls(tester);
    final slider = find.byKey(const Key('scrub'));
    // From the centre (15 s) a quarter-width drag lands inside the range (about 22 s), not on the end stop.
    await tester.drag(slider, Offset(tester.getSize(slider).width / 4, 0));
    await tester.pump();
    expect(player.positionSec, greaterThan(5));
    expect(player.positionSec, lessThan(30));
    expect(player.playing, isFalse);
    final offset = player.camera.offsetM;
    expect(offset, greaterThan(600));
    expect(find.text('route ${offset.toStringAsFixed(0)} m  (timeline 600 to 1100 m)'), findsOneWidget);
  });

  testWidgets('play at the end restarts from the beginning', (tester) async {
    await pumpControls(tester);
    player.seek(30);
    await tester.pump();
    await tester.tap(find.byKey(const Key('play-pause')));
    await tester.pump();
    expect(player.positionSec, 0);
    expect(player.playing, isTrue);
  });
}
