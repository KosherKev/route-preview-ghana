import 'dart:io';

import 'package:flutter/services.dart';

/// Reads assets straight from the project folder (flutter test runs in flutter_app/), for loader tests.
class FileAssetBundle extends AssetBundle {
  @override
  Future<ByteData> load(String key) async => ByteData.sublistView(await File(key).readAsBytes());

  @override
  Future<T> loadStructuredData<T>(String key, Future<T> Function(String value) parser) async =>
      parser(await loadString(key));
}
