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

const PLAIN_NAME = /^[a-z0-9_-]+$/;

/**
 * Entries (after trim + lower-case) that are not plain names ([a-z0-9_-]+): fullwidth letters, zero-width spaces,
 * ';' or space used as a separator, dotted capital I, and so on. Matching semantics are NOT changed: such an entry
 * simply matches no source, so it silently disables nothing. This helper exists so that can be made visible.
 */
export function suspiciousDisabledEntries(env: NodeJS.ProcessEnv = process.env): string[] {
  return disabledSources(env).filter((n) => !PLAIN_NAME.test(n));
}

const visible = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
let warned = false;

/**
 * Emit ONE warning per process (not per call) naming any suspicious entries of the switch variable, so a typo such as
 * "mapillary;other" is visible. The variable is not a secret; non-ASCII characters are shown as \u{...} escapes.
 * Returns true only when it actually warned.
 */
export function warnOnceIfSuspiciousSources(
  env: NodeJS.ProcessEnv = process.env, log: (msg: string) => void = (m) => console.warn(m),
): boolean {
  if (warned) return false;
  const bad = suspiciousDisabledEntries(env);
  if (bad.length === 0) return false;
  warned = true;
  log(
    `WARNING: ${IMAGERY_SOURCES_DISABLED_VAR} has entries that are not plain source names and will disable NOTHING: ` +
      `${bad.map((b) => `"${visible(b)}"`).join(", ")}. Use comma-separated names made of a-z, 0-9, "_" and "-" (e.g. "mapillary").`,
  );
  return true;
}

/** Test hook: allow the once-per-process warning to fire again. */
export function resetSuspiciousSourcesWarning(): void {
  warned = false;
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
  /** clips.status; a clip with status "prototype" is never servable. */
  status?: string | null;
  /** clips.render_params; `prototype: true` there also makes the clip unservable. */
  render_params?: unknown;
}

/** clips.status value for prototype clips (Phase 4: built from Mapillary imagery without written permission, D1). */
export const PROTOTYPE_CLIP_STATUS = "prototype";

/**
 * Clip-serving half of the kill switch. FAILS CLOSED: returns true only when ALL hold.
 *  (a) `source_summary` is undefined/null (legacy row with no summary, treated as "no imagery source recorded")
 *      or a real Array. Anything else (a JSON string from a mis-parsed jsonb, an object, a number) returns false.
 *  (b) every summary entry is a plain object with a non-empty string `source`. Any malformed entry returns false.
 *  (0) a clip whose status is "prototype" (or whose render_params.prototype is true) is never servable, for any source.
 *  (c) neither `clip.source` (when present; a non-string value returns false) nor any entry's source is disabled
 *      (trimmed, case-insensitive).
 * Never throws: any error while inspecting the clip returns false.
 * Limitation: pre-attribution clips default to '[]' (no sources recorded), so they are servable even if built from a
 * now-disabled source. Phase 4 MUST populate source_summary via toSourceSummary when it writes clips.
 */
export function isClipServable(clip: ClipSourceInfo, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (clip === null || typeof clip !== "object") return false;
    if (clip.status === PROTOTYPE_CLIP_STATUS) return false;
    const rp = clip.render_params;
    if (rp !== null && typeof rp === "object" && (rp as { prototype?: unknown }).prototype === true) return false;
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

/** Canonical `frames.source` labels. Code must pass one of these explicitly on every insert (D10); the column default is a safety net only. */
export const MAPILLARY_SOURCE = "mapillary" as const;
export const OWN_CAPTURE_SOURCE = "own_capture";
