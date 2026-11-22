
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import 'frame_stats.dart';

/// Collects frame timings from the engine while enabled. Off by default; one instance for the app.
/// Nothing leaves memory except through [FrameStats.report] (the user's explicit "copy report").
class FrameMonitor extends ChangeNotifier {
  final FrameStats stats = FrameStats();
  bool _enabled = false;
  int _sinceNotify = 0;

  bool get enabled => _enabled;

  void _onTimings(List<FrameTiming> timings) {
    for (final t in timings) {
      stats.addTiming(t);
    }
    _sinceNotify += timings.length;
    if (_sinceNotify >= 15) {
      _sinceNotify = 0;
      notifyListeners();
    }
  }

  set enabled(bool v) {
    if (v == _enabled) return;
    _enabled = v;
    if (v) {
      stats.reset();
      SchedulerBinding.instance.addTimingsCallback(_onTimings);
    } else {
      SchedulerBinding.instance.removeTimingsCallback(_onTimings);
    }
    notifyListeners();
  }
}
