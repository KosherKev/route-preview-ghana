import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'fixture.dart';
import 'flyover_map.dart';
import 'flyover/player_controller.dart';
import 'flyover/timeline.dart';
import 'player_controls.dart';

/// Plays the fixture flyover on a MapLibre Native map: 3D building extrusions plus the route line, camera driven
/// by the manifest's keyframes. Pre-trip preview only: no location is requested, shown or used.
class FlyoverScreen extends StatefulWidget {
  final Fixture fixture;
  final bool autoplay;
  final Duration autoplayDelay;

  /// Starting playback speed, one of [kPlaybackSpeeds] (the on-screen speed control changes it).
  final double initialSpeed;
  const FlyoverScreen({
    super.key,
    required this.fixture,
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

  @override
  void initState() {
    super.initState();
    _player = FlyoverPlayerController(FlyoverTimeline.fromManifest(widget.fixture.manifest))
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
    } finally {
      _cameraBusy = false;
    }
  }

  Future<void> _onStyleLoaded() async {
    final map = _map!;
    await map.addGeoJsonSource('route', widget.fixture.route);
    await map.addGeoJsonSource('buildings', widget.fixture.buildings);
    await map.addLineLayer(
      'route',
      'route-line',
      const LineLayerProperties(lineColor: '#d6336c', lineWidth: 5, lineCap: 'round', lineJoin: 'round'),
    );
    await map.addFillExtrusionLayer(
      'buildings',
      'buildings-3d',
      const FillExtrusionLayerProperties(
        // Real OSM heights are rare, so most buildings carry a flagged default: colour them differently so the
        // extrusions never read as measured heights.
        fillExtrusionColor: [
          'case',
          ['==', ['get', 'height_source'], 'osm'],
          '#8fa3b8',
          '#cfc6b4',
        ],
        fillExtrusionHeight: ['get', 'height'],
        fillExtrusionBase: 0,
        fillExtrusionOpacity: 0.92,
      ),
    );
    _styleReady = true;
    await _moveCamera();
    debugPrint('[flyover] style ready, ${(widget.fixture.buildings['features'] as List).length} buildings');
    if (widget.autoplay) {
      await Future<void>.delayed(widget.autoplayDelay);
      if (!mounted) return;
      debugPrint('[flyover] autoplay start');
      _player.play();
    }
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.fixture;
    final first = _player.timeline.cameraAt(0);
    return Scaffold(
      body: Stack(
        children: [
          buildFlyoverMap(
            styleString: f.styleJson,
            initialCameraPosition: CameraPosition(
              target: LatLng(first.lat, first.lon),
              zoom: first.zoom,
              bearing: first.bearingDeg,
              tilt: first.pitchDeg,
            ),
            onMapCreated: (c) => _map = c,
            onStyleLoadedCallback: _onStyleLoaded,
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topCenter,
              child: Container(
                margin: const EdgeInsets.all(12),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(10)),
                child: const Text(
                  'SYNTHETIC FIXTURE · pre-trip preview\nBuilding heights are approximate (most use a default).',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white, fontSize: 12),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.bottomCenter,
              child: PlayerControls(
                controller: _player,
                timelineStartM: f.manifest.timelineStartM,
                timelineEndM: f.manifest.timelineEndM,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
