import 'package:flutter/material.dart';

import '../flyover/manifest.dart';
import 'overlay_logic.dart';

IconData _turnIcon(String? direction) => switch (direction) {
      'left' => Icons.turn_left,
      'right' => Icons.turn_right,
      'uturn' => Icons.u_turn_left,
      _ => Icons.straight,
    };

/// The turn and landmark overlays for the camera's route offset: dark, high-contrast cards that stay readable over
/// the map and over video. At most [kMaxOverlays] show at once. Text is the manifest's only.
class OverlayStack extends StatelessWidget {
  final Overlays overlays;
  final double offsetM;
  const OverlayStack({super.key, required this.overlays, required this.offsetM});

  @override
  Widget build(BuildContext context) {
    final items = visibleOverlays(overlays, offsetM);
    return IgnorePointer(
      child: Column(
        key: const Key('overlay-stack'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final item in items)
            Container(
              key: Key('overlay-${item.id}'),
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
              constraints: const BoxConstraints(maxWidth: 300),
              decoration: BoxDecoration(
                color: (item.kind == OverlayKind.turn ? const Color(0xFF1B2A41) : const Color(0xFF2B2B2B)).withValues(alpha: 0.88),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: item.kind == OverlayKind.turn ? const Color(0xFFFFC857) : Colors.white24),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(item.kind == OverlayKind.turn ? _turnIcon(item.direction) : Icons.place_outlined, color: Colors.white, size: 22),
                const SizedBox(width: 8),
                Flexible(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                    Text(item.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
                    if (item.subtitle != null)
                      Text(item.subtitle!, style: const TextStyle(color: Colors.white70, fontSize: 11)),
                  ]),
                ),
              ]),
            ),
        ],
      ),
    );
  }
}
