# backend

TypeScript (Node >= 20.3; developed on Node 24). `tsconfig` targets ES2024 so `AbortSignal.any` type-checks.

```
cp ../.env.example ../.env   # then set a local POSTGRES_PASSWORD (git-ignored)
npm install
npm test                     # vitest; DB tests need the PostGIS container (see below)
npm run typecheck
```

## Local stack (repo root)

```
curl -L -o data/ghana-latest.osm.pbf https://download.geofabrik.de/africa/ghana-latest.osm.pbf   # git-ignored
docker compose up -d         # project name: route-preview-ghana
docker compose ps
```

Both services publish on 127.0.0.1 only: Valhalla `127.0.0.1:8002`, PostGIS `127.0.0.1:5433` (host Postgres keeps 5432).
Volumes are `route-preview-ghana_valhalla_tiles` and `route-preview-ghana_postgis_data`. Container memory limits: Valhalla 2 GB, PostGIS 1 GB
(the Colima VM has about 5 GB, so run only one heavy container job at a time).

### Valhalla

- Image: `ghcr.io/valhalla/valhalla:3.9.3` (pinned in `docker-compose.yml`).
- On first start `docker/valhalla/entrypoint.sh` writes the config and builds tiles from `data/ghana-latest.osm.pbf` with
  `mjolnir.concurrency = 2` (no timezone/admin DBs, no elevation, no transit), then serves with 2 threads. To rebuild, remove the
  project volume `route-preview-ghana_valhalla_tiles` and bring the service up again.
- Unpaved-surface handling, using only what 3.9.3 supports (checked against the 3.9.3 API docs and `src/sif/`):
  - `auto`: `costing_options.auto.exclude_unpaved = true` (unpaved edges are not allowed in the middle of a route; start/end may be unpaved).
  - `motor_scooter`: 3.9.3 has no `exclude_unpaved` or `use_trails` option for this costing. It has a built-in surface penalty
    (speed multipliers paved 1.0, paved_rough 0.9, compacted 0.6, dirt 0.1; gravel, path and impassable surfaces are refused), which is
    always on. Only `top_speed = 45` is sent.
  - Both are set in `src/routing/valhalla.ts` (`COSTING_OPTIONS`).
  - Evidence (local Valhalla 3.9.3, 1 batch of 60 random pairs inside the `tetteh-quarshie-accra-central` corridor; 2 pairs differed).
    Pair 5.61753 N, 0.21187 W to 5.60975 N, 0.22380 W (surface per edge from `trace_attributes`):
    `auto` + `exclude_unpaved: true` = 5.518 km, 33 edges, all paved (0 km dirt); plain `auto` = 4.738 km, 30 edges, with 1.072 km of
    dirt; `motor_scooter` = 5.479 km, 42 edges, all paved. So `exclude_unpaved` demonstrably re-routes, and the scooter's built-in
    penalty also avoided that dirt shortcut here. A second pair (5.62049 N, 0.21580 W to 5.63282 N, 0.20257 W) shows start/end tolerance:
    with `exclude_unpaved` the route is still 2.183 km dirt (unpaved edges at the ends are allowed), 2.849 km vs 3.043 km without it; the
    scooter took 4.388 km with 0.095 km dirt. This is one pair per behaviour, not a statistical result. Reproduce with
    `test/valhalla-unpaved.integration.test.ts` (skips when Valhalla is not reachable).
  - Phase 3 risk: `auto` `exclude_unpaved` is a HARD exclusion, so it may fail to route between points linked only by unpaved
    roads. Observed: in the same 60-pair batch, 4 pairs returned "No path could be found" with `exclude_unpaved: true` while plain
    `auto` routed them. Phase 3 must handle that (fall back to plain `auto` or `motor_scooter`) rather than assume a route exists.
  - Ingest guards: `--max-tiles` raises the per-run tile cap (default 400); antimeridian-crossing bboxes are rejected.
- Route with edge ids (`/route` for the polyline, then `/trace_attributes` with `shape_match: map_snap` for edge ids):

```
npm run route -- motor_scooter 5.6361,-0.1750 5.5502,-0.2174
npm run route -- auto          5.6361,-0.1750 5.5502,-0.2174
```

Points used: 5.6361 N, 0.1750 W (Tetteh Quarshie Interchange area) to 5.5502 N, 0.2174 W (Accra Central area).

### PostGIS

- Image `postgis/postgis:16-3.5`, credentials from `.env`.
- Migrations live in `migrations/*.sql` (additive only) and are applied in name order, tracked in `schema_migrations`:
  `npm run db:migrate`. Tables: `frames`, `clips`, `landmarks`; geometry columns are `Point, 4326`.
- Landmarks (fuel, amenity, junction, tro-tro stop) are loaded from the extract by `../scripts/load-landmarks.sh`, which runs a throwaway
  `ghcr.io/osgeo/gdal:ubuntu-small-3.10.3` container (`ogr2ogr`) against the Greater Accra bounding box `-0.60 5.40 0.40 6.10`
  (a box, not the administrative boundary; override with `LANDMARK_BBOX`). Nothing is committed.
- DB tests (`test/migrations.test.ts`, `test/landmarks.test.ts`, `test/ingest-store.test.ts`) each create and drop their own throwaway
  database on the container, so `docker compose up -d postgis` must be running for `npm test`.

## Mapillary ingestion

`src/ingest/mapillary.ts` implements `StreetImagerySource` (`src/patterns/imagerySource.ts`) for Graph API v4 `graph.mapillary.com/images`:
bbox queries (large boxes are tiled at 0.09 degrees per side), radius queries (`closeto` + `radius`), frame fields
(`computed_geometry`, `computed_compass_angle`, `captured_at`, `sequence`, `is_pano`, `camera_type`, `width`, `height`, `quality_score`,
`creator`), 250 ms throttle, and `Retry-After` (seconds or HTTP date) honored on 429/5xx with exponential backoff otherwise.
Rows are upserted into `frames` with `source = 'mapillary'`, plus attribution fields (see below).

The token comes only from `MAPILLARY_TOKEN` in `.env` and is sent only as an `Authorization` header. If it is unset the command stops
with a message before any request. Tests use mocked HTTP only.

```
npm run ingest:mapillary -- --bbox minLon,minLat,maxLon,maxLat
npm run ingest:mapillary -- --corridor tetteh-quarshie-accra-central
```

Accra corridor boxes (`minLon,minLat,maxLon,maxLat`, in `src/ingest/corridors.ts`) to use later:

| Corridor | bbox |
| --- | --- |
| `tetteh-quarshie-accra-central` | `-0.235,5.535,-0.165,5.645` |
| `accra-core` | `-0.27,5.5,-0.1,5.7` |

No live ingestion has been run. Unverified until a real token exists: the API's bbox area cap (assumed about 0.01 square degrees, hence the
tiling), the licence stored per frame (the API reports none, so `DEFAULT_MAPILLARY_LICENSE` in `src/ingest/mapillary.ts` is used; legal review is deferred to Phase 6), and the real response paging shape.

## Imagery source kill switch

Set `IMAGERY_SOURCES_DISABLED` to a comma-separated list of source names to switch a street-imagery source off without a code change
(e.g. `IMAGERY_SOURCES_DISABLED=mapillary`; names are trimmed and case-insensitive, empty entries ignored, unset = nothing disabled).
The one implementation is `src/imagery/sources.ts` (`disabledSources`, `isSourceEnabled`, `assertSourceEnabled`, `isClipServable`).
It is read from the environment on every call, never cached at import, so it takes effect on the next call (for a long-running process,
set it in that process's environment and the next request sees it; there is no admin endpoint).

What it does when a source is disabled:

- `npm run ingest:mapillary` refuses (exit code 4, "imagery source "mapillary" is disabled by IMAGERY_SOURCES_DISABLED") before any token check, network or DB access; `MapillarySource` also refuses every query, and re-checks the switch before every page fetch and every retry attempt, so an in-flight ingestion stops at its next request (with the same error) when the variable is set mid-run.
- The frame loader (`src/classify/load.ts`) drops that source's frames before classification, so affected routes classify `BIRDS_EYE_3D`.
- The classifier result (`PipelineResult.sourcesExcluded`) and the validation summary report which disabled sources had frames excluded (`[]` when none).
- `isClipServable(clip)` FAILS CLOSED and never throws. It returns true only if (a) `source_summary` is undefined/null (a legacy row with no summary, treated as "no imagery source recorded") or a real Array, (b) every entry is a plain object with a non-empty string `source`, and (c) neither `clip.source` (if present, it must be a string) nor any entry's source is disabled. Any non-array value (e.g. a JSON string from a mis-parsed jsonb), any malformed entry, or any error while inspecting returns false. Limitation: pre-attribution clips default to `'[]'` (no sources recorded) and so stay servable; Phase 4 MUST populate `source_summary` via `toSourceSummary` when it writes clips. Anything that serves a stored clip must call it.

What it does NOT do: it does not delete stored frames or clips; it does not recall anything already served, cached or copied elsewhere; it has
no authentication (whoever controls the process environment controls it); and it is not retroactive for a process that has already read
the value into its own variables (the helpers re-read on each call, so this only matters for code that copies the result).

## Attribution fields

Migration `migrations/005_attribution_fields.sql` is additive only (`ADD COLUMN IF NOT EXISTS`): `frames.creator_username text NULL`,
`frames.source_url text NULL`, `clips.source_summary jsonb NOT NULL DEFAULT '[]'`. `frames.source` (NOT NULL, no default), `frames.creator`
and `frames.license` already existed from migration 002 and are untouched.

- `creator_username` overlaps the pre-existing `creator` column: `creator` falls back to the numeric creator id when no username is returned; `creator_username` is the username only (null otherwise). Prefer `creator_username` for credits.
- A DEFAULT on `frames.source` would need `ALTER COLUMN`, which is not additive; it needs an interactive migration the owner approves, so it was not done. The ingestion always writes `source` explicitly.
- Ingestion requests the `creator` field and maps `creator.username` to `creator_username`. `source_url` is the Mapillary image page, `https://www.mapillary.com/app/?pKey=<image_id>`.
- `license` stores what the source reports; only when the source states none, the single constant `DEFAULT_MAPILLARY_LICENSE` is used.
- `src/imagery/attribution.ts`: `buildAttribution(frames)` (de-duplicated creators, licences, source URLs, per-source entries, `requiresLogoAndLink: true` for Mapillary) and `toSourceSummary(frames)` (the `clips.source_summary` shape `[{source, creators[], license, sourceUrls[]}]`, one per source).

Apply and re-apply: `npm run db:migrate` applies `005` once; running it again prints "no pending migrations" (the SQL itself is also safe to re-run).
Live apply on 2026-11-20 against the project PostGIS container: applied, columns verified, second run a no-op (`frames` and `clips` were empty; no ingestion had been run).

Manual rollback (documented only; never run automatically, and `schema_migrations` would also need `DELETE FROM schema_migrations WHERE name = '005_attribution_fields.sql'`):

```sql
ALTER TABLE frames DROP COLUMN IF EXISTS creator_username;
ALTER TABLE frames DROP COLUMN IF EXISTS source_url;
ALTER TABLE clips  DROP COLUMN IF EXISTS source_summary;
```

## Phase 3: approach extractor, map-matcher, mode classifier

**Branch status.** This branch is intentionally NOT merged to main: it is cut from the unmerged Phase 2 branch, which carries SQL migrations, and the auto-merge bar permanently excludes work touching migrations; it is pushed and PR-ready for human review.

Pre-trip preview only: origin and destination are fixed inputs; nothing follows a live position or gives turn-by-turn guidance.
Imagery stays behind `StreetImagerySource`: `src/classify/*` reads plain `FrameRecord`s (from the `frames` table via `load.ts`, or fixtures)
and imports no Mapillary code. Coordinates are always named `{lat, lon}` objects; local metres are `{x: east, y: north}`.

### Extractor (`src/routing/approach.ts`, `server.ts`)

`extractApproach(costing, origin, destination, opts)` returns the polyline, ordered Valhalla edge ids (`trace_attributes`, `map_snap` of the
route shape). The matched shape is verified against the route shape: identical, or the same vertices with the leading/trailing vertex dropped by `map_snap` (observed live; `route.matchedShapeTrim` reports it and the indices are shifted back); any other difference is an error, never silently misaligned offsets, maneuvers, the final approach (default 500 m
measured ALONG the route, cut exactly; routes no longer than that return the whole route) and decision windows (default 80 m total width,
centred on the maneuver point, for turns, roundabouts, merges and ramps/exits/forks).

- `auto` + `exclude_unpaved` with "No path could be found" (Valhalla error 442) is retried once without the exclusion: `unpaved_fallback: true`,
  an entry in `warnings`, and a `warn` callback (default `console.warn`). Any other failure, a failing retry, and every `motor_scooter` failure
  propagate as errors. Known: the scooter costing refuses gravel/path surfaces and has no unpaved option, so a pair that needs unpaved roads has
  NO scooter route (e.g. the regression pair in `test/approach.integration.test.ts`); that is reported, not hidden.
- HTTP: `npm run serve` (127.0.0.1 only, `PORT` default 8787). `POST /approach` with
  `{"origin":{"lat":5.6361,"lon":-0.175},"destination":{"lat":5.5502,"lon":-0.2174},"costing":"auto","approach_length_m":500,"decision_window_m":80}`;
  `GET /health`. Validates input (Ghana bounding box, costing enum, numeric ranges), requires `Content-Type: application/json` (415), 4 KB body cap (413, connection closed), 60 s deadline (504; the in-flight Valhalla fetches are aborted), Valhalla calls have their own 30 s timeout. Client errors are generic (`upstream routing failure`, `invalid request`); details go only to the server-side `onError` log.

### Matcher and classifier (`src/classify/`)

Thresholds (all in `DEFAULT_MATCH_CONFIG` / `DEFAULT_CLASSIFY_CONFIG`):

| Rule | Value |
| --- | --- |
| Projection | each frame is projected onto the nearest route segment in a local equirectangular frame (error well under 0.1% at Accra); offsets rounded to 1 mm |
| Lateral tolerance | true (clamped) distance to the route polyline at most 15 m, else dropped (`off_route`); frames beyond the route ends or past an outer bend vertex are measured to the end/vertex, not to the infinite line |
| Right-hand lane | more than 3 m LEFT of the centreline (in the direction of travel) is dropped (`left_of_centerline`); the right side is kept out to 15 m |
| Heading | `computed_compass_angle` within +/-25 deg (inclusive) of the segment bearing AT the frame's projected position, wrap-safe at 0/360 |
| Quality | `quality_score` >= 0.5; unscored frames (null or non-finite, e.g. NaN) are dropped unless `allowMissingQuality` |
| Sequence | one per route edge: keep the previous edge's sequence if it still has frames, else most frames, then most recent capture, then id |
| Street run | extent >= 60 m (inclusive) AND every consecutive gap strictly < 15 m (a gap of exactly 15.0 m is not part of a run; 14.999 is) |
| RIFE tier (gap < 15 m) | AI frame interpolation is permitted ONLY between consecutive frames spaced strictly less than 15 m apart, never across a 15 m or larger gap |
| Bridge tier (15 m <= gap <= 30 m, both ends inclusive) | two qualifying runs (each >= 60 m, internal gaps < 15 m, headings within +/-25 deg) separated by one such gap are merged into ONE contiguous STREET_VIDEO segment; the gap is a crossfade bridge and is NEVER RIFE-interpolated. Exactly 15 m and exactly 30 m are bridges |
| Handoff tier (gap > 30 m) | a gap over 30 m, or any run shorter than 60 m that cannot be bridged into a qualifying segment, ends the STREET_VIDEO segment and hands off to BIRDS_EYE_3D (also: a sequence change, no frames) |
| `level_uncertain` | between consecutive frames closer than 30 m at an edge transition: sequence change, heading-relative-to-road change > 30 deg, or road class / use / bridge / tunnel / layer change while the sequence continues; the span plus 20 m each side is forced to BIRDS_EYE_3D and never merged away |

All distance and threshold comparisons (gap tiers, extent, merge) are done in integer millimetres via `src/classify/mm.ts`, so an exact 15.000 m gap or 60.000 m extent is never decided by float noise. Frames are de-duplicated by `imageId` before sequence selection (latest `capturedAt` kept, ties keep the first; others drop as `duplicate_image`).

#### Two-tier gap rule: output fields and notes

The two-tier gap rule above was **confirmed by the owner 2026-11-20**. Each STREET_VIDEO segment carries:

- `bridges`: `[{ startM, endM, gapM, rifeEligible: false }]` in route order, one per crossfade bridge. A renderer crossfades across `startM..endM` and must not RIFE-interpolate there.
- `rifeCeilingM`: the RIFE ceiling (15). A gap between consecutive frames is RIFE-eligible iff it is strictly below it (`isRifeEligible(gapM)` / `classifyGap(gapM)` in `src/classify/classify.ts` return `rife | bridge | handoff`).
- `internalMaxGapM`: largest frame gap inside the runs, excluding bridges; always < `rifeCeilingM`, so every internal gap is RIFE-eligible and every bridge is not.
- `crossfades`: compatibility alias of `bridges` (same start/end/gap, no `rifeEligible` flag). Prefer `bridges`.

BIRDS_EYE_3D segments have `bridges: []`, `crossfades: []` and `internalMaxGapM: null`.

**Pairwise-chain assumption (stated explicitly, for the owner to confirm).** The rule is applied pairwise: a chain of qualifying runs, each joined to the next by a single 15-30 m gap, merges into ONE segment with several bridges (three runs and two valid gaps: one segment, two bridges). A gap over 30 m anywhere in the chain ends the segment there, and the next qualifying run starts a new segment after a BIRDS_EYE_3D handoff. A run under 60 m is never bridged, even between two valid runs.

The 3 m left-offset limit (`maxLeftOffsetM`) is a builder-chosen, configurable parameter that is not in the spec.

- **`level_uncertain` is conservative.** Any road-class change and every sequence handover at an edge transition triggers it, and the +/-20 m span is absorbed into the surrounding BIRDS_EYE_3D segment. It may over-flag on dense real data; no real imagery has been measured yet.

Valhalla 3.9.3 `trace_attributes` exposes no OSM `layer` tag, so `bridge`, `tunnel`, `use` (ramp) and `road_class` stand in for it
(`EdgeSpan.layer` is honoured when a source provides it).

### Validation harness

`npm run validate` runs 25 real Accra pairs with both costings against the live Valhalla and PostGIS and writes
`../docs/validation/route-validation.{md,json}`. It never calls Mapillary. With the empty `frames` table every routed row is BIRDS_EYE_3D and the
report says plainly that live coverage was NOT measured. A separate SYNTHETIC section demonstrates each classifier outcome.
