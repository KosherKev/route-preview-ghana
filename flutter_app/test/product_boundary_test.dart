import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'support/boundary_scan.dart';

/// Product boundary: pre-trip preview only, NEVER synced to live GPS. No location permission strings, no location
/// package, no code reading a position. See README ("Product boundary") and docs/api/preview-manifest.md.
void main() {
  group('scanner catches violations (positive controls)', () {
    test('plist location keys', () {
      for (final key in [
        'NSLocationWhenInUseUsageDescription',
        'NSLocationAlwaysAndWhenInUseUsageDescription',
        'NSLocationAlwaysUsageDescription',
      ]) {
        expect(plistViolations('<dict>\n<key>$key</key>\n<string>x</string>\n</dict>'), isNotEmpty, reason: key);
      }
      expect(plistViolations('<key>UIBackgroundModes</key><array><string>location</string></array>'), isNotEmpty);
    });

    test('location packages in pubspec', () {
      for (final p in ['geolocator', 'location', 'permission_handler', 'geolocator_apple', 'background_location']) {
        expect(packageViolations('dependencies:\n  flutter:\n    sdk: flutter\n  $p: ^1.0.0\n'), isNotEmpty, reason: p);
      }
    });

    test('code that reads a position', () {
      expect(sourceViolations('a.dart', 'MapLibreMap(myLocationEnabled: true)'), isNotEmpty);
      expect(sourceViolations('a.dart', 'await Geolocator.getCurrentPosition()'), isNotEmpty);
      expect(sourceViolations('A.swift', 'import CoreLocation\nlet m = CLLocationManager()'), isNotEmpty);
    });

    test('a clean file passes', () {
      expect(plistViolations('<dict><key>CFBundleName</key><string>route_preview</string></dict>'), isEmpty);
      expect(packageViolations('dependencies:\n  flutter:\n    sdk: flutter\n  maplibre_gl: 0.28.0\n'), isEmpty);
      expect(sourceViolations('a.dart', 'MapLibreMap(myLocationEnabled: false)'), isEmpty);
    });
  });

  group('this app', () {
    List<File> files(String dir, bool Function(String path) keep) {
      final d = Directory(dir);
      if (!d.existsSync()) return const [];
      return d.listSync(recursive: true).whereType<File>().where((f) => keep(f.path)).toList();
    }

    test('Info.plist and every iOS plist / entitlements file has no location keys', () {
      // The app's own files only: vendored CocoaPods (binary plists) and build output are not ours to scan.
      bool vendored(String p) => p.contains('/Pods/') || p.contains('/.symlinks/') || p.contains('/build/');
      final plists = files('ios', (p) => (p.endsWith('.plist') || p.endsWith('.entitlements')) && !vendored(p));
      expect(plists.any((f) => f.path.endsWith('Runner/Info.plist')), isTrue, reason: 'Info.plist must exist and be scanned');
      for (final f in plists) {
        expect(plistViolations(f.readAsStringSync()), isEmpty, reason: f.path);
      }
    });

    test('pubspec.yaml and pubspec.lock list no location package', () {
      for (final name in ['pubspec.yaml', 'pubspec.lock']) {
        expect(packageViolations(File(name).readAsStringSync()), isEmpty, reason: name);
      }
    });

    test('app sources (Dart, Swift, Kotlin) never read or request a position', () {
      final sources = [
        ...files('lib', (p) => p.endsWith('.dart')),
        ...files('ios/Runner', (p) => p.endsWith('.swift') || p.endsWith('.m') || p.endsWith('.h')),
      ];
      expect(sources, isNotEmpty);
      for (final f in sources) {
        expect(sourceViolations(f.path, f.readAsStringSync()), isEmpty, reason: f.path);
      }
    });

    test('the README states the boundary', () {
      final readme = File('README.md').readAsStringSync().toLowerCase();
      expect(readme, contains('never synced to live gps'));
    });
  });
}
