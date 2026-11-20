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
