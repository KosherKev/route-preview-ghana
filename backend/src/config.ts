import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Loads <repo>/.env (git-ignored) into process.env without overriding real environment variables. */
export function loadEnv(file = path.join(repoRoot, ".env")): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Variables an API process must never hold, whatever the environment or .env says: the dev clip door switch and the imagery token. */
export const API_FORBIDDEN_ENV = ["PROTOTYPE_CLIP_SERVING", "MAPILLARY_TOKEN"] as const;

/**
 * loadEnv() for API (HTTP server) entry points: after reading .env, deletes API_FORBIDDEN_ENV from process.env, so a .env entry cannot
 * switch on clip serving or put the Mapillary token in the API process. Entry points that are NOT the API (ingest CLI, plan/register-clips,
 * validate, coverage-audit, migrate) keep plain loadEnv(); only the ingest CLI needs the token.
 */
export function loadApiEnv(file?: string, env: NodeJS.ProcessEnv = process.env): void {
  if (file === undefined) loadEnv(); else loadEnv(file);
  for (const k of API_FORBIDDEN_ENV) delete env[k];
}

export interface DbConfig { host: string; port: number; user: string; password: string; database: string }

export function dbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set (copy .env.example to .env)`);
    return v;
  };
  return {
    host: env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(env.POSTGRES_PORT ?? 5433),
    user: need("POSTGRES_USER"),
    password: need("POSTGRES_PASSWORD"),
    database: need("POSTGRES_DB"),
  };
}
