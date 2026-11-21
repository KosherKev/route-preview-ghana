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
| Photon query latency (warm, loopback) | 11 to 19 ms per request, 6 repeats of one query | `curl -w %{time_total}` directly against Photon `/api` |
| `/geocode` latency through the service | 14 to 19 ms for a Photon-answered query (5 repeats), 11 to 12 ms for a landmark-answered query (3 repeats) | `curl -w %{time_total}` against the running service |

### Memory (re-measured 2026-11-21, follow-up G)

Method, the same for PostGIS, Valhalla and Photon: two per-container counters read inside the Colima VM's Docker, and the VM's own counters.

- **Working set**: `docker stats --no-stream` (cgroup usage minus inactive page cache).
- **cgroup `memory.current`**: `docker exec <container> cat /sys/fs/cgroup/memory.current` (includes page cache, so it is larger for PostGIS and Valhalla, which read big files). Lifetime peak: `memory.peak` in the same directory.
- **VM level**: `colima ssh -- free -m` and `grep MemAvailable /proc/meminfo` inside the VM. This is what decides whether the VM is under pressure: it counts everything in the VM (kernel, dockerd, page cache), not only container working sets. VM total 4,916 MiB, no swap.

| State | PostGIS | Valhalla | Photon | VM used | VM available (of 4,916 MiB) |
|---|---|---|---|---|---|
| Idle, Photon stopped | 151.9 working set, 322 cgroup | 255.8 working set, 359 cgroup | stopped | 966 MiB | 3,950 MiB |
| Idle, Photon running (about 15 s after ready) | 151.9 working set, 322 cgroup | 255.8 working set, 360 cgroup | 267.3 working set, 299 cgroup | 1,219 MiB | 3,697 MiB |
| `npm test` running, Photon up (338 tests) | 415.3 working set (3 samples), 768.8 cgroup max (30 samples) | 255.8 working set, 360.1 cgroup max | 287.4 working set, 320.6 cgroup max | 1,555 MiB max | 3,361 MiB min |
| Lifetime cgroup peak (`memory.peak`) | 950.5 (1 GiB limit) | 1,186.1 (2 GiB limit) | 321.6 (since this start; 1.5 GiB limit) | | |

All container figures are MiB. The per-container figures are single readings or short samples (3 to 30), not averages over time.

**Whole stack.** The earlier "about 720 MiB" was the sum of three working sets (PostGIS + Valhalla + Photon = 151.9 + 255.8 + 267.3 = 675 MiB now) and understated the VM's load. The VM itself reports 1,219 MiB used with everything running (966 MiB with Photon stopped, so Photon adds about 250 MiB), plus about 3.5 GiB of buff/cache, which the kernel gives back under pressure. Memory available to new work is 3,697 MiB at idle with Photon running, and fell to 3,361 MiB at its lowest during a full `npm test`. On these readings the 5 GiB VM is not under memory pressure with Photon running, with about 3.3 GiB available at the worst point sampled; PostGIS under test load is the largest single swing (cgroup 768.8 MiB against a 1 GiB limit, lifetime peak 950.5 MiB).

The earlier 111 MiB and 367 MiB PostGIS readings could not be reproduced. The first version of this section mixed counters (working set for Photon and PostGIS idle, cgroup for PostGIS under load); this one uses the same counters for every row. Photon is still stopped by default.

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
