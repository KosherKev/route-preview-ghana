import 'package:flutter/foundation.dart';

import 'timeline.dart';

/// Play / pause / scrub over a [FlyoverTimeline]. Time only moves through [advance] (the screen feeds it from a
/// Ticker), which keeps the maths testable without a clock. Pre-trip preview only: nothing here reads a device position.
class FlyoverPlayerController extends ChangeNotifier {
  final FlyoverTimeline timeline;
  double _position = 0;
  bool _playing = false;

  FlyoverPlayerController(this.timeline);

  double get positionSec => _position;
  double get durationSec => timeline.totalDurationSec;
  bool get playing => _playing;
  bool get atEnd => _position >= durationSec;
  CameraState get camera => timeline.cameraAt(_position);

  /// Starts playing; from the end it restarts at 0.
  void play() {
    if (_playing) return;
    if (atEnd) _position = 0;
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
    notifyListeners();
  }

  /// Moves the clock by [dtSec] while playing; stops at the end.
  void advance(double dtSec) {
    if (!_playing || dtSec <= 0) return;
    _position = timeline.clamp(_position + dtSec);
    if (atEnd) _playing = false;
    notifyListeners();
  }
}
