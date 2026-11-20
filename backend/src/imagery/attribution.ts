// Pure attribution helpers: who owns the imagery inside a set of frames (or a rendered clip), under which licence,
// and where to link back. No I/O. Missing creators and licences are tolerated.

export interface AttributionFrame {
  source: string;
  creator_username?: string | null;
  license?: string | null;
  source_url?: string | null;
}

export interface SourceAttribution {
  source: string;
  /** De-duplicated (case-sensitive), in first-seen order. */
  creators: string[];
  /** Distinct licences exactly as stored, in first-seen order (usually one). */
  licenses: string[];
  sourceUrls: string[];
  /** Mapillary's developer terms require crediting with its logo and a link back. */
  requiresLogoAndLink: boolean;
}

export interface Attribution {
  /** One entry per source, in first-seen order. */
  bySource: SourceAttribution[];
  sources: string[];
  creators: string[];
  licenses: string[];
  sourceUrls: string[];
  /** True when ANY source in the set requires the logo and link. */
  requiresLogoAndLink: boolean;
}

/** Shape stored in clips.source_summary (one entry per source). */
export interface SourceSummaryEntry {
  source: string;
  creators: string[];
  /** The licence when all frames agree; several distinct licences are joined with " / "; null when none is known. */
  license: string | null;
  sourceUrls: string[];
}

/** Sources whose terms require the provider logo and a link back when imagery derived from them is shown. */
const LOGO_AND_LINK_SOURCES: ReadonlySet<string> = new Set(["mapillary"]);

const pushUnique = (arr: string[], v: string | null | undefined) => {
  if (typeof v === "string" && v !== "" && !arr.includes(v)) arr.push(v);
};

export function buildAttribution(frames: readonly AttributionFrame[]): Attribution {
  const map = new Map<string, SourceAttribution>();
  for (const f of frames) {
    const source = (f.source ?? "").trim().toLowerCase() || "unknown";
    let e = map.get(source);
    if (!e) {
      e = { source, creators: [], licenses: [], sourceUrls: [], requiresLogoAndLink: LOGO_AND_LINK_SOURCES.has(source) };
      map.set(source, e);
    }
    pushUnique(e.creators, f.creator_username);
    pushUnique(e.licenses, f.license);
    pushUnique(e.sourceUrls, f.source_url);
  }
  const bySource = [...map.values()];
  const all = { creators: [] as string[], licenses: [] as string[], sourceUrls: [] as string[] };
  for (const e of bySource) {
    e.creators.forEach((c) => pushUnique(all.creators, c));
    e.licenses.forEach((l) => pushUnique(all.licenses, l));
    e.sourceUrls.forEach((u) => pushUnique(all.sourceUrls, u));
  }
  return {
    bySource, sources: bySource.map((e) => e.source), ...all,
    requiresLogoAndLink: bySource.some((e) => e.requiresLogoAndLink),
  };
}

/** The clips.source_summary jsonb value for the frames that went into a clip. */
export function toSourceSummary(frames: readonly AttributionFrame[]): SourceSummaryEntry[] {
  return buildAttribution(frames).bySource.map((e) => ({
    source: e.source,
    creators: e.creators,
    license: e.licenses.length ? e.licenses.join(" / ") : null,
    sourceUrls: e.sourceUrls,
  }));
}
