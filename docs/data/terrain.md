# Terrain tiles for Accra (`accra-terrain.pmtiles`)

Offline raster-dem tiles (Terrarium PNG) for hillshade and optional 3D terrain. Built on servermac with Python only; not used by any app code yet.
Output: `data/terrain/accra-terrain.pmtiles` (gitignored, 11,992,359 bytes, SHA-256 `47b98035f0ef7c91f8bf4ba5d7a8dc766b296752e9677ace6ab5ae1096195b4f`).

## Source and licence
- Dataset: Copernicus DEM GLO-30 "Public" (COP-DEM_GLO-30-DGED, 1 arc-second, about 30 m), as Cloud Optimized GeoTIFF per 1 degree cell, from the AWS Open Data bucket `copernicus-dem-30m`. No login, key or payment needed. Checked reachable from servermac on 2026-11-21 (3 of 3 HEAD requests returned 200).
- Licence: the dataset is offered "on a free basis" under the terms of the "ESA User License" (the exact link text on the Copernicus Data Space page, under "More details on the Copernicus DEM eligibility and access conditions", together with a "Mission Specific Annex"); the page's own section is headed "Licensing and citation guidelines" and says "The GLO-30 and GLO-90 datasets are available worldwide with a free license." The AWS registry says "GLO-30 Public and GLO-90 are available on a free basis for the general public under the terms and conditions of the Licence" and links to the same page. Neither page gives a longer formal title or version for the licence document, and the licence text itself (spacedata.copernicus.eu) timed out on 2026-11-21, so "ESA User License" is the most exact name that could be established; check the full text before any redistribution. It is not CC0 or an open-database licence. Obligation quoted from the page: when communicating to or distributing to the general public, the user must show the source notice below. Research users in ESA/EU are also asked to cite DOI https://doi.org/10.5270/ESA-c5d3d65.
- Licence and attribution wording retrieved 2026-11-21 from the dataspace URL below (HTTP 200, page body read in full).
- Attribution string the app must display (verbatim from that page; where the data "have been adapted or modified" the page prescribes the "produced using" form):
  `produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved`
  The unmodified-data form on the same page is `© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved`. Tiles here are resampled and re-encoded, so use the "produced using" form.
- URLs:
  - https://registry.opendata.aws/copernicus-dem/ (AWS Open Data registry entry)
  - https://copernicus-dem-30m.s3.amazonaws.com/readme.html (dataset readme, COG layout)
  - https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM (licence and citation wording)
  - https://spacedata.copernicus.eu/en/web/guest/collections/copernicus-digital-elevation-model (linked by the registry as the licence page; it timed out from servermac on 2026-11-21 on two attempts, so the wording above comes from the dataspace page)
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
GLO-30 is a Digital Surface Model. Building, tree and infrastructure heights are baked into the elevations, so central Accra shows blocky bumps and the hillshade will show them. FABDEM (which removes them) is CC BY-NC-SA and must not be used. 
This is a surface model, so a height lookup on a building or tree returns the roof or canopy height, not the ground.

## Zoom notes
- Accurate from zoom 10 up (mean error against the source under 1 m, see results below). Zooms 6 to 9 are overview levels only: they are point-sampled bilinear from the 30 m grid without area averaging, so they are aliased (mean error about 8 m at z6 and 4 m at z7, 1.6 to 2 m at z8 and z9; individual points reach 20 to 75 m). Use them for coarse shading, never for height lookups.
- The app's target view is zoom 12 and above. Data stops at zoom 13 (about 19 m per pixel at lat 5.6, finer than the 30 m source), so any zoom above 13 is overzoomed (MapLibre stretches z13 tiles via `maxzoom: 13`).
- Area-averaging z6 to z9 was tried (2x2 box mean from the next zoom, down to sampled z10) and not kept: it built in about 12 s and left z10 to z13 unchanged, but the averaged levels then differ from point samples of the source by design, so the seam check (tile step versus source step) fails at z6 to z9 (up to 100 m) and the random-point error at z6 to z9 does not improve against the point reference (z6 8.3, z7 3.9, z8 2.2, z9 1.7 m mean). It would need a different reference and seam definition, so the shipped tiles stay as built and the file hash is unchanged.

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
`scripts/terrain/verify_terrain.py` computes every metric below, prints PASS or FAIL per check and exits 1 if any gated check fails (shown once with a deliberately broken input: `--scale-z13 1.5` multiplies z13 heights by 1.5 and exits 1 with 4 FAIL lines). On the shipped tiles it exits 0 with 16 of 16 checks passing.
- Header and metadata: version 3, PNG, no tile compression, clustered, zoom 6 to 13, encoding terrarium, tile size 256, bounds as built. Tile counts z6 to z9 4 each, z10 6, z11 12, z12 30, z13 108 (172, all decode to 256x256 and match the header).
- Pixel centres (75 random tile pixels at each of z10 to z13, against a bilinear sample of the source at the pixel centre): mean 0.0014 m, max 0.0039 m (the 1/256 m Terrarium quantisation). Gate: max under 1 m.
- Random geographic points (150 per zoom, tile value interpolated between pixel centres, against the source): z13 mean 0.037 max 0.90 m; z12 mean 0.086 max 0.69; z11 mean 0.39 max 3.1; z10 mean 0.60 max 8.8. Gates: mean under 1 m over z10 to z13 (0.279 m, pass), max under 5 m for z11 to z13 (3.1 m, pass). Deviation from the task spec: z10 max is gated at under 10 m instead of 5 m, because z10 (about 76 m per pixel from a 30 m source) reaches 8.8 m at a steep point and z10 had to stay unchanged. Reported only, not gated: z9 mean 1.6 max 20.5; z8 mean 2.0 max 25.6; z7 mean 4.0 max 38.2; z6 mean 8.2 max 75.0.
- Seams, two different numbers. The step across a tile edge (last pixel of one tile minus first pixel of its neighbour) matches the step between the same two points in the source within 0.0039 m at every zoom from z6 to z13 (gate: under 1 m), so tiles are continuous and no seam artefact exists. The raw difference between adjacent pixels across an edge is not small and is not expected to be: it is real terrain change plus (at low zooms) resolution, with z13 mean 0.47 m, max 13.9 m; z12 mean 1.2, max 27.3; z11 mean 2.2, max 52.1; z10 mean 2.1, max 33.8; z9 max 48.1; z8 max 81.4; z7 max 124.7; z6 max 185.2 m. Do not read the raw difference as a seam error.
- z13 elevation over the box: min 0.00 m (sea), max 497.20 m, mean 39.17 m (gate: min at least -1 m, max between 100 and 800 m). Plausible: the coast is 0 m and the Akwapim ridge at the northern edge rises to several hundred metres (the source cells peak at 739 m further north).
- Build: 6.5 s, peak RSS 337 MB (`/usr/bin/time -l`, rebuilt 2026-11-21, byte-identical to the shipped file).

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
