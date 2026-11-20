import type { BBox } from "./mapillary";

/** Accra corridors to ingest later: [minLon, minLat, maxLon, maxLat]. Documented in backend/README.md. */
export const CORRIDORS: Record<string, BBox> = {
  "tetteh-quarshie-accra-central": [-0.235, 5.535, -0.165, 5.645],
  "accra-core": [-0.27, 5.5, -0.1, 5.7],
};
