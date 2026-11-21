# Phase 4 street-video worker: status and benchmark (PROTOTYPE)

Every clip this worker produces is a prototype built from Mapillary frames. Clips live only in the gitignored local cache
(`data/clips-cache/`), carry `clips.status = 'prototype'` and `render_params.prototype = true`, and fail `isClipServable`.
Nothing is uploaded or served (D1).

## Pipeline

1. `npm run clips:plan` (backend): classifies every validated route from the STORED frames (no Mapillary call), builds one plan
   per STREET_VIDEO segment, picks the newest imagery in a length window, writes `data/clips/plans/*.json`.
2. `python -m rpg_worker.cli` (worker, venv): fetch (fresh signed URL per image, budget-counted), normalise to 1280x720,
   stabilise, interpolate gaps under 15 m, FFmpeg-crossfade the 15 to 30 m bridges, encode, cache by (edge_id, direction).
3. `npm run clips:register` (backend): writes the `clips` row with `source_summary` from the attribution builder.

## Rules implemented and tested

- Normalise: scale to cover and centre-crop; letterbox instead when covering would discard more than 35 percent.
- Stabilise: Canny + Hough on the middle band of the frame, moving-median smoothing over the sequence, clamp at 4 degrees,
  no correction without evidence.
- Gaps: interpolation only below 15 m (`interpolate_pair` raises otherwise); a 15 to 30 m gap must be a listed bridge and is an
  FFmpeg `xfade` crossfade; a gap over 30 m, an unlisted bridge-tier gap or a mis-tiered bridge raises before any download.
- Encode: 720p H.264, CRF 27, preset medium, `+faststart`, constant frame rate (10 fps), no overlays, constant nominal virtual
  speed (default 10 m/s, `--speed`). Each keyframe is held for the metres it covers, so the clip lasts length / speed.
- Budget: at most 1,000 image downloads in total, counted before each request in `data/mapillary-budget.json` (counts only).

## Tooling

- FFmpeg 9.0.2 static (libx264, minterpolate, xfade) comes from the `imageio-ffmpeg==0.8.1` wheel for macOS x86_64, installed into
  `worker/.venv` only with `pip install --require-hashes -r requirements-ffmpeg.txt`; the pinned sha256
  (9538a10e598257263b5de1a1c1b86e7603417bc219245b1e279b452e5e48cc20) is PyPI's published digest for that exact wheel and matched the
  downloaded file. The wheel ships no ffprobe.
- ffprobe substitute (stated plainly: real ffprobe was NOT available): `ffmpeg -i` stream-line parse for codec, pixel format, size,
  fps and duration, plus a pure-Python top-level MP4 box walk for moov-before-mdat (faststart). See `ffmpeg.stream_info`.

## Interpolation benchmark and choice

- RIFE was SKIPPED, not benchmarked: the upstream release (nihui/rife-ncnn-vulkan 20221029, MIT, 436 MB macOS zip) publishes no
  checksum, so the verified-binary rule cannot be met, and Vulkan through MoltenVK on this Intel Iris Pro is doubtful.
- Chosen on the owner's instruction: FFmpeg `minterpolate` (mci, aobmc, bidir) for gaps under 15 m; `xfade` crossfade for 15 to 30 m
  bridges. Measured: about 0.6 s per interpolated frame on this CPU (109 interpolated frames across three clips in about 65 s wall
  time including encoding).

## Ghosting observations (inspected frames only; none committed)

minterpolate is visibly imperfect on this footage. Frames between two source frames show doubled or smeared edges on high-contrast
static objects whose apparent position shifts a lot between frames (a roadside billboard was blurred and doubled, and a faint second
outline of a tall building appeared), and moving motorbike riders and nearby cars blur or smear. Frames close to a source frame look
clean. Crossfade bridge frames are blends of the two stills, so objects present in only one appear semi-transparent. Judged on
about nine hand-picked frames from two clips, not exhaustively.
