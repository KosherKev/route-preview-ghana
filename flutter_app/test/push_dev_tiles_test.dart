import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Runs tool/push_dev_tiles.sh against small fake tile files and a stub `xcrun`, so nothing real is touched.
void main() {
  late Directory root;
  late Directory src;
  late Directory container;
  late Directory bin;

  setUp(() {
    root = Directory.systemTemp.createTempSync('push');
    src = Directory('${root.path}/src')..createSync();
    container = Directory('${root.path}/container')..createSync();
    bin = Directory('${root.path}/bin')..createSync();
    File('${bin.path}/xcrun').writeAsStringSync('#!/bin/bash\necho "${container.path}"\n');
    Process.runSync('chmod', ['+x', '${bin.path}/xcrun']);
  });
  tearDown(() => root.deleteSync(recursive: true));

  const names = ['accra-v2.pmtiles', 'accra.pmtiles', 'accra-terrain.pmtiles'];

  void putFiles({Set<String> skip = const {}}) {
    for (final n in names) {
      if (!skip.contains(n)) File('${src.path}/$n').writeAsStringSync('content of $n');
    }
  }

  void putSums({String? wrongFor}) {
    final lines = <String>[];
    for (final n in names) {
      final f = File('${src.path}/$n');
      final h = f.existsSync()
          ? (Process.runSync('shasum', ['-a', '256', f.path]).stdout as String).split(' ').first
          : 'a' * 64;
      lines.add('${n == wrongFor ? 'b' * 64 : h}  $n');
    }
    File('${src.path}/SHA256SUMS').writeAsStringSync('${lines.join('\n')}\n');
  }

  ProcessResult run() => Process.runSync(
        'bash',
        ['tool/push_dev_tiles.sh', 'booted'],
        environment: {'TILES_SRC': src.path, 'BUNDLE_ID': 'test.app', 'PATH': '${bin.path}:${Platform.environment["PATH"]}'},
      );

  List<String> pushed() {
    final d = Directory('${container.path}/Documents/tiles');
    if (!d.existsSync()) return <String>[];
    final names = [for (final f in d.listSync()) f.path.split('/').last];
    names.sort();
    return names;
  }

  test('pushes v2, v1 and terrain when all three hashes match', () {
    putFiles();
    putSums();
    final r = run();
    expect(r.exitCode, 0, reason: '${r.stdout}${r.stderr}');
    expect(pushed(), ['accra-terrain.pmtiles', 'accra-v2.pmtiles', 'accra.pmtiles']);
    expect(r.stdout, contains('accra-v2.pmtiles'));
  });

  test('refuses, and copies nothing, when the v2 hash does not match SHA256SUMS', () {
    putFiles();
    putSums(wrongFor: 'accra-v2.pmtiles');
    final r = run();
    expect(r.exitCode, isNot(0));
    expect(r.stderr, allOf(contains('HASH MISMATCH for accra-v2.pmtiles'), contains('refusing to copy')));
    expect(pushed(), isEmpty);
  });

  test('refuses when the v1 or the terrain hash does not match', () {
    for (final bad in ['accra.pmtiles', 'accra-terrain.pmtiles']) {
      putFiles();
      putSums(wrongFor: bad);
      final r = run();
      expect(r.exitCode, isNot(0), reason: bad);
      expect(r.stderr, contains('HASH MISMATCH for $bad'));
      expect(pushed(), isEmpty);
    }
  });

  test('refuses when v2 is missing, and when SHA256SUMS has no entry for it', () {
    putFiles(skip: {'accra-v2.pmtiles'});
    putSums();
    var r = run();
    expect(r.exitCode, isNot(0));
    expect(r.stderr, contains('missing'));
    expect(pushed(), isEmpty);

    putFiles();
    File('${src.path}/SHA256SUMS').writeAsStringSync(
        File('${src.path}/SHA256SUMS').readAsLinesSync().where((l) => !l.contains('accra-v2')).join('\n'));
    r = run();
    expect(r.exitCode, isNot(0));
    expect(r.stderr, contains('no SHA256SUMS entry for accra-v2.pmtiles'));
    expect(pushed(), isEmpty);
  });
}
