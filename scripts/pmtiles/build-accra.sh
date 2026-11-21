#!/usr/bin/env bash
# Phase 5A PMTiles spike: build data/accra.pmtiles from the Geofabrik Ghana extract with Planetiler.
# Usage: scripts/pmtiles/build-accra.sh [bounds] [output] [schema]    (run from the repo root)
# Default schema accra-buildings.yml (v1: building, road, water). A schema that reads the sea GeoPackage (data/tmp/sea.gpkg, e.g.
# scripts/pmtiles/accra-base.yml, v2: adds landuse and sea) makes the script first extract the OSM natural=coastline ways from the extract
# (osm_coast.py) and derive the sea polygons from them (build_sea.py, see docs/data/tiles.md); the tiles are clipped to the bounds below.
# The sea step is decided by what the schema file reads, not by its path string, so any path form runs it. A stale data/tmp/sea.gpkg is
# deleted first and the script fails with a clear error unless the step produced a GeoPackage newer than its inputs.
# SEA_ONLY=1 stops after the sea step (used by scripts/pmtiles/test_build_guard.sh); SEA_PY overrides the Python used for it.
# Everything runs from verified, project-scoped binaries under data/tools (see docs/validation/phase5a-pmtiles-spike.md).
set -euo pipefail
cd "$(dirname "$0")/../.."
BOUNDS="${1:--0.40,5.45,0.05,5.80}"   # lon_min,lat_min,lon_max,lat_max: Greater Accra Metropolitan Area incl. Tema and Kasoa
OUT="${2:-data/accra.pmtiles}"
SCHEMA="${3:-scripts/pmtiles/accra-buildings.yml}"
JAVA="$(ls -d data/tools/jdk-21/*/Contents/Home)/bin/java"
JAR=data/tools/planetiler/planetiler.jar
# refuse to run anything whose checksum is not the verified one
echo "f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d  $JAR" | shasum -a 256 -c - >/dev/null || { echo "planetiler.jar checksum mismatch: refusing to run" >&2; exit 1; }
mkdir -p data/tmp-planetiler data/tmp
PBF=data/osm/ghana-latest.osm.pbf
SEA_PY="${SEA_PY:-data/tools/tiles-venv/bin/python}"
[ -f "$SCHEMA" ] || { echo "ERROR: schema file not found: $SCHEMA" >&2; exit 1; }
if grep -q 'data/tmp/sea\.gpkg' "$SCHEMA"; then
  COAST=data/tmp/coast.json; GPKG=data/tmp/sea.gpkg
  rm -f "$GPKG"   # never reuse a sea.gpkg from an earlier run
  if [ ! -s "$COAST" ] || [ ! "$COAST" -nt "$PBF" ] || [ ! "$COAST" -nt scripts/pmtiles/osm_coast.py ]; then
    "$SEA_PY" -I scripts/pmtiles/osm_coast.py "$PBF" "$COAST" --bbox -1.10,4.90,0.75,6.20 --names Christiansborg || { echo "ERROR: coastline extraction failed" >&2; exit 1; }
  fi
  "$SEA_PY" -I scripts/pmtiles/build_sea.py "$COAST" "$GPKG" || { echo "ERROR: build_sea.py failed (see above): refusing to build tiles without a fresh sea layer" >&2; exit 1; }
  if [ ! -s "$GPKG" ]; then echo "ERROR: the sea step did not produce $GPKG: refusing to build tiles with a missing or stale sea layer" >&2; exit 1; fi
  for dep in "$COAST" scripts/pmtiles/build_sea.py; do
    if [ ! "$GPKG" -nt "$dep" ]; then echo "ERROR: $GPKG is not newer than its input $dep: refusing to use a stale sea layer" >&2; exit 1; fi
  done
fi
[ "${SEA_ONLY:-0}" = 1 ] && { echo "SEA_ONLY=1: stopping after the sea step"; exit 0; }
/usr/bin/time -l "$JAVA" -Xmx6g -jar "$JAR" generate-custom \
  --schema="$SCHEMA" --osm_path=data/osm/ghana-latest.osm.pbf \
  --bounds="$BOUNDS" --minzoom=0 --maxzoom=14 --tmpdir=data/tmp-planetiler --download=false --force \
  --output="$OUT"
