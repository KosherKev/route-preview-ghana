import 'package:flutter/foundation.dart' show ValueListenable;
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
///
/// Layout: two columns, left and right, each at most just under half the width, stacked upwards from the bottom of this
/// widget. A card sits on the side of the road its landmark is on (or the side of its turn), so the route line down
/// the middle of the chase view stays clear, and a turn and a landmark that arrive together do not pile up in one corner.
///
/// Give it either a fixed [offsetM] or a live [offset]; with a live offset it rebuilds only when the set of cards or their
/// text changes, not on every tick.
class OverlayStack extends StatefulWidget {
  final Overlays overlays;
  final double? offsetM;
  final ValueListenable<double>? offset;
  const OverlayStack({super.key, required this.overlays, this.offsetM, this.offset})
      : assert(offsetM != null || offset != null, 'pass offsetM or offset');

  @override
  State<OverlayStack> createState() => _OverlayStackState();
}

class _OverlayStackState extends State<OverlayStack> {
  List<OverlayItem> _items = const [];
  String _signature = '';
  double _lastComputedAt = double.nan;

  @override
  void initState() {
    super.initState();
    widget.offset?.addListener(_onOffset);
    _compute(widget.offsetM ?? widget.offset!.value, force: true);
  }

  @override
  void didUpdateWidget(OverlayStack old) {
    super.didUpdateWidget(old);
    if (old.offset != widget.offset) {
      old.offset?.removeListener(_onOffset);
      widget.offset?.addListener(_onOffset);
    }
    _compute(widget.offsetM ?? widget.offset!.value, force: true);
  }

  @override
  void dispose() {
    widget.offset?.removeListener(_onOffset);
    super.dispose();
  }

  void _onOffset() {
    final o = widget.offset!.value;
    // Distances on the cards are rounded to 10 m, so a metre of movement never changes what is shown.
    if (!_lastComputedAt.isNaN && (o - _lastComputedAt).abs() < 1) return;
    if (_compute(o)) setState(() {});
  }

  bool _compute(double offsetM, {bool force = false}) {
    _lastComputedAt = offsetM;
    final items = visibleOverlays(widget.overlays, offsetM);
    final sig = [for (final i in items) '${i.id}|${i.title}|${i.subtitle}'].join('~');
    if (!force && sig == _signature) return false;
    _signature = sig;
    _items = items;
    return true;
  }

  Widget _card(OverlayItem item) => Container(
        key: Key('overlay-${item.id}'),
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
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
              Text(item.title,
                  maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
              if (item.subtitle != null) Text(item.subtitle!, style: const TextStyle(color: Colors.white70, fontSize: 11)),
            ]),
          ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final left = [for (final i in _items) if (!i.onRight) i];
    final right = [for (final i in _items) if (i.onRight) i];
    return IgnorePointer(
      child: RepaintBoundary(
        child: LayoutBuilder(builder: (context, c) {
          // Just under half the width each: the route line runs down the middle of the screen.
          final colWidth = (c.maxWidth / 2 - 14).clamp(80.0, 300.0);
          Widget column(List<OverlayItem> items, CrossAxisAlignment a) => ConstrainedBox(
                constraints: BoxConstraints(maxWidth: colWidth),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: a, children: [for (final i in items) _card(i)]),
              );
          return Row(
            key: const Key('overlay-stack'),
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [column(left, CrossAxisAlignment.start), column(right, CrossAxisAlignment.end)],
          );
        }),
      ),
    );
  }
}
