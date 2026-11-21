/// Product boundary (D5 / README): pre-trip preview only, NEVER synced to live GPS. The app must not request or use
/// location. These pure functions find violations in file contents so a test can prove they trip on bad input.
library;

/// Info.plist / entitlement keys that ask for location access.
final _locationKey = RegExp(
  r'NSLocation\w*UsageDescription|NSLocation\w*|UIRequiredDeviceCapabilities[\s\S]*location-services|UIBackgroundModes[\s\S]*<string>location</string>',
  caseSensitive: false,
);

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

List<String> plistViolations(String plist) => _locationKey
    .allMatches(plist)
    .map(
      (m) => 'location key in plist: ${m.group(0)!.split('\n').first.trim()}',
    )
    .toList();

/// A pubspec.yaml / pubspec.lock mentions a location package as a dependency (`  name:` line).
List<String> packageViolations(String pubspecOrLock) {
  final found = <String>[];
  for (final name in locationPackages) {
    // `  geolocator:` (pubspec) or `  geolocator:` under `packages:` (lock) or a `geolocator_android:` style federated name.
    if (RegExp(
      '^\\s+${RegExp.escape(name)}(_[a-z_]+)?:',
      multiLine: true,
    ).hasMatch(pubspecOrLock)) {
      found.add('location package: $name');
    }
  }
  return found;
}

/// Dart / Swift / Kotlin source that reads, tracks or requests a position, or uses the plugin's location features.
List<String> sourceViolations(String path, String source) {
  final patterns = <String, RegExp>{
    'myLocationEnabled: true': RegExp(r'myLocationEnabled\s*:\s*true'),
    // `(?!\s|...)` stops `\s*` from backtracking to leave a space that would make the negative lookahead pass.
    'tracking mode other than none': RegExp(
      r'myLocationTrackingMode\s*:\s*(?!\s|MyLocationTrackingMode\.none\b)|MyLocationTrackingMode\.(?!none\b)\w+',
    ),
    'LocationPuckMapView': RegExp(r'\bLocationPuckMapView\b'),
    'UserLocation': RegExp(r'\bUserLocation\b|onUserLocationUpdated'),
    'Geolocator': RegExp(r'\bGeolocator\b'),
    'location permission request': RegExp(
      r'Permission\.location\w*|\.requestPermission\(|requestLocationPermission|requestWhenInUseAuthorization|requestAlwaysAuthorization',
    ),
    'CLLocationManager': RegExp(r'\bCLLocationManager\b'),
    'import CoreLocation': RegExp(r'import\s+CoreLocation'),
    'LocationManager (Android)': RegExp(
      r'android\.location|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION',
    ),
    'getCurrentPosition': RegExp(
      r'getCurrentPosition|getPositionStream|onLocationChanged',
    ),
  };
  return [
    for (final e in patterns.entries)
      if (e.value.hasMatch(source)) '$path: ${e.key}',
  ];
}

/// Every `MapLibreMap(` call must set `myLocationEnabled: false` and `myLocationTrackingMode: MyLocationTrackingMode.none`
/// explicitly (not rely on plugin defaults).
List<String> mapWidgetViolations(String path, String source) {
  final out = <String>[];
  for (final m in RegExp(r'\bMapLibreMap\(').allMatches(source)) {
    var depth = 1;
    var i = m.end;
    while (i < source.length && depth > 0) {
      final c = source[i];
      if (c == '(') depth++;
      if (c == ')') depth--;
      i++;
    }
    final args = source.substring(m.end, i);
    if (!RegExp(r'myLocationEnabled\s*:\s*false').hasMatch(args)) {
      out.add('$path: MapLibreMap without explicit myLocationEnabled: false');
    }
    if (!RegExp(r'myLocationTrackingMode\s*:\s*MyLocationTrackingMode\.none\b')
        .hasMatch(args)) {
      out.add(
        '$path: MapLibreMap without explicit myLocationTrackingMode: MyLocationTrackingMode.none',
      );
    }
  }
  return out;
}
