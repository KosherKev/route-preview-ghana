import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("a command-line PROTOTYPE_CLIP_SERVING=1 is kept (dev clip door still works), even when .env also names it", () => {
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    loadApiEnv(envFile("RPG_TEST_KEEP=1\n"));
    expect(process.env.PROTOTYPE_CLIP_SERVING).toBe("1");
    expect(clipServingEnabled()).toBe(true);
    delete process.env.PROTOTYPE_CLIP_SERVING;
    process.env.PROTOTYPE_CLIP_SERVING = "1";
    loadApiEnv(envFile("PROTOTYPE_CLIP_SERVING=0\n")); // loadEnvFile never overrides the real environment
    expect(process.env.PROTOTYPE_CLIP_SERVING).toBe("1");
  });
  it("a command-line value never exposes the token: MAPILLARY_TOKEN is removed from any source", () => {
    process.env.MAPILLARY_TOKEN = "x";
    loadApiEnv(envFile("RPG_TEST_KEEP=1\n"));
    expect(process.env.MAPILLARY_TOKEN).toBeUndefined();
  });
  it("control: plain loadEnv (non-API tools such as the ingest CLI) still loads them", () => {
    loadEnv(envFile("PROTOTYPE_CLIP_SERVING=1\nMAPILLARY_TOKEN=t\n"));
    expect(process.env.PROTOTYPE_CLIP_SERVING).toBe("1");
    expect(process.env.MAPILLARY_TOKEN).toBe("t");
  });
  it("end to end: a command-line PROTOTYPE_CLIP_SERVING=1 survives, a .env-only one does not", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const code = (f: string) => `import { loadApiEnv } from "./src/config.ts"; loadApiEnv(${JSON.stringify(f)}); console.log(JSON.stringify([process.env.PROTOTYPE_CLIP_SERVING ?? null, process.env.MAPILLARY_TOKEN ?? null]));`;
    const run = (f: string, extra: Record<string, string>) => {
      const env = { ...process.env, ...extra }; delete env.MAPILLARY_TOKEN; if (!("PROTOTYPE_CLIP_SERVING" in extra)) delete env.PROTOTYPE_CLIP_SERVING;
      return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code(f)], { cwd: root, env, encoding: "utf8" }).stdout.trim();
    };
    expect(run(envFile("MAPILLARY_TOKEN=t\n"), { PROTOTYPE_CLIP_SERVING: "1" })).toBe('["1",null]');
    expect(run(envFile("PROTOTYPE_CLIP_SERVING=1\nMAPILLARY_TOKEN=t\n"), {})).toBe("[null,null]");
  });
  it("the API entry point uses loadApiEnv, and no file in the API serving path loads .env any other way", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const entry = path.join(root, "scripts/serve-approach.ts");
    expect(readFileSync(entry, "utf8")).toMatch(/loadApiEnv\(\)/);
    // walk the static relative-import graph from the entry point: that is every file the API process loads
    const seen = new Set<string>(); const queue = [entry];
    while (queue.length) {
      const f = queue.pop()!; if (seen.has(f)) continue; seen.add(f);
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const base = path.resolve(path.dirname(f), m[1]!.replace(/\.(js|ts)$/, ""));
        const hit = [`${base}.ts`, path.join(base, "index.ts")].find((c) => existsSync(c));
        if (hit) queue.push(hit);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
    const files = [...seen].map((f) => path.relative(root, f));
    expect(files).toContain("src/clips/serve.ts");
    expect(files).toContain("src/routing/server.ts");
    for (const f of seen) {
      const rel = path.relative(root, f); const src = readFileSync(f, "utf8");
      if (rel === "src/config.ts") continue; // defines loadEnv/loadApiEnv; the rest of the serving path must not read .env itself
      expect(src, rel).not.toMatch(/process\.loadEnvFile|dotenv|\bloadEnv\(/);
      expect(src, rel).not.toMatch(/process\.env\.MAPILLARY_TOKEN|env\.MAPILLARY_TOKEN|MAPILLARY_TOKEN\]/);
    }
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
