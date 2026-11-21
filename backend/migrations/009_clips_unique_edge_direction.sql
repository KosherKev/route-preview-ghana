-- Phase 4 follow-up H: one clips row per (edge_id, direction), the key register.ts looks a clip up by. Additive only.
-- Pre-checked on the live table: zero duplicates. Rows with a NULL direction are not constrained (NULLs are distinct); the code always sets direction.
-- Manual rollback (never run automatically): DROP INDEX clips_edge_direction_uniq;
CREATE UNIQUE INDEX clips_edge_direction_uniq ON clips (edge_id, direction);
