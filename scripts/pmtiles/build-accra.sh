#!/usr/bin/env bash
# Phase 5A PMTiles spike: build data/accra.pmtiles from the Geofabrik Ghana extract with Planetiler.
# Usage: scripts/pmtiles/build-accra.sh [bounds] [output]    (run from the repo root)
# Everything runs from verified, project-scoped binaries under data/tools (see docs/validation/phase5a-pmtiles-spike.md).
set -euo pipefail
cd "$(dirname "$0")/../.."
BOUNDS="${1:--0.40,5.45,0.05,5.80}"   # lon_min,lat_min,lon_max,lat_max: Greater Accra Metropolitan Area incl. Tema and Kasoa
OUT="${2:-data/accra.pmtiles}"
JAVA="$(ls -d data/tools/jdk-21/*/Contents/Home)/bin/java"
JAR=data/tools/planetiler/planetiler.jar
# refuse to run anything whose checksum is not the verified one
echo "f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d  $JAR" | shasum -a 256 -c - >/dev/null || { echo "planetiler.jar checksum mismatch: refusing to run" >&2; exit 1; }
mkdir -p data/tmp-planetiler
/usr/bin/time -l "$JAVA" -Xmx6g -jar "$JAR" generate-custom \
  --schema=scripts/pmtiles/accra-buildings.yml --osm_path=data/osm/ghana-latest.osm.pbf \
  --bounds="$BOUNDS" --minzoom=0 --maxzoom=14 --tmpdir=data/tmp-planetiler --download=false --force \
  --output="$OUT"
