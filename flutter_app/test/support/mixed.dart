import 'dart:convert';
import 'dart:io';

import 'package:route_preview/flyover/manifest.dart';

/// The hand-authored mixed manifest (assets/fixtures/mixed-manifest.json): four segment cases on the real Accra route.
///   0 STREET_VIDEO ready clip 900001 (flyover null)   1 BIRDS_EYE_3D flyover
///   2 STREET_VIDEO not_rendered with flyover          3 STREET_VIDEO ready clip 900002 (flyover null)
const kClipA = '900001/forward.mp4';
const kClipB = '900002/forward.mp4';

Map<String, dynamic> mixedJson() =>
    jsonDecode(File('assets/fixtures/mixed-manifest.json').readAsStringSync()) as Map<String, dynamic>;

PreviewManifest mixedManifest([void Function(Map<String, dynamic> json)? edit]) {
  final j = mixedJson();
  edit?.call(j);
  return PreviewManifest.parse(jsonEncode(j));
}
