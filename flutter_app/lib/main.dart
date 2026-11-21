import 'package:flutter/material.dart';

import 'flyover_screen.dart';
import 'scene/scene.dart';
import 'scene/scene_loader.dart';

/// Dev switches for evidence runs, set at build time with `--dart-define=NAME=value`:
///
///   AUTOPLAY=true          start the flyover on launch
///   AUTOPLAY_DELAY_SEC=n   wait n seconds (paused at the start) before autoplay begins
///   PLAYBACK_SPEED=0.5|1|2 starting playback speed (default 1)
///   HILLSHADE=off          hide the terrain hillshade
///   PROBE_UNSUPPORTED=true try the 3D terrain and sky calls (unsupported on iOS) and show the result
const bool _autoplay = bool.fromEnvironment('AUTOPLAY');
const int _autoplayDelaySec = int.fromEnvironment('AUTOPLAY_DELAY_SEC');
const String _playbackSpeed = String.fromEnvironment('PLAYBACK_SPEED', defaultValue: '1');
const String _hillshade = String.fromEnvironment('HILLSHADE', defaultValue: 'on');
const bool _probeUnsupported = bool.fromEnvironment('PROBE_UNSUPPORTED');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final scene = await loadScene(hillshade: _hillshade != 'off', probeUnsupported: _probeUnsupported);
  runApp(RoutePreviewApp(scene: scene));
}

class RoutePreviewApp extends StatelessWidget {
  final Scene scene;
  const RoutePreviewApp({super.key, required this.scene});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Route preview',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFFD6336C), useMaterial3: true),
      home: FlyoverScreen(
        scene: scene,
        autoplay: _autoplay,
        autoplayDelay: const Duration(seconds: _autoplayDelaySec),
        initialSpeed: double.parse(_playbackSpeed),
      ),
    );
  }
}
