import 'dart:io';

import 'package:flutter/material.dart';
import 'package:route_preview/clips/clip_player.dart';

/// A scripted [ClipPlayer] that records every call, so tests can check how the clip view drives the video.
class FakeClipPlayer implements ClipPlayer {
  final File file;
  final List<String> calls = [];
  Duration _pos = Duration.zero;
  bool _init = false;
  bool disposed = false;
  Object? failOnInit;

  FakeClipPlayer(this.file);

  /// Move the video's own position (as if it drifted or stalled).
  set position(Duration d) => _pos = d;

  @override
  Future<void> initialize() async {
    calls.add('init');
    if (failOnInit != null) throw failOnInit!;
    _init = true;
  }

  @override
  Future<void> seekTo(Duration position) async {
    calls.add('seek ${(position.inMilliseconds / 1000).toStringAsFixed(2)}');
    _pos = position;
  }

  @override
  Future<void> play() async => calls.add('play');
  @override
  Future<void> pause() async => calls.add('pause');
  @override
  Future<void> setSpeed(double speed) async => calls.add('speed $speed');
  @override
  Duration get position => _pos;
  @override
  bool get isInitialized => _init;
  @override
  Future<void> dispose() async {
    disposed = true;
    calls.add('dispose');
  }

  @override
  Widget? buildView() => _init ? const SizedBox.expand(key: Key('fake-video')) : null;
}
