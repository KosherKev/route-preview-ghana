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

## Geocoding and routing by place name

`npm run serve` (in `backend/`, loopback only, port 8787 or `PORT`) exposes:

- `GET /geocode?q=...&near=lat,lon&limit=` returns ranked candidates `{name, lat, lon, source, score, distance_m?}` plus `degraded`.
  The chain is: a coordinate string (`5.6037, -0.1870`, source `coordinates`), then the local Accra landmarks table
  (fuzzy trigram search, source `landmarks`, claims the answer at score >= 0.5), then the self-hosted Photon (source `photon-local`).
  Photon has no score, so photon-local candidates carry a local bigram similarity between the query and the returned name (candidates
  below 0.3 are dropped, so nonsense gives an empty list). `distance_m` appears only when `near` is given. `q` is at most 100 characters,
  no control characters; `limit` is 1 to 20 (default 5). Bad input returns RFC 9457 problem JSON (`application/problem+json`, 400).
- `degraded: true` means the Photon stage was unavailable for this request: Photon is stopped, unreachable, slow (3 s hard timeout) or
  answered badly. It says nothing about the quality of the answer: a `degraded: true` landmark or coordinate answer is exactly the answer
  the full chain would give, because those stages run before Photon. What is lost is the Photon fallback, so a name that is not in the
  local landmarks (for example "Kotoka International Airport") returns an empty list in that state rather than a wrong landmark.
  The response is still a 200, never a 5xx. `degraded: false` means Photon was reachable (or no Photon client is configured).
- `POST /approach` accepts `origin_query` and/or `destination_query` (a place name) instead of `origin` / `destination` (lat/lon);
  give one form per end. Lat/lon requests behave exactly as before. A name is resolved through the same chain and the response gains a
  `resolved` object saying which candidate was used for each named end (`query`, `name`, `lat`, `lon`, `source`, `score`, `degraded`).
- Disambiguation: if the best candidate scores below 0.5, or the top two candidates' scores are within a margin (default 0.05,
  `GEOCODE_DISAMBIGUATION_MARGIN` env var or the `disambiguationMargin` server option) and are more than 500 m apart, no route is
  computed. The response is 422 `application/problem+json` with `title` ("Ambiguous place", "No confident match" or "Place not found"),
  `field` (`origin_query` or `destination_query`), `query`, `degraded` and a `candidates` list; the client picks one and resends its
  coordinates.
- Every `POST /approach` error uses the same RFC 9457 problem JSON as `/geocode` and `/landmarks/search`
  (`application/problem+json`: `type`, `title`, `status`, `detail`; never Valhalla bodies, stack traces or paths). Bad input is 400
  (invalid JSON, missing or out-of-Ghana coordinates, bad costing, over-long or malformed `*_query`), 413 oversized body, 415 wrong
  content type, 405 wrong method, 502 upstream routing failure, 504 deadline. The 422 disambiguation body is the same problem JSON with
  extra members (`field`, `query`, `degraded`, `candidates`). The 200 success body is unchanged.

Photon is the self-hosted Ghana-only geocoder (no public Photon or Nominatim server is ever called). It is stopped by default because it
holds about 300 MiB on the 5 GiB Colima VM next to PostGIS and Valhalla:

```
scripts/fetch-photon.sh                              # once: index and jar into data/photon
docker compose --profile geocoder up -d photon       # start (about 7 s to ready)
docker compose stop photon                           # stop when done
```

Tests that need Photon detect that it is unreachable and skip with a message; `npm test` passes with Photon up or down. Measurements and
query quality: [docs/validation/geocoder-spike.md](docs/validation/geocoder-spike.md).
