-- Re-run safety for 006 (additive): 006 created the trigram index without IF NOT EXISTS. It cannot be edited in place
-- (already applied on live databases), so this re-asserts the same objects idempotently. A no-op where 006 already ran.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION landmarks_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

CREATE INDEX IF NOT EXISTS landmarks_name_trgm_idx ON landmarks USING gin (landmarks_norm(name) gin_trgm_ops);
