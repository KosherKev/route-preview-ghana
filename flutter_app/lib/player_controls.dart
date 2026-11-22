import 'package:flutter/material.dart';

import 'flyover/camera_preset.dart';
import 'flyover/player_controller.dart';

/// Play / pause button, scrub slider, clock and the manifest's own route offsets. Rebuilds when [controller] changes.
class PlayerControls extends StatelessWidget {
  final FlyoverPlayerController controller;
  final double timelineStartM;
  final double timelineEndM;

  /// The camera view in use and what to do when the rider picks another (null hides the picker).
  final CameraPreset? cameraPreset;
  final ValueChanged<CameraPreset>? onCameraPreset;
  const PlayerControls({
    super.key,
    required this.controller,
    required this.timelineStartM,
    required this.timelineEndM,
    this.cameraPreset,
    this.onCameraPreset,
  });

  /// '0.5x', '1x', '2x', '4x'.
  static String formatSpeed(double v) => '${v == v.roundToDouble() ? v.toInt() : v}x';

  static String formatClock(double s) => '${s.floor().toString().padLeft(2, '0')}.${((s % 1) * 10).floor()}s';

  @override
  Widget build(BuildContext context) {
    // Structural changes (play, pause, speed) rebuild the buttons; the per-tick slider, clock and offset text listen to
    // the position alone, each in its own repaint boundary, so a tick never rebuilds the rest.
    return RepaintBoundary(
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 4, 12, 8),
        padding: const EdgeInsets.fromLTRB(8, 0, 12, 6),
        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(14)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                ListenableBuilder(
                  listenable: controller,
                  builder: (context, _) => IconButton(
                    key: const Key('play-pause'),
                    color: Colors.white,
                    icon: Icon(controller.playing ? Icons.pause : Icons.play_arrow),
                    onPressed: controller.playing ? controller.pause : controller.play,
                  ),
                ),
                Expanded(
                  child: ValueListenableBuilder<double>(
                    valueListenable: controller.position,
                    builder: (context, pos, _) => Slider(
                      key: const Key('scrub'),
                      value: pos.clamp(0, controller.durationSec).toDouble(),
                      max: controller.durationSec,
                      onChanged: controller.seek,
                    ),
                  ),
                ),
                ValueListenableBuilder<double>(
                  valueListenable: controller.position,
                  builder: (context, pos, _) => Text('${formatClock(pos)} / ${formatClock(controller.durationSec)}',
                      key: const Key('clock'), style: const TextStyle(color: Colors.white, fontSize: 12)),
                ),
              ],
            ),
            ListenableBuilder(
              listenable: controller,
              builder: (context, _) => Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('speed', style: TextStyle(color: Colors.white70, fontSize: 11)),
                  const SizedBox(width: 6),
                  for (final v in kPlaybackSpeeds)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: ChoiceChip(
                        key: Key('speed-$v'),
                        label: Text(formatSpeed(v), style: const TextStyle(fontSize: 12)),
                        selected: controller.speed == v,
                        visualDensity: VisualDensity.compact,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        padding: EdgeInsets.zero,
                        onSelected: (_) => controller.setSpeed(v),
                      ),
                    ),
                ],
              ),
            ),
            if (cameraPreset != null)
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('view', style: TextStyle(color: Colors.white70, fontSize: 11)),
                  const SizedBox(width: 6),
                  for (final p in CameraPreset.values)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: ChoiceChip(
                        key: Key('preset-${p.name}'),
                        label: Text(p.label, style: const TextStyle(fontSize: 12)),
                        selected: cameraPreset == p,
                        visualDensity: VisualDensity.compact,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        padding: EdgeInsets.zero,
                        onSelected: (_) => onCameraPreset?.call(p),
                      ),
                    ),
                ],
              ),
            ValueListenableBuilder<double>(
              valueListenable: controller.position,
              builder: (context, _, _) => Text(
                'route ${controller.camera.offsetM.toStringAsFixed(0)} m  '
                '(timeline ${timelineStartM.toStringAsFixed(0)} to ${timelineEndM.toStringAsFixed(0)} m)',
                key: const Key('offset'),
                style: const TextStyle(color: Colors.white70, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
