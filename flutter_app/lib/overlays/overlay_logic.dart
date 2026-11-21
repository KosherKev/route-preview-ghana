import '../flyover/manifest.dart';

/// Turn cue and landmark callouts, shown above the map by their offsets along the route. Text comes only from the
/// manifest (maneuver, direction, street name, landmark name, category, side). These are static preview markers, not
/// guidance: they appear as the preview clock passes their offsets, never from a device position.

/// How many overlays are on screen at once at most.
const int kMaxOverlays = 3;

/// A landmark shows from this far before its offset until a little after it.
const double kLandmarkLeadM = 80;
const double kLandmarkTrailM = 20;

enum OverlayKind { turn, landmark }

class OverlayItem {
  final OverlayKind kind;

  /// Stable id: kind plus position in the manifest list.
  final String id;
  final String title;
  final String? subtitle;

  /// Metres from the camera to the marker (negative once passed).
  final double distanceM;
  final String? direction; // turns only: left | right | straight | uturn
  const OverlayItem({
    required this.kind,
    required this.id,
    required this.title,
    required this.subtitle,
    required this.distanceM,
    this.direction,
  });
}

/// `slight_right` -> `Slight right`, `roundabout_enter` -> `Roundabout enter`.
String humanize(String raw) {
  final words = raw.replaceAll('_', ' ').trim();
  if (words.isEmpty) return words;
  return words[0].toUpperCase() + words.substring(1);
}

String _distance(double m) {
  if (m <= 5) return 'now';
  return 'in ${(m / 10).round() * 10} m';
}

/// The overlays visible when the camera is [offsetM] metres along the route, at most [max] of them.
///
/// - A turn shows while the camera is inside its decision window (`window.startM` to `window.endM`).
/// - A landmark shows from [kLandmarkLeadM] before its offset to [kLandmarkTrailM] after it.
/// - Turns come first (nearest first), then landmarks (nearest first); the rest are dropped, so the screen never
///   crowds. The order of the result is the display order.
List<OverlayItem> visibleOverlays(Overlays overlays, double offsetM, {int max = kMaxOverlays}) {
  final turns = <OverlayItem>[];
  for (var i = 0; i < overlays.turns.length; i++) {
    final t = overlays.turns[i];
    if (offsetM < t.windowStartM || offsetM > t.windowEndM) continue;
    final d = t.offsetM - offsetM;
    final base = humanize(t.maneuver);
    turns.add(OverlayItem(
      kind: OverlayKind.turn,
      id: 'turn-$i',
      title: t.streetName == null ? base : '$base · ${t.streetName}',
      subtitle: _distance(d),
      distanceM: d,
      direction: t.direction,
    ));
  }
  final marks = <OverlayItem>[];
  for (var i = 0; i < overlays.landmarks.length; i++) {
    final l = overlays.landmarks[i];
    final d = l.offsetM - offsetM;
    if (d > kLandmarkLeadM || d < -kLandmarkTrailM) continue;
    marks.add(OverlayItem(
      kind: OverlayKind.landmark,
      id: 'landmark-$i',
      title: l.name,
      subtitle: '${humanize(l.kind ?? l.category)} · on the ${l.side}',
      distanceM: d,
    ));
  }
  int byDistance(OverlayItem a, OverlayItem b) => a.distanceM.abs().compareTo(b.distanceM.abs());
  turns.sort(byDistance);
  marks.sort(byDistance);
  return [...turns, ...marks].take(max).toList();
}
