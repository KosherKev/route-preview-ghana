-- OSM points of interest loaded from the Geofabrik Ghana extract.
CREATE TABLE landmarks (
  osm_type text NOT NULL,
  osm_id   bigint NOT NULL,
  category text NOT NULL,   -- fuel | amenity | junction | tro_tro_stop
  kind     text,            -- e.g. amenity value, highway value
  name     text,
  geom     geometry(Point, 4326) NOT NULL,
  tags     jsonb,
  PRIMARY KEY (osm_type, osm_id, category)
);
CREATE INDEX landmarks_geom_gix ON landmarks USING gist (geom);
CREATE INDEX landmarks_category_idx ON landmarks (category);
