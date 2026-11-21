import 'dart:io';

import 'package:flutter/material.dart';

import 'clip_player.dart';

/// Shows one street-video clip and keeps it in step with the preview clock.
///
/// The preview clock is the master: [localSec] is where the clip should be. The view starts or pauses the video with
/// [playing], sets its speed, and seeks when the video drifts more than [driftToleranceSec] from the clock (after a
/// scrub, a speed change or a stall). Each clip gets its own player; changing [file] disposes the old one.
class ClipView extends StatefulWidget {
  final File file;
  final double localSec;
  final bool playing;
  final double speed;
  final ClipPlayerFactory factory;
  final double driftToleranceSec;

  const ClipView({
    super.key,
    required this.file,
    required this.localSec,
    required this.playing,
    required this.speed,
    this.factory = defaultClipPlayer,
    this.driftToleranceSec = 0.5,
  });

  @override
  State<ClipView> createState() => _ClipViewState();
}

class _ClipViewState extends State<ClipView> {
  ClipPlayer? _player;
  bool _ready = false;
  bool _failed = false;
  bool _wasPlaying = false;
  double _lastSpeed = 1.0;
  Duration? _lastSeek;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    final p = widget.factory(widget.file);
    _player = p;
    try {
      await p.initialize();
      if (!mounted || _player != p) {
        await p.dispose();
        return;
      }
      await p.seekTo(_toDuration(widget.localSec));
      await p.setSpeed(widget.speed);
      _lastSpeed = widget.speed;
      if (widget.playing) {
        await p.play();
        _wasPlaying = true;
      }
      if (mounted) setState(() => _ready = true);
    } on Object catch (e) {
      debugPrint('[clip] cannot play ${widget.file.path}: $e');
      if (mounted) setState(() => _failed = true);
    }
  }

  static Duration _toDuration(double sec) => Duration(microseconds: (sec.clamp(0, 1e9) * 1e6).round());

  @override
  void didUpdateWidget(ClipView old) {
    super.didUpdateWidget(old);
    final p = _player;
    if (p == null || !_ready) return;
    if (widget.speed != _lastSpeed) {
      _lastSpeed = widget.speed;
      p.setSpeed(widget.speed);
    }
    final drift = (p.position.inMicroseconds / 1e6 - widget.localSec).abs();
    if (drift > widget.driftToleranceSec) {
      final target = _toDuration(widget.localSec);
      if (_lastSeek != target) {
        _lastSeek = target;
        p.seekTo(target);
      }
    }
    if (widget.playing && !_wasPlaying) {
      _wasPlaying = true;
      p.play();
    } else if (!widget.playing && _wasPlaying) {
      _wasPlaying = false;
      p.pause();
    }
  }

  @override
  void dispose() {
    final p = _player;
    _player = null;
    p?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final view = _ready ? _player?.buildView() : null;
    return ColoredBox(
      key: const Key('clip-view'),
      color: Colors.black,
      child: _failed
          ? const Center(child: Text('This clip cannot be played.', style: TextStyle(color: Colors.white70)))
          : view ?? const Center(child: CircularProgressIndicator(color: Colors.white54)),
    );
  }
}
