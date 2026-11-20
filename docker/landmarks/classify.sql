-- Moves staged OSM points into landmarks with a category. Re-runnable.
BEGIN;
TRUNCATE landmarks;
INSERT INTO landmarks (osm_type, osm_id, category, kind, name, geom, tags)
SELECT 'node', osm_id::bigint, c.category, c.kind, NULLIF(name, ''), ST_SetSRID(geom, 4326),
       jsonb_strip_nulls(jsonb_build_object('amenity', amenity, 'highway', highway, 'public_transport', public_transport))
FROM landmarks_stage s
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    (CASE WHEN amenity = 'fuel' THEN 'fuel' END, amenity),
    (CASE WHEN highway IN ('bus_stop') OR amenity = 'bus_station' OR public_transport = 'stop_position' THEN 'tro_tro_stop' END, COALESCE(highway, amenity, public_transport)),
    (CASE WHEN highway IN ('motorway_junction','traffic_signals','mini_roundabout') THEN 'junction' END, highway),
    (CASE WHEN amenity IN ('marketplace','bank','hospital','clinic','pharmacy','police','post_office','townhall','school','college','university') THEN 'amenity' END, amenity)
  ) AS v(category, kind) WHERE category IS NOT NULL
) c
ON CONFLICT DO NOTHING;
DROP TABLE landmarks_stage;
COMMIT;
