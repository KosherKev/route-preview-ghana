# Vector tiles for Accra, v2 (`accra-v2.pmtiles`)

Offline Mapbox Vector Tiles for the Flutter map style. v2 is `data/accra.pmtiles` (Phase 5A, see `docs/validation/phase5a-pmtiles-spike.md`) plus two new layers, `landuse` and `sea`. v1 is not touched; v2 is a new file. Built on servermac with Planetiler (pinned JDK and jar under gitignored `data/tools/`, checksum-checked by the build script) and Python. Free data only.

Output: `data/accra-v2.pmtiles` (gitignored, 21,812,103 bytes, SHA-256 `f8358005e486be65dbc06689bea9c631436e1f59aab05c8ef33721012dfa12fe`; Planetiler writes its build time into the metadata, so a rebuild gives a different hash). v1 `data/accra.pmtiles` is 21,088,228 bytes, SHA-256 `8bf255ccff00351cbed97597c269967215c58ceb52a3976d45a7b4f6c01ed07b`, unchanged.

## Layers
Bounds lon -0.40 to 0.05, lat 5.45 to 5.80 (Greater Accra incl. Tema and Kasoa); tiles z0 to z14, only tiles that touch the bounds. Layer zoom ranges and feature counts (summed over all tiles; a feature cut by a tile edge is counted once per tile):

| Layer | Geometry | Zooms | Attributes | Features |
|---|---|---|---|---|
| `building` | polygon | 13 to 14 | `height`, `min_height`, `building:levels`, `building:min_level`, `roof:height`, `building`, `name` (z14), `height_source` | 766,439 |
| `road` | line | 8 to 14 | `highway`, `name` (z12+), `bridge`, `tunnel` | 522,973 |
| `water` | polygon | 6 to 14 | `natural`, `name` (z12+) | 3,167 |
| `landuse` (new) | polygon | 10 to 14 | `class`, `name` (z13+) | 15,111 |
| `sea` (new) | polygon | 8 to 14 | none | 207 |

`building`, `road` and `water` are unchanged: per-zoom feature counts are identical to v1 (tolerance 0, checked by `scripts/pmtiles/verify_tiles.py`). The building height rule is unchanged: raw OSM `height` and `building:levels` are carried through, `height_source` is `height`, `levels` or `default`, and a client extruding a `default` building applies its own flagged default of 6 m (two storeys). No guessed height is in the tiles.

Suggested draw order, bottom to top: background, `landuse`, `sea`, `water`, `road`, `building`. Put `sea` above `landuse` (OSM landuse polygons often run into the shore) and below `road` and `building`. With the coastline-derived sea no OSM building starts inside `sea` (see "Buildings in the sea"), but roads and buildings on piers and breakwaters can touch it, so draw them above.

## `landuse` class mapping
OSM polygons only; features that carry a `building` tag are excluded (a school building is a building, not landuse). When a polygon matches several rows, the first row in this table wins.

| `class` | OSM tags |
|---|---|
| `park` | `leisure` = park, garden, recreation_ground |
| `pitch` | `leisure` = pitch, stadium, sports_centre |
| `forest` | `natural` = wood; `landuse` = forest |
| `grass` | `landuse` = grass, meadow, village_green; `natural` = grassland, scrub, heath |
| `farmland` | `landuse` = farmland, orchard, allotments |
| `wetland` | `natural` = wetland |
| `beach` | `natural` = beach, sand |
| `cemetery` | `landuse` = cemetery |
| `residential` | `landuse` = residential |
| `commercial` | `landuse` = commercial, retail |
| `industrial` | `landuse` = industrial |
| `institution` | `amenity` = school, university, college, hospital |
| `airport` | `aeroway` = aerodrome |

Feature counts at z14: residential 1,502, pitch 567, grass 516, commercial 513, institution 482, forest 212, industrial 135, farmland 93, wetland 90, park 74, cemetery 32, beach 25, airport 5. No feature falls back to a catch-all class (the schema's `other` default is never produced). Geometry simplification is Planetiler's default for polygons.

## `sea` derivation (OSM coastline)
The Geofabrik extract has no ocean polygons, but it does contain the OSM `natural=coastline` ways. In OSM the land is on the LEFT of a coastline way's direction and the water on the right, so the coastline is the authority for the land/sea boundary.
1. `scripts/pmtiles/osm_coast.py` reads `data/osm/ghana-latest.osm.pbf` (stdlib and numpy only; no download) and writes the coastline ways inside lon -1.10 to 0.75, lat 4.90 to 6.20 to `data/tmp/coast.json` (140 coastline ways in the extract, 62 pieces in that box, 4,626 vertices). About 150 s, run only when `coast.json` is missing or older than the extract or the script.
2. `scripts/pmtiles/build_sea.py` joins the pieces end to start into one west-to-east chain across the crop (lon -0.90 to 0.55, lat 5.0 to 6.0; the build bounds are lon -0.40 to 0.05, lat 5.45 to 5.80) and closes it through the southern edge (lat 4.90): the polygon is everything to the right of the coast. It refuses to continue if the pieces do not join into exactly one chain across the crop, or if that chain runs east to west. Closed counter-clockwise coastline rings (islands) would be holes; there are none in this area. Result: one polygon, no holes, 4,568 vertices, no simplification (Planetiler's own tile simplification applies).
3. Written as a GeoPackage (`data/tmp/sea.gpkg`, stdlib `sqlite3`, WGS 84), read by Planetiler as a `geopackage` source and clipped to the build bounds.
The DEM is not used any more: the sea no longer uses the DEM at all. The first v2 build derived the sea from the Copernicus GLO-30 DEM (0 m cells connected to the open sea). That method is comparison-only and not production-supported: `build_sea.py SRC OUT --method dem` now refuses at once (exit 1, clear message, no GeoPackage, no DEM read), because on the real DEM it dropped 12 inland pit holes (the dropped-hole gate, unchanged for the default method, rightly refuses those: a dropped hole turns land into sea) and its shoreline was wrong at Tema port. The code stays in the file only to document how the comparison sea was made; the comparison tiles of that build are not shipped. Test: `scripts/pmtiles/test_build_sea.py` (`DemMethod`), including a run against the real DEM in `data/terrain/src` when it is present.

### Why the DEM sea was replaced (measured)
A reviewer's points at "Osu Castle" (5.5400, -0.1845) and "Labadi Beach Hotel" (5.5543, -0.1578) came out as sea. Against the OSM coastline both are in fact sea (about 630 m and 140 m offshore): the reviewer's coordinates were wrong, not the polygon there. The real places, found by name as OSM ways (the first search looked at nodes only, which is why they were missing from this document): Osu Castle is way 11827738 (`name=Osu Castle`, `historic=castle`, `alt_name=Fort Christiansborg`), centroid 5.54684, -0.18423; Labadi Beach Hotel is way 11949352 (`name=Labadi Beach Hotel`, `tourism=hotel`), centroid 5.56353, -0.13753. Both are land in the shipped tiles (and in the GeoPackage); `test_orientation.py` checks them. Further OSM nodes found in the extract (looked up by name, not remembered): `Christiansborg` (place=hamlet, the Osu Castle area) at 5.55368, -0.18297; `Labadi Beach` (a bus stop, there is no node with the name of the hotel) at 5.56394, -0.14061; `Ussher Fort` (bus stop) at 5.53834, -0.20893; `Castle Post Office` at 5.54630, -0.18445. All are land by the coastline rule (the Christiansborg node is about 700 m inland) and land in both polygons.
The DEM sea was nevertheless wrong elsewhere. `scripts/pmtiles/check_shoreline.py` samples the coastline every 500 m inside the bounds (193 points, west to east) and measures the distance to the nearest sea polygon edge in the shipped tiles (z14, tile-edge cuts excluded):

| Sea polygon | Median | 95th percentile | Maximum | Land test points classified as sea |
|---|---|---|---|---|
| DEM (first v2 build) | 26.3 m | 930.2 m | 1,471.2 m | 2 of 33 |
| OSM coastline (this build) | 0.1 m | 0.3 m | 0.6 m | 0 of 33 |

DEM worst 5 (lat, lon, offset): 5.60867, -0.00484, 1,471 m; 5.60874, -0.00507, 1,447 m; 5.60494, -0.01304, 1,378 m; 5.61052, -0.00072, 1,377 m; 5.61058, -0.00096, 1,363 m. All are at Tema port: the DSM holds the port and its reclaimed land at 0 m, so the DEM sea ran up to 1.5 km onto land. The two land failures were points 100 m inland (left of the coast) at 5.60715, -0.05781 and 5.62293, -0.00133. The thresholds that trigger a fix were median over 40 m, 95th percentile over 100 m, or any land point in the sea: the 95th percentile and the land points triggered it, the fix was applied at the first attempt.
The offsets of the coastline-derived polygon are tile quantisation only (the same coastline is the source), so they are a consistency check of the build, not an independent measurement. The coastline-rule point checks below use the same rule that built the sea, so they are consistency checks too, not independent ones. The independent evidence is: the DEM comparison above (a different data source), the hand-picked land and sea lists in `verify_tiles.py`, the buildings-in-sea gate (OSM buildings are not derived from the coastline), and `test_orientation.py` (hand-written coordinates, see below).
Test points (coastline-rule consistency check, same rule as the build): 58 classified with the coastline direction rule (land left, water right of the nearest coastline edge), none guessed: 17 land and 23 sea points 100 m either side of the coast, spaced along the whole coast; 16 named OSM nodes (all land); the reviewer's two points (both sea). 33 land, 25 sea, 0 failures with the final tiles. The 14 hand-picked land and 8 hand-picked sea points in `verify_tiles.py` are independent of the rule and also agree with it.

## Orientation test (independent, hand-written coordinates)
`scripts/pmtiles/test_orientation.py` reads the final GeoPackage (`data/tmp/sea.gpkg`) and the built tiles (`data/accra-v2.pmtiles`) and checks 32 hand-written points that do not come from `build_sea.py` or the coastline rule: 11 north-south transects across lon -0.38 to -0.04 (the coast latitude at each longitude was read off the raw OSM `natural=coastline` way, then the points are 0.0045 deg, about 500 m, south and north of it: south must be sea, north must be land), 5 inland places (Kotoka airport, Kwame Nkrumah Circle, Accra Mall, Osu Castle, Labadi Beach Hotel: not sea) and 5 open-sea points south of the coast (sea). The Tema harbour area, where the coast has several pieces, is left out of the transects. Each test also asserts that the same checks all fail when the answer is inverted. Result on the final file: 3 tests pass. With the sea deliberately inverted (a GeoPackage and tiles built from the north side of the coastline, in `/tmp`, not shipped) both the GeoPackage and the tiles test fail with 32 of 32 checks wrong (run recorded in the task report, 2026-11-22). Run it with `SEA_GPKG=... TILES=... test_orientation.py` to point it at other files.

## Test points that were replaced
During the first v2 build two of the builder's own hand-picked land points fell inside the DEM sea and were swapped for others without a record. Which two they were is not recorded anywhere (not in the commits, logs or specs), so it cannot be stated. Hand-picked coordinates have proved unreliable in this project twice (these two, and the reviewer's two), so the shoreline is now checked with coastline-derived points instead (`check_shoreline.py`), and the hand lists in `verify_tiles.py` are a secondary smoke test.

## Estuary strip
The DEM sea left a thin strip of sea inland near (5.515 to 5.526, -0.30) (probably the Densu estuary: 0 m cells connected to the sea through the river mouth). The OSM coastline puts those points on land (for example 5.516, -0.31 is 497 m inland, 5.524, -0.30 is 1,131 m inland), and the coastline-derived sea does not cover it. If the river mouth should show as water the app should rely on the OSM `water` layer there.

## Buildings in the sea
With the DEM sea, 70 of 114,645 z14 buildings (0.06 percent) in tiles that contain sea had their first vertex inside it (Tema port, the Jamestown and Korle harbours, and a group at about 5.50 N, -0.34 W). They were harbour and reclaimed land held at 0 m by the DEM. With the coastline-derived sea the same check gives 0 of 114,645, and `verify_tiles.py` gates on it: it fails if no building is examined (a gate that examines nothing passes vacuously) and if any building starts inside the sea (limit 0, the measured value; the justification is in the code comment). Roads and buildings can still touch `sea` along piers and breakwaters, so the app must draw buildings and roads above `sea`.

## Attribution and licence
- Attribution decision (2026-11-22): the sources listed in the tile metadata are OpenStreetMap contributors only, and the metadata lists exactly the sources used. `<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>` covers every layer, including `sea`, which is derived from the OSM coastline (ODbL). This is the only string in the PMTiles metadata `attribution` field (checked by printing the metadata of the final file: `attribution`, `name`, `description` (names the OSM coastline-derived sea) and `vector_layers` with `sea` at z8 to z14); the app must show it wherever the map is shown.
- The first v2 build also carried the Copernicus WorldDEM-30 attribution because the sea came from the DEM. The sea no longer uses the DEM, so that string was removed from the schema and stays removed. The DEM comparison output is not shipped; if it ever is, the licence note applies: the Copernicus DEM licence is named "ESA User License" in `docs/data/terrain.md` (on main), that name is unconfirmed (its full text could not be fetched), and it must be checked before redistribution.

## Known limits
- `sea` is exactly "right of the OSM coastline within the crop". Where OSM puts the coastline in a harbour or lagoon mouth is where the sea ends; lagoon mouths (Korle, Sakumono) and the Weija reservoir are not covered by `sea` (checked at the centre of their `water` polygons).
- The coast must be one unbroken chain across the crop. If an OSM update breaks it, `build_sea.py` stops with an error instead of guessing.
- The sea polygon runs to the crop edge (lon -0.90 and 0.55); at zooms 8 and 9 a border tile covers more than that margin, so there the sea can end abruptly beyond the bounds. Inside the bounds this never shows.
- Tiles are not built from OSM data newer than the Geofabrik extract in `data/osm/`.

## Build script safety
- `build-accra.sh` decides on the sea step by what the schema file reads (`data/tmp/sea.gpkg`), not by the path string, so `./scripts/pmtiles/accra-base.yml`, `scripts/pmtiles/../pmtiles/accra-base.yml` and absolute paths all run it. It deletes `sea.gpkg` first and stops with `ERROR` unless the step produced a GeoPackage newer than `coast.json` and `build_sea.py`. Tests: `scripts/pmtiles/test_build_guard.sh` (path forms, v1 skips, stale file, failing step, back-dated file). The old script, given `./scripts/pmtiles/accra-base.yml` and a stale `sea.gpkg`, went straight on to Planetiler with the stale file.
- `build_sea.py` counts dropped degenerate rings and orphan holes, prints them, and exits 1 without writing a GeoPackage if any hole was dropped (a dropped hole turns land into sea). Tests: `scripts/pmtiles/test_build_sea.py`. `--method dem` refuses outright (comparison-only), so the gate is never reached on the DEM path.
- `verify_tiles.py` fails the buildings-in-sea gate if it examined zero buildings, and the landuse class check if landuse is empty. Tests: `scripts/pmtiles/test_verify_gate.py`.

## Build and verify (repo root)
```bash
# one-off: pinned tooling (macOS x86_64, CPython 3.14); the DEM is no longer needed
python3 -m venv data/tools/tiles-venv
data/tools/tiles-venv/bin/pip install --only-binary=:all: --require-hashes -r scripts/pmtiles/requirements.txt
# build: extracts the coastline (cached), derives the sea GeoPackage, then runs Planetiler (Java 21, -Xmx6g)
scripts/pmtiles/build-accra.sh -0.40,5.45,0.05,5.80 data/accra-v2.pmtiles scripts/pmtiles/accra-base.yml
# verify against v1
data/tools/tiles-venv/bin/python -I scripts/pmtiles/verify_tiles.py data/accra-v2.pmtiles data/accra.pmtiles
# shoreline against the OSM coastline (needs data/tmp/coast.json from the build)
data/tools/tiles-venv/bin/python -I scripts/pmtiles/check_shoreline.py data/tmp/coast.json data/accra-v2.pmtiles
# script tests
scripts/pmtiles/test_build_guard.sh; data/tools/tiles-venv/bin/python -I scripts/pmtiles/test_build_sea.py; data/tools/tiles-venv/bin/python -I scripts/pmtiles/test_verify_gate.py
data/tools/tiles-venv/bin/python -I scripts/pmtiles/test_orientation.py
```
With no schema argument the script builds v1 as before.

Measured on servermac (2015 MacBook, `/usr/bin/time -l`): coastline extraction 152 s, peak RSS 0.41 GB (cached afterwards); `build_sea.py` under 1 s; Planetiler about 30 s wall; the whole `build-accra.sh` run with a cached coastline 29.9 s real, peak RSS 2.55 GB (peak memory footprint 2.38 GB). Output 21.8 MB; 544 addressed tiles (424 unique), 1,308,000 features. Planetiler writes `build time` into the metadata, so the file is not byte-identical between runs (the sea GeoPackage input is deterministic).
