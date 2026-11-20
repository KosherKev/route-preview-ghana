-- Street-imagery frame metadata (pointers only; no pixels are stored here).
CREATE TABLE frames (
  image_id               text PRIMARY KEY,
  sequence_id            text,
  geom                   geometry(Point, 4326) NOT NULL,
  computed_compass_angle double precision,
  is_pano                boolean NOT NULL DEFAULT false,
  camera_type            text,
  width                  integer,
  height                 integer,
  quality_score          double precision,
  captured_at            timestamptz,
  source                 text NOT NULL,
  creator                text,
  license                text
);
CREATE INDEX frames_geom_gix ON frames USING gist (geom);
CREATE INDEX frames_sequence_idx ON frames (sequence_id, captured_at);
CREATE INDEX frames_source_idx ON frames (source);
