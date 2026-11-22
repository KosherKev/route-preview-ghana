/// Per-step elapsed time of one API request: name lookup, connect, first byte, total. Pure bookkeeping with an injectable
/// clock so the timing logic is testable; it never leaves memory and sends nothing anywhere.
class StepTracker {
  /// A step that has run longer than this gets a "still trying" message.
  static const Duration slowAfter = Duration(seconds: 5);

  static const String lookup = 'name lookup';
  static const String connect = 'connect';
  static const String firstByte = 'first byte';
  static const String total = 'total';

  /// The shown wording for a slow step. A request to the tailnet address can stall while Tailscale wakes up.
  static const String slowMessage = 'Waking the Tailscale connection, still trying';

  final Duration Function() _now;
  final Duration _start;
  final Map<String, Duration> _done = {};
  final List<String> _order = [];
  String? _current;
  Duration _currentStart = Duration.zero;
  Duration? _finishedAt;

  /// [now] is a monotonic clock (default: a stopwatch).
  StepTracker({Duration Function()? now})
      : _now = now ?? _stopwatchClock(),
        _start = (now ?? _stopwatchClock())();

  static Duration Function() _stopwatchClock() {
    final sw = Stopwatch()..start();
    return () => sw.elapsed;
  }

  /// Starts [step]; a step still running is ended first.
  void begin(String step) {
    if (_current != null) end();
    _current = step;
    _currentStart = _now();
  }

  /// Ends the running step and records how long it took.
  void end() {
    final c = _current;
    if (c == null) return;
    _done[c] = _now() - _currentStart;
    _order.remove(c); // a retried step shows once, with its latest time
    _order.add(c);
    _current = null;
  }

  /// Ends everything and fixes the total.
  void finish() {
    end();
    _finishedAt = _now();
  }

  String? get currentStep => _current;
  Duration get currentElapsed => _current == null ? Duration.zero : _now() - _currentStart;
  Duration get totalElapsed => (_finishedAt ?? _now()) - _start;
  Duration? elapsedOf(String step) => _done[step];

  /// The step that is taking too long (running over [slowAfter]), or null.
  String? get slowStep => _current != null && currentElapsed > slowAfter ? _current : null;

  /// [slowMessage] while a step is over [slowAfter], else null.
  String? get warning => slowStep == null ? null : slowMessage;

  static String _fmt(Duration d) => '${(d.inMilliseconds / 1000).toStringAsFixed(1)} s';

  /// `name lookup 0.0 s · connect 0.2 s · first byte (running) 1.4 s · total 1.9 s`
  String summary() {
    final parts = <String>[
      for (final s in _order) '$s ${_fmt(_done[s]!)}',
      if (_current != null) '$_current (running) ${_fmt(currentElapsed)}',
      '$total ${_fmt(totalElapsed)}',
    ];
    return parts.join(' · ');
  }
}
