import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'frame_monitor.dart';

/// The on-device frame-time overlay: average and 99th percentile of the last 300 frames, dropped-frame counts and the
/// current camera preset, with a "Copy report" button that puts a plain-text summary on the clipboard.
///
/// Off by default; the flyover screen shows it only after a long-press on the segment strip. It keeps everything in
/// memory: it never writes a file, sends anything anywhere, or touches location.
class FrameOverlay extends StatelessWidget {
  final FrameMonitor monitor;
  final String presetLabel;

  /// Called after a report has been copied (tests and the snackbar use it).
  final VoidCallback? onCopied;
  const FrameOverlay({super.key, required this.monitor, required this.presetLabel, this.onCopied});

  static const TextStyle _style = TextStyle(color: Colors.white, fontSize: 11, fontFeatures: [FontFeature.tabularFigures()]);

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: ListenableBuilder(
        listenable: monitor,
        builder: (context, _) {
          final s = monitor.stats;
          return Container(
            key: const Key('frame-overlay'),
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
            decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.78), borderRadius: BorderRadius.circular(8)),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('view: $presetLabel', key: const Key('frame-preset'), style: _style),
                Text('avg ${s.avgMs.toStringAsFixed(1)} · p99 ${s.p99Ms.toStringAsFixed(1)} ms', key: const Key('frame-times'), style: _style),
                Text('b ${s.avgBuildMs.toStringAsFixed(1)} · r ${s.avgRasterMs.toStringAsFixed(1)} ms', style: _style),
                Text('>16.7 ms: ${s.over16} · >33 ms: ${s.over33}', key: const Key('frame-dropped'), style: _style),
                Text('of ${s.frames} frames', style: _style),
                SizedBox(
                  height: 28,
                  child: TextButton(
                    key: const Key('frame-copy'),
                    style: TextButton.styleFrom(foregroundColor: Colors.lightBlueAccent, padding: EdgeInsets.zero, minimumSize: const Size(0, 24), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: s.report(preset: presetLabel)));
                      onCopied?.call();
                    },
                    child: const Text('Copy report', style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
