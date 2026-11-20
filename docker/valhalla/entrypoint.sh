#!/bin/bash
# Builds config + tiles from /data/ghana-latest.osm.pbf on first start, then serves.
# Tiles live in the named volume mounted at /valhalla; delete that volume to force a rebuild.
set -euo pipefail

PBF="${PBF:-/data/ghana-latest.osm.pbf}"
CONFIG=/valhalla/valhalla.json
TILE_DIR=/valhalla/tiles
BUILD_CONCURRENCY="${BUILD_CONCURRENCY:-2}"   # small VM (~5 GB): keep the tile build narrow
SERVER_THREADS="${SERVER_THREADS:-2}"

mkdir -p "$TILE_DIR"

if [ ! -f "$CONFIG" ]; then
  valhalla_build_config \
    --mjolnir-tile-dir "$TILE_DIR" \
    --mjolnir-concurrency "$BUILD_CONCURRENCY" \
    --mjolnir-timezone "" \
    --mjolnir-admin "" \
    --httpd-service-listen "tcp://0.0.0.0:8002" \
    --loki-service-defaults-minimum-reachability 50 \
    > "$CONFIG"
fi

if [ ! -f "$TILE_DIR/.build_complete" ]; then
  [ -f "$PBF" ] || { echo "Missing $PBF (download the Geofabrik Ghana extract into data/)" >&2; exit 1; }
  echo "Building tiles from $PBF with concurrency $BUILD_CONCURRENCY ..."
  valhalla_build_tiles -c "$CONFIG" "$PBF"
  touch "$TILE_DIR/.build_complete"
fi

exec valhalla_service "$CONFIG" "$SERVER_THREADS"
