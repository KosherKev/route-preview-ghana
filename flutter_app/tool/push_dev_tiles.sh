#!/bin/bash
# Copies the dev tile files into the iOS SIMULATOR app's sandbox (Documents/tiles) so the app can read them at runtime.
# The tiles are OSM vector tiles and a Copernicus DEM: large, and never committed or bundled as assets.
#
# usage: tool/push_dev_tiles.sh [simulator-udid|booted]
#   TILES_SRC=dir   where accra.pmtiles, accra-terrain.pmtiles and SHA256SUMS are (default ~/dev/.scratch/tiles)
#   BUNDLE_ID=id    app bundle id (default: read from ios/Runner.xcodeproj, the Runner target)
#
# Refuses to run if a file's SHA-256 does not match SHA256SUMS (checked before the copy and again on the copy).
# The app must have been installed once (flutter run) so its data container exists; then restart the app.
# Real-device install is a separate step and is not done here.
set -euo pipefail

SRC="${TILES_SRC:-$HOME/dev/.scratch/tiles}"
UDID="${1:-booted}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FILES=(accra.pmtiles accra-terrain.pmtiles)

BUNDLE_ID="${BUNDLE_ID:-$(grep -m1 'PRODUCT_BUNDLE_IDENTIFIER = ' "$HERE/../ios/Runner.xcodeproj/project.pbxproj" | grep -v RunnerTests | sed -E 's/.*= ([^;]+);.*/\1/')}"
[ -n "$BUNDLE_ID" ] || { echo "cannot determine the bundle id; set BUNDLE_ID" >&2; exit 2; }

verify_dir() { # $1 = directory holding the files and a SHA256SUMS to check them against
  local dir="$1" f want got
  for f in "${FILES[@]}"; do
    [ -f "$dir/$f" ] || { echo "missing $dir/$f" >&2; return 1; }
    want="$(awk -v f="$f" '$2 == f || $2 == "*" f {print $1}' "$SRC/SHA256SUMS")"
    [ -n "$want" ] || { echo "no SHA256SUMS entry for $f" >&2; return 1; }
    got="$(shasum -a 256 "$dir/$f" | awk '{print $1}')"
    if [ "$got" != "$want" ]; then
      echo "HASH MISMATCH for $f: expected $want, got $got" >&2
      return 1
    fi
    echo "ok  $got  $f ($(stat -f%z "$dir/$f") bytes)"
  done
}

echo "source: $SRC"
echo "bundle id: $BUNDLE_ID   simulator: $UDID"
verify_dir "$SRC" || { echo "refusing to copy: the tiles do not match SHA256SUMS" >&2; exit 1; }

CONTAINER="$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data 2>/dev/null)" || {
  echo "no data container for $BUNDLE_ID on $UDID: install the app first (flutter run), then run this again" >&2
  exit 1
}
DEST="$CONTAINER/Documents/tiles"
mkdir -p "$DEST"
for f in "${FILES[@]}"; do cp "$SRC/$f" "$DEST/$f"; done
verify_dir "$DEST" || { echo "the copied files do not match SHA256SUMS; removing them" >&2; for f in "${FILES[@]}"; do rm -f "$DEST/$f"; done; exit 1; }
echo "pushed to $DEST"
echo "restart the app (or hot restart) to load the tiles"
