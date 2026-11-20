#!/usr/bin/env bash
# Downloads the Ghana-only Photon index and the Photon 0.7.4 jar into data/photon (git-ignored), verifying checksums.
# These are static data/artifact downloads; no public Photon or Nominatim API is ever queried.
# Then: docker compose --profile geocoder up -d photon   (bound to 127.0.0.1:2322, 1.5 GB memory limit)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=data/photon
DB=photon-db-gh-250720.tar.bz2
DB_MD5=1755ec3d38a4084799fcdcae58e7580d
JAR=photon-0.7.4.jar
JAR_SHA256=5cf6effb274504c1d2d088efe7c7a10fbd1e30de3215a260451f68cc57186601
mkdir -p "$DIR"
if [ ! -f "$DIR/$DB" ]; then curl -fsSL -o "$DIR/$DB" "https://download1.graphhopper.com/public/extracts/by-country-code/gh/$DB"; fi
if [ ! -f "$DIR/$JAR" ]; then curl -fsSL -o "$DIR/$JAR" "https://github.com/komoot/photon/releases/download/0.7.4/$JAR"; fi
md5_of() { if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }
sha_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
[ "$(md5_of "$DIR/$DB")" = "$DB_MD5" ] || { echo "checksum mismatch: $DB" >&2; exit 1; }
[ "$(sha_of "$DIR/$JAR")" = "$JAR_SHA256" ] || { echo "checksum mismatch: $JAR" >&2; exit 1; }
[ -d "$DIR/photon_data" ] || tar -xjf "$DIR/$DB" -C "$DIR"
echo "photon ready in $DIR"
