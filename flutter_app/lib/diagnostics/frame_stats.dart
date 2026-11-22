import 'dart:collection';
import 'dart:ui' show FrameTiming;

/// Frame-time statistics over a sliding window of frames. Pure maths: feed it millisecond values.
///
/// Diagnostics only: nothing here writes a file, sends data or touches a location.
class FrameStats {
  /// How many of the most recent frames the average and percentile cover.
  final int window;
  final Queue<double> _totalMs = Queue();
  double _buildSumMs = 0, _rasterSumMs = 0;
  final Queue<double> _buildMs = Queue(), _rasterMs = Queue();

  /// Frames seen since the start (not windowed).
  int frames = 0;
  final List<double> _run = [];

  /// Frames whose total (build + raster) time exceeded 16.7 ms / 33.4 ms since the start.
  int over16 = 0, over33 = 0;

  FrameStats({this.window = 300});

  static const double budget60Ms = 1000 / 60;
  static const double budget30Ms = 2 * 1000 / 60;

  /// Adds one frame. A frame's cost is the larger of its build and raster time, because the two run on different
  /// threads and the frame rate is set by the slower one; [totalMs] is what the thresholds compare.
  void add({required double buildMs, required double rasterMs}) {
    final total = buildMs > rasterMs ? buildMs : rasterMs;
    frames++;
    _run.add(total);
    if (total > budget60Ms) over16++;
    if (total > budget30Ms) over33++;
    _totalMs.addLast(total);
    _buildMs.addLast(buildMs);
    _rasterMs.addLast(rasterMs);
    _buildSumMs += buildMs;
    _rasterSumMs += rasterMs;
    if (_totalMs.length > window) {
      _totalMs.removeFirst();
      _buildSumMs -= _buildMs.removeFirst();
      _rasterSumMs -= _rasterMs.removeFirst();
    }
  }

  void addTiming(FrameTiming t) => add(
        buildMs: t.buildDuration.inMicroseconds / 1000,
        rasterMs: t.rasterDuration.inMicroseconds / 1000,
      );

  int get windowCount => _totalMs.length;
  double get avgMs => _totalMs.isEmpty ? 0 : _totalMs.fold(0.0, (a, b) => a + b) / _totalMs.length;
  double get avgBuildMs => _buildMs.isEmpty ? 0 : _buildSumMs / _buildMs.length;
  double get avgRasterMs => _rasterMs.isEmpty ? 0 : _rasterSumMs / _rasterMs.length;
  double get maxMs => _totalMs.isEmpty ? 0 : _totalMs.reduce((a, b) => a > b ? a : b);

  /// Nearest-rank percentile (0 < [p] <= 100) of the windowed frame times; 0 when there are none.
  double percentile(double p) {
    if (_totalMs.isEmpty) return 0;
    final sorted = _totalMs.toList()..sort();
    final rank = (p / 100 * sorted.length).ceil().clamp(1, sorted.length);
    return sorted[rank - 1];
  }

  double get p99Ms => percentile(99);

  /// Average and nearest-rank 99th percentile over every frame since the start (not just the window).
  double get runAvgMs => _run.isEmpty ? 0 : _run.fold(0.0, (a, b) => a + b) / _run.length;
  double get runP99Ms {
    if (_run.isEmpty) return 0;
    final sorted = _run.toList()..sort();
    return sorted[(0.99 * sorted.length).ceil().clamp(1, sorted.length) - 1];
  }

  void reset() {
    _totalMs.clear();
    _buildMs.clear();
    _rasterMs.clear();
    _buildSumMs = _rasterSumMs = 0;
    _run.clear();
    frames = over16 = over33 = 0;
  }

  /// Plain-text summary for the clipboard and the notes.
  String report({String? preset, String? note}) => [
        'Route preview frame report',
        if (preset != null) 'camera preset: $preset',
        'frames: $frames (window $windowCount)',
        'avg ${avgMs.toStringAsFixed(1)} ms (build ${avgBuildMs.toStringAsFixed(1)}, raster ${avgRasterMs.toStringAsFixed(1)})',
        'p99 ${p99Ms.toStringAsFixed(1)} ms, max ${maxMs.toStringAsFixed(1)} ms',
        'whole run: avg ${runAvgMs.toStringAsFixed(1)} ms, p99 ${runP99Ms.toStringAsFixed(1)} ms',
        'over 16.7 ms: $over16, over 33.4 ms: $over33',
        ?note,
      ].join('\n');
}
