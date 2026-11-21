/// Product boundary (D5 / README): pre-trip preview only, NEVER synced to live GPS. The app must not request or use
/// location. These pure functions find violations in file contents so a test can prove they trip on bad input.
library;

/// Info.plist / entitlement keys that ask for location access.
final _locationKey = RegExp(r'NSLocation\w*UsageDescription|NSLocation\w*|UIRequiredDeviceCapabilities[\s\S]*location-services|UIBackgroundModes[\s\S]*<string>location</string>',
    caseSensitive: false);

/// Dart packages that read or request device location (or the generic permission gateway used for it).
const locationPackages = <String>[
  'geolocator',
  'location',
  'background_location',
  'flutter_background_geolocation',
  'location_permissions',
  'permission_handler',
  'geolocation',
  'flutter_location',
  'loc',
];

List<String> plistViolations(String plist) =>
    _locationKey.allMatches(plist).map((m) => 'location key in plist: ${m.group(0)!.split('\n').first.trim()}').toList();

/// A pubspec.yaml / pubspec.lock mentions a location package as a dependency (`  name:` line).
List<String> packageViolations(String pubspecOrLock) {
  final found = <String>[];
  for (final name in locationPackages) {
    // `  geolocator:` (pubspec) or `  geolocator:` under `packages:` (lock) or a `geolocator_android:` style federated name.
    if (RegExp('^\\s+${RegExp.escape(name)}(_[a-z_]+)?:', multiLine: true).hasMatch(pubspecOrLock)) {
      found.add('location package: $name');
    }
  }
  return found;
}

/// Dart / Swift / Kotlin source that reads or requests a position.
List<String> sourceViolations(String path, String source) {
  final patterns = <String, RegExp>{
    'myLocationEnabled: true': RegExp(r'myLocationEnabled\s*:\s*true'),
    'Geolocator': RegExp(r'\bGeolocator\b'),
    'CLLocationManager': RegExp(r'\bCLLocationManager\b'),
    'import CoreLocation': RegExp(r'import\s+CoreLocation'),
    'requestWhenInUseAuthorization': RegExp(r'requestWhenInUseAuthorization|requestAlwaysAuthorization'),
    'LocationManager (Android)': RegExp(r'android\.location|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION'),
    'getCurrentPosition': RegExp(r'getCurrentPosition|getPositionStream|onLocationChanged'),
  };
  return [
    for (final e in patterns.entries)
      if (e.value.hasMatch(source)) '$path: ${e.key}',
  ];
}
