import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// A local fake preview API in the test process, listening on loopback. Records every request path so tests can prove
/// what the client asked for (never a clip).
class FakeServer {
  late final HttpServer _server;
  final requests = <String>[];
  final bodies = <String>[];

  /// What `/preview` answers: status, content type and body (or a delay before answering).
  int previewStatus = 200;
  String previewBody = '';
  String previewType = 'application/json';
  Duration previewDelay = Duration.zero;
  int healthStatus = 200;
  String healthBody = '{"ok":true}';

  String get url => 'http://127.0.0.1:${_server.port}';

  static Future<FakeServer> start() async {
    final f = FakeServer();
    f._server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    f._server.listen((req) async {
      f.requests.add('${req.method} ${req.uri.path}');
      final body = await utf8.decoder.bind(req).join();
      if (body.isNotEmpty) f.bodies.add(body);
      final res = req.response;
      if (req.uri.path == '/health') {
        res.statusCode = f.healthStatus;
        res.headers.contentType = ContentType.json;
        res.write(f.healthBody);
      } else if (req.uri.path == '/preview' && req.method == 'POST') {
        if (f.previewDelay > Duration.zero) await Future<void>.delayed(f.previewDelay);
        res.statusCode = f.previewStatus;
        res.headers.contentType = ContentType.parse(f.previewType);
        res.write(f.previewBody);
      } else {
        res.statusCode = 404;
        res.write('not found');
      }
      try {
        await res.close();
      } on Object {
        // The client may have given up (timeout test).
      }
    });
    return f;
  }

  Future<void> stop() => _server.close(force: true);
}
