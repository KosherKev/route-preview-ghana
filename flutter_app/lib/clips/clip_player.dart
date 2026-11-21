import 'dart:io';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// The few things the hybrid player needs from a video, so tests can use a fake and the real one wraps `video_player`.
abstract class ClipPlayer {
  Future<void> initialize();
  Future<void> seekTo(Duration position);
  Future<void> play();
  Future<void> pause();
  Future<void> setSpeed(double speed);
  Duration get position;
  bool get isInitialized;
  Future<void> dispose();

  /// The picture (a widget that fills its parent); null before [initialize].
  Widget? buildView();
}

typedef ClipPlayerFactory = ClipPlayer Function(File file);

/// Plays a LOCAL file only (`VideoPlayerController.file`). There is no network constructor in this app.
class VideoPlayerClip implements ClipPlayer {
  final VideoPlayerController _c;
  VideoPlayerClip(File file) : _c = VideoPlayerController.file(file, videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true));

  @override
  Future<void> initialize() async {
    await _c.initialize();
    await _c.setVolume(0); // preview clips are silent
    await _c.setLooping(false);
  }

  @override
  Future<void> seekTo(Duration position) => _c.seekTo(position);
  @override
  Future<void> play() => _c.play();
  @override
  Future<void> pause() => _c.pause();
  @override
  Future<void> setSpeed(double speed) => _c.setPlaybackSpeed(speed);
  @override
  Duration get position => _c.value.position;
  @override
  bool get isInitialized => _c.value.isInitialized;
  @override
  Future<void> dispose() => _c.dispose();

  @override
  Widget? buildView() {
    if (!_c.value.isInitialized) return null;
    final size = _c.value.size;
    return FittedBox(
      fit: BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: SizedBox(width: size.width, height: size.height, child: VideoPlayer(_c)),
    );
  }
}

ClipPlayer defaultClipPlayer(File file) => VideoPlayerClip(file);
