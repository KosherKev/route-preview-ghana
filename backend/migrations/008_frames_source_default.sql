-- D10: frames.source gets a database default of 'mapillary' (approved exact alteration; nothing else on existing columns changes).
-- Code must still set source explicitly on every insert; the default is a safety net only.
-- Manual rollback (never run automatically): ALTER TABLE frames ALTER COLUMN source DROP DEFAULT;
ALTER TABLE frames ALTER COLUMN source SET DEFAULT 'mapillary';
