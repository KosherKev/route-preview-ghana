import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'support/network_scan.dart';

/// Network and clip boundary: one configurable API address, clips only from local files, no media in the app.
List<File> _dart(String dir) =>
    Directory(dir).listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart')).toList();

void main() {
  group('scanners catch violations (positive controls)', () {
    test('URLs', () {
      expect(urlViolations('a.dart', "final u = 'https://evil.example/path';"), isNotEmpty);
      expect(urlViolations('a.dart', "'http://10.0.0.5:8787/clips/1/forward.mp4'"), isNotEmpty);
      expect(urlViolations('a.dart', "'https://cdn.maptiles.example/{z}/{x}/{y}.png'"), isNotEmpty);
      expect(urlViolations('a.dart', "const d = 'https://servermac.tail607401.ts.net:8444';"), isEmpty);
      expect(urlViolations('a.dart', "'https://www.openstreetmap.org/copyright'"), isEmpty);
      expect(urlViolations('a.dart', "must start with http:// or https:// and name a host"), isEmpty);
    });

    test('network video', () {
      for (final bad in [
        'VideoPlayerController.network(url)',
        'VideoPlayerController.networkUrl(Uri.parse(x))',
        'VideoPlayerController . asset("a.mp4")',
        'VideoPlayerController.contentUri(u)',
        "VideoPlayerController(dataSource: 'x')",
      ]) {
        expect(networkVideoViolations('a.dart', bad), isNotEmpty, reason: bad);
      }
      expect(networkVideoViolations('a.dart', 'VideoPlayerController.file(file, videoPlayerOptions: o)'), isEmpty);
    });

    test('HTTP machinery', () {
      for (final bad in ["import 'package:http/http.dart' as http;", 'final c = HttpClient();', 'Socket.connect(h, 80)', 'WebSocket.connect(u)', "import 'package:dio/dio.dart';"]) {
        expect(httpUseViolations('a.dart', bad), isNotEmpty, reason: bad);
      }
      expect(httpUseViolations('a.dart', "import 'dart:io' show File;"), isEmpty);
    });

    test('media files', () {
      for (final bad in ['a/clip.mp4', 'x/CLIP.MOV', 'tiles/accra.pmtiles', 'data.pbf']) {
        expect(isForbiddenMedia(bad), isTrue, reason: bad);
      }
      expect(isForbiddenMedia('assets/fixtures/accra-real-manifest.json'), isFalse);
    });
  });

  group('this app', () {
    test('lib/ has no URL except the default API address and the attribution link', () {
      final found = <String>[];
      for (final f in _dart('lib')) {
        found.addAll(urlViolations(f.path, f.readAsStringSync()));
      }
      expect(found, isEmpty);
    });

    test('the default API address is in exactly one place', () {
      final hits = [for (final f in _dart('lib')) if (f.readAsStringSync().contains('servermac.tail607401.ts.net')) f.path];
      expect(hits, ['lib/api/preview_api.dart']);
    });

    test('only the API client uses HTTP', () {
      final found = <String>[];
      for (final f in _dart('lib')) {
        if (f.path == 'lib/api/preview_api.dart') continue;
        found.addAll(httpUseViolations(f.path, f.readAsStringSync()));
      }
      expect(found, isEmpty);
    });

    test('video is only ever opened from a local file', () {
      var players = 0;
      for (final f in _dart('lib')) {
        final src = f.readAsStringSync();
        expect(networkVideoViolations(f.path, src), isEmpty, reason: f.path);
        players += RegExp(r'VideoPlayerController\s*\.\s*file\(').allMatches(src).length;
      }
      expect(players, 1, reason: 'exactly one video player, and it is built from a File');
    });

    test('the app never reads the manifest\'s servePath (the API does not serve clips, and the app does not ask)', () {
      for (final f in _dart('lib')) {
        expect(RegExp(r"""\[\s*['\"]servePath['\"]\s*\]|\.servePath\b""").hasMatch(f.readAsStringSync()), isFalse, reason: '${f.path} reads servePath');
        expect(RegExp(r"""['\"]/clips/""").hasMatch(f.readAsStringSync()), isFalse, reason: '${f.path} builds an API clip path');
      }
    });

    test('clips resolve only below Documents/clips (the clip store is the only path builder)', () {
      final uses = [for (final f in _dart('lib')) if (f.readAsStringSync().contains('fileFor(')) f.path]..sort();
      expect(uses, ['lib/clips/clip_store.dart', 'lib/flyover_screen.dart']);
    });

    test('no media (clips, tiles, recordings) anywhere in the app tree, and none declared as assets', () {
      final bad = <String>[];
      for (final dir in ['lib', 'assets', 'test', 'tool', 'ios/Runner']) {
        if (!Directory(dir).existsSync()) continue;
        for (final e in Directory(dir).listSync(recursive: true).whereType<File>()) {
          if (isForbiddenMedia(e.path)) bad.add(e.path);
        }
      }
      expect(bad, isEmpty);
      final pubspec = File('pubspec.yaml').readAsStringSync();
      final assets = RegExp(r'^\s+- (assets/\S+)', multiLine: true).allMatches(pubspec).map((m) => m.group(1)!).toList();
      expect(assets, ['assets/fixtures/', 'assets/style/'], reason: 'only the JSON fixtures and the style are bundled');
    });

    test('the push scripts and the clip folder are outside the tracked app tree', () {
      expect(File('tool/push_dev_clips.sh').existsSync(), isTrue);
      expect(File('tool/push_dev_tiles.sh').existsSync(), isTrue);
      expect(Directory('clips').existsSync(), isFalse);
      expect(Directory('assets/clips').existsSync(), isFalse);
    });
  });
}
