import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { API_FORBIDDEN_ENV, loadApiEnv, loadEnv } from "../src/config";
import { clipServingEnabled } from "../src/clips/serve";

const dirs: string[] = [];
const envFile = (body: string) => { const d = mkdtempSync(path.join(os.tmpdir(), "rpg-env-")); dirs.push(d); const f = path.join(d, ".env"); writeFileSync(f, body); return f; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); for (const k of [...API_FORBIDDEN_ENV, "RPG_TEST_KEEP"]) delete process.env[k]; });

describe("API env hardening", () => {
  it("a .env with PROTOTYPE_CLIP_SERVING=1 does not enable clip serving in an API process", () => {
    const f = envFile("PROTOTYPE_CLIP_SERVING=1\nRPG_TEST_KEEP=yes\n");
    loadApiEnv(f);
    expect(process.env.PROTOTYPE_CLIP_SERVING).toBeUndefined();
    expect(clipServingEnabled()).toBe(false);
    expect(process.env.RPG_TEST_KEEP).toBe("yes"); // other .env values still load
  });
  it("a .env with MAPILLARY_TOKEN does not expose the token to an API process", () => {
    const f = envFile("MAPILLARY_TOKEN=not-a-real-token-for-test\n");
    loadApiEnv(f);
    expect(process.env.MAPILLARY_TOKEN).toBeUndefined();
  });
  it("values set in the real environment before start are removed too", () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1"; process.env.MAPILLARY_TOKEN = "x";
    loadApiEnv(envFile("RPG_TEST_KEEP=1\n"));
    expect(process.env.PROTOTYPE_CLIP_SERVING).toBeUndefined();
    expect(process.env.MAPILLARY_TOKEN).toBeUndefined();
  });
  it("control: plain loadEnv (non-API tools such as the ingest CLI) still loads them", () => {
    loadEnv(envFile("PROTOTYPE_CLIP_SERVING=1\nMAPILLARY_TOKEN=t\n"));
    expect(process.env.PROTOTYPE_CLIP_SERVING).toBe("1");
    expect(process.env.MAPILLARY_TOKEN).toBe("t");
  });
  it("the API entry point uses loadApiEnv, and no server entry point uses plain loadEnv", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const serve = readFileSync(path.join(root, "scripts/serve-approach.ts"), "utf8");
    expect(serve).toMatch(/loadApiEnv\(\)/);
    expect(serve).not.toMatch(/\bloadEnv\(\)/);
  });
  it("end to end: a real process loading a .env that names both variables ends up with neither", () => {
    const f = envFile("PROTOTYPE_CLIP_SERVING=1\nMAPILLARY_TOKEN=secret-test-value\n");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const code = `import { loadApiEnv } from "./src/config.ts"; loadApiEnv(${JSON.stringify(f)}); console.log(JSON.stringify([process.env.PROTOTYPE_CLIP_SERVING ?? null, process.env.MAPILLARY_TOKEN ?? null]));`;
    const env = { ...process.env }; delete env.PROTOTYPE_CLIP_SERVING; delete env.MAPILLARY_TOKEN;
    const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: root, env, encoding: "utf8" });
    expect(r.stdout.trim()).toBe("[null,null]");
  });
});
