import 'package:flutter/material.dart';

import 'api/preview_api.dart';
import 'flyover/camera_preset.dart';
import 'flyover/manifest.dart';
import 'request/request_screen.dart';
import 'request/settings_store.dart';
import 'scene/scene_loader.dart';

/// Dev switches for evidence runs, set at build time with `--dart-define=NAME=value`:
///
///   AUTOPLAY=true          start the flyover as soon as a preview opens
///   AUTOPLAY_DELAY_SEC=n   wait n seconds (paused at the start) before autoplay begins
///   PLAYBACK_SPEED=0.5|1|2|4starting playback speed (default 1)
///   CAMERA_PRESET=close|standard|high  camera view for this run (otherwise the saved choice, Close by default)
///   FRAME_LOG=true         record frame timings and print the summary when the flyover ends
///   HILLSHADE=off          hide the terrain hillshade
///   API_BASE_URL=url       override the stored API address for this run
///   PRESET=0|1|2           start with this preset filled in
///   AUTO_PREVIEW_SEC=n     press Preview n seconds after launch (hands-free evidence runs)
const bool _autoplay = bool.fromEnvironment('AUTOPLAY');
const int _autoplayDelaySec = int.fromEnvironment('AUTOPLAY_DELAY_SEC');
const String _playbackSpeed = String.fromEnvironment('PLAYBACK_SPEED', defaultValue: '1');
const String _cameraPreset = String.fromEnvironment('CAMERA_PRESET');
const String _hillshade = String.fromEnvironment('HILLSHADE', defaultValue: 'on');
const String _apiBaseUrl = String.fromEnvironment('API_BASE_URL');
const int _preset = int.fromEnvironment('PRESET');
const int _autoPreviewSec = int.fromEnvironment('AUTO_PREVIEW_SEC', defaultValue: -1);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settings = await SettingsStore.open();
  if (_apiBaseUrl.isNotEmpty) await settings.setBaseUrl(_apiBaseUrl);
  runApp(RoutePreviewApp(settings: settings));
}

class RoutePreviewApp extends StatelessWidget {
  final SettingsStore settings;
  final ApiFactory apiFactory;
  final SceneForManifest? sceneForManifestOverride;
  final BundledScene? bundledSceneOverride;

  const RoutePreviewApp({
    super.key,
    required this.settings,
    this.apiFactory = _defaultApi,
    this.sceneForManifestOverride,
    this.bundledSceneOverride,
  });

  static PreviewApi _defaultApi(String baseUrl) => PreviewApi(baseUrl);

  @override
  Widget build(BuildContext context) {
    final hill = _hillshade != 'off';
    return MaterialApp(
      title: 'Route preview',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFFD6336C), useMaterial3: true),
      home: RequestScreen(
        settings: settings,
        apiFactory: apiFactory,
        sceneForManifest: sceneForManifestOverride ??
            (PreviewManifest m, String label) => sceneForManifest(m, sourceLabel: label, hillshade: hill),
        bundledScene: bundledSceneOverride ?? () => loadScene(hillshade: hill),
        autoplay: _autoplay,
        autoplayDelay: const Duration(seconds: _autoplayDelaySec),
        initialSpeed: double.parse(_playbackSpeed),
        initialCameraPreset: _cameraPreset.isEmpty ? null : CameraPreset.parse(_cameraPreset),
        initialPreset: _preset,
        autoPreviewDelay: _autoPreviewSec >= 0 ? const Duration(seconds: _autoPreviewSec) : null,
      ),
    );
  }
}
