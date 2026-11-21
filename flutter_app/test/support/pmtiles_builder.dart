import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Builds the first bytes of a PMTiles v3 archive (127-byte header plus metadata) for loader tests. No tiles.
Uint8List pmtilesBytes({
  int tileType = 1,
  int minZoom = 0,
  int maxZoom = 14,
  Map<String, dynamic> metadata = const {},
  bool gzipMetadata = false,
  int version = 3,
  String magic = 'PMTiles',
}) {
  var meta = Uint8List.fromList(utf8.encode(jsonEncode(metadata)));
  if (gzipMetadata) meta = Uint8List.fromList(gzip.encode(meta));
  final header = ByteData(127);
  for (var i = 0; i < magic.length; i++) {
    header.setUint8(i, magic.codeUnitAt(i));
  }
  header.setUint8(7, version);
  header.setUint64(24, 127, Endian.little); // metadata offset
  header.setUint64(32, meta.length, Endian.little);
  header.setUint8(96, 1); // clustered
  header.setUint8(97, gzipMetadata ? 2 : 1); // internal compression
  header.setUint8(98, 1); // tile compression
  header.setUint8(99, tileType);
  header.setUint8(100, minZoom);
  header.setUint8(101, maxZoom);
  return Uint8List.fromList([...header.buffer.asUint8List(), ...meta]);
}

File writePmtiles(Directory dir, String name, Uint8List bytes) {
  final f = File('${dir.path}/$name');
  f.writeAsBytesSync(bytes);
  return f;
}
