import 'package:flutter/foundation.dart';

import 'timeline.dart';

/// User-selectable playback speeds, as multiples of the default effective speed ([kFlyoverEffectiveSpeedMps]).
const List<double> kPlaybackSpeeds = [0.5, 1.0, 2.0, 4.0];

/// Play / pause / scrub over a [FlyoverTimeline]. Time only moves through [advance] (the screen feeds it from a
/// Ticker), which keeps the maths testable without a clock. Pre-trip preview only: nothing here reads a device position.
///
/// Two kinds of change, so widgets rebuild only for what changed: the controller itself notifies for STRUCTURAL changes
/// (play, pause, seek, speed, a new section, the end), while [position] is a [ValueListenable] that moves on every tick
/// (the slider, clock and strip marker listen to it; nothing else needs to).
class FlyoverPlayerController extends ChangeNotifier {
  final FlyoverTimeline timeline;
  double _position = 0;
  bool _playing = false;
  double _speed = 1.0;
  final ValueNotifier<double> _positionNotifier = ValueNotifier<double>(0);
  int _segmentIndex = 0;
  int _seekEpoch = 0;

  FlyoverPlayerController(this.timeline);

  /// The clock position, updated every tick.
  ValueListenable<double> get position => _positionNotifier;

  /// Increases on every seek, so the camera can jump instead of gliding to a scrubbed position.
  int get seekEpoch => _seekEpoch;

  /// Index into [FlyoverTimeline.segments] of the section playing now.
  int get segmentIndex => _segmentIndex;

  @override
  void dispose() {
    _positionNotifier.dispose();
    super.dispose();
  }

  void _sync() {
    _positionNotifier.value = _position;
    _segmentIndex = timeline.segments.indexOf(timeline.segmentAt(_position));
  }

  double get positionSec => _position;
  double get durationSec => timeline.totalDurationSec;
  bool get playing => _playing;

  /// Playback multiplier (1.0 = the default effective speed). Only [advance] uses it; scrubbing is unaffected.
  double get speed => _speed;
  bool get atEnd => _position >= durationSec;
  CameraState get camera => timeline.cameraAt(_position);

  /// Starts playing; from the end it restarts at 0.
  void play() {
    if (_playing) return;
    if (atEnd) {
      _position = 0;
      _seekEpoch++;
      _sync();
    }
    _playing = true;
    notifyListeners();
  }

  void pause() {
    if (!_playing) return;
    _playing = false;
    notifyListeners();
  }

  /// Jumps to [sec] (clamped to 0..duration). Does not change play/pause.
  void seek(double sec) {
    final next = timeline.clamp(sec);
    if (next == _position) return;
    _position = next;
    _seekEpoch++;
    _sync();
    notifyListeners();
  }

  /// Sets the playback multiplier; must be one of [kPlaybackSpeeds].
  void setSpeed(double speed) {
    if (!kPlaybackSpeeds.contains(speed)) {
      throw ArgumentError.value(speed, 'speed', 'must be one of $kPlaybackSpeeds');
    }
    if (speed == _speed) return;
    _speed = speed;
    notifyListeners();
  }

  /// Moves the clock by [dtSec] (wall time) times [speed] while playing; stops at the end.
  void advance(double dtSec) {
    if (!_playing || dtSec <= 0) return;
    _position = timeline.clamp(_position + dtSec * _speed);
    final before = _segmentIndex;
    _sync();
    if (atEnd) _playing = false;
    // Per-tick movement goes through [position]; only a section change or the end is a structural notification.
    if (atEnd || _segmentIndex != before) notifyListeners();
  }
}
