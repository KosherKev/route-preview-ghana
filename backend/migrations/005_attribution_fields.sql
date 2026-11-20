-- Attribution data for street imagery (additive only: new nullable columns and one new defaulted column).
-- frames.source, frames.creator and frames.license already exist (002_frames.sql) and are NOT touched here.
-- Manual rollback (never run automatically):
--   ALTER TABLE frames DROP COLUMN IF EXISTS creator_username;
--   ALTER TABLE frames DROP COLUMN IF EXISTS source_url;
--   ALTER TABLE clips  DROP COLUMN IF EXISTS source_summary;
ALTER TABLE frames ADD COLUMN IF NOT EXISTS creator_username text NULL;
ALTER TABLE frames ADD COLUMN IF NOT EXISTS source_url text NULL;
ALTER TABLE clips  ADD COLUMN IF NOT EXISTS source_summary jsonb NOT NULL DEFAULT '[]'::jsonb;
