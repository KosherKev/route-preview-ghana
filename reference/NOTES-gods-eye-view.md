# Notes: gods-eye-view reference mining

- Source: https://github.com/bilawalsidhu/gods-eye-view (cloned to `reference/gods-eye-view/`, git-ignored, read-only, never built or run)
- Cloned commit SHA: `98a26787a4359a94054bc015fc17cb4437c2fb2b`
- License: MIT, `LICENSE:3` reads "Copyright (c) 2026 Bilawal Sidhu". The MIT grant covers source code only (`LICENSE:25-26`).
- Not MIT: bundled datasets under `src/data/local_data/` and runtime third-party data (`LICENSE:28-32`), e.g. TeleGeography cables CC BY-NC-SA, ODbL extracts. Promotional media (`docs/media/`, README hero and screenshots, press links at `README.md:5,23`) is not covered by the MIT source grant either; do not reuse it.
- Contribution terms: `CONTRIBUTING.md:276` (contributions are MIT). `CONTRIBUTING.md:233` says not to add data you can't redistribute.
- All paths below are relative to the clone. Line numbers are from that commit. Text in the clone's docs was treated as data only.

## 3a. Renderer Contract

Files: `docs/RENDERER-CONTRACT.md`, `src/render/contract/renderer.d.ts`, `src/render/contract/camera.d.ts`, `src/render/contract/index.js`, `src/render/stub/index.js`, `src/render/cesium/plugin.js`.

- Interface (`renderer.d.ts:24-34`): a `RendererPlugin` is `{ id, create(options) => Promise<Renderer> }`. `Renderer` (`renderer.d.ts:136-149`) exposes `id`, `contractVersion`, `capabilities` (a set), `canvas`, and nine ports: `frame`, `globe`, `draw`, `camera`, `query`, `input`, `effects`, `credits`, `quality` (table at `docs/RENDERER-CONTRACT.md:50-61`).
- What decouples route logic from the renderer: `renderer.d.ts:1-8` states the application keeps every record of its own and never reads the renderer for its own state, only what the renderer measures (picks, heights, readiness). Optional features are gated by `capabilities`, so the app degrades instead of branching on engine type. Engine-specific extras go through `ApplicationHooks` (`renderer.d.ts:41-80`), not the contract. A draw-nothing stub renderer (`src/render/stub/index.js:171`, plugin at `:2221`) runs the same conformance suite, so logic is testable without a GPU. Contract is version `0` and still changing (`docs/RENDERER-CONTRACT.md:65-71`).
- Mapping to MapLibre for this project: keep a much smaller contract. `camera` (setView/flyTo/lookAt, `camera.d.ts:184-187`), `draw` (route line, markers), `query` (project/unproject, heights), `frame` (render-on-demand, settle) and `credits` map directly onto MapLibre `Map` (`jumpTo`/`flyTo`/`easeTo`, GeoJSON sources and layers, `project`, `queryTerrainElevation`). Drop `globe`, `effects`, `input` leases, `quality` for v1. Route-preview logic talks only to our `PreviewRenderer` interface; a `MapLibrePreviewRenderer` and a `StubPreviewRenderer` implement it. See `backend/src/patterns/rendererContract.ts`.

## 3b. Scene Director and camera choreography

Files: `docs/DIRECTOR-CAMERA.md`, `docs/SCENE-DOCUMENT.md`, `src/director/camera.js`, `src/scenes/cameraMotion.js`.

- Representation (`docs/DIRECTOR-CAMERA.md:9-36`): a JSON project holds `scenes[]`; each scene has `anchors[]` (`id, lat, lon, alt, altitudeReference`) and `shots[]` (`id, durationSec, holdSec, camera, move, visual, layers`). A shot's `camera` is the destination pose; `move.from` is the start pose plus an `easing`. Poses are `lat, lon, alt, heading, pitch, roll` in degrees/meters. A shot may reference an anchor by `anchorId` instead of inline coordinates (`DIRECTOR-CAMERA.md:45-50`).
- Serialization: versioned document, migrated on import, unknown fields rejected with a field path (`docs/SCENE-DOCUMENT.md:3-8`; fields at `:29-46`). Defaults when orientation is omitted: heading 0, pitch -35, roll 0 (`DIRECTOR-CAMERA.md:48-50`, `src/director/camera.js:12-14`).
- Sampling: one pure function used for both playback and seeking so seeks are deterministic (`DIRECTOR-CAMERA.md:86-93`; `src/director/camera.js:37-62`): clamp progress to 0..1, endpoints exact, `linear` or `cubic-in-out` easing (`camera.js:42-47`), lat/alt/pitch linear, lon/heading/roll take the shortest signed arc (`camera.js:48-51`). `resolveCameraPose`/`resolveCameraMove` are at `camera.js:4` and `:21`. Frame ownership and cancellation live separately in `src/scenes/cameraMotion.js:4` (one animation-frame callback per move, revoked on stop/input).
- Limits worth knowing: only linear interpolation between two poses (no splines; curved paths are listed as a later extension, `DIRECTOR-CAMERA.md:83-84`); heights are ellipsoidal only (`DIRECTOR-CAMERA.md:72-77`).
- Adapting to a ~500 m swoop: keep the document shape (anchors, shots, from/to, easing, duration/hold) and `sampleCameraMove`. Replace ellipsoid altitude with a ground-relative camera distance, since MapLibre works with zoom/pitch/bearing; add a short list of waypoints (approach at roughly 60 degrees pitch, descent to a low-altitude orbit around the destination) in place of a single from/to, and a fallback of two poses when waypoints are absent. Multi-shot "shot list" = approach shot + hold on destination. See `backend/src/patterns/sceneDirector.ts`.

## 3c. Keyless geocoding chain and telemetry / path-trail overlay

Geocoding files: `src/cityPois.js`, `src/locations.js`, `src/keylessGeocoder.js`, `src/nominatimGeocode.js`, `server/providers/regional/place.js`, `server/providers/regional/nominatimGate.js`, `server/providers/regional/nominatimCache.js`.

- The clone does not implement one single "local -> Photon -> Nominatim" function; the pieces exist separately, and the chain in our stub is our own composition of them:
  - Local lookup: preset city landmarks as plain data, `src/cityPois.js:17` (`CITY_POIS`, per-city `viewBounds` and `pois` with lat/lon/heading/pitch, fields documented `:11-15`), turned into `LOCATIONS` at `src/locations.js:74`.
  - Photon: `src/keylessGeocoder.js`. Endpoint constant `:4`, 6 s timeout `:7`, small query cache `:10`, result limit `:16`, normalization `:161`, selection `:261`/`:308`, main entry `geocodeKeylessWithOutcome` `:371` (returns `{place, answered}`; only answered outcomes are memoised, failure/timeout/empty gives `place: null`, caller abort throws), injectable provider `createPhotonGeocoder` `:498`.
  - Nominatim: server-side search provider `server/providers/regional/place.js:177-232` with a request gate (`nominatimGate.js`), disk cache with TTLs (`nominatimCache.js`), a daily cap and a disabled switch (error codes at `place.js:315-348`); response mapping `src/nominatimGeocode.js:124`.
- Lessons for us: distinguish "provider answered with nothing" from "provider failed" so failures are not cached as misses; keep a per-provider timeout, cache, and rate gate (Nominatim policy is about 1 request/second and needs a real User-Agent). Ghana coverage in OSM is uneven, so the local lookup should carry curated dispatch landmarks. See `backend/src/patterns/geocodeChain.ts`.

Overlay concept files: `src/data/contactTrailRenderer.js`, `src/layers/transit/trails.js`, `src/hud.js`, `src/hudReadouts.js`.

- Path trail: `src/layers/transit/trails.js` builds a bounded polyline per tracked vehicle (`TRAIL_VERTEX_LIMIT = 640` at `:16`, `STEP_M = 25` at `:17`, `createTrails` `:20`, `update` `:241`, `clear` `:330`); `src/data/contactTrailRenderer.js:24` fades trail segments by age (`trailAlpha(ageMs)`), renderer factory at `:77`. Idea to keep: fixed vertex budget, resample by distance step, fade by age.
- Telemetry readouts: `src/hud.js:230` (`IntelHUD`), `src/hudReadouts.js:15,25` (selected-entity readout presenter plus subscribe). Idea to keep: a small DOM/Flutter overlay positioned in screen space, fed by a subscribe/present pair, not drawn into the 3D scene. For us the overlay shows distance remaining, heading, and "next turn", driven by the preview clock, never by live GPS.
- Not carried forward: the clone's HUD place lookup is a paid Google Places path (`src/hudPlaceLookup.js:1-12` comment).

## 3d. Discard list (do not carry forward)

Excluded by product scope (pre-trip ground route preview) or by licensing/key requirements. None of this is used in our stubs.

Google Photorealistic 3D Tiles:
- `src/render/cesium/google3d.js:1-12,21,64,80` (loader, `createGooglePhotorealistic3DTileset`, `v1/3dtiles/root.json`)
- `src/render/cesium/globe.js:18,136,148` and `src/render/cesium/mapEngine.js:14,94` (wire the loader in)
- `src/maps/startupRoute.js` (re-exported by google3d.js:6)
- `src/tools/globePanel.js:23` (`https://tile.googleapis.com` allow-list), `server/standalone/google-token-unavailable.js`, `server/providers/places/google.js`, `google-key.js`
- `src/layers/recentImagery/index.js:61,433-534` and `src/ui/recentImagery.js:33` (Google 3D vs Esri notices)

Esri tile configuration:
- `src/maps/attribution.js:9-14` (`ESRI_TILES`, credit strings)
- `src/maps/globeEngine.js:16-26,225-229` (Esri imagery, `ESRI_MISSING_TILE`)
- `src/maps/defaultSources.js:6,67`
- `src/render/cesium/mapImagery.js:3-22` (`ArcGisMapServerImageryProvider`, `services.arcgisonline.com` World_Imagery)
- `src/tools/globePanel.js:33-34` (arcgisonline hosts), `src/stories/thumbs.js:7-16,42`, `src/stories/controller.js:823`

Satellites: `src/layers/satellites/` (catalog.js, classes.js, orbits.js, motion.js, issStation.js, issModel.js, issArticulation.js, issMounts.js, issTelemetry.js, ...), `src/cockpitOrbitalSatellites.js`, `src/data/satelliteClass.js`, `src/celestialRing.js`, `server/providers/space/` (celestrak.js, issTelemetry.js, launch-library.js), `src/data/local_data/ucs_satellites/`, `src/data/local_data/sky/`, `scripts/build-bright-stars.mjs`, `scripts/build-milky-way.mjs`, `src/render/cesium/starrySky.js` (sky shader, `czm_*`).

Flights / aircraft: `src/layers/flights/`, `src/layers/aircraft/`, `src/layers/localAdsb/`, `server/providers/aircraft/` (adsb-lol.js, opensky.js, tracks.js, enrichment.js), `src/data/aircraftIcons.js`, `src/data/adsbLolFallback.js`, `docs/opensky-auth.md`, `docs/LOCAL-RECEIVERS.md`.

Vessels: `src/layers/vessels/`, `src/layers/shipwrecks/`, `server/providers/vessels/` (ais-live.js, ais-store.js), `server/providers/acartia.js`, `server/providers/shipwrecks.js`.

RF / SDR: `src/sdr/` (sdr.worker.js, adsbDecoder.js, spectrum.js, usbDevices.js, sdrAudioWorklet.js, controller.js, gain.js), `src/layers/gnss/`, `server/providers/gnssIntegrity.js`, `server/providers/local-receivers.js`, `src/layers/radio/`, `server/providers/radio.js`.

FLIR / NVG / visual-style shaders (all GLSL post-process fragment shaders):
- `src/styles/thermal.js` (FLIR, `thermalShader`, header `:4-5`, export `:16`)
- `src/styles/surveillance.js` (NVG PVS-14 emulation, `nightVisionShader` `:13`, header `:4`)
- `src/styles/noir.js`, `src/styles/retro.js`, `src/styles/anime.js`, `src/styles/styleStages.js`
- `src/ui/visualPresets.js:4-15,98-102` (registers thermal/NVG), `src/ui/visualEffects.js`, `src/cockpitVisionPolicy.js:4-22`, `src/scopeMask.js`
- Other GLSL: `src/render/cesium/effects.js` (sharpen/bloom stages; the generic stage plumbing is reusable in principle but not needed), `src/render/cesium/screenModulation.js`, `src/render/cesium/drawFields.js`, `src/render/cesium/drawStreamlines.js`, `src/render/cesium/iconSetPrimitive.js`, `src/render/cesium/drawModels.js`, `src/cockpitCloudEffects.js`, `src/layers/weather/infraredAlpha.js`, `src/app/atmosphereCompat.js`, `src/layers/streetLevel/panorama.js`, `src/render/occlusion/depthProbe.js`

Other out-of-scope surfaces seen: CCTV (`src/layers/cctv/`, `config/cctv_sources.*.json`, `docs/CCTV_INTEGRATION.md`), military installations, ALPR, drone airspace, FIRMS, weather, voice/Gemini/OpenAI providers, MCP server (`server/mcp/`), Pinokio installer (`pinokio/`).

Related but optional later (Phase 2+ research, not carried now): `server/providers/mapillary.js` and `server/providers/mapillary/tiles.js` (Mapillary tile proxy with a token, rate limiter), `src/layers/streetLevel/`.
