import 'package:flutter/material.dart';

import 'flyover/player_controller.dart';
import 'flyover/timeline.dart';

/// What to call each source on screen.
String sourceLabel(SegmentSource s) => switch (s) {
      SegmentSource.flyover => 'Flyover',
      SegmentSource.streetVideo => 'Street video (local clip)',
      SegmentSource.flyoverFallback => 'Flyover fallback (no local clip)',
      SegmentSource.noPreview => 'No preview for this section',
    };

Color sourceColor(SegmentSource s) => switch (s) {
      SegmentSource.flyover => const Color(0xFF5B8DEF),
      SegmentSource.streetVideo => const Color(0xFF43A047),
      SegmentSource.flyoverFallback => const Color(0xFFF2A33A),
      SegmentSource.noPreview => const Color(0xFF9E9E9E),
    };

/// A strip with one block per segment (width proportional to its time on the clock, colour by source) and a marker at
/// the current position, plus a label for the segment playing: which source is on screen. Tapping a block jumps to it.
class SegmentStrip extends StatelessWidget {
  final FlyoverPlayerController controller;
  const SegmentStrip({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final tl = controller.timeline;
        final cur = tl.segmentAt(controller.positionSec);
        final total = tl.totalDurationSec;
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 12),
          padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
          decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(12)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Section ${tl.segments.indexOf(cur) + 1} of ${tl.segments.length} · ${sourceLabel(cur.source)}',
                key: const Key('segment-label'),
                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 5),
              LayoutBuilder(builder: (context, c) {
                final w = c.maxWidth;
                return SizedBox(
                  height: 14,
                  child: Stack(children: [
                    for (var i = 0; i < tl.segments.length; i++)
                      Positioned(
                        left: tl.segments[i].startT / total * w,
                        width: (tl.segments[i].durationSec / total * w - 2).clamp(2.0, w),
                        top: 2,
                        height: 10,
                        child: GestureDetector(
                          key: Key('segment-$i'),
                          onTap: () => controller.seek(tl.segments[i].startT),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: sourceColor(tl.segments[i].source).withValues(alpha: tl.segments[i] == cur ? 1 : 0.55),
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        ),
                      ),
                    Positioned(
                      key: const Key('segment-marker'),
                      left: (controller.positionSec / total * w - 1).clamp(0.0, w - 2),
                      width: 2,
                      top: 0,
                      height: 14,
                      child: const ColoredBox(color: Colors.white),
                    ),
                  ]),
                );
              }),
            ],
          ),
        );
      },
    );
  }
}
