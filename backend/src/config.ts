import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Loads <repo>/.env (git-ignored) into process.env without overriding real environment variables. */
export function loadEnv(file = path.join(repoRoot, ".env")): void {
  if (existsSync(file)) process.loadEnvFile(file);
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
