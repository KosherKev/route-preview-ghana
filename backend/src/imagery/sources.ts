// Imagery source kill switch. ONE place decides whether a street-imagery source may be used or served.
// IMAGERY_SOURCES_DISABLED is a comma-separated list of source names (e.g. "mapillary"). It is read from the
// environment on EVERY call (never cached at import), so flipping it takes effect on the next call without a redeploy.

export const IMAGERY_SOURCES_DISABLED_VAR = "IMAGERY_SOURCES_DISABLED";

/** Parse a raw value: split on commas, trim, lower-case, drop empties, de-duplicate (first-seen order). */
export function parseDisabledSources(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Sources currently disabled. Unset or empty means nothing is disabled. */
export function disabledSources(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseDisabledSources(env[IMAGERY_SOURCES_DISABLED_VAR]);
}

const norm = (name: string) => name.trim().toLowerCase();

export function isSourceEnabled(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return !disabledSources(env).includes(norm(name));
}

export class SourceDisabledError extends Error {
  constructor(readonly source: string) {
    super(`imagery source "${source}" is disabled by ${IMAGERY_SOURCES_DISABLED_VAR}; refusing to use it. Unset or edit the variable to re-enable.`);
    this.name = "SourceDisabledError";
  }
}

export function assertSourceEnabled(name: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!isSourceEnabled(name, env)) throw new SourceDisabledError(norm(name));
}

/** The part of a stored clip the servability check needs. `source_summary` is the clips.source_summary jsonb. */
export interface ClipSourceInfo {
  source?: string | null;
  source_summary?: unknown;
}

/**
 * Clip-serving half of the kill switch. FAILS CLOSED: returns true only when ALL hold.
 *  (a) `source_summary` is undefined/null (legacy row with no summary, treated as "no imagery source recorded")
 *      or a real Array. Anything else (a JSON string from a mis-parsed jsonb, an object, a number) returns false.
 *  (b) every summary entry is a plain object with a non-empty string `source`. Any malformed entry returns false.
 *  (c) neither `clip.source` (when present; a non-string value returns false) nor any entry's source is disabled
 *      (trimmed, case-insensitive).
 * Never throws: any error while inspecting the clip returns false.
 * Limitation: pre-attribution clips default to '[]' (no sources recorded), so they are servable even if built from a
 * now-disabled source. Phase 4 MUST populate source_summary via toSourceSummary when it writes clips.
 */
export function isClipServable(clip: ClipSourceInfo, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (clip === null || typeof clip !== "object") return false;
    const disabled = disabledSources(env);
    const own = clip.source;
    if (own !== undefined && own !== null) {
      if (typeof own !== "string") return false;
      if (disabled.includes(norm(own))) return false;
    }
    const summary = clip.source_summary;
    if (summary === undefined || summary === null) return true;
    if (!Array.isArray(summary)) return false;
    for (let i = 0; i < summary.length; i++) {
      const entry: unknown = summary[i];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
      const s: unknown = (entry as { source?: unknown }).source;
      if (typeof s !== "string" || s.trim() === "") return false;
      if (disabled.includes(norm(s))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
