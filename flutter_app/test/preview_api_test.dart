import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:route_preview/api/preview_api.dart';

import 'support/fake_server.dart';
import 'support/mixed.dart';

const _req = PreviewRequest(originLat: 5.6037, originLon: -0.187, destLat: 5.56, destLon: -0.2057);
String get _manifestText => File('assets/fixtures/accra-real-manifest.json').readAsStringSync();

void main() {
  late FakeServer server;
  setUp(() async => server = await FakeServer.start());
  tearDown(() => server.stop());

  group('against a fake server in this process', () {
    test('success: the manifest is parsed and the request body is what the API documents', () async {
      server.previewBody = _manifestText;
      final api = PreviewApi(server.url);
      final r = await api.preview(_req);
      expect(r.manifest.segments, hasLength(1));
      expect(r.manifest.routeLengthM, closeTo(5727.47, 0.01));
      expect(r.raw, _manifestText);
      expect(server.requests, ['POST /preview']);
      expect(jsonDecode(server.bodies.single), {
        'origin': {'lat': 5.6037, 'lon': -0.187},
        'destination': {'lat': 5.56, 'lon': -0.2057},
        'costing': 'motor_scooter',
      });
      api.close();
    });

    test('the mixed manifest (clips, overlays) is accepted too', () async {
      server.previewBody = File('assets/fixtures/mixed-manifest.json').readAsStringSync();
      final r = await PreviewApi(server.url).preview(_req);
      expect(r.manifest.segments.map((s) => s.playback), ['clip', 'flyover', 'flyover', 'clip']);
    });

    test('4xx problem+json is shown by its title and detail', () async {
      server.previewStatus = 400;
      server.previewType = 'application/problem+json';
      server.previewBody = jsonEncode({'type': 'about:blank', 'title': 'Bad coordinates', 'status': 400, 'detail': 'origin is outside Ghana'});
      final e = await _expectApi(PreviewApi(server.url).preview(_req));
      expect(e.kind, ApiErrorKind.client);
      expect(e.status, 400);
      expect(e.title, 'Bad coordinates');
      expect(e.detail, 'origin is outside Ghana');
      expect(e.message, 'Bad coordinates: origin is outside Ghana');
      expect(e.canOfferFixture, isFalse, reason: 'a rejected request is not an outage');
    });

    test('4xx without a body still gives a readable message', () async {
      server.previewStatus = 403;
      server.previewType = 'text/plain';
      server.previewBody = 'nope';
      final e = await _expectApi(PreviewApi(server.url).preview(_req));
      expect(e.kind, ApiErrorKind.client);
      expect(e.message, contains('403'));
    });

    test('5xx is a server error and offers the fixture', () async {
      server.previewStatus = 502;
      server.previewType = 'application/problem+json';
      server.previewBody = jsonEncode({'title': 'Upstream routing failure', 'status': 502});
      final e = await _expectApi(PreviewApi(server.url).preview(_req));
      expect(e.kind, ApiErrorKind.server);
      expect(e.status, 502);
      expect(e.message, contains('Upstream routing failure'));
      expect(e.canOfferFixture, isTrue);
    });

    test('a slow server times out (and is not retried)', () async {
      server.previewBody = _manifestText;
      server.previewDelay = const Duration(seconds: 2);
      final api = PreviewApi(server.url, timeout: const Duration(milliseconds: 300));
      final e = await _expectApi(api.preview(_req));
      expect(e.kind, ApiErrorKind.timeout);
      expect(e.message, contains('did not answer'));
      expect(e.canOfferFixture, isTrue);
      expect(server.requests.where((r) => r == 'POST /preview').length, 1);
    });

    test('an invalid manifest is rejected with a readable message', () async {
      final j = jsonDecode(_manifestText) as Map<String, dynamic>;
      for (final broken in <void Function(Map<String, dynamic>)>[
        (m) => m['manifestVersion'] = 2,
        (m) => m['current_position'] = {'lat': 1, 'lon': 2},
        (m) => (m['segments'] as List).clear(),
        (m) => (((m['segments'] as List).first as Map)['flyover'] as Map)['keyframes'] = [],
      ]) {
        final copy = jsonDecode(jsonEncode(j)) as Map<String, dynamic>;
        broken(copy);
        server.previewBody = jsonEncode(copy);
        final e = await _expectApi(PreviewApi(server.url).preview(_req));
        expect(e.kind, ApiErrorKind.invalidManifest);
        expect(e.message, startsWith('The API returned a manifest this app cannot play:'));
      }
    });

    test('a 200 that is not JSON is an invalid manifest, not a crash', () async {
      server.previewBody = '<html>proxy error</html>';
      server.previewType = 'text/html';
      final e = await _expectApi(PreviewApi(server.url).preview(_req));
      expect(e.kind, ApiErrorKind.invalidManifest);
    });

    test('health: ok, wrong service, and error status', () async {
      expect(await PreviewApi(server.url).health(), isTrue);
      server.healthBody = '{"hello":"world"}';
      expect((await _expectApi(PreviewApi(server.url).health())).kind, ApiErrorKind.badResponse);
      server.healthStatus = 503;
      expect((await _expectApi(PreviewApi(server.url).health())).kind, ApiErrorKind.server);
    });

    test('offline: a closed port is an offline error', () async {
      final port = (await ServerSocket.bind(InternetAddress.loopbackIPv4, 0));
      final url = 'http://127.0.0.1:${port.port}';
      await port.close();
      final e = await _expectApi(PreviewApi(url).preview(_req));
      expect(e.kind, ApiErrorKind.offline);
      expect(e.canOfferFixture, isTrue);
    });

    test('the client never asks for a clip, and the base URL may have a trailing slash and a path', () async {
      server.previewBody = _manifestText;
      await PreviewApi('${server.url}/').preview(_req);
      await PreviewApi(server.url).health();
      expect(server.requests.where((r) => r.contains('/clips')), isEmpty);
      expect(server.requests, ['POST /preview', 'GET /health']);
    });
  });

  group('retries and edge cases (mock client)', () {
    test('a connection failure is retried exactly once, then reported as offline', () async {
      var calls = 0;
      final api = PreviewApi('http://api.test', client: MockClient((_) async {
        calls++;
        throw http.ClientException('connection refused');
      }));
      final e = await _expectApi(api.preview(_req));
      expect(e.kind, ApiErrorKind.offline);
      expect(calls, 2);
    });

    test('a connection failure that clears on the retry succeeds', () async {
      var calls = 0;
      final api = PreviewApi('http://api.test', client: MockClient((_) async {
        if (++calls == 1) throw const SocketException('network unreachable');
        return http.Response(_manifestText, 200, headers: {'content-type': 'application/json'});
      }));
      expect((await api.preview(_req)).manifest.segments, hasLength(1));
      expect(calls, 2);
    });

    test('HTTP errors and invalid manifests are not retried', () async {
      var calls = 0;
      final api = PreviewApi('http://api.test', client: MockClient((_) async {
        calls++;
        return http.Response('{"title":"boom"}', 500);
      }));
      await _expectApi(api.preview(_req));
      expect(calls, 1);
    });

    test('no auth header or token is sent (D5 is backlog)', () async {
      Map<String, String>? headers;
      final api = PreviewApi('http://api.test', client: MockClient((r) async {
        headers = r.headers;
        return http.Response(_manifestText, 200);
      }));
      await api.preview(_req);
      expect(headers!.keys.map((k) => k.toLowerCase()), ['content-type']);
    });

    test('the base URL is validated', () {
      expect(PreviewApi.validateBaseUrl('https://servermac.tail607401.ts.net:8444'), isNull);
      expect(PreviewApi.validateBaseUrl(' http://127.0.0.1:8787/ '), isNull);
      for (final bad in ['', 'servermac', 'ftp://x', 'http://', 'not a url']) {
        expect(PreviewApi.validateBaseUrl(bad), isNotNull, reason: bad);
      }
      expect(() => PreviewApi('nope'), throwsA(isA<ApiException>()));
    });

    test('the default base URL is the tailnet dev API', () {
      expect(kDefaultApiBaseUrl, 'https://servermac.tail607401.ts.net:8444');
    });

    test('the request JSON uses the costing it was given', () {
      expect(const PreviewRequest(originLat: 1, originLon: 2, destLat: 3, destLon: 4, costing: 'auto').toJson()['costing'], 'auto');
    });

    test('a mixed manifest round trips through the same parser the player uses', () {
      expect(mixedManifest().segments, hasLength(4));
    });
  });
}

Future<ApiException> _expectApi(Future<Object?> f) async {
  try {
    await f;
  } on ApiException catch (e) {
    return e;
  }
  fail('expected an ApiException');
}
