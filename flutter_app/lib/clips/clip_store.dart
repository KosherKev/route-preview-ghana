import 'dart:io';

import '../flyover/manifest.dart';

/// Street-video clips on this device: `Documents/clips/<clip key>` (for example `Documents/clips/671625527824/forward.mp4`)
/// inside the app sandbox, copied there by `tool/push_dev_clips.sh`. Clips are prototype-only (D1): never in the repo,
/// never in assets, and NEVER fetched over the network. This class only maps a manifest key to a local file.
class ClipStore {
  final Directory dir;
  const ClipStore(this.dir);

  /// The local file for [key], or null when the key is not a valid clip key (so it can never point outside [dir]).
  File? fileFor(String key) {
    if (!kClipKeyPattern.hasMatch(key)) return null;
    return File('${dir.path}/$key');
  }

  /// Keys of the manifest's ready clips whose files exist here and are not empty.
  Future<Set<String>> available(PreviewManifest m) async {
    final keys = <String>{};
    for (final s in m.segments) {
      final clip = s.clip;
      if (clip == null) continue;
      final f = fileFor(clip.key);
      if (f != null && await f.exists() && await f.length() > 0) keys.add(clip.key);
    }
    return keys;
  }
}
