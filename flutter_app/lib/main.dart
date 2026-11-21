import 'package:flutter/material.dart';

import 'fixture.dart';
import 'flyover_screen.dart';

/// `--dart-define=AUTOPLAY=true` starts the flyover on launch (used for simulator evidence).
const bool _autoplay = bool.fromEnvironment('AUTOPLAY');

/// `--dart-define=AUTOPLAY_DELAY_SEC=n` waits n seconds (paused at the start) before autoplay begins.
const int _autoplayDelaySec = int.fromEnvironment('AUTOPLAY_DELAY_SEC');

/// `--dart-define=PLAYBACK_SPEED=0.5|1|2` sets the starting playback speed (default 1).
const String _playbackSpeed = String.fromEnvironment('PLAYBACK_SPEED', defaultValue: '1');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final fixture = await Fixture.load();
  runApp(RoutePreviewApp(fixture: fixture));
}

class RoutePreviewApp extends StatelessWidget {
  final Fixture fixture;
  const RoutePreviewApp({super.key, required this.fixture});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Route preview',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFFD6336C), useMaterial3: true),
      home: FlyoverScreen(
        fixture: fixture,
        autoplay: _autoplay,
        autoplayDelay: const Duration(seconds: _autoplayDelaySec),
        initialSpeed: double.parse(_playbackSpeed),
      ),
    );
  }
}
