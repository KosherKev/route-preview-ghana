# Decision log

Decisions D1 to D6 from Spec v2, closed by the owner on 2026-11-20.

| ID | Topic | Status | Closed |
| --- | --- | --- | --- |
| D1 | Street imagery source | CLOSED | 2026-11-20 |
| D2 | Client | CLOSED | 2026-11-20 |
| D3 | Flyover renderer | CLOSED | 2026-11-20 |
| D4 | Flyover base data | CLOSED | 2026-11-20 |
| D5 | Target product shape | CLOSED | 2026-11-20 |
| D6 | Storage | CLOSED | 2026-11-20 |
| D7 | Bridge cap per street segment | CLOSED | 2026-11-20 |
| D8 | Bridges require the same sequence_id | CLOSED | 2026-11-20 |

## D1 Street imagery (CLOSED 2026-11-20)

Rider/own capture is the long-term primary source. Mapillary is prototype-only. Nothing derived from Mapillary is served publicly
until written permission exists. The Phase 6 audit decides what stays.

Enforcement hook in code: the imagery source kill switch (`IMAGERY_SOURCES_DISABLED`, see `backend/README.md`).

## D2 Client (CLOSED 2026-11-20)

Native Flutter app.

## D3 Flyover renderer (CLOSED 2026-11-20)

MapLibre Native.

## D4 Flyover base data (CLOSED 2026-11-20)

OSM vectors + free DEM + Google Open Buildings (CC BY 4.0). No licensed or Esri imagery.

## D5 Target (CLOSED 2026-11-20)

An API/SDK that other apps (a rider fleet app, or a maps application) can embed, plus our own first-party Flutter app built on the
same API.

Consequence, recorded as BACKLOG and NOT built yet:

- endpoint authentication
- per-key rate limits and quotas
- API docs
- fleet admin view

## D6 Storage (CLOSED 2026-11-20)

Cloudflare R2 (S3-compatible; MinIO locally).

## D7 Bridge cap per street segment (CLOSED 2026-11-20)

Pairwise chaining of qualifying runs across 15 to 30 m gaps stays, but a merged STREET_VIDEO segment holds at most 2 bridges
(`maxBridgesPerSegment`, default 2, an integer config value). When a chain would need a third bridge, the segment ends at the
end of its third run and keeps its two bridges; the gap that would have been the third bridge is a BIRDS_EYE_3D handoff; the next
qualifying run starts a new segment. The owner also allowed an alternative (at least 60 m of dense frames with gaps under 15 m
between bridges); it is NOT implemented.

## D8 Bridges require the same sequence_id (CLOSED 2026-11-20)

A 15 to 30 m gap is bridged only when both runs share the same `sequence_id`. If `sequence_id` differs across the gap, or is
missing on either side, the street segment terminates and hands off to BIRDS_EYE_3D. This was already the builder's behaviour; it is
now an explicit, tested, documented rule.
