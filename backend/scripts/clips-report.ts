// Regenerates docs/validation/phase4-clips.md and phase4-clips.json from the gitignored clip results. Needs no token, DB or network.
//   npm run clips:report
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClipReport, renderClipReportMarkdown } from "../src/clips/report";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const data = path.join(repoRoot, "data");
const report = buildClipReport({
  results: path.join(data, "clips", "results"), plans: path.join(data, "clips", "plans"), budgetFile: path.join(data, "mapillary-budget.json"),
  framesCache: path.join(data, "frames-cache"), clipsCache: path.join(data, "clips-cache"),
});
const out = path.join(repoRoot, "docs", "validation");
writeFileSync(path.join(out, "phase4-clips.md"), renderClipReportMarkdown(report));
writeFileSync(path.join(out, "phase4-clips.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`wrote phase4-clips.md and phase4-clips.json: ${report.totals.clips} clips, ${report.totals.mapillary_downloads}/${report.totals.mapillary_downloads_cap} downloads`);
