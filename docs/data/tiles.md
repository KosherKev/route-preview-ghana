# Vector tiles for Accra, v2 (`accra-v2.pmtiles`)

Offline Mapbox Vector Tiles for the Flutter map style. v2 is `data/accra.pmtiles` (Phase 5A, see `docs/validation/phase5a-pmtiles-spike.md`) plus two new layers, `landuse` and `sea`. v1 is not touched; v2 is a new file. Built on servermac with Planetiler (pinned JDK and jar under gitignored `data/tools/`, checksum-checked by the build script) and Python. Free data only.

Output: `data/accra-v2.pmtiles` (gitignored, 21,808,355 bytes, SHA-256 `70fc746ddf9f282a99ca1d7e76937e06a4ec98ec5a049d897fc3a5e789d16725`). v1 `data/accra.pmtiles` is 21,088,228 bytes, SHA-256 `8bf255ccff00351cbed97597c269967215c58ceb52a3976d45a7b4f6c01ed07b`, unchanged.

## Layers
Bounds lon -0.40 to 0.05, lat 5.45 to 5.80 (Greater Accra incl. Tema and Kasoa); tiles z0 to z14, only tiles that touch the bounds. Layer zoom ranges and feature counts (summed over all tiles; a feature cut by a tile edge is counted once per tile):

| Layer | Geometry | Zooms | Attributes | Features |
|---|---|---|---|---|
| `building` | polygon | 13 to 14 | `height`, `min_height`, `building:levels`, `building:min_level`, `roof:height`, `building`, `name` (z14), `height_source` | 766,439 |
| `road` | line | 8 to 14 | `highway`, `name` (z12+), `bridge`, `tunnel` | 522,973 |
| `water` | polygon | 6 to 14 | `natural`, `name` (z12+) | 3,167 |
| `landuse` (new) | polygon | 10 to 14 | `class`, `name` (z13+) | 15,111 |
| `sea` (new) | polygon | 8 to 14 | none | 210 |

`building`, `road` and `water` are unchanged: per-zoom feature counts are identical to v1 (tolerance 0, checked by `scripts/pmtiles/verify_tiles.py`). The building height rule is unchanged: raw OSM `height` and `building:levels` are carried through, `height_source` is `height`, `levels` or `default`, and a client extruding a `default` building applies its own flagged default of 6 m (two storeys). No guessed height is in the tiles.

Suggested draw order, bottom to top: background, `landuse`, `sea`, `water`, `road`, `building`. Put `sea` above `landuse` (OSM landuse polygons often run into the shore) and below `road` and `building` (see "Known limits": some harbour and reclaimed land is 0 m in the DEM).

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

## `sea` derivation
The Geofabrik extract has no ocean polygons, so the sea comes from the Copernicus GLO-30 DEM (see `docs/data/terrain.md` on the branch `task/dem-terrain-tiles` for the source cells, licence and hashes; same two cells, `data/terrain/src/`).
1. Candidate ocean cells: elevation 0 m or below, or nodata.
2. Flood fill (4-connected) from the southern edge of the crop (lat 5.0, open sea). Only candidates connected to the open sea are kept, so 0 m pits and lagoons cut off from the sea are not marked as sea. Crop: lon -0.90 to 0.55, lat 5.0 to 6.0 (wider than the bounds so the sea does not end inside a border tile). 10,282,013 candidate cells, 10,262,221 connected to the sea.
3. Cell edges between sea and non-sea are traced into rings, simplified with Douglas-Peucker at 40 m (about 1.3 DEM cells, inside the 30 to 60 m target), holes assigned to their outer ring. Result: one polygon, 20 holes, 1,078 vertices.
4. Written as a GeoPackage (`data/tmp/sea.gpkg`, built with stdlib `sqlite3`, WGS 84) which Planetiler reads as a `geopackage` source (supported by the pinned release). Tiles are clipped to the build bounds.
`scripts/pmtiles/build_sea.py` does steps 1 to 4 and is deterministic (two runs give the same SHA-256).

## Attribution
- `<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>` for `building`, `road`, `water`, `landuse` (ODbL).
- Sea mask: `produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved`. This is the wording the Copernicus page prescribes for adapted data; licence name and caveats are in `docs/data/terrain.md` (the "ESA User License"; its full text could not be fetched, so check it before redistribution).
Both strings are in the PMTiles metadata `attribution` field (the `licence` is covered by that field; Planetiler's custom schema has no other metadata slot). The app must show both strings wherever the map is shown.

## Known limits
- The sea is exactly "0 m in the DSM and connected to the open sea". Harbours and reclaimed land that the DSM holds at 0 m are inside the sea polygon: 70 of 114,645 z14 buildings (0.06 percent) in tiles that contain sea have their first vertex inside it, clustered at Tema port (about 5.62 N, 0.00 W), the Jamestown/Korle harbour area (about 5.52 to 5.54 N, -0.25 to -0.20 W) and a group at about 5.50 N, -0.34 W (probably offshore or shoreline mapping in OSM; not investigated further). Draw buildings and roads above `sea`.
- The OSM lagoons (Korle, Sakumono) and Weija reservoir are not covered by `sea` (checked at the centre of their `water` polygons).
- `sea` is the DEM's 30 m grid simplified to 40 m: the shoreline can be off by that much against OSM, and beach and lagoon-mouth detail is coarse.
- The sea polygon runs to the crop edge (lon -0.90 and 0.55); at zooms 8 and 9 a border tile covers more than that margin, so there the sea can end abruptly beyond the bounds. Inside the bounds this never shows.
- Tiles are not built from OSM data newer than the Geofabrik extract in `data/osm/`.

## Build and verify (repo root)
```bash
# one-off: pinned tooling (macOS x86_64, CPython 3.14), plus the DEM cells under data/terrain/src (see docs/data/terrain.md)
python3 -m venv data/tools/tiles-venv
data/tools/tiles-venv/bin/pip install --only-binary=:all: --require-hashes -r scripts/pmtiles/requirements.txt
# build: derives the sea GeoPackage, then runs Planetiler (Java 21, -Xmx6g)
scripts/pmtiles/build-accra.sh -0.40,5.45,0.05,5.80 data/accra-v2.pmtiles scripts/pmtiles/accra-base.yml
# verify against v1
data/tools/tiles-venv/bin/python -I scripts/pmtiles/verify_tiles.py data/accra-v2.pmtiles data/accra.pmtiles
```
With no schema argument the script builds v1 as before.

Measured on servermac (2015 MacBook): sea derivation 74 s; Planetiler 31 s wall, peak RSS 2.45 GB (`/usr/bin/time -l`, peak memory footprint 2.32 GB); whole script about 1 min 45 s. Output 21.8 MB; 544 addressed tiles (420 unique), 1,308,037 features. Planetiler writes `build time` into the metadata, so the file is not byte-identical between runs (the sea GeoPackage input is: same SHA-256 on two runs).
