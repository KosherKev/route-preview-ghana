# Route preview validation (Phase 3)

Generated: 2026-11-21T05:33:49.050Z

## Branch status

**This branch is intentionally NOT merged to main: it is cut from the unmerged Phase 2 branch, which carries SQL migrations, and the auto-merge bar permanently excludes work touching migrations; it is pushed and PR-ready for human review.**

## Imagery coverage

**This run classified against the 50476 frames then in the `frames` table (the coverage-audit data); no Mapillary call was made. Rows below describe the last-500 m approach only. Real coverage was measured separately: see docs/validation/coverage-audit.md (Mapillary image metadata, no image files, for a 30 m corridor around these same 25 pairs under both costings, ingested 2026-11-20).**

- Mapillary token configured: yes (never used by this tool)
- Rows in the `frames` table at run time: 50476

What the real-route section DOES verify: Valhalla routing, approach extraction (about 500 m along the route), edge ids, the `unpaved_fallback` handling, and that the classifier degrades safely to BIRDS_EYE_3D when there is no imagery.

## Thresholds used

- Approach length 500 m along the route; decision windows 80 m.
- Street run: at least 60 m long and every gap between consecutive usable frames strictly under 15 m (maximum, not average).
- Two-tier gap rule (confirmed by the owner 2026-11-20): gap under 15 m is RIFE-eligible (AI interpolation is allowed ONLY below this ceiling); 15 m to 30 m, both ends inclusive, between two qualifying runs is a crossfade bridge that merges them into ONE STREET_VIDEO segment and is NEVER RIFE-interpolated; a gap over 30 m, or a run under 60 m that cannot be bridged, hands off to BIRDS_EYE_3D.
- Pairwise chaining is capped: a merged STREET_VIDEO segment holds at most 2 bridges (so at most 3 runs). A chain that would need one more ends the segment at the end of its last allowed run, the extra gap is a BIRDS_EYE_3D handoff, and the next qualifying run starts a new segment.
- Same-sequence rule: a 15-30 m gap is bridged only when both runs share the same sequence_id; a different or missing sequence_id across the gap is a handoff, never a bridge.
- Frame filters: lateral tolerance 15 m, more than 3 m left of the centreline dropped (right-hand traffic), heading within +/-25 deg of the local road bearing, quality_score at least 0.5.
- level_uncertain: sequence jump, heading jump over 30 deg, or road class/use/bridge/tunnel/layer change at an edge transition, padded 20 m each side.

## Named places (coordinates used)

| Place | lat, lon | How located |
| --- | --- | --- |
| Kwame Nkrumah Interchange (Circle) | 5.56960, -0.21520 | Not in landmarks by name; located from Valhalla roundabout maneuvers named "Kwame Nkrumah Circle" (5.5693-5.5698, -0.2157 to -0.2150) |
| Tetteh Quarshie Interchange | 5.62326, -0.17552 | landmarks row, osm node 493773904, motorway_junction "Tetteh Quarshie Interchange" |
| Danquah Circle | 5.56700, -0.18090 | Valhalla roundabout maneuvers named "Danquah Circle" (5.5669-5.5670, -0.1812 to -0.1806) |

A route is marked "through" a named place if it passes within 150 m of it, or "ends at" if that closest point is within 150 m of the route's start or end.

## Real routes (live Valhalla, PostGIS frames table)

Each pair is run with both costings. Approach length, edge counts, classifier columns and frame counts describe the final approach (the last ~500 m along the route); the Named places column and Route km describe the whole route. A row with "no route" is a genuine routing failure reported as is.

| Route | Costing | Origin | Destination | Route km | Approach m | Edges (approach / route) | unpaved_fallback | Named places | Classifier | Frames used | Frames/100 m | Max gap m | level_uncertain |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| r01 Accra Central -> Tetteh Quarshie Interchange | motor_scooter | 5.55020, -0.21740 | 5.62326, -0.17552 | 11.5 | 500.0 | 5 / 141 | false | Tetteh Quarshie Interchange (ends at, 90 m) | BIRDS_EYE_3D, STREET_VIDEO | 36 | 7.2 | 68.2 | 0 |
| r01 Accra Central -> Tetteh Quarshie Interchange | auto | 5.55020, -0.21740 | 5.62326, -0.17552 | 15.4 | 500.0 | 5 / 174 | false | Kwame Nkrumah Interchange (through, 17 m); Tetteh Quarshie Interchange (ends at, 0 m) | BIRDS_EYE_3D | 21 | 4.2 | 38.7 | 1 |
| r02 Tetteh Quarshie Interchange -> Accra Central | motor_scooter | 5.62326, -0.17552 | 5.55020, -0.21740 | 13.1 | 500.0 | 14 / 175 | false | Tetteh Quarshie Interchange (ends at, 90 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r02 Tetteh Quarshie Interchange -> Accra Central | auto | 5.62326, -0.17552 | 5.55020, -0.21740 | 14.1 | 500.0 | 13 / 195 | false | Tetteh Quarshie Interchange (ends at, 0 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r03 Kwame Nkrumah Interchange -> Airport | motor_scooter | 5.56960, -0.21520 | 5.60520, -0.16680 | 12.0 | 500.0 | 2 / 109 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r03 Kwame Nkrumah Interchange -> Airport | auto | 5.56960, -0.21520 | 5.60520, -0.16680 | 10.7 | 500.0 | 1 / 79 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r04 Achimota -> Kwame Nkrumah Interchange | motor_scooter | 5.61500, -0.23300 | 5.56960, -0.21520 | 7.3 | 500.0 | 7 / 84 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r04 Achimota -> Kwame Nkrumah Interchange | auto | 5.61500, -0.23300 | 5.56960, -0.21520 | 7.4 | 500.0 | 7 / 116 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r05 Kwame Nkrumah Interchange -> Danquah Circle | motor_scooter | 5.56960, -0.21520 | 5.56700, -0.18090 | 4.2 | 500.0 | 12 / 49 | false | Kwame Nkrumah Interchange (ends at, 2 m); Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D, STREET_VIDEO | 44 | 8.8 | 78.5 | 1 |
| r05 Kwame Nkrumah Interchange -> Danquah Circle | auto | 5.56960, -0.21520 | 5.56700, -0.18090 | 4.2 | 500.0 | 12 / 49 | false | Kwame Nkrumah Interchange (ends at, 2 m); Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D, STREET_VIDEO | 44 | 8.8 | 78.5 | 1 |
| r06 Danquah Circle -> Airport | motor_scooter | 5.56700, -0.18090 | 5.60520, -0.16680 | 9.7 | 500.0 | 2 / 123 | false | Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r06 Danquah Circle -> Airport | auto | 5.56700, -0.18090 | 5.60520, -0.16680 | 9.0 | 500.0 | 1 / 62 | false | Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r07 Osu -> Danquah Circle | motor_scooter | 5.55410, -0.18360 | 5.56700, -0.18090 | 1.5 | 500.0 | 13 / 41 | false | Danquah Circle (ends at, 21 m) | STREET_VIDEO, BIRDS_EYE_3D | 77 | 15.4 | 46.6 | 1 |
| r07 Osu -> Danquah Circle | auto | 5.55410, -0.18360 | 5.56700, -0.18090 | 1.5 | 500.0 | 13 / 41 | false | Danquah Circle (ends at, 21 m) | STREET_VIDEO, BIRDS_EYE_3D | 77 | 15.4 | 46.6 | 1 |
| r08 Legon -> Tetteh Quarshie Interchange | motor_scooter | 5.65080, -0.18700 | 5.62326, -0.17552 | 6.1 | 500.0 | 5 / 88 | false | Tetteh Quarshie Interchange (ends at, 90 m) | BIRDS_EYE_3D, STREET_VIDEO | 36 | 7.2 | 68.2 | 0 |
| r08 Legon -> Tetteh Quarshie Interchange | auto | 5.65080, -0.18700 | 5.62326, -0.17552 | 4.9 | 500.0 | 4 / 77 | false | Tetteh Quarshie Interchange (ends at, 0 m) | BIRDS_EYE_3D | 46 | 9.2 | 61.1 | 1 |
| r09 Madina -> Kwame Nkrumah Interchange | motor_scooter | 5.66830, -0.16650 | 5.56960, -0.21520 | 16.7 | 500.0 | 7 / 190 | false | Kwame Nkrumah Interchange (ends at, 2 m); Tetteh Quarshie Interchange (through, 110 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r09 Madina -> Kwame Nkrumah Interchange | auto | 5.66830, -0.16650 | 5.56960, -0.21520 | 16.7 | 500.0 | 7 / 182 | false | Kwame Nkrumah Interchange (ends at, 2 m); Tetteh Quarshie Interchange (through, 110 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r10 Dzorwulu -> Tetteh Quarshie Interchange | motor_scooter | 5.60200, -0.19500 | 5.62326, -0.17552 | 4.4 | 500.0 | 5 / 54 | false | Tetteh Quarshie Interchange (ends at, 90 m) | BIRDS_EYE_3D, STREET_VIDEO | 36 | 7.2 | 68.2 | 0 |
| r10 Dzorwulu -> Tetteh Quarshie Interchange | auto | 5.60200, -0.19500 | 5.62326, -0.17552 | 4.8 | 500.0 | 5 / 45 | false | Tetteh Quarshie Interchange (ends at, 0 m) | BIRDS_EYE_3D | 21 | 4.2 | 38.7 | 1 |
| r11 Kaneshie -> Kwame Nkrumah Interchange | motor_scooter | 5.56000, -0.23700 | 5.56960, -0.21520 | 3.1 | 500.0 | 5 / 41 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 27 | 5.4 | 195.5 | 0 |
| r11 Kaneshie -> Kwame Nkrumah Interchange | auto | 5.56000, -0.23700 | 5.56960, -0.21520 | 3.1 | 500.0 | 5 / 41 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 27 | 5.4 | 195.5 | 0 |
| r12 Labone -> Danquah Circle | motor_scooter | 5.56400, -0.17200 | 5.56700, -0.18090 | 1.2 | 500.0 | 13 / 23 | false | Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D, STREET_VIDEO | 50 | 10.0 | 89.0 | 1 |
| r12 Labone -> Danquah Circle | auto | 5.56400, -0.17200 | 5.56700, -0.18090 | 1.2 | 500.0 | 13 / 23 | false | Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D, STREET_VIDEO | 50 | 10.0 | 89.0 | 1 |
| r13 Ridge -> Kwame Nkrumah Interchange | motor_scooter | 5.56000, -0.19800 | 5.56960, -0.21520 | 4.4 | 500.0 | 7 / 88 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r13 Ridge -> Kwame Nkrumah Interchange | auto | 5.56000, -0.19800 | 5.56960, -0.21520 | 4.4 | 500.0 | 7 / 91 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r14 Danquah Circle -> Madina | motor_scooter | 5.56700, -0.18090 | 5.66830, -0.16650 | 13.4 | 500.0 | 8 / 123 | false | Tetteh Quarshie Interchange (through, 90 m); Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r14 Danquah Circle -> Madina | auto | 5.56700, -0.18090 | 5.66830, -0.16650 | 13.4 | 500.0 | 8 / 114 | false | Tetteh Quarshie Interchange (through, 90 m); Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r15 Achimota -> Osu | motor_scooter | 5.61500, -0.23300 | 5.55410, -0.18360 | 11.7 | 500.0 | 12 / 189 | false | Kwame Nkrumah Interchange (through, 20 m); Danquah Circle (through, 33 m) | STREET_VIDEO, BIRDS_EYE_3D | 66 | 13.2 | 13.5 | 0 |
| r15 Achimota -> Osu | auto | 5.61500, -0.23300 | 5.55410, -0.18360 | 11.7 | 500.0 | 12 / 185 | false | Kwame Nkrumah Interchange (through, 20 m); Danquah Circle (through, 33 m) | STREET_VIDEO, BIRDS_EYE_3D | 66 | 13.2 | 13.5 | 0 |
| r16 Accra Central -> Madina | motor_scooter | 5.55020, -0.21740 | 5.66830, -0.16650 | 17.7 | 500.0 | 8 / 195 | false | Tetteh Quarshie Interchange (through, 90 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r16 Accra Central -> Madina | auto | 5.55020, -0.21740 | 5.66830, -0.16650 | 17.7 | 500.0 | 8 / 187 | false | Tetteh Quarshie Interchange (through, 90 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r17 East Legon -> Kwame Nkrumah Interchange | motor_scooter | 5.63500, -0.15500 | 5.56960, -0.21520 | 13.5 | 500.0 | 7 / 162 | false | Kwame Nkrumah Interchange (ends at, 2 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r17 East Legon -> Kwame Nkrumah Interchange | auto | 5.63500, -0.15500 | 5.56960, -0.21520 | 14.3 | 500.0 | 7 / 191 | false | Kwame Nkrumah Interchange (ends at, 2 m); Tetteh Quarshie Interchange (through, 110 m) | BIRDS_EYE_3D | 26 | 5.2 | 195.5 | 0 |
| r18 Tetteh Quarshie Interchange -> Osu | motor_scooter | 5.62326, -0.17552 | 5.55410, -0.18360 | 10.3 | 500.0 | 12 / 141 | false | Tetteh Quarshie Interchange (ends at, 90 m); Danquah Circle (through, 33 m) | STREET_VIDEO, BIRDS_EYE_3D | 66 | 13.2 | 13.5 | 0 |
| r18 Tetteh Quarshie Interchange -> Osu | auto | 5.62326, -0.17552 | 5.55410, -0.18360 | 10.4 | 500.0 | 12 / 131 | false | Tetteh Quarshie Interchange (ends at, 0 m); Danquah Circle (through, 33 m) | STREET_VIDEO, BIRDS_EYE_3D | 66 | 13.2 | 13.5 | 0 |
| r19 Airport -> Accra Central | motor_scooter | 5.60520, -0.16680 | 5.55020, -0.21740 | 14.5 | 500.0 | 14 / 174 | false | none | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r19 Airport -> Accra Central | auto | 5.60520, -0.16680 | 5.55020, -0.21740 | 14.2 | 500.0 | 13 / 176 | false | none | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r20 Spintex -> Danquah Circle | motor_scooter | 5.63500, -0.10500 | 5.56700, -0.18090 | 15.3 | 500.0 | 15 / 231 | false | Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D | 34 | 6.8 | 193.2 | 1 |
| r20 Spintex -> Danquah Circle | auto | 5.63500, -0.10500 | 5.56700, -0.18090 | 17.1 | 500.0 | 13 / 195 | false | Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D, STREET_VIDEO | 50 | 10.0 | 89.0 | 1 |
| r21 Kaneshie -> Tetteh Quarshie Interchange | motor_scooter | 5.56000, -0.23700 | 5.62326, -0.17552 | 12.1 | 500.0 | 5 / 126 | false | Kwame Nkrumah Interchange (through, 2 m); Tetteh Quarshie Interchange (ends at, 90 m) | BIRDS_EYE_3D, STREET_VIDEO | 36 | 7.2 | 68.2 | 0 |
| r21 Kaneshie -> Tetteh Quarshie Interchange | auto | 5.56000, -0.23700 | 5.62326, -0.17552 | 14.2 | 500.0 | 5 / 146 | false | Kwame Nkrumah Interchange (through, 17 m); Tetteh Quarshie Interchange (ends at, 0 m) | BIRDS_EYE_3D | 21 | 4.2 | 38.7 | 1 |
| r22 Legon -> Danquah Circle | motor_scooter | 5.65080, -0.18700 | 5.56700, -0.18090 | 11.5 | 500.0 | 12 / 159 | false | Tetteh Quarshie Interchange (through, 110 m); Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D, STREET_VIDEO | 44 | 8.8 | 78.5 | 1 |
| r22 Legon -> Danquah Circle | auto | 5.65080, -0.18700 | 5.56700, -0.18090 | 11.5 | 500.0 | 12 / 159 | false | Tetteh Quarshie Interchange (through, 110 m); Danquah Circle (ends at, 21 m) | BIRDS_EYE_3D, STREET_VIDEO | 44 | 8.8 | 78.5 | 1 |
| r23 East Legon -> Accra Central | motor_scooter | 5.63500, -0.15500 | 5.55020, -0.21740 | 14.5 | 500.0 | 14 / 189 | false | none | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r23 East Legon -> Accra Central | auto | 5.63500, -0.15500 | 5.55020, -0.21740 | 16.3 | 500.0 | 13 / 248 | false | Tetteh Quarshie Interchange (through, 110 m) | BIRDS_EYE_3D | 0 | 0.0 | n/a | 0 |
| r24 Abeka -> Adabraka (through Kwame Nkrumah Interchange area) | motor_scooter | 5.59950, -0.22850 | 5.56300, -0.20900 | 5.8 | 500.0 | 8 / 94 | false | Kwame Nkrumah Interchange (through, 37 m) | BIRDS_EYE_3D | 12 | 2.4 | 27.8 | 0 |
| r24 Abeka -> Adabraka (through Kwame Nkrumah Interchange area) | auto | 5.59950, -0.22850 | 5.56300, -0.20900 | 5.8 | 500.0 | 8 / 103 | false | Kwame Nkrumah Interchange (through, 55 m) | BIRDS_EYE_3D | 12 | 2.4 | 27.8 | 0 |
| r25 Phase 2 failing pair (corridor tetteh-quarshie-accra-central) | motor_scooter | 5.60198, -0.22612 | 5.57811, -0.22970 | no route | | | | | error: Valhalla /route -> HTTP 400: {"error_code":442,"error":"No path could be found for input","status_code":400,"status":"Bad Request"} | | | | |
| r25 Phase 2 failing pair (corridor tetteh-quarshie-accra-central) | auto | 5.60198, -0.22612 | 5.57811, -0.22970 | 3.8 | 500.0 | 7 / 63 | TRUE | none | BIRDS_EYE_3D | 6 | 1.2 | 101.4 | 0 |

Routes attempted: 50; routed: 49; no route/error: 1; unpaved_fallback used: 1; classified STREET_VIDEO anywhere: 17.

## SYNTHETIC classifier demonstrations

**SYNTHETIC: artificial frames generated by the test fixture builder to demonstrate classifier outcomes. This is not real imagery and not a coverage measurement.**

Everything in this section is SYNTHETIC. Nothing here says anything about real roads or real imagery coverage.

### SYNTHETIC: Street run

500 m route, one sequence, a frame every 5 m on the right-hand lane from 100 m to 400 m.

Expected: One STREET_VIDEO segment 100-400 m, BIRDS_EYE_3D before and after.

Route 500.0 m, 61 synthetic frames, 61 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 400.0 | 61 | 5.000 | no | none | street run |
| 3 | BIRDS_EYE_3D | 400.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Short run

Same road, but frames only cover 50 m (below the 60 m minimum run).

Expected: No STREET_VIDEO: the whole route is BIRDS_EYE_3D (run_too_short).

Route 500.0 m, 11 synthetic frames, 11 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 500.0 | 11 | 5.000 | no | none | run_too_short |

### SYNTHETIC: Gap of 14 m

Frames every 14 m across 100-400 m (every consecutive gap is exactly 14 m; the limit is strict < 15 m).

Expected: Qualifies: one STREET_VIDEO segment.

Route 500.0 m, 21 synthetic frames, 21 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 380.0 | 21 | 14.000 | no | none | street run |
| 3 | BIRDS_EYE_3D | 380.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Gap of 16 m

Frames every 16 m across 100-400 m (every consecutive gap is exactly 16 m; the limit is strict < 15 m).

Expected: Does not qualify: BIRDS_EYE_3D (gap_too_large).

Route 500.0 m, 21 synthetic frames, 21 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 500.0 | 21 | 16.000 | no | none | gap_too_large |

### SYNTHETIC: Opposite-lane frames

Eastbound route. 61 frames on the correct right-hand lane plus 167 frames from the opposite carriageway (7 m left, heading reversed).

Expected: Opposite-lane frames are all dropped (left_of_centerline); the street run comes only from the own-direction sequence.

Route 500.0 m, 228 synthetic frames, 61 usable after filtering; dropped: {"left_of_centerline":167}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 400.0 | 61 | 5.000 | no | none | street run |
| 3 | BIRDS_EYE_3D | 400.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Opposite-lane frames only

Same road, only the opposite carriageway has imagery.

Expected: No usable frames: the whole route is BIRDS_EYE_3D.

Route 500.0 m, 167 synthetic frames, 0 usable after filtering; dropped: {"left_of_centerline":167}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Interchange discontinuity

One sequence runs continuously, but at 300 m the matched edge changes from a primary road to a motorway ramp on a bridge (a level change while the sequence continues).

Expected: level_uncertain BIRDS_EYE_3D around 300 m; street video only on either side, not across the transition.

Route 600.0 m, 121 synthetic frames, 121 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | STREET_VIDEO | 0.0 | 275.0 | 56 | 5.000 | no | none | street run |
| 2 | BIRDS_EYE_3D | 275.0 | 330.0 | 10 | 5.000 | level_change | none | level_uncertain |
| 3 | STREET_VIDEO | 330.0 | 600.0 | 55 | 5.000 | no | none | street run |

### SYNTHETIC: Interchange sequence/heading jump

Sequence A ends at 295 m and a different sequence B begins at 305 m on the next edge, with the heading relative to the road changing from -20 to +20 degrees.

Expected: level_uncertain BIRDS_EYE_3D across the jump (sequence_jump and heading_jump).

Route 600.0 m, 120 synthetic frames, 120 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | STREET_VIDEO | 0.0 | 270.0 | 55 | 5.000 | no | none | street run |
| 2 | BIRDS_EYE_3D | 270.0 | 330.0 | 10 | 10.000 | sequence_jump+heading_jump | none | level_uncertain |
| 3 | STREET_VIDEO | 330.0 | 600.0 | 55 | 5.000 | no | none | street run |

### SYNTHETIC: Bridge: two 80 m runs, 20 m gap

Two 80 m runs separated by a 20 m gap (15 m to 30 m: a crossfade bridge, never RIFE-interpolated).

Expected: One STREET_VIDEO segment with the 20 m gap listed as a bridge (not a handoff).

Route 500.0 m, 34 synthetic frames, 34 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 280.0 | 34 | 20.000 | no | 180.0-200.0 (20.000 m) | street run |
| 3 | BIRDS_EYE_3D | 280.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Gap of 14.999 m between two runs

Two 60 m runs (a frame every 5 m) joined by a gap of 14.999 m between the last frame of the first and the first frame of the second.

Expected: RIFE tier: the two pieces form ONE run (no bridge); the gap is RIFE-eligible.

Route 500.0 m, 26 synthetic frames, 26 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 235.0 | 26 | 14.999 | no | none | street run |
| 3 | BIRDS_EYE_3D | 235.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Gap of exactly 15.000 m between two runs

Two 60 m runs (a frame every 5 m) joined by a gap of 15.000 m between the last frame of the first and the first frame of the second.

Expected: Bridge tier: ONE STREET_VIDEO segment with ONE bridge (crossfade, not RIFE).

Route 500.0 m, 26 synthetic frames, 26 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 235.0 | 26 | 15.000 | no | 160.0-175.0 (15.000 m) | street run |
| 3 | BIRDS_EYE_3D | 235.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Gap of exactly 30.000 m between two runs

Two 60 m runs (a frame every 5 m) joined by a gap of 30.000 m between the last frame of the first and the first frame of the second.

Expected: Bridge tier (ceiling is inclusive): ONE STREET_VIDEO segment with ONE bridge.

Route 500.0 m, 26 synthetic frames, 26 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 250.0 | 26 | 30.000 | no | 160.0-190.0 (30.000 m) | street run |
| 3 | BIRDS_EYE_3D | 250.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Gap of 30.001 m between two runs

Two 60 m runs (a frame every 5 m) joined by a gap of 30.001 m between the last frame of the first and the first frame of the second.

Expected: Handoff tier: TWO STREET_VIDEO segments with BIRDS_EYE_3D between, no bridge.

Route 500.0 m, 26 synthetic frames, 26 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 160.0 | 13 | 5.000 | no | none | street run |
| 3 | BIRDS_EYE_3D | 160.0 | 190.0 | 0 | n/a | no | none | no_frames |
| 4 | STREET_VIDEO | 190.0 | 250.0 | 13 | 5.000 | no | none | street run |
| 5 | BIRDS_EYE_3D | 250.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Chain of three runs, two bridges

Three 60 m runs separated by gaps of 20 m and 25 m, all one sequence (pairwise rule: each qualifying run joins the previous one, up to the 2-bridge cap).

Expected: ONE STREET_VIDEO segment 50-275 m with TWO bridges (110-130 m and 190-215 m).

Route 500.0 m, 39 synthetic frames, 39 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 50.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 50.0 | 275.0 | 39 | 25.000 | no | 110.0-130.0 (20.000 m), 190.0-215.0 (25.000 m) | street run |
| 3 | BIRDS_EYE_3D | 275.0 | 500.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Bridge cap: four runs, three valid gaps

Four 60 m runs, one sequence, separated by gaps of 20 m, 25 m and 22 m. A segment may hold at most 2 bridges.

Expected: STREET_VIDEO 50-275 m with TWO bridges, a BIRDS_EYE_3D handoff over the third gap (275-297 m), then the fourth run (297-357 m) as its own STREET_VIDEO segment with no bridge.

Route 600.0 m, 52 synthetic frames, 52 usable after filtering; dropped: {}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 50.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 50.0 | 275.0 | 39 | 25.000 | no | 110.0-130.0 (20.000 m), 190.0-215.0 (25.000 m) | street run |
| 3 | BIRDS_EYE_3D | 275.0 | 297.0 | 0 | n/a | no | none | no_frames |
| 4 | STREET_VIDEO | 297.0 | 357.0 | 13 | 5.000 | no | none | street run |
| 5 | BIRDS_EYE_3D | 357.0 | 600.0 | 0 | n/a | no | none | no_frames |

### SYNTHETIC: Same-sequence rule: 20 m gap, different sequence_id

Two 60 m runs separated by a 20 m gap, but the second run belongs to a different sequence_id.

Expected: No bridge across the sequence change (the matcher keeps one sequence per edge, so the other run is dropped as other_sequence): ONE STREET_VIDEO segment with no bridges, the rest BIRDS_EYE_3D.

Route 500.0 m, 26 synthetic frames, 21 usable after filtering; dropped: {"other_sequence":5}.

| Segment | Mode | From m | To m | Frames | Max gap m | level_uncertain | Bridges (crossfade, not RIFE) | Reason |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | BIRDS_EYE_3D | 0.0 | 100.0 | 0 | n/a | no | none | no_frames |
| 2 | STREET_VIDEO | 100.0 | 160.0 | 13 | 5.000 | no | none | street run |
| 3 | BIRDS_EYE_3D | 160.0 | 500.0 | 8 | 5.000 | no | none | run_too_short |

