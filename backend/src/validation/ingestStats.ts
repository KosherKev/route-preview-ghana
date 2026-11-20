// Field-presence statistics over raw Mapillary image metadata records (no image data is ever involved).
import type { MapillaryImage } from "../ingest/mapillary";
import { countByAge, emptyBuckets, type BucketCounts } from "./coverage";
import { parseCapturedAt } from "../ingest/mapillary";

export interface FieldStats {
  images: number;
  qualityScorePresent: number;
  qualityScoreNull: number;
  /** Present and below 0.5, the classifier's minimum (a separate cause of the low_quality drop). */
  qualityScoreBelow05: number;
  computedGeometryMissing: number;
  computedCompassMissing: number;
  sequenceMissing: number;
  capturedAtMissing: number;
  panoramas: number;
  captureYear: BucketCounts;
}

export const emptyFieldStats = (): FieldStats => ({
  images: 0, qualityScorePresent: 0, qualityScoreNull: 0, qualityScoreBelow05: 0, computedGeometryMissing: 0, computedCompassMissing: 0,
  sequenceMissing: 0, capturedAtMissing: 0, panoramas: 0, captureYear: emptyBuckets(),
});

/** Accumulates one image. A quality_score that is absent, null or not a finite number counts as null. */
export function addImage(s: FieldStats, img: MapillaryImage, minQuality = 0.5): void {
  s.images++;
  const q = img.quality_score;
  if (typeof q === "number" && Number.isFinite(q)) {
    s.qualityScorePresent++;
    if (q < minQuality) s.qualityScoreBelow05++;
  } else s.qualityScoreNull++;
  if (!img.computed_geometry) s.computedGeometryMissing++;
  if (img.computed_compass_angle === undefined || img.computed_compass_angle === null) s.computedCompassMissing++;
  if (!img.sequence) s.sequenceMissing++;
  if (img.captured_at === undefined || img.captured_at === null) s.capturedAtMissing++;
  if (img.is_pano) s.panoramas++;
  const iso = img.captured_at == null ? null : parseCapturedAt(img.captured_at);
  const b = countByAge([iso]);
  for (const k of Object.keys(b) as (keyof BucketCounts)[]) s.captureYear[k] += b[k];
}
