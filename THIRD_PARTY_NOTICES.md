# Third-party notices

## gods-eye-view

- Source: https://github.com/bilawalsidhu/gods-eye-view (commit 98a26787a4359a94054bc015fc17cb4437c2fb2b)
- License: MIT License
- Copyright (c) 2026 Bilawal Sidhu

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Scope: the stubs in `backend/src/patterns/` are original sketches that follow patterns described in this project (renderer contract, camera move sampling with eased shortest-arc interpolation, trail vertex budget and age fade, Photon/Nominatim fallback). No source files were copied. Two trivial expressions in `sceneDirector.ts` (cubic-in-out easing and the shortest-arc angle wrap in `lerpAngle`) are the same as in that project's `src/director/camera.js` (lines 44-49); they are covered by the MIT notice and copyright above, which is kept for that reason. The MIT grant covers that project's source code only. Its bundled datasets (`LICENSE:25-38`) are not MIT-licensed, and its promotional media is not licensed for standalone reuse (`README.md:698`). Neither is used here.

## OpenStreetMap data via Photon extracts

The self-hosted geocoder (`docker compose --profile geocoder`, `scripts/fetch-photon.sh`) uses Photon (Apache-2.0, komoot/photon) with a Ghana extract
built by GraphHopper from OpenStreetMap data (ODbL, (c) OpenStreetMap contributors). Nothing from either is committed.
