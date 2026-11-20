# route-preview-ghana

Pre-trip route preview for Ghana dispatch riders: eye-level street video plus a 3D MapLibre flyover, focused on the last ~500 m.

## Product boundary

- Pre-trip preview only. It is never synced to live GPS.
- Live navigation is out of scope.
- Keep the architecture modular: the street-imagery source (Mapillary now, rider-captured later) and the renderer sit behind swappable interfaces.

## Decisions

Closed product and architecture decisions (D1 to D6, 2026-11-20) are recorded in [docs/decisions/DECISIONS.md](docs/decisions/DECISIONS.md).

## Imagery source kill switch

`IMAGERY_SOURCES_DISABLED=mapillary` (comma-separated source names, read on every call) stops ingestion from that source, removes its frames
before route classification (affected routes fall back to `BIRDS_EYE_3D`, reported as `sourcesExcluded`), and makes stored clips derived from it
not servable (`isClipServable`). It does not delete stored data, recall anything already served elsewhere, or add authentication. Details,
attribution fields (`creator_username`, `source_url`, `clips.source_summary`) and the migration rollback SQL: [backend/README.md](backend/README.md).

## Layout

- `backend/` API and pattern stubs
- `worker/` video/segment workers (later phases)
- `flutter_app/` rider app (later phases)
- `data/` local data, git-ignored
- `reference/` notes on third-party references; clones are git-ignored
