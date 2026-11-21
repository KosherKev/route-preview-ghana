import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

/// Dev-only probe (Phase 5B-1, report only): can maplibre_gl load a `pmtiles://` vector source on iOS, and draw
/// fill and fill-extrusion layers from it? Not part of the app. Run with
///
///   flutter run -t lib/probe_pmtiles_main.dart -d IOS_SIM_ID \
///     --dart-define=PMTILES_URL=pmtiles://file:///abs/path/probe.pmtiles \
///     --dart-define=PROBE_LAT=5.583184 --dart-define=PROBE_LON=-0.20874
///
/// with a file made by tool/make_probe_pmtiles.py (synthetic, git-ignored). No network, no location.
const String _url = String.fromEnvironment('PMTILES_URL');
final double _lat = double.parse(const String.fromEnvironment('PROBE_LAT', defaultValue: '5.583184'));
final double _lon = double.parse(const String.fromEnvironment('PROBE_LON', defaultValue: '-0.20874'));

void main() => runApp(const MaterialApp(debugShowCheckedModeBanner: false, home: _Probe()));

class _Probe extends StatefulWidget {
  const _Probe();
  @override
  State<_Probe> createState() => _ProbeState();
}

class _ProbeState extends State<_Probe> {
  String _result = 'waiting for map idle...';
  MapLibreMapController? _map;

  String get _style => jsonEncode({
        'version': 8,
        'sources': {
          'probe': {'type': 'vector', 'url': _url},
        },
        'layers': [
          {'id': 'bg', 'type': 'background', 'paint': {'background-color': '#e8e3d6'}},
          {
            'id': 'probe-fill',
            'type': 'fill',
            'source': 'probe',
            'source-layer': 'probe',
            'paint': {'fill-color': '#ff00ff', 'fill-opacity': 0.5},
          },
          {
            'id': 'probe-3d',
            'type': 'fill-extrusion',
            'source': 'probe',
            'source-layer': 'probe',
            'paint': {'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-color': '#3366ff'},
          },
        ],
      });

  Future<void> _query() async {
    final map = _map;
    if (map == null) return;
    final size = MediaQuery.of(context).size;
    final hits = await map.queryRenderedFeaturesInRect(
        Rect.fromLTWH(0, 0, size.width, size.height), ['probe-fill', 'probe-3d'], null);
    final heights = [for (final f in hits) (f['properties'] as Map?)?['height']];
    final msg = 'pmtiles probe: ${hits.length} rendered features, heights=$heights';
    debugPrint('[probe] $msg');
    if (mounted) setState(() => _result = msg);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(children: [
        MapLibreMap(
          styleString: _style,
          initialCameraPosition: CameraPosition(target: LatLng(_lat, _lon), zoom: 14.6, tilt: 55, bearing: 20),
          onMapCreated: (c) => _map = c,
          onMapIdle: () => Future<void>.delayed(const Duration(seconds: 2), _query),
          myLocationEnabled: false,
          compassEnabled: false,
        ),
        SafeArea(
          child: Container(
            margin: const EdgeInsets.all(12),
            padding: const EdgeInsets.all(8),
            color: Colors.black.withValues(alpha: 0.7),
            child: Text(_result, style: const TextStyle(color: Colors.white, fontSize: 12)),
          ),
        ),
      ]),
    );
  }
}
