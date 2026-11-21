#!/bin/bash
# Copies dev street-video clips into the iOS SIMULATOR app's sandbox (Documents/clips/<clip key>) so the app can play them.
# Clips are prototype-only (D1): never committed, never in assets, never fetched over the network. The tailnet API does not
# serve them (the clip door answers 403 by design), so this is the only way a clip reaches the app.
#
# usage: tool/push_dev_clips.sh [-m manifest.json] [-u simulator-udid|booted] [clips-dir]
#   clips-dir   holds files laid out by clip key, e.g. <clips-dir>/900001/forward.mp4 (default ~/dev/.scratch/clips)
#   -m          a preview manifest: every clip the manifest lists that exists in clips-dir is checked against it.
#               If the manifest records a sha256 for the clip it MUST match, or the script refuses. The 5A manifest
#               records the clip's size (bytes), not a hash; the size is checked too and a difference is refused.
#   BUNDLE_ID   app bundle id (default: read from ios/Runner.xcodeproj, the Runner target)
#   If clips-dir has a SHA256SUMS (lines "<hash>  <key>"), those are enforced as well.
set -euo pipefail

MANIFEST=""
UDID="booted"
while getopts "m:u:" opt; do
  case "$opt" in
    m) MANIFEST="$OPTARG" ;;
    u) UDID="$OPTARG" ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND - 1))
SRC="${1:-$HOME/dev/.scratch/clips}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_ID="${BUNDLE_ID:-$(grep -m1 'PRODUCT_BUNDLE_IDENTIFIER = ' "$HERE/../ios/Runner.xcodeproj/project.pbxproj" | grep -v RunnerTests | sed -E 's/.*= ([^;]+);.*/\1/')}"
[ -n "$BUNDLE_ID" ] || { echo "cannot determine the bundle id; set BUNDLE_ID" >&2; exit 2; }
[ -d "$SRC" ] || { echo "no clips directory: $SRC" >&2; exit 1; }

KEY_RE='^[0-9]{1,15}/[a-z]+\.mp4$'
sha() { shasum -a 256 "$1" | awk '{print $1}'; }

# Keys to push: every <digits>/<letters>.mp4 under SRC. Anything else is ignored with a note.
KEYS=()
while IFS= read -r f; do
  key="${f#"$SRC"/}"
  if [[ "$key" =~ $KEY_RE ]]; then KEYS+=("$key"); else echo "ignoring $key (not a clip key like 123/forward.mp4)"; fi
done < <(find "$SRC" -type f -name '*.mp4' | sort)
[ "${#KEYS[@]}" -gt 0 ] || { echo "no clips found under $SRC" >&2; exit 1; }

# Expected sha256 / bytes from the manifest, as "key sha bytes" lines (sha or bytes may be '-').
EXPECT=""
if [ -n "$MANIFEST" ]; then
  EXPECT="$(python3 -I - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for s in m.get('segments', []):
    c = s.get('clip')
    if c:
        print(c['key'], c.get('sha256') or '-', c.get('bytes') if c.get('bytes') is not None else '-')
PY
)"
fi

fail=0
for key in "${KEYS[@]}"; do
  f="$SRC/$key"; got="$(sha "$f")"; size="$(stat -f%z "$f")"
  # 1. SHA256SUMS next to the clips
  if [ -f "$SRC/SHA256SUMS" ]; then
    want="$(awk -v k="$key" '$2 == k || $2 == "*" k {print $1}' "$SRC/SHA256SUMS")"
    if [ -n "$want" ] && [ "$want" != "$got" ]; then echo "HASH MISMATCH (SHA256SUMS) for $key: expected $want, got $got" >&2; fail=1; continue; fi
  fi
  # 2. the manifest
  line="$(printf '%s\n' "$EXPECT" | awk -v k="$key" '$1 == k')"
  if [ -n "$line" ]; then
    msha="$(echo "$line" | awk '{print $2}')"; mbytes="$(echo "$line" | awk '{print $3}')"
    if [ "$msha" != "-" ] && [ "$msha" != "$got" ]; then echo "HASH MISMATCH (manifest) for $key: expected $msha, got $got" >&2; fail=1; continue; fi
    if [ "$mbytes" != "-" ] && [ "$mbytes" != "$size" ]; then echo "SIZE MISMATCH (manifest) for $key: expected $mbytes bytes, got $size" >&2; fail=1; continue; fi
    if [ "$msha" = "-" ]; then echo "ok  $got  $key ($size bytes; manifest records no sha256, size matches)"; else echo "ok  $got  $key ($size bytes; sha256 matches the manifest)"; fi
  else
    echo "ok  $got  $key ($size bytes; not listed in the manifest, no hash to check)"
  fi
done
[ "$fail" = 0 ] || { echo "refusing to copy: a clip does not match what is recorded for it" >&2; exit 1; }

CONTAINER="$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data 2>/dev/null)" || {
  echo "no data container for $BUNDLE_ID on $UDID: install the app first (flutter run), then run this again" >&2
  exit 1
}
for key in "${KEYS[@]}"; do
  mkdir -p "$CONTAINER/Documents/clips/$(dirname "$key")"
  cp "$SRC/$key" "$CONTAINER/Documents/clips/$key"
  [ "$(sha "$CONTAINER/Documents/clips/$key")" = "$(sha "$SRC/$key")" ] || { echo "copy of $key does not match; removing it" >&2; rm -f "$CONTAINER/Documents/clips/$key"; exit 1; }
done
echo "pushed ${#KEYS[@]} clip(s) to $CONTAINER/Documents/clips"
echo "restart the app (or open the preview again) to use them"
