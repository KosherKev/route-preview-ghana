#!/usr/bin/env bash
# Loads fuel / amenity / junction / tro-tro-stop POIs for Greater Accra from data/ghana-latest.osm.pbf
# into PostGIS `landmarks` via a throwaway GDAL (ogr2ogr) container. No data is committed.
# Prereqs: `docker compose up -d postgis`, `npm run db:migrate` (in backend/), .env present.
set -euo pipefail
cd "$(dirname "$0")/.."

GDAL_IMAGE="ghcr.io/osgeo/gdal:ubuntu-small-3.10.3"
NETWORK="route-preview-ghana_default"
# Approximate Greater Accra bounding box: west south east north (a box, not the admin boundary).
BBOX="${LANDMARK_BBOX:--0.60 5.40 0.40 6.10}"
LANDMARK_SQL="SELECT osm_id, name, amenity, highway, public_transport FROM points WHERE
  amenity IN ('fuel','marketplace','bank','hospital','clinic','pharmacy','police','post_office','townhall','school','college','university','bus_station')
  OR highway IN ('bus_stop','motorway_junction','traffic_signals','mini_roundabout')
  OR public_transport = 'stop_position'"

[ -f data/ghana-latest.osm.pbf ] || { echo "missing data/ghana-latest.osm.pbf" >&2; exit 1; }
[ -f .env ] || { echo "missing .env (copy .env.example)" >&2; exit 1; }

# --env-file passes the DB password to the container without putting it on a command line.
docker run --rm --network "$NETWORK" --memory 1g --env-file .env \
  -e BBOX="$BBOX" -e LANDMARK_SQL="$LANDMARK_SQL" \
  -v "$PWD/data:/data:ro" -v "$PWD/docker/landmarks/extract.sh:/extract.sh:ro" \
  "$GDAL_IMAGE" bash /extract.sh

docker compose exec -T postgis sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < docker/landmarks/classify.sql
docker compose exec -T postgis sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT category, count(*) FROM landmarks GROUP BY 1 ORDER BY 1"'
