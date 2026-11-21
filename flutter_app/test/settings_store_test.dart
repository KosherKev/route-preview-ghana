import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/api/preview_api.dart';
import 'package:route_preview/request/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<SettingsStore> open([Map<String, Object> initial = const {}]) async {
  SharedPreferences.setMockInitialValues(initial);
  return SettingsStore.open();
}

void main() {
  test('defaults: the tailnet URL, motor scooter, three presets starting with Osu to Korle Gonno', () async {
    final s = await open();
    expect(s.baseUrl, kDefaultApiBaseUrl);
    expect(s.costing, 'motor_scooter');
    expect(s.presets, hasLength(kPresetCount));
    expect(kPresetCount, 3);
    expect(s.presets.first.name, 'Osu to Korle Gonno');
    expect((s.presets.first.originLat, s.presets.first.originLon, s.presets.first.destLat, s.presets.first.destLon), ('5.6037', '-0.1870', '5.5600', '-0.2057'));
  });

  test('the base URL persists across opens, trailing slashes are dropped, and the default is not stored', () async {
    SharedPreferences.setMockInitialValues({});
    var s = await SettingsStore.open();
    await s.setBaseUrl(' http://127.0.0.1:8787/ ');
    s = await SettingsStore.open(); // same underlying store, as after an app restart
    expect(s.baseUrl, 'http://127.0.0.1:8787');
    await s.setBaseUrl(kDefaultApiBaseUrl);
    expect((await SharedPreferences.getInstance()).containsKey('api_base_url'), isFalse);
    expect((await SettingsStore.open()).baseUrl, kDefaultApiBaseUrl);
  });

  test('costing persists; anything else falls back to motor_scooter', () async {
    final s = await open();
    await s.setCosting('auto');
    expect((await SettingsStore.open()).costing, 'auto');
    await s.setCosting('bicycle');
    expect((await SettingsStore.open()).costing, 'motor_scooter');
  });

  test('a saved preset persists in its slot and the others keep their values', () async {
    final s = await open();
    await s.savePreset(1, const RoutePreset('Mine', '5.60', '-0.20', '5.55', '-0.21'));
    final again = (await SettingsStore.open()).presets;
    expect(again[1], const RoutePreset('Mine', '5.60', '-0.20', '5.55', '-0.21'));
    expect(again[0], kDefaultPresets[0]);
    expect(again[2], kDefaultPresets[2]);
    expect(() => s.savePreset(3, kDefaultPresets[0]), throwsRangeError);
  });

  test('corrupt stored values fall back to the defaults without throwing', () async {
    for (final raw in ['not json', '{"a":1}', '[1,2,3]', '[{"name":5}]']) {
      final s = await open({'route_presets': raw});
      expect(s.presets, kDefaultPresets, reason: raw);
    }
  });

  test('nothing secret or location related is stored', () async {
    final s = await open();
    await s.setBaseUrl('http://x.test');
    await s.setCosting('auto');
    await s.savePreset(0, kDefaultPresets[0]);
    final keys = (await SharedPreferences.getInstance()).getKeys();
    expect(keys, {'api_base_url', 'costing', 'route_presets'});
  });
}
