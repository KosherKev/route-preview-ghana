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
Rows are upserted into `frames` with `source = 'mapillary'`.

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
tiling), the licence string stored per frame (`CC-BY-SA-4.0`; legal review is deferred to Phase 6), and the real response paging shape.

## Phase 3: approach extractor, map-matcher, mode classifier

Pre-trip preview only: origin and destination are fixed inputs; nothing follows a live position or gives turn-by-turn guidance.
Imagery stays behind `StreetImagerySource`: `src/classify/*` reads plain `FrameRecord`s (from the `frames` table via `load.ts`, or fixtures)
and imports no Mapillary code. Coordinates are always named `{lat, lon}` objects; local metres are `{x: east, y: north}`.

### Extractor (`src/routing/approach.ts`, `server.ts`)

`extractApproach(costing, origin, destination, opts)` returns the polyline, ordered Valhalla edge ids (`trace_attributes`, `map_snap` of the
route shape; its shape is identical to the route's, so edge shape indices are route indices), maneuvers, the final approach (default 500 m
measured ALONG the route, cut exactly; routes no longer than that return the whole route) and decision windows (default 80 m total width,
centred on the maneuver point, for turns, roundabouts, merges and ramps/exits/forks).

- `auto` + `exclude_unpaved` with "No path could be found" (Valhalla error 442) is retried once without the exclusion: `unpaved_fallback: true`,
  an entry in `warnings`, and a `warn` callback (default `console.warn`). Any other failure, a failing retry, and every `motor_scooter` failure
  propagate as errors. Known: the scooter costing refuses gravel/path surfaces and has no unpaved option, so a pair that needs unpaved roads has
  NO scooter route (e.g. the regression pair in `test/approach.integration.test.ts`); that is reported, not hidden.
- HTTP: `npm run serve` (127.0.0.1 only, `PORT` default 8787). `POST /approach` with
  `{"origin":{"lat":5.6361,"lon":-0.175},"destination":{"lat":5.5502,"lon":-0.2174},"costing":"auto","approach_length_m":500,"decision_window_m":80}`;
  `GET /health`. Validates input (Ghana bounding box, costing enum, numeric ranges), 4 KB body cap, 60 s deadline (504), Valhalla calls have their own 30 s timeout.

### Matcher and classifier (`src/classify/`)

Thresholds (all in `DEFAULT_MATCH_CONFIG` / `DEFAULT_CLASSIFY_CONFIG`):

| Rule | Value |
| --- | --- |
| Projection | each frame is projected onto the nearest route segment in a local equirectangular frame (error well under 0.1% at Accra); offsets rounded to 1 mm |
| Lateral tolerance | 15 m from the centreline, else dropped (`off_route`) |
| Right-hand lane | more than 3 m LEFT of the centreline (in the direction of travel) is dropped (`left_of_centerline`); the right side is kept out to 15 m |
| Heading | `computed_compass_angle` within +/-25 deg (inclusive) of the segment bearing AT the frame's projected position, wrap-safe at 0/360 |
| Quality | `quality_score` >= 0.5; unscored frames are dropped unless `allowMissingQuality` |
| Sequence | one per route edge: keep the previous edge's sequence if it still has frames, else most frames, then most recent capture, then id |
| Street run | extent >= 60 m (inclusive) AND the MAXIMUM consecutive gap strictly < 15 m (a gap of exactly 15.0 m does not qualify; 14.999 does) |
| Crossfade | two qualifying runs of one sequence separated by a gap of 15 m to 30 m (inclusive) become ONE street segment with the gap listed in `crossfades` |
| Handoff | any larger gap, a non-qualifying run, a sequence change or no frames is BIRDS_EYE_3D |
| `level_uncertain` | between consecutive frames closer than 30 m at an edge transition: sequence change, heading-relative-to-road change > 30 deg, or road class / use / bridge / tunnel / layer change while the sequence continues; the span plus 20 m each side is forced to BIRDS_EYE_3D and never merged away |

Valhalla 3.9.3 `trace_attributes` exposes no OSM `layer` tag, so `bridge`, `tunnel`, `use` (ramp) and `road_class` stand in for it
(`EdgeSpan.layer` is honoured when a source provides it).

### Validation harness

`npm run validate` runs 25 real Accra pairs with both costings against the live Valhalla and PostGIS and writes
`../docs/validation/route-validation.{md,json}`. It never calls Mapillary. With the empty `frames` table every routed row is BIRDS_EYE_3D and the
report says plainly that live coverage was NOT measured. A separate SYNTHETIC section demonstrates each classifier outcome.
