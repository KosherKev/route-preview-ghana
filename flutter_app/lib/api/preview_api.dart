import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../flyover/manifest.dart';

/// The tailnet dev API (docs/api/tailnet-dev.md). This is the app's default base URL; it is configurable in the app and
/// is the only server URL in the code. There is no authentication yet (D5 is backlog), so no header is sent.
const String kDefaultApiBaseUrl = 'https://servermac.tail607401.ts.net:8444';

enum ApiErrorKind {
  /// No connection (DNS, refused, no network, TLS failure) even after one retry.
  offline,

  /// The request took longer than the timeout.
  timeout,

  /// A 4xx answer: the server's problem+json `title` and `detail` are in [ApiException.title] and [ApiException.detail].
  client,

  /// A 5xx answer.
  server,

  /// A 200 whose body is not a valid manifest.
  invalidManifest,

  /// Anything else that is not a usable answer (wrong content, bad base URL).
  badResponse,
}

class ApiException implements Exception {
  final ApiErrorKind kind;
  final int? status;
  final String? title;
  final String? detail;

  /// A readable message for the screen.
  final String message;

  const ApiException(this.kind, this.message, {this.status, this.title, this.detail});

  /// True when offering the bundled fixture route makes sense (the API cannot be used right now).
  bool get canOfferFixture =>
      kind == ApiErrorKind.offline || kind == ApiErrorKind.timeout || kind == ApiErrorKind.server || kind == ApiErrorKind.badResponse;

  @override
  String toString() => 'ApiException(${kind.name}): $message';
}

class PreviewRequest {
  final double originLat, originLon, destLat, destLon;

  /// `motor_scooter` or `auto`.
  final String costing;
  const PreviewRequest({
    required this.originLat,
    required this.originLon,
    required this.destLat,
    required this.destLon,
    this.costing = 'motor_scooter',
  });

  Map<String, dynamic> toJson() => {
        'origin': {'lat': originLat, 'lon': originLon},
        'destination': {'lat': destLat, 'lon': destLon},
        'costing': costing,
      };
}

class PreviewResult {
  final PreviewManifest manifest;

  /// The manifest exactly as received.
  final String raw;
  const PreviewResult(this.manifest, this.raw);
}

/// Small typed client for `GET /health` and `POST /preview`.
///
/// - Every call has a timeout ([timeout], default 20 s; `/health` uses [healthTimeout], 6 s).
/// - A connection failure is retried once; timeouts, HTTP errors and invalid manifests are not.
/// - A 4xx problem+json is shown by its `title` and `detail`; a 5xx is a server error; a 200 is parsed with the same
///   [PreviewManifest.parse] rules the player uses and rejected with a readable message if invalid.
/// - It never requests a clip: the API does not serve them (the clip door answers 403 by design) and the app plays
///   clips only from files already on the device.
class PreviewApi {
  final Uri baseUri;
  final http.Client _client;
  final Duration timeout;
  final Duration healthTimeout;

  PreviewApi(
    String baseUrl, {
    http.Client? client,
    this.timeout = const Duration(seconds: 20),
    this.healthTimeout = const Duration(seconds: 6),
  })  : baseUri = _parseBase(baseUrl),
        _client = client ?? http.Client();

  static Uri _parseBase(String raw) {
    final s = raw.trim().replaceAll(RegExp(r'/+$'), '');
    final u = Uri.tryParse(s);
    if (u == null || !(u.scheme == 'http' || u.scheme == 'https') || u.host.isEmpty) {
      throw const ApiException(ApiErrorKind.badResponse, 'The API address must start with http:// or https:// and name a host.');
    }
    return u;
  }

  /// Checks a base URL the way the settings screen does; null when fine, else a message.
  static String? validateBaseUrl(String raw) {
    try {
      _parseBase(raw);
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  void close() => _client.close();

  Uri _uri(String path) => baseUri.replace(path: '${baseUri.path}$path');

  Future<http.Response> _send(Future<http.Response> Function() call, Duration limit) async {
    for (var attempt = 0;; attempt++) {
      try {
        return await call().timeout(limit);
      } on TimeoutException {
        throw ApiException(ApiErrorKind.timeout, 'The API did not answer within ${limit.inSeconds} seconds.');
      } on SocketException catch (e) {
        if (attempt == 0) continue;
        throw ApiException(ApiErrorKind.offline, 'Cannot reach the API (${e.message}).');
      } on http.ClientException catch (e) {
        if (attempt == 0) continue;
        throw ApiException(ApiErrorKind.offline, 'Cannot reach the API (${e.message}).');
      } on HandshakeException catch (e) {
        throw ApiException(ApiErrorKind.offline, 'Secure connection to the API failed (${e.message}).');
      }
    }
  }

  /// True when `GET /health` answers 200 with `{"ok":true}`; otherwise throws an [ApiException].
  Future<bool> health() async {
    final res = await _send(() => _client.get(_uri('/health')), healthTimeout);
    _throwIfError(res);
    final Object? body = _tryJson(res.body);
    if (body is Map && body['ok'] == true) return true;
    throw const ApiException(ApiErrorKind.badResponse, 'The address answered, but it does not look like the preview API (no {"ok":true}).');
  }

  Future<PreviewResult> preview(PreviewRequest request) async {
    final res = await _send(
      () => _client.post(_uri('/preview'), headers: const {'content-type': 'application/json'}, body: jsonEncode(request.toJson())),
      timeout,
    );
    _throwIfError(res);
    try {
      return PreviewResult(PreviewManifest.parse(res.body), res.body);
    } on ManifestFormatException catch (e) {
      throw ApiException(ApiErrorKind.invalidManifest, 'The API returned a manifest this app cannot play: ${e.message}');
    }
  }

  static Object? _tryJson(String body) {
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }

  static void _throwIfError(http.Response res) {
    final code = res.statusCode;
    if (code >= 200 && code < 300) return;
    final body = _tryJson(res.body);
    final title = body is Map ? body['title'] as String? : null;
    final detail = body is Map ? body['detail'] as String? : null;
    if (code >= 400 && code < 500) {
      final text = [?title, ?detail].join(': ');
      throw ApiException(ApiErrorKind.client, text.isEmpty ? 'The API refused the request (HTTP $code).' : text,
          status: code, title: title, detail: detail);
    }
    if (code >= 500) {
      throw ApiException(ApiErrorKind.server, 'The API had a problem (HTTP $code${title == null ? '' : ': $title'}). Try again in a moment.',
          status: code, title: title, detail: detail);
    }
    throw ApiException(ApiErrorKind.badResponse, 'Unexpected answer from the API (HTTP $code).', status: code);
  }
}
