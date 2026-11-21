import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAPILLARY_SOURCE, OWN_CAPTURE_SOURCE } from "../src/imagery/sources";

// D10: frames.source has a database default, but no insert path may rely on it.
const root = path.resolve(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "migrations") continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|py)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, "src")), ...walk(path.join(root, "scripts")), ...walk(path.join(root, "test")), ...walk(path.join(root, "..", "worker"))].filter(
  (f) => !f.includes(".venv") && !f.endsWith("explicit-source.test.ts"),
);

describe("every insert into frames sets source explicitly", () => {
  const re = /INSERT\s+INTO\s+frames\s*\(([^)]*)\)/gi;
  const hits = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(re)].map((m) => ({ f, cols: m[1]!.split(",").map((c) => c.trim()) })));
  it("finds the known insert paths", () => expect(hits.length).toBeGreaterThanOrEqual(2));
  for (const h of hits) it(`${path.relative(root, h.f)} lists the source column`, () => expect(h.cols).toContain("source"));
  it("flags a bare INSERT INTO frames without a column list", () => {
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/INSERT\s+INTO\s+frames\s+(VALUES|SELECT)/i);
  });
  it("the only source value the Mapillary row builder emits is the named constant", () => {
    expect(MAPILLARY_SOURCE).toBe("mapillary");
    expect(OWN_CAPTURE_SOURCE).toBe("own_capture");
    expect(readFileSync(path.join(root, "src/ingest/mapillary.ts"), "utf8")).toMatch(/source:\s*MAPILLARY_SOURCE/);
  });
});
