import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'flyover_map.dart';
import 'flyover/player_controller.dart';
import 'flyover/timeline.dart';
import 'info_panel.dart';
import 'player_controls.dart';
import 'scene/scene.dart';

/// Plays a [Scene]'s flyover on a MapLibre Native map: the camera is driven by the manifest's keyframes. Pre-trip
/// preview only: no location is requested, shown or used.
class FlyoverScreen extends StatefulWidget {
  final Scene scene;
  final bool autoplay;
  final Duration autoplayDelay;

  /// Starting playback speed, one of [kPlaybackSpeeds] (the on-screen speed control changes it).
  final double initialSpeed;
  const FlyoverScreen({
    super.key,
    required this.scene,
    this.autoplay = false,
    this.autoplayDelay = Duration.zero,
    this.initialSpeed = 1.0,
  });

  @override
  State<FlyoverScreen> createState() => _FlyoverScreenState();
}

class _FlyoverScreenState extends State<FlyoverScreen> with SingleTickerProviderStateMixin {
  late final FlyoverPlayerController _player;
  late final Ticker _ticker;
  MapLibreMapController? _map;
  bool _styleReady = false;
  bool _cameraBusy = false;
  Duration _last = Duration.zero;

  Scene get _scene => widget.scene;

  @override
  void initState() {
    super.initState();
    _player = FlyoverPlayerController(FlyoverTimeline.fromManifest(_scene.manifest))
      ..setSpeed(widget.initialSpeed)
      ..addListener(_onPlayer);
    _ticker = createTicker((elapsed) {
      _player.advance((elapsed - _last).inMicroseconds / 1e6);
      _last = elapsed;
    });
    _ticker.start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _player
      ..removeListener(_onPlayer)
      ..dispose();
    super.dispose();
  }

  void _onPlayer() {
    _moveCamera();
    if (_player.atEnd && !_player.playing) debugPrint('[flyover] reached end at ${_player.positionSec.toStringAsFixed(1)} s');
    setState(() {});
  }

  /// One camera move at a time: if the previous call is still in flight the next frame will pick up the newest state.
  Future<void> _moveCamera() async {
    final map = _map;
    if (map == null || !_styleReady || _cameraBusy) return;
    _cameraBusy = true;
    try {
      final c = _player.camera;
      await map.moveCamera(CameraUpdate.newCameraPosition(CameraPosition(
        target: LatLng(c.lat, c.lon),
        zoom: c.zoom,
        bearing: c.bearingDeg,
        tilt: c.pitchDeg,
      )));
      try {
        await _scene.onProgress(map, c.offsetM);
      } catch (e) {
        // The completed-route highlight is cosmetic: never let it stop the camera or autoplay.
        debugPrint('[flyover] progress update failed: $e');
      }
    } finally {
      _cameraBusy = false;
    }
  }

  Future<void> _onStyleLoaded() async {
    final map = _map!;
    await _scene.onStyleLoaded(map);
    _styleReady = true;
    await _moveCamera();
    if (mounted) setState(() {});
    debugPrint('[flyover] style ready');
    if (widget.autoplay) {
      await Future<void>.delayed(widget.autoplayDelay);
      if (!mounted) return;
      debugPrint('[flyover] autoplay start');
      _player.play();
    }
  }

  @override
  Widget build(BuildContext context) {
    final first = _player.timeline.cameraAt(0);
    final horizon = _scene.horizonColor;
    final msg = _scene.fallbackMessage;
    return Scaffold(
      body: Stack(
        children: [
          buildFlyoverMap(
            styleString: _scene.styleJson,
            initialCameraPosition: CameraPosition(
              target: LatLng(first.lat, first.lon),
              zoom: first.zoom,
              bearing: first.bearingDeg,
              tilt: first.pitchDeg,
            ),
            onMapCreated: (c) => _map = c,
            onStyleLoadedCallback: _onStyleLoaded,
          ),
          // MapLibre Native on iOS has no fog or sky (see the D3 note): a soft fade at the top of the screen stands in
          // for the horizon haze at high pitch.
          if (horizon != null)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: 170,
              child: IgnorePointer(
                // Only needed when the camera is tilted far enough to show the horizon.
                child: Opacity(
                  opacity: ((_player.camera.pitchDeg - 50) / 20).clamp(0.0, 1.0),
                  child: DecoratedBox(
                    key: const Key('horizon-fade'),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Color(horizon), Color(horizon).withValues(alpha: 0)],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          SafeArea(
            child: Align(
              alignment: Alignment.topCenter,
              child: Container(
                key: const Key('banner'),
                margin: const EdgeInsets.fromLTRB(12, 12, 60, 12),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(10)),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_scene.bannerTitle,
                        textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                    Text(_scene.bannerNote, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 11)),
                    if (msg != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(msg,
                            key: const Key('fallback-message'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Color(0xFFFFD27A), fontSize: 11)),
                      ),
                  ],
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.only(top: 12, right: 8),
                child: IconButton.filledTonal(
                  key: const Key('info-button'),
                  icon: const Icon(Icons.info_outline),
                  tooltip: 'Attribution and notes',
                  onPressed: () => InfoPanel.show(context, _scene),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.bottomCenter,
              child: PlayerControls(
                controller: _player,
                timelineStartM: _scene.manifest.timelineStartM,
                timelineEndM: _scene.manifest.timelineEndM,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
