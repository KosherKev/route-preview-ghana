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
  source_summary?: ReadonlyArray<{ source?: string | null }> | null;
}

/** False when the clip's own source, or ANY source recorded in its source_summary, is disabled. */
export function isClipServable(clip: ClipSourceInfo, env: NodeJS.ProcessEnv = process.env): boolean {
  const disabled = disabledSources(env);
  if (disabled.length === 0) return true;
  if (clip.source && disabled.includes(norm(clip.source))) return false;
  for (const s of clip.source_summary ?? []) {
    if (s?.source && disabled.includes(norm(s.source))) return false;
  }
  return true;
}
