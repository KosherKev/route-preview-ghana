# route-preview-ghana

Pre-trip route preview for Ghana dispatch riders: eye-level street video plus a 3D MapLibre flyover, focused on the last ~500 m.

## Product boundary

- Pre-trip preview only. It is never synced to live GPS.
- Live navigation is out of scope.
- Keep the architecture modular: the street-imagery source (Mapillary now, rider-captured later) and the renderer sit behind swappable interfaces.

## Layout

- `backend/` API and pattern stubs
- `worker/` video/segment workers (later phases)
- `flutter_app/` rider app (later phases)
- `data/` local data, git-ignored
- `reference/` notes on third-party references; clones are git-ignored
