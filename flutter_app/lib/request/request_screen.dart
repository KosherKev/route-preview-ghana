import 'package:flutter/material.dart';

import '../api/preview_api.dart';
import '../clips/clip_player.dart';
import '../flyover/camera_preset.dart';
import '../flyover/manifest.dart';
import '../flyover_screen.dart';
import '../scene/scene.dart';
import 'coordinates.dart';
import 'settings_store.dart';

typedef ApiFactory = PreviewApi Function(String baseUrl);
typedef SceneForManifest = Future<Scene> Function(PreviewManifest manifest, String sourceLabel);
typedef BundledScene = Future<Scene> Function();
typedef OpenScene = Future<void> Function(BuildContext context, Scene scene);

/// The first screen: API address (with a connection test), the route request form, and the three saved presets.
///
/// Pre-trip preview only: the origin and destination are typed (or picked from a preset). There is no use of device
/// location and no map-tap picking.
class RequestScreen extends StatefulWidget {
  final SettingsStore settings;
  final ApiFactory apiFactory;
  final SceneForManifest sceneForManifest;
  final BundledScene bundledScene;
  final ClipPlayerFactory clipPlayerFactory;

  /// How a scene is shown (default: push the flyover screen). Tests replace it to avoid building a native map.
  final OpenScene? openScene;

  /// Dev evidence switches (`--dart-define`): start playing on open, after a delay, at a speed.
  final bool autoplay;
  final Duration autoplayDelay;
  final double initialSpeed;

  /// Dev evidence switch: the camera view for this run (otherwise the saved one).
  final CameraPreset? initialCameraPreset;

  /// Dev evidence switches: fill the form from this preset, and press Preview after [autoPreviewDelay] (null = never).
  final int initialPreset;
  final Duration? autoPreviewDelay;

  const RequestScreen({
    super.key,
    required this.settings,
    required this.apiFactory,
    required this.sceneForManifest,
    required this.bundledScene,
    this.clipPlayerFactory = defaultClipPlayer,
    this.openScene,
    this.autoplay = false,
    this.autoplayDelay = Duration.zero,
    this.initialSpeed = 1.0,
    this.initialCameraPreset,
    this.initialPreset = 0,
    this.autoPreviewDelay,
  });

  @override
  State<RequestScreen> createState() => _RequestScreenState();
}

enum _Phase { idle, loading, error }

class _RequestScreenState extends State<RequestScreen> {
  final _form = GlobalKey<FormState>();
  final _scroll = ScrollController();
  final _statusKey = GlobalKey();
  late final TextEditingController _baseUrl;
  late final TextEditingController _oLat, _oLon, _dLat, _dLon;
  late List<RoutePreset> _presets;
  late String _costing;
  _Phase _phase = _Phase.idle;
  ApiException? _error;
  String? _health;
  bool _healthBusy = false;

  @override
  void initState() {
    super.initState();
    final s = widget.settings;
    _baseUrl = TextEditingController(text: s.baseUrl);
    _presets = s.presets;
    _costing = s.costing;
    final first = _presets[widget.initialPreset.clamp(0, kPresetCount - 1)];
    _oLat = TextEditingController(text: first.originLat);
    _oLon = TextEditingController(text: first.originLon);
    _dLat = TextEditingController(text: first.destLat);
    _dLon = TextEditingController(text: first.destLon);
    final auto = widget.autoPreviewDelay;
    if (auto != null) Future<void>.delayed(auto, () => mounted ? _preview() : null);
  }

  @override
  void dispose() {
    for (final c in [_baseUrl, _oLat, _oLon, _dLat, _dLon]) {
      c.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  void _applyPreset(RoutePreset p) {
    setState(() {
      _oLat.text = p.originLat;
      _oLon.text = p.originLon;
      _dLat.text = p.destLat;
      _dLon.text = p.destLon;
    });
  }

  Future<void> _savePreset(int slot) async {
    if (parseLatLon(_oLat.text, _oLon.text) == null || parseLatLon(_dLat.text, _dLon.text) == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Fix the coordinates before saving a preset.')));
      return;
    }
    final name = 'Saved ${slot + 1}';
    await widget.settings.savePreset(slot, RoutePreset(name, _oLat.text.trim(), _oLon.text.trim(), _dLat.text.trim(), _dLon.text.trim()));
    if (!mounted) return;
    setState(() => _presets = widget.settings.presets);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Saved to preset ${slot + 1}.')));
  }

  /// Brings the loading or error card into view (it sits below the form).
  void _showStatus() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _statusKey.currentContext;
      if (ctx != null && mounted) Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 250), alignment: 1.0);
    });
  }

  Future<void> _testConnection() async {
    final err = PreviewApi.validateBaseUrl(_baseUrl.text);
    if (err != null) {
      setState(() => _health = err);
      return;
    }
    setState(() {
      _healthBusy = true;
      _health = null;
    });
    final api = widget.apiFactory(_baseUrl.text);
    try {
      await api.health();
      await widget.settings.setBaseUrl(_baseUrl.text);
      if (mounted) setState(() => _health = 'Connected: the API answered /health.');
    } on ApiException catch (e) {
      if (mounted) setState(() => _health = 'Not connected: ${e.message}');
    } finally {
      api.close();
      if (mounted) setState(() => _healthBusy = false);
    }
  }

  Future<void> _preview() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    final urlErr = PreviewApi.validateBaseUrl(_baseUrl.text);
    if (urlErr != null) {
      setState(() {
        _phase = _Phase.error;
        _error = ApiException(ApiErrorKind.badResponse, urlErr);
      });
      return;
    }
    final o = parseLatLon(_oLat.text, _oLon.text)!, d = parseLatLon(_dLat.text, _dLon.text)!;
    await widget.settings.setBaseUrl(_baseUrl.text);
    await widget.settings.setCosting(_costing);
    setState(() {
      _phase = _Phase.loading;
      _error = null;
    });
    _showStatus();
    final api = widget.apiFactory(_baseUrl.text);
    try {
      final result = await api.preview(PreviewRequest(originLat: o.lat, originLon: o.lon, destLat: d.lat, destLon: d.lon, costing: _costing));
      final scene = await widget.sceneForManifest(result.manifest, 'Live preview API');
      if (!mounted) return;
      setState(() => _phase = _Phase.idle);
      await _open(scene);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _phase = _Phase.error;
          _error = e;
        });
        _showStatus();
      }
    } finally {
      api.close();
    }
  }

  Future<void> _useFixture() async {
    final scene = await widget.bundledScene();
    if (!mounted) return;
    await _open(scene);
  }

  Future<void> _open(Scene scene) {
    final custom = widget.openScene;
    if (custom != null) return custom(context, scene);
    return Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (ctx) => FlyoverScreen(
        scene: scene,
        clipPlayerFactory: widget.clipPlayerFactory,
        autoplay: widget.autoplay,
        autoplayDelay: widget.autoplayDelay,
        initialSpeed: widget.initialSpeed,
        settings: widget.settings,
        initialCameraPreset: widget.initialCameraPreset,
        onClose: () => Navigator.of(ctx).pop(),
      ),
    ));
  }

  Widget _coordField(String label, TextEditingController c, String? Function(String) validate, Key key) => Expanded(
        child: Padding(
          padding: const EdgeInsets.only(right: 8),
          child: TextFormField(
            key: key,
            controller: c,
            decoration: InputDecoration(labelText: label, isDense: true, border: const OutlineInputBorder(), errorMaxLines: 4),
            keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
            autovalidateMode: AutovalidateMode.onUserInteraction,
            validator: (v) => validate(v ?? ''),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Route preview')),
      body: SafeArea(
        child: ListView(
          controller: _scroll,
          padding: const EdgeInsets.all(16),
          children: [
            Text('Pre-trip preview only. It is never synced to live GPS, and it never asks for your location.', style: theme.textTheme.bodySmall),
            const SizedBox(height: 16),
            Text('Preview API', style: theme.textTheme.titleSmall),
            const SizedBox(height: 6),
            TextField(
              key: const Key('base-url'),
              controller: _baseUrl,
              decoration: const InputDecoration(labelText: 'API address', isDense: true, border: OutlineInputBorder()),
              keyboardType: TextInputType.url,
              autocorrect: false,
            ),
            const SizedBox(height: 8),
            Row(children: [
              OutlinedButton(
                key: const Key('test-connection'),
                onPressed: _healthBusy ? null : _testConnection,
                child: const Text('Test connection'),
              ),
              const SizedBox(width: 12),
              if (_healthBusy) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
            ]),
            if (_health != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(_health!, key: const Key('health-result'), style: theme.textTheme.bodySmall),
              ),
            const Divider(height: 32),
            Text('Route', style: theme.textTheme.titleSmall),
            const SizedBox(height: 6),
            Wrap(spacing: 8, children: [
              for (var i = 0; i < _presets.length; i++)
                GestureDetector(
                  onLongPress: () => _savePreset(i),
                  child: ActionChip(key: Key('preset-$i'), label: Text(_presets[i].name), onPressed: () => _applyPreset(_presets[i])),
                ),
            ]),
            Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 10),
              child: Text('Tap a preset to fill the form. Long-press one to save the current coordinates into it.', style: theme.textTheme.bodySmall),
            ),
            Form(
              key: _form,
              child: Column(children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _coordField('Origin latitude', _oLat, validateLat, const Key('origin-lat')),
                  _coordField('Origin longitude', _oLon, validateLon, const Key('origin-lon')),
                ]),
                const SizedBox(height: 12),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _coordField('Destination latitude', _dLat, validateLat, const Key('dest-lat')),
                  _coordField('Destination longitude', _dLon, validateLon, const Key('dest-lon')),
                ]),
              ]),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              key: const Key('costing'),
              segments: const [
                ButtonSegment(value: 'motor_scooter', label: Text('Motor scooter'), icon: Icon(Icons.two_wheeler)),
                ButtonSegment(value: 'auto', label: Text('Car'), icon: Icon(Icons.directions_car)),
              ],
              selected: {_costing},
              onSelectionChanged: (v) => setState(() => _costing = v.first),
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('preview-button'),
              onPressed: _phase == _Phase.loading ? null : _preview,
              child: const Text('Preview'),
            ),
            const SizedBox(height: 16),
            KeyedSubtree(key: _statusKey, child: _status(theme)),
          ],
        ),
      ),
    );
  }

  Widget _status(ThemeData theme) {
    switch (_phase) {
      case _Phase.idle:
        return Text('Enter two places in Ghana and press Preview. The route and its camera path come from the preview API.',
            key: const Key('empty-state'), style: theme.textTheme.bodySmall);
      case _Phase.loading:
        return Row(key: const Key('loading'), children: const [
          SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: 12),
          Expanded(child: Text('Asking the preview API for a route...')),
        ]);
      case _Phase.error:
        final e = _error!;
        return Card(
          key: const Key('error-state'),
          color: theme.colorScheme.errorContainer,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(e.message, key: const Key('error-message')),
              if (e.canOfferFixture) ...[
                const SizedBox(height: 10),
                Text('You can still try the app with the bundled fixture route. It is a saved example, not a live answer.',
                    style: theme.textTheme.bodySmall),
                const SizedBox(height: 6),
                OutlinedButton(key: const Key('use-fixture'), onPressed: _useFixture, child: const Text('Use bundled fixture route')),
              ],
            ]),
          ),
        );
    }
  }
}
