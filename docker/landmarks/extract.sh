#!/bin/sh
# Runs inside the GDAL container: OSM PBF points -> PostGIS staging table landmarks_stage.
set -e
sed '/^\[points\]/,/^\[lines\]/ s/^attributes=.*/attributes=name,highway,amenity,public_transport/' \
  /usr/share/gdal/osmconf.ini > /tmp/osmconf.ini
export PGPASSWORD="$POSTGRES_PASSWORD"
ogr2ogr -f PostgreSQL "PG:host=postgis port=5432 dbname=$POSTGRES_DB user=$POSTGRES_USER" \
  /data/ghana-latest.osm.pbf -overwrite -nln landmarks_stage -nlt POINT \
  -lco GEOMETRY_NAME=geom -lco FID=fid -t_srs EPSG:4326 \
  --config OSM_CONFIG_FILE /tmp/osmconf.ini --config OGR_INTERLEAVED_READING YES \
  -spat $BBOX -dialect OGRSQL -sql "$LANDMARK_SQL"
