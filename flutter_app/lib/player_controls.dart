import 'package:flutter/material.dart';

import 'flyover/player_controller.dart';

/// Play / pause button, scrub slider, clock and the manifest's own route offsets. Rebuilds when [controller] changes.
class PlayerControls extends StatelessWidget {
  final FlyoverPlayerController controller;
  final double timelineStartM;
  final double timelineEndM;
  const PlayerControls({
    super.key,
    required this.controller,
    required this.timelineStartM,
    required this.timelineEndM,
  });

  /// '0.5x', '1x', '2x'.
  static String formatSpeed(double v) => '${v == v.roundToDouble() ? v.toInt() : v}x';

  static String formatClock(double s) => '${s.floor().toString().padLeft(2, '0')}.${((s % 1) * 10).floor()}s';

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => Container(
        margin: const EdgeInsets.all(12),
        padding: const EdgeInsets.fromLTRB(8, 4, 12, 8),
        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(14)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                IconButton(
                  key: const Key('play-pause'),
                  color: Colors.white,
                  icon: Icon(controller.playing ? Icons.pause : Icons.play_arrow),
                  onPressed: controller.playing ? controller.pause : controller.play,
                ),
                Expanded(
                  child: Slider(
                    key: const Key('scrub'),
                    value: controller.positionSec.clamp(0, controller.durationSec).toDouble(),
                    max: controller.durationSec,
                    onChanged: controller.seek,
                  ),
                ),
                Text('${formatClock(controller.positionSec)} / ${formatClock(controller.durationSec)}',
                    key: const Key('clock'), style: const TextStyle(color: Colors.white, fontSize: 12)),
              ],
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('speed', style: TextStyle(color: Colors.white70, fontSize: 11)),
                const SizedBox(width: 8),
                for (final v in kPlaybackSpeeds)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: ChoiceChip(
                      key: Key('speed-$v'),
                      label: Text(formatSpeed(v), style: const TextStyle(fontSize: 12)),
                      selected: controller.speed == v,
                      visualDensity: VisualDensity.compact,
                      onSelected: (_) => controller.setSpeed(v),
                    ),
                  ),
              ],
            ),
            Text(
              'route ${controller.camera.offsetM.toStringAsFixed(0)} m  '
              '(timeline ${timelineStartM.toStringAsFixed(0)} to ${timelineEndM.toStringAsFixed(0)} m)',
              key: const Key('offset'),
              style: const TextStyle(color: Colors.white70, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}
