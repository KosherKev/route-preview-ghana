import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:route_preview/api/preview_api.dart';
import 'package:route_preview/flyover/manifest.dart';
import 'package:route_preview/request/request_screen.dart';
import 'package:route_preview/request/settings_store.dart';
import 'package:route_preview/scene/scene.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/mixed.dart';

String get _real => File('assets/fixtures/accra-real-manifest.json').readAsStringSync();

class Harness {
  final SettingsStore settings;
  final List<String> calls = [];
  final List<Map<String, dynamic>> bodies = [];
  final opened = <Scene>[];
  http.Response Function(http.Request) respond = (r) => http.Response(_real, 200);
  Future<void> Function()? gate;
  Harness(this.settings);

  PreviewApi api(String url) => PreviewApi(url, client: MockClient((r) async {
        calls.add('${r.method} ${r.url.path}');
        if (r.body.isNotEmpty) bodies.add(jsonDecode(r.body) as Map<String, dynamic>);
        await gate?.call();
        if (r.url.path == '/health') return http.Response('{"ok":true}', 200);
        return respond(r);
      }));

  Future<Scene> scene(PreviewManifest m, String label) async => RouteOnlyScene.create(manifest: m, message: 'test', sourceLabel: label);
  Future<Scene> bundled() async => RouteOnlyScene.create(manifest: PreviewManifest.parse(_real), message: 'bundled', sourceLabel: 'Bundled fixture route');
}

Future<Harness> pumpScreen(WidgetTester tester, {Map<String, Object> prefs = const {}}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final h = Harness(await SettingsStore.open());
  await tester.binding.setSurfaceSize(const Size(430, 1100));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: RequestScreen(
      settings: h.settings,
      apiFactory: h.api,
      sceneForManifest: h.scene,
      bundledScene: h.bundled,
      openScene: (ctx, s) async => h.opened.add(s),
    ),
  ));
  return h;
}

Future<void> enter(WidgetTester t, String key, String text) async {
  await t.enterText(find.byKey(Key(key)), text);
  await t.pump();
}

void main() {
  testWidgets('first run: the tailnet URL, the Osu to Korle Gonno preset filled in, three presets and an empty state', (tester) async {
    await pumpScreen(tester);
    expect(tester.widget<TextField>(find.byKey(const Key('base-url'))).controller!.text, kDefaultApiBaseUrl);
    expect(tester.widget<TextFormField>(find.byKey(const Key('origin-lat'))).controller!.text, '5.6037');
    expect(tester.widget<TextFormField>(find.byKey(const Key('dest-lon'))).controller!.text, '-0.2057');
    for (var i = 0; i < 3; i++) {
      expect(find.byKey(Key('preset-$i')), findsOneWidget);
    }
    expect(find.byKey(const Key('empty-state')), findsOneWidget);
    expect(find.textContaining('never asks for your location'), findsOneWidget);
  });

  testWidgets('validation: bad coordinates give clear messages and no request is made', (tester) async {
    final h = await pumpScreen(tester);
    await enter(tester, 'origin-lat', '51.5');
    await enter(tester, 'origin-lon', '2.5');
    await enter(tester, 'dest-lat', 'abc');
    await tester.tap(find.byKey(const Key('preview-button')));
    await tester.pump();
    expect(find.textContaining('Latitude 51.5 is outside Ghana'), findsOneWidget);
    expect(find.textContaining('minus sign'), findsOneWidget);
    expect(find.textContaining('must be a number like 5.6037'), findsOneWidget);
    expect(h.calls, isEmpty);
  });

  testWidgets('tapping a preset fills the form; long-press saves the form into that preset and it persists', (tester) async {
    final h = await pumpScreen(tester);
    await tester.tap(find.byKey(const Key('preset-1')));
    await tester.pump();
    expect(tester.widget<TextFormField>(find.byKey(const Key('origin-lat'))).controller!.text, '5.5600');
    await enter(tester, 'origin-lat', '5.61');
    await tester.longPress(find.byKey(const Key('preset-2')));
    await tester.pumpAndSettle();
    expect(find.text('Saved to preset 3.'), findsOneWidget);
    expect(h.settings.presets[2].originLat, '5.61');
    expect((await SettingsStore.open()).presets[2].originLat, '5.61');
  });

  testWidgets('saving a preset with bad coordinates is refused', (tester) async {
    final h = await pumpScreen(tester);
    await enter(tester, 'origin-lat', 'x');
    await tester.longPress(find.byKey(const Key('preset-0')));
    await tester.pump();
    expect(find.text('Fix the coordinates before saving a preset.'), findsOneWidget);
    expect(h.settings.presets[0], kDefaultPresets[0]);
  });

  testWidgets('Test connection: connected, and a bad address is explained without a request', (tester) async {
    final h = await pumpScreen(tester);
    await tester.tap(find.byKey(const Key('test-connection')));
    await tester.pumpAndSettle();
    expect(find.text('Connected: the API answered /health.'), findsOneWidget);
    expect(h.calls, ['GET /health']);
    await enter(tester, 'base-url', 'servermac');
    await tester.tap(find.byKey(const Key('test-connection')));
    await tester.pumpAndSettle();
    expect(find.textContaining('must start with http'), findsOneWidget);
    expect(h.calls, hasLength(1));
  });

  testWidgets('a working address is stored when the connection test succeeds', (tester) async {
    final h = await pumpScreen(tester);
    await enter(tester, 'base-url', 'http://127.0.0.1:8787/');
    await tester.tap(find.byKey(const Key('test-connection')));
    await tester.pumpAndSettle();
    expect(h.settings.baseUrl, 'http://127.0.0.1:8787');
  });

  testWidgets('Preview: loading state, then the scene opens, with the typed coordinates and costing sent', (tester) async {
    final h = await pumpScreen(tester);
    final gate = Completer<void>();
    h.gate = () => gate.future;
    await tester.tap(find.text('Car'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('preview-button')));
    await tester.pump();
    expect(find.byKey(const Key('loading')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('preview-button'))).onPressed, isNull, reason: 'no double submit');
    gate.complete();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('loading')), findsNothing);
    expect(h.opened, hasLength(1));
    expect(h.opened.single.sourceLabel, 'Live preview API');
    expect(h.bodies.single, {
      'origin': {'lat': 5.6037, 'lon': -0.187},
      'destination': {'lat': 5.56, 'lon': -0.2057},
      'costing': 'auto',
    });
    expect(h.settings.costing, 'auto');
  });

  testWidgets('a 4xx shows the API title and detail and does NOT offer the fixture', (tester) async {
    final h = await pumpScreen(tester);
    h.respond = (_) => http.Response(jsonEncode({'title': 'Ambiguous place', 'detail': 'two matches'}), 422, headers: {'content-type': 'application/problem+json'});
    await tester.tap(find.byKey(const Key('preview-button')));
    await tester.pumpAndSettle();
    expect(find.text('Ambiguous place: two matches'), findsOneWidget);
    expect(find.byKey(const Key('use-fixture')), findsNothing);
    expect(h.opened, isEmpty);
  });

  testWidgets('API unreachable: an error, and the bundled fixture route is offered and labelled', (tester) async {
    final h = await pumpScreen(tester);
    h.respond = (_) => throw http.ClientException('connection refused');
    await tester.tap(find.byKey(const Key('preview-button')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('error-state')), findsOneWidget);
    expect(find.textContaining('Cannot reach the API'), findsOneWidget);
    expect(find.textContaining('bundled fixture route'), findsWidgets);
    expect(find.textContaining('not a live answer'), findsOneWidget);
    await tester.tap(find.byKey(const Key('use-fixture')));
    await tester.pumpAndSettle();
    expect(h.opened.single.sourceLabel, 'Bundled fixture route');
  });

  testWidgets('an invalid manifest from the API is rejected with a readable error', (tester) async {
    final h = await pumpScreen(tester);
    h.respond = (_) => http.Response('{"manifestVersion":9}', 200);
    await tester.tap(find.byKey(const Key('preview-button')));
    await tester.pumpAndSettle();
    expect(find.textContaining('cannot play'), findsOneWidget);
    expect(h.opened, isEmpty);
  });

  testWidgets('settings persist: a stored address and costing are shown on the next start', (tester) async {
    await pumpScreen(tester, prefs: {'api_base_url': 'http://10.0.0.5:8787', 'costing': 'auto'});
    expect(tester.widget<TextField>(find.byKey(const Key('base-url'))).controller!.text, 'http://10.0.0.5:8787');
    final seg = tester.widget<SegmentedButton<String>>(find.byKey(const Key('costing')));
    expect(seg.selected, {'auto'});
  });

  test('the mixed manifest is a valid input for the whole path', () {
    expect(mixedManifest().segments, hasLength(4));
  });
}
