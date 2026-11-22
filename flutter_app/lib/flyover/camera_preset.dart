/// The three camera views the rider can pick. Close is the default.
///
/// Close and Standard are chase cameras computed from the route polyline ([ChaseCamera]); High is the manifest's own
/// overhead flyover keyframes, exactly as before.
enum CameraPreset {
  close('Close', zoom: 17.25, pitchDeg: 62, lookAheadM: 35, headingAheadM: 40),
  standard('Standard', zoom: 16, pitchDeg: 55, lookAheadM: 70, headingAheadM: 70),
  high('High', zoom: null, pitchDeg: null, lookAheadM: 0, headingAheadM: 0);

  final String label;

  /// Chase zoom and pitch; null for [high] (the keyframes decide).
  final double? zoom;
  final double? pitchDeg;

  /// How far ahead of the route position the camera centre sits, in metres of route: about one third of the road
  /// length the screen shows at this zoom and pitch. The route position then sits low on the screen, with the road
  /// ahead above it.
  final double lookAheadM;

  /// The heading comes from the route direction up to this many metres ahead of the route position (a few tens of metres).
  final double headingAheadM;

  const CameraPreset(this.label, {required this.zoom, required this.pitchDeg, required this.lookAheadM, required this.headingAheadM});

  bool get isChase => this != high;

  static const CameraPreset defaultPreset = CameraPreset.close;

  /// The preset saved under [name], or [defaultPreset] for null or anything unknown.
  static CameraPreset parse(String? name) {
    for (final p in values) {
      if (p.name == name) return p;
    }
    return defaultPreset;
  }
}
