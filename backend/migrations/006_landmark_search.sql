-- Fuzzy landmark-name search: trigram index over an accent-folded, lower-cased name. Additive only.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is only STABLE, so an index expression needs an IMMUTABLE wrapper with a pinned dictionary.
CREATE OR REPLACE FUNCTION landmarks_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

CREATE INDEX landmarks_name_trgm_idx ON landmarks USING gin (landmarks_norm(name) gin_trgm_ops);
