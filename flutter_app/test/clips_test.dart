import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/clips/clip_store.dart';
import 'package:route_preview/clips/clip_view.dart';

import 'support/fake_clip_player.dart';
import 'support/mixed.dart';

void main() {
  group('ClipStore: only local files, only valid keys', () {
    late Directory dir;
    setUp(() => dir = Directory.systemTemp.createTempSync('clips'));
    tearDown(() => dir.deleteSync(recursive: true));

    test('a key maps to a file under the clips directory', () {
      final f = ClipStore(dir).fileFor(kClipA)!;
      expect(f.path, '${dir.path}/$kClipA');
    });

    test('keys that could leave the directory or are not clip keys map to nothing', () {
      for (final bad in ['../x/forward.mp4', '/etc/passwd', '12/../../x.mp4', 'a.mp4', '12/forward.mov', '', '12/forward.mp4\n', 'https://x/1/forward.mp4']) {
        expect(ClipStore(dir).fileFor(bad), isNull, reason: bad);
      }
    });

    test('available() lists the manifest clips that exist and are not empty', () async {
      final m = mixedManifest();
      expect(await ClipStore(dir).available(m), isEmpty);
      Directory('${dir.path}/900001').createSync();
      File('${dir.path}/$kClipA').writeAsBytesSync(const [1, 2, 3]);
      expect(await ClipStore(dir).available(m), {kClipA});
      Directory('${dir.path}/900002').createSync();
      File('${dir.path}/$kClipB').writeAsBytesSync(const []); // empty file: not usable
      expect(await ClipStore(dir).available(m), {kClipA});
    });

    test('a clip on the device that the manifest does not list is ignored', () async {
      Directory('${dir.path}/900009').createSync();
      File('${dir.path}/900009/forward.mp4').writeAsBytesSync(const [1]);
      expect(await ClipStore(dir).available(mixedManifest()), isEmpty);
    });
  });

  group('ClipView keeps the video in step with the preview clock', () {
    late FakeClipPlayer fake;
    final file = File('/tmp/sandbox/Documents/clips/$kClipA');

    Widget host({required double local, required bool playing, double speed = 1.0}) => MaterialApp(
          home: SizedBox(
            width: 200,
            height: 300,
            child: ClipView(file: file, localSec: local, playing: playing, speed: speed, factory: (f) => fake = FakeClipPlayer(f)),
          ),
        );

    testWidgets('opens the local file, seeks to the clock, sets the speed and plays', (tester) async {
      await tester.pumpWidget(host(local: 2.5, playing: true));
      await tester.pump();
      expect(fake.file.path, file.path);
      expect(fake.calls, ['init', 'seek 2.50', 'speed 1.0', 'play']);
      expect(find.byKey(const Key('fake-video')), findsOneWidget);
    });

    testWidgets('paused: it does not play; resuming plays; pausing again pauses', (tester) async {
      await tester.pumpWidget(host(local: 0, playing: false));
      await tester.pump();
      expect(fake.calls, isNot(contains('play')));
      await tester.pumpWidget(host(local: 0, playing: true));
      expect(fake.calls.last, 'play');
      await tester.pumpWidget(host(local: 0.1, playing: false));
      expect(fake.calls.last, 'pause');
    });

    testWidgets('small drift is left alone; a scrub (big drift) seeks', (tester) async {
      await tester.pumpWidget(host(local: 1, playing: true));
      await tester.pump();
      fake.calls.clear();
      fake.position = const Duration(milliseconds: 1200);
      await tester.pumpWidget(host(local: 1.1, playing: true));
      expect(fake.calls.where((c) => c.startsWith('seek')), isEmpty, reason: '0.1 s of drift is within the tolerance');
      await tester.pumpWidget(host(local: 6.0, playing: true)); // scrubbed forward
      expect(fake.calls, contains('seek 6.00'));
    });

    testWidgets('a speed change reaches the video', (tester) async {
      await tester.pumpWidget(host(local: 0, playing: true));
      await tester.pump();
      await tester.pumpWidget(host(local: 0, playing: true, speed: 2));
      expect(fake.calls.last, 'speed 2.0');
    });

    testWidgets('leaving disposes the player', (tester) async {
      await tester.pumpWidget(host(local: 0, playing: true));
      await tester.pump();
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      expect(fake.disposed, isTrue);
    });

    testWidgets('a clip that cannot be opened shows a message, not a crash', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: SizedBox(
            width: 200,
            height: 300,
            child: ClipView(file: file, localSec: 0, playing: true, speed: 1, factory: (f) => fake = FakeClipPlayer(f)..failOnInit = StateError('bad file'))),
      ));
      await tester.pump();
      expect(find.text('This clip cannot be played.'), findsOneWidget);
    });
  });
}
