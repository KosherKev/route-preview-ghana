import 'dart:math' show Point;

import 'package:maplibre_gl/maplibre_gl.dart';

/// The one place the flyover's MapLibre widget is built, so its product-boundary settings live in one spot and a widget
/// test can assert them without a native platform view.
///
/// Pre-trip preview only: location is OFF and never tracked. Both location settings below are set explicitly (they
/// are the plugin defaults too) because MapLibre.framework
/// links the system location library and the plugin ships a location-puck view; nothing here may turn either on.
/// `test/product_boundary_test.dart` fails if any map widget in `lib/` leaves these implicit or enables them.
MapLibreMap buildFlyoverMap({
  required String styleString,
  required CameraPosition initialCameraPosition,
  MapCreatedCallback? onMapCreated,
  OnStyleLoadedCallback? onStyleLoadedCallback,
}) {
  return MapLibreMap(
    styleString: styleString,
    initialCameraPosition: initialCameraPosition,
    onMapCreated: onMapCreated,
    onStyleLoadedCallback: onStyleLoadedCallback,
    // The player owns the camera; the user scrubs with the slider.
    rotateGesturesEnabled: false,
    scrollGesturesEnabled: false,
    zoomGesturesEnabled: false,
    tiltGesturesEnabled: false,
    compassEnabled: false,
    // Keep the map attribution button (OSM's licence wants attribution visible), lifted above the player controls.
    attributionButtonPosition: AttributionButtonPosition.bottomRight,
    attributionButtonMargins: const Point<double>(8, 300),
    // Product boundary: no device position, ever.
    myLocationEnabled: false,
    myLocationTrackingMode: MyLocationTrackingMode.none,
  );
}
