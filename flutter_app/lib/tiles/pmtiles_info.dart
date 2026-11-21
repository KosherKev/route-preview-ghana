import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

class PmtilesFormatException implements Exception {
  final String message;
  const PmtilesFormatException(this.message);
  @override
  String toString() => 'PmtilesFormatException: $message';
}

/// What the app needs from a PMTiles v3 archive: it is a PMTiles file, its tile type and zoom range, and its metadata
/// (attribution, layers). Reads only the 127-byte header and the metadata block, never the tiles.
class PmtilesInfo {
  /// 1 = MVT (vector), 2 = PNG, 3 = JPEG, 4 = WEBP, 5 = AVIF.
  final int tileType;
  final int minZoom;
  final int maxZoom;
  final Map<String, dynamic> metadata;

  const PmtilesInfo({required this.tileType, required this.minZoom, required this.maxZoom, required this.metadata});

  static const int tileTypeMvt = 1;
  static const int tileTypePng = 2;

  String? get attribution => metadata['attribution'] as String?;

  /// Layer ids of a vector archive (empty for a raster archive).
  List<String> get vectorLayers => [
        for (final l in (metadata['vector_layers'] as List? ?? const [])) (l as Map)['id'] as String,
      ];

  /// Parses [bytes] holding at least the header and the metadata block (the first `metadataOffset + metadataLength` bytes).
  factory PmtilesInfo.parse(Uint8List bytes) {
    if (bytes.length < 127) throw const PmtilesFormatException('shorter than the 127-byte PMTiles header');
    final magic = utf8.decode(bytes.sublist(0, 7), allowMalformed: true);
    if (magic != 'PMTiles') throw const PmtilesFormatException('missing PMTiles magic');
    if (bytes[7] != 3) throw PmtilesFormatException('unsupported PMTiles version ${bytes[7]} (need 3)');
    final d = ByteData.sublistView(bytes);
    final metaOffset = d.getUint64(24, Endian.little);
    final metaLength = d.getUint64(32, Endian.little);
    final internalCompression = bytes[97];
    if (metaOffset + metaLength > bytes.length) {
      throw const PmtilesFormatException('metadata block lies outside the bytes given');
    }
    var raw = bytes.sublist(metaOffset, metaOffset + metaLength);
    if (internalCompression == 2) {
      raw = Uint8List.fromList(gzip.decode(raw));
    } else if (internalCompression != 1 && internalCompression != 0) {
      throw PmtilesFormatException('unsupported internal compression $internalCompression');
    }
    final Object? meta = raw.isEmpty ? <String, dynamic>{} : jsonDecode(utf8.decode(raw));
    if (meta is! Map<String, dynamic>) throw const PmtilesFormatException('metadata is not a JSON object');
    return PmtilesInfo(tileType: bytes[99], minZoom: bytes[100], maxZoom: bytes[101], metadata: meta);
  }

  /// Reads the header and metadata of the file at [path] without loading the tiles.
  static Future<PmtilesInfo> read(File file) async {
    final raf = await file.open();
    try {
      final head = await raf.read(127);
      if (head.length < 127) throw const PmtilesFormatException('shorter than the 127-byte PMTiles header');
      final d = ByteData.sublistView(Uint8List.fromList(head));
      final metaOffset = d.getUint64(24, Endian.little);
      final metaLength = d.getUint64(32, Endian.little);
      if (metaLength > 8 * 1024 * 1024) throw const PmtilesFormatException('metadata block is implausibly large');
      await raf.setPosition(0);
      final bytes = await raf.read(metaOffset + metaLength);
      return PmtilesInfo.parse(Uint8List.fromList(bytes));
    } finally {
      await raf.close();
    }
  }
}
