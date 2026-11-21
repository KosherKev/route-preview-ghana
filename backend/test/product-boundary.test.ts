// Product boundary: pre-trip preview only, never synced to live GPS. No endpoint, parameter or manifest field may accept
// or store a live, device or "current" position. This is a static guard over the code that defines the API surface.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { schema } from "./helpers/manifestSchema";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FORBIDDEN = new RegExp(
  [
    "(live|current|curr|device|user|rider|driver|gps|my|here|now)[_\\-.]?(position|location|pos|loc|coords?|coordinates|latlng|latlon|lat_lon|fix)",
    "geolocation", "watchPosition", "getCurrentPosition", "navigator\\.geo", "locationPermission", "ACCESS_FINE_LOCATION",
    "(current|live|now)[_\\-]?(offset|progress|distance)", "turn[_\\-]by[_\\-]turn", "reroute",
  ].join("|"), "i",
);

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const files = (dir: string) => readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".ts")).map((f) => path.join(dir, f));

function keysOf(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v) => keysOf(v, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.push(k); keysOf(v, out); }
  return out;
}
function propertyNames(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v) => propertyNames(v, out));
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      if (k === "properties" && v && typeof v === "object") out.push(...Object.keys(v));
      propertyNames(v, out);
    }
  }
  return out;
}

describe("product boundary: no live-position names in the API surface", () => {
  it("the forbidden-name pattern catches what it should (and not the legitimate names)", () => {
    for (const bad of ["current_position", "currentPosition", "live_location", "device_location", "userLocation", "gps_fix", "navigator.geolocation", "watchPosition", "turn_by_turn", "currentOffset"]) {
      expect(FORBIDDEN.test(bad), bad).toBe(true);
    }
    for (const ok of ["origin", "destination", "offsetM", "lat", "lon", "approach_length_m", "decision_window_m", "landmarkOptions", "servePath", "startPose"]) {
      expect(FORBIDDEN.test(ok), ok).toBe(false);
    }
  });
  it("no manifest property or schema key names a live/device/current position", () => {
    const bad = [...propertyNames(schema), ...keysOf(schema)].filter((k) => FORBIDDEN.test(k));
    expect(bad).toEqual([]);
  });
  it("no preview or routing source code defines or reads such a name (comments excluded)", () => {
    const offenders: string[] = [];
    for (const f of [...files("src/preview"), ...files("src/routing"), "src/clips/serve.ts"].filter((f) => { try { readFileSync(path.join(root, f)); return true; } catch { return false; } })) {
      stripComments(readFileSync(path.join(root, f), "utf8")).split("\n").forEach((line, i) => { if (FORBIDDEN.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`); });
    }
    expect(offenders).toEqual([]);
  });
  it("the schema forbids unknown fields at every object level that carries data", () => {
    const loose: string[] = [];
    const walk = (x: unknown, p: string) => {
      if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${p}[${i}]`));
      if (!x || typeof x !== "object") return;
      const o = x as Record<string, unknown>;
      if (o.type === "object" && o.properties && o.additionalProperties !== false) loose.push(p);
      for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
    };
    walk(schema, "$");
    expect(loose).toEqual([]);
  });
});
