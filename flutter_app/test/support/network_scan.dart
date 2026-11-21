/// Network and clip boundary (5B-2b): the app talks to ONE configurable API address, plays clips only from local files,
/// and ships no media. These helpers find violations in source text so tests can prove they trip on bad input.
library;

/// Hosts that may appear in `http(s)://` literals in `lib/`: the default API address and the attribution link.
const allowedUrlHosts = <String>{'servermac.tail607401.ts.net', 'www.openstreetmap.org'};

final _url = RegExp(r'https?://([A-Za-z0-9][A-Za-z0-9.\-]*)');

List<String> urlViolations(String path, String source) => [
      for (final m in _url.allMatches(source))
        if (!allowedUrlHosts.contains(m.group(1))) '$path: URL to ${m.group(1)}',
    ];

/// Ways to get a video from anywhere but a local file.
final _networkVideo = <String, RegExp>{
  'VideoPlayerController.network': RegExp(r'VideoPlayerController\s*\.\s*network'),
  'VideoPlayerController.networkUrl': RegExp(r'VideoPlayerController\s*\.\s*networkUrl'),
  'VideoPlayerController.asset': RegExp(r'VideoPlayerController\s*\.\s*asset'),
  'VideoPlayerController.contentUri': RegExp(r'VideoPlayerController\s*\.\s*contentUri'),
  'dataSource url': RegExp(r'dataSource\s*:'),
};

List<String> networkVideoViolations(String path, String source) => [
      for (final e in _networkVideo.entries)
        if (e.value.hasMatch(source)) '$path: ${e.key}',
    ];

/// HTTP machinery outside the API client: the `http` package, `dart:io` HttpClient, sockets, WebSockets.
List<String> httpUseViolations(String path, String source) {
  final bad = <String, RegExp>{
    'package:http': RegExp(r"import\s+'package:http/"),
    'HttpClient': RegExp(r'\bHttpClient\b'),
    'Socket.connect': RegExp(r'\bSocket\s*\.\s*connect\b'),
    'WebSocket': RegExp(r'\bWebSocket\b'),
    'Dio': RegExp(r"import\s+'package:dio/"),
  };
  return [
    for (final e in bad.entries)
      if (e.value.hasMatch(source)) '$path: ${e.key}',
  ];
}

/// Media files that must never be in the app tree (clips, tiles, recordings).
const forbiddenMediaExtensions = <String>['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.pmtiles', '.mbtiles', '.pbf'];

bool isForbiddenMedia(String path) => forbiddenMediaExtensions.any((e) => path.toLowerCase().endsWith(e));
