import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:route_preview/flyover_map.dart';

/// Product boundary: the flyover map never uses device location. A native map cannot be pumped in a widget test, so the
/// test builds the widget object (no platform view) and asserts its configuration.
void main() {
  testWidgets('the flyover map has location explicitly off and never tracks', (tester) async {
    final map = buildFlyoverMap(
      styleString: '{"version":8,"sources":{},"layers":[]}',
      initialCameraPosition: const CameraPosition(target: LatLng(5.59, -0.2), zoom: 15),
    );
    expect(map.myLocationEnabled, isFalse);
    expect(map.myLocationTrackingMode, MyLocationTrackingMode.none);
    expect(map.onUserLocationUpdated, isNull, reason: 'no user-location callback is wired');
  });

  testWidgets('the map is driven by the player, not by user gestures', (tester) async {
    final map = buildFlyoverMap(
      styleString: '{"version":8,"sources":{},"layers":[]}',
      initialCameraPosition: const CameraPosition(target: LatLng(5.59, -0.2), zoom: 15),
    );
    expect(map.scrollGesturesEnabled, isFalse);
    expect(map.rotateGesturesEnabled, isFalse);
    expect(map.zoomGesturesEnabled, isFalse);
    expect(map.tiltGesturesEnabled, isFalse);
  });
}
