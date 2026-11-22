import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../api/preview_api.dart';
import '../flyover/camera_preset.dart';

/// A saved route: name and the four coordinate texts (kept as text so the form shows exactly what was typed).
class RoutePreset {
  final String name;
  final String originLat, originLon, destLat, destLon;
  const RoutePreset(this.name, this.originLat, this.originLon, this.destLat, this.destLon);

  Map<String, dynamic> toJson() => {'name': name, 'oLat': originLat, 'oLon': originLon, 'dLat': destLat, 'dLon': destLon};

  static RoutePreset? fromJson(Object? j) {
    if (j is! Map) return null;
    final n = j['name'], a = j['oLat'], b = j['oLon'], c = j['dLat'], d = j['dLon'];
    if (n is String && a is String && b is String && c is String && d is String) return RoutePreset(n, a, b, c, d);
    return null;
  }

  @override
  bool operator ==(Object other) =>
      other is RoutePreset &&
      other.name == name &&
      other.originLat == originLat &&
      other.originLon == originLon &&
      other.destLat == destLat &&
      other.destLon == destLon;
  @override
  int get hashCode => Object.hash(name, originLat, originLon, destLat, destLon);
}

/// Presets used until the user saves their own. The first is the Osu to Korle Gonno pair of the 5B-2a fixture.
const List<RoutePreset> kDefaultPresets = [
  RoutePreset('Osu to Korle Gonno', '5.6037', '-0.1870', '5.5600', '-0.2057'),
  RoutePreset('Ridge to Jamestown', '5.5600', '-0.1900', '5.5330', '-0.2110'),
  RoutePreset('Airport to Osu', '5.6050', '-0.1710', '5.5560', '-0.1820'),
];

const int kPresetCount = 3;

/// Local settings (shared_preferences): the API base URL, the three presets, the last costing. Never a secret, never a
/// location.
class SettingsStore {
  static const _kBaseUrl = 'api_base_url';
  static const _kPresets = 'route_presets';
  static const _kCosting = 'costing';
  static const _kCameraPreset = 'camera_preset';

  final SharedPreferences _p;
  SettingsStore(this._p);

  static Future<SettingsStore> open() async => SettingsStore(await SharedPreferences.getInstance());

  String get baseUrl => _p.getString(_kBaseUrl) ?? kDefaultApiBaseUrl;

  Future<void> setBaseUrl(String url) async {
    final v = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (v == kDefaultApiBaseUrl) {
      await _p.remove(_kBaseUrl);
    } else {
      await _p.setString(_kBaseUrl, v);
    }
  }

  String get costing => _p.getString(_kCosting) == 'auto' ? 'auto' : 'motor_scooter';
  Future<void> setCosting(String c) => _p.setString(_kCosting, c == 'auto' ? 'auto' : 'motor_scooter');

  /// The camera view last chosen on the flyover screen ([CameraPreset.close] until then, and for any unknown value).
  CameraPreset get cameraPreset => CameraPreset.parse(_p.getString(_kCameraPreset));
  Future<void> setCameraPreset(CameraPreset preset) => _p.setString(_kCameraPreset, preset.name);

  /// Always [kPresetCount] presets: saved ones where valid, the defaults otherwise.
  List<RoutePreset> get presets {
    final raw = _p.getString(_kPresets);
    final out = List<RoutePreset>.of(kDefaultPresets);
    if (raw != null) {
      try {
        final list = jsonDecode(raw);
        if (list is List) {
          for (var i = 0; i < kPresetCount && i < list.length; i++) {
            final p = RoutePreset.fromJson(list[i]);
            if (p != null) out[i] = p;
          }
        }
      } on FormatException {
        // A corrupt value falls back to the defaults.
      }
    }
    return out;
  }

  Future<void> savePreset(int slot, RoutePreset preset) async {
    if (slot < 0 || slot >= kPresetCount) throw RangeError.index(slot, kDefaultPresets, 'slot');
    final all = presets;
    all[slot] = preset;
    await _p.setString(_kPresets, jsonEncode([for (final p in all) p.toJson()]));
  }
}
