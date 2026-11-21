# D4: Street-video playback in the Flutter app (Phase 5B-2b, 2026-11-21)

D1 makes street imagery prototype-only: clips may be shown on a development device, never published, shared or committed.
This note records how the app plays them and which package it uses.

## Choice: `video_player` 2.14.1 (official, `flutter.dev`)

| | |
| --- | --- |
| Publisher | `flutter.dev` (the Flutter team; source `flutter/packages`) |
| Licence | BSD-3-Clause |
| Platforms | iOS (through `video_player_avfoundation` 2.12.4, AVFoundation) and Android; also web and others. Only iOS is built here. |
| Maintenance | Released 2026-10-02; the iOS implementation 2026-11-13. pub.dev: 3,700+ likes, 140/160 points. |
| Used as | `VideoPlayerController.file(File)` only, silent (volume 0), no looping |

Alternatives not taken: `media_kit` (a native libmpv build, heavier, not needed for short H.264 clips); `chewie` (UI chrome we
do not want, since the preview clock is the master); `flutter_vlc_player` (a large native dependency).

## How clips reach the app, and how they do not

- **Only from a local file.** A clip is looked up at `Documents/clips/<clip key>` in the app sandbox, where the key is the
  manifest's `clip.key` (for example `900001/forward.mp4`). The key must match the schema pattern
  `^[0-9]{1,15}/[a-z]+\.mp4$`, which also makes it a safe relative path (no `..`, no leading slash).
- **Never fetched.** The preview API does not serve clips over the tailnet (the clip door answers 403 by design), and the app has
  no code that asks: no network video constructor (`network`, `networkUrl`, `asset`, `contentUri`) exists in `lib/`, the HTTP
  client is only used by the API client, and the app never reads the manifest's `servePath`. Tests in
  `test/network_boundary_test.dart` scan for all of this, with positive controls, and the API tests prove the client never requests a
  `/clips` path.
- **Never committed or bundled.** No `.mp4`, `.mov` or tile file may exist in the app tree, and only `assets/fixtures/` (JSON) and
  `assets/style/` are declared as assets; both are tested.
- **Dev push only.** `flutter_app/tool/push_dev_clips.sh` copies clips from a local folder into the simulator container. It refuses
  if a clip's SHA-256 differs from a hash recorded for it (the manifest's `clip.sha256` if the manifest ever has one, or a
  `SHA256SUMS` next to the clips), and it checks the manifest's `bytes`. **Today's 5A manifest records the size, not a hash**
  (`readyClip` has `bytes` and no `sha256`), so the hash check against the manifest is ready but dormant; size and
  `SHA256SUMS` are enforced. A real-device push is a separate step done from the MacBook.

## Playback model

The preview clock is the master. For a section whose clip is on the device, `ClipView` opens the file, seeks to the clock's
position inside the section, sets the speed and plays or pauses with the player. If the video drifts more than 0.5 s from the
clock (after a scrub, a speed change or a stall) it seeks. The section lasts as long as the clip (`clip.durationSec`).

When a section has no local clip, the player uses the manifest's flyover keyframes if it has them (a STREET_VIDEO segment that
carries `flyover`, which the pending tailnet follow-up adds for every street segment), else it shows "No preview for this
section", keeps the map riding the route, and continues the timeline at the segment's length at 10 m/s. Both shapes are handled
today: until the follow-up lands, a clip-ready segment arrives with `flyover: null`.

## Test clip

There is no `ffmpeg` on this Mac. `flutter_app/tool/make_test_clip.swift` makes a synthetic colour-bar clip (a frame counter and a
sweeping marker, not imagery of any place) with the system AVFoundation. The output stays outside the repo.

## Findings

- 8 s H.264 clip, 720x1280, 24 fps, 381 KB: it started, tracked the clock (video 5.04 s at clock 5.3 s) and handed over to the
  flyover at the section boundary on the iOS 27.2 simulator.
- Real-device playback, HEVC/other codecs and long clips are untested.
