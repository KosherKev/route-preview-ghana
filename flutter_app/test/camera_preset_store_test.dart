import 'package:flutter_test/flutter_test.dart';
import 'package:route_preview/flyover/camera_preset.dart';
import 'package:route_preview/request/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('Close is the default, and the choice persists across a new store (an app restart)', () async {
    SharedPreferences.setMockInitialValues({});
    final a = await SettingsStore.open();
    expect(a.cameraPreset, CameraPreset.close);
    await a.setCameraPreset(CameraPreset.high);
    expect((await SettingsStore.open()).cameraPreset, CameraPreset.high);
    await a.setCameraPreset(CameraPreset.standard);
    expect((await SettingsStore.open()).cameraPreset, CameraPreset.standard);
  });

  test('an unknown or corrupt saved value falls back to Close', () async {
    SharedPreferences.setMockInitialValues({'camera_preset': 'overhead-9000'});
    expect((await SettingsStore.open()).cameraPreset, CameraPreset.close);
    expect(CameraPreset.parse(null), CameraPreset.close);
    expect(CameraPreset.parse('standard'), CameraPreset.standard);
  });

  test('only the preset name is stored: no location, no coordinates', () async {
    SharedPreferences.setMockInitialValues({});
    final s = await SettingsStore.open();
    await s.setCameraPreset(CameraPreset.standard);
    final p = await SharedPreferences.getInstance();
    expect(p.getKeys(), {'camera_preset'});
    expect(p.getString('camera_preset'), 'standard');
  });
}
