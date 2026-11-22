import 'dart:async';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'clips/clip_player.dart';
import 'diagnostics/frame_monitor.dart';
import 'diagnostics/frame_overlay.dart';
import 'flyover/camera_preset.dart';
import 'flyover/camera_smoother.dart';
import 'flyover/chase_camera.dart';
import 'request/settings_store.dart';
import 'clips/clip_view.dart';
import 'flyover_map.dart';
import 'flyover/player_controller.dart';
import 'flyover/timeline.dart';
import 'info_panel.dart';
import 'overlays/overlay_stack.dart';
import 'player_controls.dart';
import 'prototype_badge.dart';
import 'scene/scene.dart';
import 'segment_strip.dart';

/// Plays a [Scene]'s flyover on a MapLibre Native map. The camera is a chase camera computed from the route polyline
/// (Close, Standard) or the manifest's overhead keyframes (High), smoothed every frame. Pre-trip preview only: no
/// location is requested, shown or used.
class FlyoverScreen extends StatefulWidget {
  final Scene scene;
  final bool autoplay;
  final Duration autoplayDelay;

  /// Starting playback speed, one of [kPlaybackSpeeds] (the on-screen speed control changes it).
  final double initialSpeed;

  /// Builds the player for a street-video clip (tests pass a fake; the app plays local files with `video_player`).
  final ClipPlayerFactory clipPlayerFactory;

  /// Where the chosen camera view is remembered (null = not remembered, e.g. in tests).
  final SettingsStore? settings;

  /// Overrides the saved camera view for this run (dev switch `CAMERA_PRESET`).
  final CameraPreset? initialCameraPreset;

  /// Shown as a back button when set (the request screen closes this screen).
  final VoidCallback? onClose;
  const FlyoverScreen({
    super.key,
    required this.scene,
    this.autoplay = false,
    this.autoplayDelay = Duration.zero,
    this.initialSpeed = 1.0,
    this.clipPlayerFactory = defaultClipPlayer,
    this.settings,
    this.initialCameraPreset,
    this.onClose,
  });

  @override
  State<FlyoverScreen> createState() => _FlyoverScreenState();
}

/// Dev switch: `--dart-define=FRAME_LOG=true` records frame timings from the first frame and prints the summary to the
/// debug console when the flyover ends (never written to a file).
const bool kFrameLog = bool.fromEnvironment('FRAME_LOG');

/// Dev switch for evidence runs: `--dart-define=FRAME_OVERLAY=true` opens with the frame overlay already showing (the
/// overlay is otherwise OFF until a long-press on the segment strip).
const bool kFrameOverlayAtStart = bool.fromEnvironment('FRAME_OVERLAY');

class _FlyoverScreenState extends State<FlyoverScreen> with SingleTickerProviderStateMixin {
  /// The route progress highlight is re-sent at most this often (it re-uploads geometry).
  static const Duration _progressEvery = Duration(milliseconds: 100);

  /// A frame gap longer than this (a hitch, a backgrounded app) moves the clock by this much only, so the preview
  /// never lurches forward after a stall.
  static const double _maxFrameDtSec = 0.1;

  /// A target farther than this (degrees, about 200 m) from the smoothed camera is a jump (a scrub or a section change):
  /// snap instead of gliding across the city.
  static const double _snapDegrees = 0.002;

  late final FlyoverPlayerController _player;
  late final Ticker _ticker;
  late final ChaseCamera? _chase;
  final CameraSmoother _smoother = CameraSmoother();
  late CameraPreset _preset;
  MapLibreMapController? _map;
  bool _styleReady = false;
  bool _cameraBusy = false;
  Duration _last = Duration.zero;
  Duration _lastProgress = Duration.zero;
  int _lastEpoch = -1;
  CameraState? _sent;
  final FrameMonitor _frames = FrameMonitor();
  int _cameraCalls = 0;
  bool _showFrames = kFrameOverlayAtStart;

  /// What changes every frame, each behind its own listenable so only the widget that shows it rebuilds.
  final ValueNotifier<double> _overlayOffset = ValueNotifier<double>(0);
  final ValueNotifier<double> _horizonOpacity = ValueNotifier<double>(0);

  Scene get _scene => widget.scene;

  @override
  void initState() {
    super.initState();
    _preset = widget.initialCameraPreset ?? widget.settings?.cameraPreset ?? CameraPreset.defaultPreset;
    _player = FlyoverPlayerController(FlyoverTimeline.fromManifest(_scene.manifest, availableClips: _scene.availableClips))
      ..setSpeed(widget.initialSpeed)
      ..addListener(_onPlayer);
    final route = _player.timeline.route;
    _chase = (route != null && route.points.length >= 2) ? ChaseCamera(route) : null;
    _ticker = createTicker(_onTick)..start();
    if (kFrameLog || kFrameOverlayAtStart) _frames.enabled = true;
  }

  @override
  void dispose() {
    _ticker.dispose();
    _frames.enabled = false;
    _frames.dispose();
    _overlayOffset.dispose();
    _horizonOpacity.dispose();
    _player
      ..removeListener(_onPlayer)
      ..dispose();
    super.dispose();
  }

  /// Structural player changes only (play, pause, seek, speed, a new section, the end): rebuild the little that depends on them.
  void _onPlayer() {
    if (_player.atEnd && !_player.playing) {
      debugPrint('[flyover] reached end at ${_player.positionSec.toStringAsFixed(1)} s');
      if (kFrameLog) debugPrint('[framelog]\n${_frames.stats.report(preset: _preset.label, note: 'moveCamera calls: $_cameraCalls')}');
    }
    setState(() {});
  }

  /// One tick per vsync: advance the clock, ease the camera towards where it should be, and make one `moveCamera` call.
  void _onTick(Duration elapsed) {
    final dt = ((elapsed - _last).inMicroseconds / 1e6).clamp(0.0, _maxFrameDtSec).toDouble();
    _last = elapsed;
    _player.advance(dt);
    _stepCamera(dt, elapsed);
  }

  /// The camera the current preset wants right now, before smoothing.
  CameraState _targetCamera() {
    final chase = _chase;
    if (chase == null || !_preset.isChase) return _player.camera;
    return chase.targetAt(_player.timeline.chaseOffsetAt(_player.positionSec), _preset);
  }

  void _stepCamera(double dt, Duration elapsed) {
    final target = _targetCamera();
    final prevSent = _sent;
    final jumped = _lastEpoch != _player.seekEpoch ||
        (prevSent != null && ((target.lat - prevSent.lat).abs() > _snapDegrees || (target.lon - prevSent.lon).abs() > _snapDegrees));
    _lastEpoch = _player.seekEpoch;
    final cam = jumped ? _smoother.snap(target) : _smoother.step(target, dt);
    _overlayOffset.value = cam.offsetM;
    _horizonOpacity.value = (((cam.pitchDeg - 50) / 20).clamp(0.0, 1.0) * 50).round() / 50;
    _sent = cam;
    // Nothing moved (paused and settled): no platform call.
    if (prevSent != null && _sameView(prevSent, cam)) return;
    _applyCamera(cam);
    if (_player.playing && elapsed - _lastProgress >= _progressEvery) {
      _lastProgress = elapsed;
      _updateProgress(cam.offsetM);
    }
  }

  static bool _sameView(CameraState a, CameraState b) =>
      (a.lat - b.lat).abs() < 1e-9 &&
      (a.lon - b.lon).abs() < 1e-9 &&
      (a.bearingDeg - b.bearingDeg).abs() < 1e-4 &&
      (a.pitchDeg - b.pitchDeg).abs() < 1e-4 &&
      (a.zoom - b.zoom).abs() < 1e-5;

  /// One `moveCamera` per frame at most: if the previous call is still in flight this frame is skipped and the next one
  /// carries the newest smoothed state (time-based, so nothing slows down).
  Future<void> _applyCamera(CameraState c) async {
    final map = _map;
    if (map == null || !_styleReady || _cameraBusy) return;
    _cameraBusy = true;
    try {
      _cameraCalls++;
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

  /// The completed-route highlight, at 10 Hz and never awaited by the camera.
  Future<void> _updateProgress(double offsetM) async {
    final map = _map;
    if (map == null || !_styleReady) return;
    try {
      await _scene.onProgress(map, offsetM);
    } catch (e) {
      // Cosmetic: never let it stop the camera or autoplay.
      debugPrint('[flyover] progress update failed: $e');
    }
  }

  Future<void> _onStyleLoaded() async {
    final map = _map!;
    await _scene.onStyleLoaded(map);
    _styleReady = true;
    _sent = null;
    _stepCamera(0, _last);
    if (mounted) setState(() {});
    debugPrint('[flyover] style ready');
    if (kDebugMode) debugPrint('[flyover] camera after first move: tilt ${map.cameraPosition?.tilt} zoom ${map.cameraPosition?.zoom}');
    if (widget.autoplay) {
      await Future<void>.delayed(widget.autoplayDelay);
      if (!mounted) return;
      debugPrint('[flyover] autoplay start');
      _player.play();
    }
  }

  void _setPreset(CameraPreset p) {
    if (p == _preset) return;
    setState(() => _preset = p);
    unawaited(widget.settings?.setCameraPreset(p));
  }

  CameraState get _initialCamera {
    final chase = _chase;
    return (chase != null && _preset.isChase) ? chase.targetAt(_player.timeline.chaseOffsetAt(0), _preset) : _player.timeline.cameraAt(0);
  }

  @override
  Widget build(BuildContext context) {
    final first = _initialCamera;
    final horizon = _scene.horizonColor;
    final msg = _scene.fallbackMessage;
    final seg = _player.timeline.segmentAt(_player.positionSec);
    final clipFile = seg.source == SegmentSource.streetVideo ? _scene.clipStore?.fileFor(seg.clipKey!) : null;
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
          // Street video covers the map for its section; the clock stays the master.
          if (clipFile != null)
            Positioned.fill(
              child: ValueListenableBuilder<double>(
                valueListenable: _player.position,
                builder: (context, _, _) => ClipView(
                  key: ValueKey(seg.clipKey),
                  file: clipFile,
                  localSec: _player.timeline.localSec(_player.positionSec),
                  playing: _player.playing,
                  speed: _player.speed,
                  factory: widget.clipPlayerFactory,
                ),
              ),
            ),
          // MapLibre Native on iOS has no fog or sky (see the D3 note): a soft fade at the top of the screen stands in
          // for the horizon haze at high pitch.
          if (horizon != null && clipFile == null)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: 170,
              child: IgnorePointer(
                child: RepaintBoundary(
                  child: ValueListenableBuilder<double>(
                    valueListenable: _horizonOpacity,
                    builder: (context, opacity, child) => Opacity(opacity: opacity, child: child),
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
            ),
          SafeArea(
            child: Align(
              alignment: Alignment.topCenter,
              child: Container(
                key: const Key('banner'),
                margin: EdgeInsets.fromLTRB(widget.onClose == null ? 12 : 56, 12, 60, 12),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(10)),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_scene.manifest.prototype) const PrototypeBadge(key: Key('prototype-badge')),
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
                    // In the banner, not over the map: the destination pin and the route are never covered by it.
                    if (seg.source == SegmentSource.noPreview)
                      const Padding(
                        padding: EdgeInsets.only(top: 6),
                        child: Text('No preview for this section\nThe route continues below.',
                            key: Key('no-preview'),
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                      ),
                  ],
                ),
              ),
            ),
          ),
          if (widget.onClose != null)
            SafeArea(
              child: Align(
                alignment: Alignment.topLeft,
                child: Padding(
                  padding: const EdgeInsets.only(top: 12, left: 8),
                  child: IconButton.filledTonal(
                    key: const Key('close-button'),
                    icon: const Icon(Icons.arrow_back),
                    tooltip: 'Back to the route request',
                    onPressed: widget.onClose,
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
          if (_showFrames)
            SafeArea(
              child: Align(
                alignment: Alignment.topLeft,
                child: Padding(
                  padding: EdgeInsets.only(top: widget.onClose == null ? 96 : 150, left: 8),
                  child: FrameOverlay(
                    monitor: _frames,
                    presetLabel: _preset.label,
                    onCopied: () => ScaffoldMessenger.of(context)
                        .showSnackBar(const SnackBar(content: Text('Frame report copied.'), duration: Duration(seconds: 2))),
                  ),
                ),
              ),
            ),
          // Bottom stack, in one column so the cards always sit above the controls and never over them.
          SafeArea(
            child: Align(
              alignment: Alignment.bottomCenter,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
                    child: OverlayStack(overlays: _scene.manifest.overlays, offset: _overlayOffset),
                  ),
                  SegmentStrip(
                    controller: _player,
                    onLongPress: () {
                      setState(() => _showFrames = !_showFrames);
                      _frames.enabled = _showFrames || kFrameLog;
                    },
                  ),
                  PlayerControls(
                    controller: _player,
                    timelineStartM: _scene.manifest.timelineStartM,
                    timelineEndM: _scene.manifest.timelineEndM,
                    cameraPreset: _preset,
                    onCameraPreset: _setPreset,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
