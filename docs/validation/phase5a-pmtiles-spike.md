# Phase 5A PMTiles feasibility spike (2026-11-21)

Goal: a local `accra.pmtiles` (OSM vector tiles with building properties) for the Accra metropolitan bounding box, built from the Geofabrik
Ghana extract, using only verified binaries. Result: **built, 21,088,228 bytes, zoom 0 to 14 (tiles from z6), in 24 s using 2.35 GB RSS.**
Output is under `data/` (gitignored, not committed). Nothing here uses Mapillary.

## Verified tooling (nothing unverified was installed or run)

| Item | Source | Verification |
| --- | --- | --- |
| Temurin JDK 21.0.13.1+2, `OpenJDK21U-jdk_x64_mac_hotspot_21.0.13.1_2.tar.gz` (Intel macOS, 193,986,883 bytes) | `github.com/adoptium/temurin21-binaries` release asset, found via the Adoptium API (`api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=mac`) | SHA-256 `1b5eff1741bb83d32e2e19aade71452bb42e40f047c01d3e178d438304c9a26d`: the API `checksum` field, the published `.sha256.txt` and `shasum -a 256` of the download all agree; checked BEFORE extracting. Tar listing had no absolute or `..` entries. |
| Extracted JDK | `data/tools/jdk-21/jdk-21.0.13.1+2/` (project-scoped, gitignored, not Homebrew) | `java -version`: Temurin-21.0.13.1+2 |
| Planetiler v0.10.2 `planetiler.jar` (93,278,824 bytes) | `github.com/onthegomap/planetiler/releases/tag/v0.10.2` | SHA-256 `f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d`: the GitHub release asset `digest` field, the published `planetiler.jar.sha256` file and `shasum -a 256` all agree. The build script re-checks it before every run and refuses to run on a mismatch. (The `.sha256` file itself has digest `2dc93aaec9bbb50092d29e59e7de2e809c3ad329a8faea5279dc3bfa20487775` per the API.) |
| Geofabrik `ghana-latest.osm.pbf` (117,199,750 bytes, snapshot of 2026-11-21) | `download.geofabrik.de/africa/ghana-latest.osm.pbf` | MD5 `64cf4ebb486ef5e69e850e9c8b5d49a6` matches the published `.md5`; SHA-256 recorded as `fad4e9cd47a0e73ba978131994378229aeefb353cdd142e2d5438e8b6ff7e816`. A fresh download, not the Phase 2 copy (that worktree was not touched; its file is the 2026-11-20 snapshot). |

Attempts: JDK, 1 (worked). Planetiler: the first run used its default OpenMapTiles profile, which stops because it needs Natural Earth,
water-polygon and lake-centerline downloads that have no published checksum; that profile was not used. Second attempt, a custom
OSM-only schema (`scripts/pmtiles/accra-buildings.yml`), worked first time (a 3 km square test, then the full box).

## Build

```
scripts/pmtiles/build-accra.sh            # from the repo root; bounds default -0.40,5.45,0.05,5.80
python3 -I scripts/pmtiles/stats.py data/accra.pmtiles
```

Bounds: lon -0.40 to 0.05, lat 5.45 to 5.80 (about 51 km by 39 km: Accra, Tema, Kasoa). Layers: `building` (from z13), `road` (from z8),
`water` (OSM `natural=water`, from z6). No elevation, no OSM landuse or labels beyond names: a spike base map, not a style.

| Metric | Value |
| --- | --- |
| File size | 21,088,228 bytes (21 MB); sha256 `8bf255ccff00351cbed97597c269967215c58ceb52a3976d45a7b4f6c01ed07b` |
| Format | PMTiles v3, MVT, gzip tiles; header zoom 0 to 14, tiles present z6 to z14, 414 tiles (272 at z14, 84 at z13) |
| Build time | 24 s wall (osm_pass1 4 s, osm_pass2 about 13 s), 8 cores |
| Memory | 2.35 GB maximum resident set, 2.18 GB peak footprint (`/usr/bin/time -l`, `-Xmx6g`); the 16 GB host was otherwise idle; Colima VM not touched |
| Features at z14 | 717,451 building, 113,459 road, 889 water |
| Data errors | 386 `render_snap_fix_input` geometry snaps (Planetiler repaired them) |

## Building heights: real versus default

The tiles carry raw OSM `height`, `building:levels`, `min_height`, `building:min_level`, `roof:height` and a `height_source` flag
(`height`, `levels` or `default`). No height number is invented in the tiles; a client extruding a `default` building must apply a
documented default of 6 m (two storeys), and should draw it flagged, not as measured.

Counted from the z14 tiles (a building crossing a tile edge appears in each tile, so the shares are per tile feature):

| Source | Features | Share |
| --- | --- | --- |
| Usable `height` tag | 68 (82 have the tag, 14 not parsable as metres) | 0.01 % |
| Usable `building:levels` only | 33,085 (33,136 have the tag) | 4.61 % |
| **Real total** | **33,153** | **4.62 %** |
| **Flagged default** | **684,298** | **95.38 %** |

So in Accra today about 95 % of buildings would extrude at the flagged default. Extruded 3D buildings are feasible as a visual aid
only; do not present the heights as measured.

## Open Buildings (D4): the finding

Google Open Buildings v3 polygons have **no height attribute**. The dataset page lists the columns of the polygon files as `latitude`,
`longitude`, `area_in_meters`, `confidence`, `geometry` (WKT) and `full_plus_code`, with no building height
(`sites.research.google/gr/open-buildings/`, read 2026-11-21). Building heights exist only in the separate **Open Buildings 2.5D Temporal
Dataset** (annual 2016 to 2023, Sentinel-2 based, "building presence, fractional building counts, and building heights"), which is an Earth
Engine image collection, not a plain download (`sites.research.google/gr/open-buildings/temporal/`). So the brief's "Open Buildings 3D
heights" cannot come from a plain download; heights come from OSM `height` and `building:levels` with the flagged default above.

Open Buildings footprints were **not added**. Fetching is possible: the public bucket `open-buildings-data` lists level 6 cell files
(for example `v3/polygons_s2_level_6_gzip_no_header/0097_buildings.csv.gz`, 99 MB) with `md5Hash` and `crc32c` in the object metadata, and
the licence is stated as CC BY-4.0 and ODbL v1.0, user's choice (attribute: "Open Buildings, Google Research, CC BY 4.0"). It was skipped
because it needs an S2 cell lookup and a 100 to 450 MB CSV-to-GeoJSON conversion that does not fit this time box, and footprints add no
heights, so they would not change the answer. If added later, record the object md5 before use and add the attribution to the tile
metadata and the app credits.

## DEM

Skipped. A free source is reachable and checksum-able (Copernicus DEM GLO-30 on AWS Open Data, for example
`Copernicus_DSM_COG_10_N05_00_W001_00_DEM.tif`, 29,649,343 bytes, S3 ETag `88398124d524ac3dc4e78239fdfb1082`), but turning it into terrain
tiles needs GDAL or rio-rgbify, and no verified binary for that is installed (none was installed unverified). Elevation is optional for
the prototype; Accra is low relief.

## Slicing a route corridor

Measured read-only against the built archive (`stats.py --corridor <manifest.json> --buffer 150`), for the 670 m real route with a ready
clip (route A in [phase5a-preview.md](phase5a-preview.md)): a 150 m corridor needs **11 tiles, 1,084,104 bytes (5.1 % of the archive)**: one tile
per zoom from z6 to z12 and a few at z13 and z14. A route-sized slice is therefore about 1 MB, well inside the bundle cap, and the reserved
`tiles/` section of the offline bundle can hold it. Producing the slice file needs one of: `pmtiles extract` from go-pmtiles (not
installed: no verified binary here), a small PMTiles writer in the backend (the reader in `stats.py` already walks the directories), or
re-running Planetiler per route with `--bounds` (the whole metro takes 24 s, a corridor a few seconds). Not built in this task.

## Disk used (all under gitignored `data/`)

JDK 310 MB extracted plus 193 MB tarball, Planetiler 96 MB, Geofabrik extract 112 MB, `accra.pmtiles` 21 MB, one bundle 2.7 MB, copied
clip cache 4.9 MB.
