# Terrain tiles for Accra (`accra-terrain.pmtiles`)

Offline raster-dem tiles (Terrarium PNG) for hillshade and optional 3D terrain. Built on servermac with Python only; not used by any app code yet.
Output: `data/terrain/accra-terrain.pmtiles` (gitignored, 11,992,359 bytes, SHA-256 `47b98035f0ef7c91f8bf4ba5d7a8dc766b296752e9677ace6ab5ae1096195b4f`).

## Source and licence
- Dataset: Copernicus DEM GLO-30 "Public" (COP-DEM_GLO-30-DGED, 1 arc-second, about 30 m), as Cloud Optimized GeoTIFF per 1 degree cell, from the AWS Open Data bucket `copernicus-dem-30m`. No login, key or payment needed. Checked reachable from servermac on 2026-11-21 (3 of 3 HEAD requests returned 200).
- Licence: the free ESA/EU Copernicus DEM licence for GLO-30 ("GLO-30 and GLO-90 are available on a free basis for the general public under the terms and conditions of the Licence", registry wording; the Copernicus page calls it "ESA User License" with "Licensing and citation guidelines"). It requires the source notice below when communicating to the general public. Not CC0 and not an open-database licence: keep the notice with any redistribution.
- Attribution string the app must display (verbatim from the Copernicus page; for modified data the page prescribes the "produced using" form):
  `produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved`
  The unmodified-data form on the same page is `© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved`. Tiles here are resampled and re-encoded, so use the "produced using" form.
- URLs:
  - https://registry.opendata.aws/copernicus-dem/ (AWS Open Data registry entry)
  - https://copernicus-dem-30m.s3.amazonaws.com/readme.html (dataset readme, COG layout)
  - https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM (licence and citation wording)
  - https://spacedata.copernicus.eu/en/web/guest/collections/copernicus-digital-elevation-model (linked by the registry as the licence page; it timed out from servermac on 2026-11-21, so the wording above comes from the dataspace page)
- Source files (under gitignored `data/terrain/src/`), `https://copernicus-dem-30m.s3.amazonaws.com/<name>/<name>.tif`. These files cannot be checked against a publisher checksum; only TLS protects the transfer. Recorded hashes are for reproducibility.

| File | Bytes | S3 ETag | SHA-256 |
|---|---|---|---|
| `Copernicus_DSM_COG_10_N05_00_W001_00_DEM.tif` | 29,649,343 | `88398124d524ac3dc4e78239fdfb1082` | `149c3b27ad1009c991ab52d97e38a878dd3fe97a20b583a51e17aacaa0a8634d` |
| `Copernicus_DSM_COG_10_N05_00_E000_00_DEM.tif` | 10,975,203 | `2c0eb8b4df85871cad35673be6dcfc96` | `373793e20709960a1c166064e20417270fd67f871847d08a9d7cd3a634bd2818` |

## Tiles
- Bounding box (same as `scripts/pmtiles/build-accra.sh`): lon -0.40 to 0.05, lat 5.45 to 5.80. Covered by the two cells above (lon -1..1, lat 5..6). Tiles are written only for tiles that touch the box; elevation outside the two downloaded cells reads as 0 m.
- Zoom 6 to 13. At lat 5.6 one 256 px pixel is about 19 m at z13 and 38 m at z12; the source is about 30 m, so z13 is the last level that adds anything (slight oversampling, which gives smoother hillshade) and z14 would only enlarge the file. z6 is the lowest level with a useful whole-metro view and matches `accra.pmtiles` (tiles from z6). Tile counts: z6 4, z7 4, z8 4, z9 4, z10 6, z11 12, z12 30, z13 108 (172 total).
- Encoding: Terrarium PNG, `height = R*256 + G + B/256 - 32768`, 256 px tiles, Web Mercator, bilinear resampling from the source, ocean and nodata = 0 m. Heights are floored to 1/256 m.
- Source grid: the GeoTIFF is PixelIsPoint (samples at the grid nodes, first sample at the cell's north-west corner), and the sampler follows that.
- PMTiles metadata carries `encoding: terrarium`, `tileSize`, `bounds`, `minzoom`, `maxzoom`, `license`, `attribution`, `source` and `caveat`.

## DSM caveat
GLO-30 is a Digital Surface Model. Building, tree and infrastructure heights are baked into the elevations, so central Accra shows blocky bumps and the hillshade will show them. FABDEM (which removes them) is CC BY-NC-SA and must not be used. Low zoom levels (z6 to z9) are point-sampled bilinear from the 30 m grid without area averaging, so they are aliased; they are fine for overview shading but not for height lookups.

## Reproduce (from a clean checkout of the branch, repo root)
```bash
# 1. source cells (about 40 MB)
mkdir -p data/terrain/src && cd data/terrain/src
for c in N05_00_W001_00 N05_00_E000_00; do f=Copernicus_DSM_COG_10_${c}_DEM.tif; curl -fSL -o $f https://copernicus-dem-30m.s3.amazonaws.com/${f%.tif}/$f; done
shasum -a 256 *.tif   # compare with the table above
cd ../../..
# 2. hash-pinned tooling (macOS x86_64, CPython 3.14; no rasterio wheel exists there, so tifffile + imagecodecs read the GeoTIFF)
python3 -m venv data/tools/terrain-venv
data/tools/terrain-venv/bin/pip install --only-binary=:all: --require-hashes -r scripts/terrain/requirements.txt
# 3. build (deterministic: two runs give identical bytes) and verify
/usr/bin/time -l data/tools/terrain-venv/bin/python -I scripts/terrain/build_terrain.py data/terrain/src data/terrain/accra-terrain.pmtiles
data/tools/terrain-venv/bin/python -I scripts/terrain/verify_terrain.py data/terrain/src data/terrain/accra-terrain.pmtiles
```
Measured: build 6.5 s, peak RSS 337 MB (`/usr/bin/time -l`).

## Verification results (2026-11-21)
- 300 random tile pixels over z6 to z13 compared with a bilinear sample of the GeoTIFF at the pixel centre: mean error 0.0007 m, max 0.0039 m (the Terrarium 1/256 m quantisation).
- 287 random geographic points (tile value interpolated between pixel centres) vs the source: mean 2.99 m, max 97 m overall, but that is resolution, not encoding error: z13 mean 0.04 m (max 0.64), z12 mean 0.15 (max 1.36), z11 mean 0.26 (max 0.97), z10 mean 0.56, z9 mean 1.7, z8 mean 4.0, z7 mean 10, z6 mean 11. The 1 m mean target holds from z11 up.
- Seams: the step between the last pixel column/row of a tile and the first of its neighbour deviates from the source's own step for the same two points by at most 0.0039 m at every zoom, so tiles are continuous. The raw adjacent-pixel difference is just real terrain change between neighbouring pixels (z13 mean 0.47 m, max 13.9 m on steep or built-up pixels); it cannot be under 1 m everywhere for any DEM.
- z13 elevation over the box: min 0.00 m (sea), max 497.2 m, mean 39.2 m. Plausible: the Gulf of Guinea coast is 0 m and the Akwapim ridge at the northern edge reaches several hundred metres (the source cells peak at 739 m further north).
- PMTiles header and metadata checks via the `pmtiles` package: version 3, tile type PNG, tile compression none, clustered, zoom 6 to 13, 172 addressed tiles, all decode to 256x256 PNGs.

## MapLibre style snippet
Not yet tested in maplibre_gl 0.28.0 on iOS (Home Mac task). The `pmtiles://` scheme needs the PMTiles protocol support of the host (check this on device); the file lives next to `accra.pmtiles`.
```json
{
  "sources": {
    "terrain-dem": {
      "type": "raster-dem",
      "url": "pmtiles://accra-terrain.pmtiles",
      "encoding": "terrarium",
      "tileSize": 256,
      "minzoom": 6,
      "maxzoom": 13,
      "bounds": [-0.40, 5.45, 0.05, 5.80],
      "attribution": "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"
    }
  },
  "layers": [
    {
      "id": "hillshade",
      "type": "hillshade",
      "source": "terrain-dem",
      "paint": {
        "hillshade-exaggeration": 0.5,
        "hillshade-shadow-color": "#473B24",
        "hillshade-highlight-color": "#FFFFFF",
        "hillshade-illumination-direction": 335
      }
    }
  ],
  "terrain": { "source": "terrain-dem", "exaggeration": 1.0 }
}
```
Put the hillshade layer below buildings and labels. Omit `terrain` for flat-map hillshade only.

## Copy to the Home Mac
Over the tailnet, never through git (the file is gitignored):
```bash
scp data/terrain/accra-terrain.pmtiles macmini:<destination-dir>/accra-terrain.pmtiles
shasum -a 256 <destination-dir>/accra-terrain.pmtiles   # on macmini, expect the SHA-256 above
```
This task did not copy it.
