# Self-hosted geocoder spike (Photon, Ghana-only)

Date: 2026-11-20. Verdict: **works; wired in as the second stage of the geocode chain** (opt-in compose profile).
It started on the first attempt (of a maximum of three). No public Photon or Nominatim server was queried; only static downloads
(index tarball from download1.graphhopper.com, jar from the komoot/photon GitHub release) and the local container on 127.0.0.1.

## What was run

| Item | Value |
|---|---|
| Photon | 0.7.4 (`photon-0.7.4.jar`, Elasticsearch 5.6 embedded), sha256 `5cf6effb...6601` matched the GitHub release digest |
| Index | `photon-db-gh-250720.tar.bz2` (Ghana country extract, `by-country-code/gh`), md5 `1755ec3d38a4084799fcdcae58e7580d` matched the published `.md5` |
| Index date | 2025-07-20 (the newest Ghana-only extract on the server; about 16 months old, so newer OSM edits are missing) |
| Runtime | `eclipse-temurin:17-jre`, `-Xms256m -Xmx768m`, `mem_limit` and `memswap_limit` 1536 MB, bound to `127.0.0.1:2322` |
| Reproduce | `scripts/fetch-photon.sh` then `docker compose --profile geocoder up -d photon` |

Colima VM left at 5 GiB / 4 CPU (not enlarged). PostGIS and Valhalla stayed up and healthy throughout.

## Measured numbers

| Metric | Measured |
|---|---|
| Download size | 31,980,944 bytes (30.5 MiB) index tarball; 44,570,297 bytes jar |
| Index size on disk | 66 MB extracted (`photon_data`) |
| Image size | 433 MB (`eclipse-temurin:17-jre`, a generic JRE image; the jar and index are bind-mounted, not baked in) |
| Time to ready | about 7 s from container start to "Database cluster is now ready" |
| Memory | 267 MiB right after start, 296 to 343 MiB after 40 queries; cgroup peak 376 MiB (357 to 394 MB) against the 1.5 GiB limit |
| Query latency (warm, from the host, loopback) | 8 to 16 ms for single-place queries; first queries 220 to 280 ms (cold) |
| Chain latency through Node (landmarks miss then Photon) | 37 to 76 ms |

Headroom: the whole stack (PostGIS 111 MiB, Valhalla about 250 MiB, Photon about 300 MiB) uses well under the 5 GiB VM.

## Query quality (chain run against the live PostGIS table and the live container)

Landmark stage claims an answer only at trigram score >= 0.5 (`LANDMARK_MIN_SCORE`); otherwise Photon is asked.

| Query | Answered by | Result |
|---|---|---|
| asilum down farmacy | landmarks | Asylum Down Pharmacy (5.5724, -0.2001) |
| Lapaz Tema station | landmarks | Lapaz, Tema Station (5.6078, -0.2450) |
| Madina | landmarks | Madina (5.6767, -0.1716) |
| Kotoka International Airport | photon-local | Kotoka International Airport (5.6038, -0.1683) |
| Korle Bu Teaching Hospital | photon-local | Korle Bu Teaching Hospital (5.5383, -0.2268) |
| Osu Oxford Street | photon-local | Oxford Street, Osu (5.5665, -0.1811) |
| Spintex Road | photon-local | Spintex, Addogonno (5.6288, -0.0902) |
| Kwame Nkrumah Circle | photon-local | Kwame Nkrumah Interchange (5.5696, -0.2153) |
| 5.6037, -0.1870 | coordinates | parsed locally |
| qqzzxxvv | none | no answer |

Finding that changed the design: with the first threshold (0.3) the landmark stage claimed "Kotoka International Airport" and answered
"Opportunity International" (score 0.41), so Photon was never consulted. Raising the claim threshold to 0.5 fixed that on these probes
(wrong matches scored 0.33 to 0.45, right ones 0.52 and up). The threshold is tuned on about a dozen queries, not a large set; treat it as a
starting value.

## Caveats

- Photon 0.7.x uses Elasticsearch 5.6, which logs a pre-release warning. It is loopback-only and not exposed, but it is old software.
  Photon 1.x needs a newer index format; a Ghana-only 1.x extract was not available, so 1.x was not tried.
- Single-result lookups only (`limit=1`); no `lat`/`lon` location bias is passed yet.
- The index is OSM data (ODbL, (c) OpenStreetMap contributors) via GraphHopper's Photon extracts.
