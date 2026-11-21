import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClipReport, dirBytes, renderClipReportMarkdown } from "../src/clips/report";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "clipsrep-"));
  const d = (n: string) => { const p = path.join(root, n); mkdirSync(p, { recursive: true }); return p; };
  const results = d("results"), plans = d("plans"), framesCache = d("frames"), clipsCache = d("clips");
  const res = (edge: number, o: object) => ({ edge_id: edge, direction: "forward", clip_key: `${edge}/forward.mp4`, duration_s: 10, fps: 10, speed_mps: 10,
    frame_count: 100, source_frames: 10, interpolated_frames: 30, bridge_frames: 0, bridges_used: 0, interpolator: "minterpolate", file_bytes: 1000, encode_seconds: 2, ...o });
  const plan = (years: string[]) => ({ plan: { frames: years.map((y, i) => ({ image_id: `i${i}`, captured_at: y })) } });
  writeFileSync(path.join(results, "1_forward.json"), JSON.stringify(res(1, {})));
  writeFileSync(path.join(results, "2_forward.json"), JSON.stringify(res(2, { bridge_frames: 10, bridges_used: 1, duration_s: 5.5 })));
  writeFileSync(path.join(plans, "1_forward.json"), JSON.stringify(plan(["2024-03-01T00:00:00Z", "2024-05-01T00:00:00Z", "2026-01-05T00:00:00Z"])));
  writeFileSync(path.join(framesCache, "a.jpg"), "xxxx");
  mkdirSync(path.join(clipsCache, "1"));
  writeFileSync(path.join(clipsCache, "1", "forward.mp4"), "yyyyyy");
  const budgetFile = path.join(root, "budget.json");
  writeFileSync(budgetFile, JSON.stringify({ downloads: 43, api_calls: 43 }));
  return { results, plans, budgetFile, framesCache, clipsCache };
}

describe("clip report", () => {
  const dirs = fixture();
  const r = buildClipReport(dirs);
  it("builds per-clip rows with share and capture-year buckets, and totals with budget and cache sizes", () => {
    expect(r.clips).toHaveLength(2);
    expect(r.clips[0]).toMatchObject({ edge_id: 1, interpolated_share: 0.75, capture_year_buckets: { "2024": 2, "2026": 1 } });
    expect(r.clips[1]!.capture_year_buckets).toEqual({}); // no plan file: no buckets, no crash
    expect(r.totals).toMatchObject({ clips: 2, total_duration_s: 15.5, total_bridges_used: 1, mapillary_downloads: 43, mapillary_downloads_cap: 1000,
      mapillary_api_calls: 43, frames_cache_bytes: 4, clips_cache_bytes: 6 });
    expect(dirBytes(path.join(dirs.results, "missing"))).toBe(0);
  });
  it("renders markdown with the totals and the stated limits and no image references", () => {
    const md = renderClipReportMarkdown(r);
    expect(md).toContain("43 of 1000");
    expect(md).toMatch(/billboards, buildings and vehicles/);
    expect(md).toMatch(/RIFE was skipped/);
    expect(md).toMatch(/Real ffprobe has not been run/);
    expect(md).not.toMatch(/!\[|<img|\.(jpg|png|mp4)\b/i);
  });
  it("is deterministic for the same inputs", () => {
    expect(renderClipReportMarkdown(buildClipReport(dirs))).toBe(renderClipReportMarkdown(r));
  });
});
