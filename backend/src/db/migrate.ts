import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Applies pending *.sql files in name order, each in a transaction, recording them in schema_migrations. */
export async function applyMigrations(client: Client, dir = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name as string));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(path.join(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
    applied.push(file);
  }
  return applied;
}
