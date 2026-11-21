import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Loads <repo>/.env (git-ignored) into process.env without overriding real environment variables. */
export function loadEnv(file = path.join(repoRoot, ".env")): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Variables an API process must not take from .env: the dev clip door switch and the imagery token. */
export const API_FORBIDDEN_ENV = ["PROTOTYPE_CLIP_SERVING", "MAPILLARY_TOKEN"] as const;

/**
 * loadEnv() for API (HTTP server) entry points. Afterwards a name in API_FORBIDDEN_ENV is removed if it was NOT already in the process
 * environment before the load (so it came from .env): a .env entry cannot switch on clip serving. An explicit command-line value for
 * PROTOTYPE_CLIP_SERVING (`PROTOTYPE_CLIP_SERVING=1 npm run serve`, docs/api/dev-clip-serving.md) is kept. MAPILLARY_TOKEN is always
 * removed: the API never calls Mapillary, so the token is never visible to it from any source.
 * Entry points that are NOT the API (ingest CLI, plan/register-clips, validate, coverage-audit, migrate) keep plain loadEnv().
 */
export function loadApiEnv(file?: string, env: NodeJS.ProcessEnv = process.env): void {
  const before = new Set(API_FORBIDDEN_ENV.filter((k) => env[k] !== undefined));
  if (file === undefined) loadEnv(); else loadEnv(file);
  for (const k of API_FORBIDDEN_ENV) if (k === "MAPILLARY_TOKEN" || !before.has(k)) delete env[k];
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
