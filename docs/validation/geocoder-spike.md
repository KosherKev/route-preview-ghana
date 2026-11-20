# Self-hosted geocoder spike (Photon, Ghana-only)

Date: 2026-11-20. Verdict: **works; wired in as the second stage of the geocode chain** (opt-in compose profile).
No public Photon or Nominatim server was queried; only static downloads
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
The image is pinned in `docker-compose.yml` by index digest `sha256:fb2cec8d...13c0` (verified with `docker manifest inspect`).

## Measured numbers

Re-measured 2026-11-20 (follow-up F) on the 5 GiB Colima VM; figures from the first spike run that could not be reproduced were removed
(the "40 queries" wording, the 111 MiB PostGIS reading, and the chain-latency range). How each number was obtained:

| Metric | Measured | How |
|---|---|---|
| Download size | 31,980,944 bytes index tarball; 44,570,297 bytes jar | `ls -l data/photon` |
| Checksums | jar sha256 `5cf6effb...6601` and index md5 `1755ec3d...e580d` match the values in `scripts/fetch-photon.sh` | `shasum -a 256`, `md5 -q` on the downloaded files |
| Index size on disk | 67 MiB (`photon_data`) | `du -sm data/photon/photon_data` |
| Image size | 433 MB disk usage, 115 MB content size (`eclipse-temurin:17-jre`, generic JRE; jar and index are bind-mounted, not baked in) | `docker image ls eclipse-temurin` |
| Time to ready | 7.1 s from container start to "Database cluster is now ready" | `docker inspect` StartedAt (20:46:50.85) against the container log timestamp (20:46:57.95) |
| Photon memory | 264 MiB right after start, 313 MiB after 40 `/geocode` requests (20 distinct place names, each sent twice, whichever stage answered) | `docker stats --no-stream` (excludes page cache) |
| Photon peak memory | 363,622,400 B (346.8 MiB) cgroup peak after those 40 requests, including startup; 393,375,744 B (375.2 MiB) after five further `npm test` runs with live Photon tests | `/sys/fs/cgroup/memory.peak` inside the container; limit is 1.5 GiB |
| Photon query latency (warm, loopback) | 11 to 19 ms per request, 6 repeats of one query | `curl -w %{time_total}` directly against Photon `/api` |
| `/geocode` latency through the service | 14 to 19 ms for a Photon-answered query (5 repeats), 11 to 12 ms for a landmark-answered query (3 repeats) | `curl -w %{time_total}` against the running service |
| PostGIS memory, idle | 151.7 MiB | `docker stats --no-stream`, no tests running; the cgroup `memory.current` reads about 320 to 330 MiB for the same state because it includes page cache |
| PostGIS memory, under test load | 467 MiB seen in one `docker stats` sample during `npm test`; cgroup `memory.current` peaked at 749.6, 750.6 and 764.7 MiB across three runs (27 to 28 samples each); lifetime cgroup peak 950.5 MiB against the 1 GiB limit | `docker stats` and `/sys/fs/cgroup/memory.current` sampled in a loop while `npm test` ran |
| Whole stack at idle | PostGIS 151.7 + Valhalla 255.4 + Photon 313 MiB = about 720 MiB by `docker stats` | `docker stats --no-stream` with all three running |

The earlier 111 MiB and 367 MiB PostGIS readings could not be reproduced and are replaced by the numbers above; note that `docker stats`
excludes page cache while the cgroup file includes it, so the two counters differ by design. Under test load PostGIS can approach its 1 GiB cap by the cgroup counter, which is one reason
Photon is stopped when not in use.

## Query quality (re-run 2026-11-20 through `GET /geocode`, live PostGIS table and live container)

Landmark stage claims an answer only at trigram score >= 0.5 (`LANDMARK_MIN_SCORE`); otherwise Photon is asked. Photon returns no score, so
photon-local candidates carry a local bigram-similarity score between the query and the returned name (see README).

| Query | Answered by | Result |
|---|---|---|
| asilum down farmacy | landmarks | Asylum Down Pharmacy (5.5724, -0.2001), score 0.519 |
| Lapaz Tema station | landmarks | Lapaz, Tema Station (5.6078, -0.2450) |
| Madina | landmarks | Madina (5.6767, -0.1716), two entries 60 m apart |
| Kotoka International Airport | photon-local | Kotoka International Airport, Juba Ridge, Burma Camp (5.6038, -0.1683) |
| Korle Bu Teaching Hospital | photon-local | Korle Bu Teaching Hospital (5.5383, -0.2268) |
| Osu Oxford Street | photon-local | Oxford Street, Osu, Accra (5.5665, -0.1811) |
| Spintex Road | photon-local | Spintex Road, Addogonno (5.6261, -0.0827), 5 candidates |
| Kwame Nkrumah Circle | photon-local | Kwame Nkrumah Circle, Kokomlemle (5.5697, -0.2151) |
| 5.6037, -0.1870 | coordinates | parsed locally |
| qqzzxxvv | none | empty candidate list |

Finding that changed the design: with the first threshold (0.3) the landmark stage claimed "Kotoka International Airport" and answered
"Opportunity International" (score 0.41), so Photon was never consulted. Raising the claim threshold to 0.5 fixed that on these probes
(wrong matches scored 0.33 to 0.45, right ones 0.52 and up). The threshold is tuned on about a dozen queries, not a large set; treat it as a
starting value.

## Caveats

- Photon 0.7.x uses Elasticsearch 5.6, which logs a pre-release warning. It is loopback-only and not exposed, but it is old software.
  Photon 1.x needs a newer index format; a Ghana-only 1.x extract was not available, so 1.x was not tried.
- `/geocode` passes `near` to Photon as a location bias (`lat`/`lon`) and asks for up to `limit` results.
- The index is OSM data (ODbL, (c) OpenStreetMap contributors) via GraphHopper's Photon extracts.
