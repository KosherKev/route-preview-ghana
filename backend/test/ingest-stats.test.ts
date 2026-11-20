import { describe, expect, it } from "vitest";
import { addImage, emptyFieldStats } from "../src/validation/ingestStats";

const pt = { type: "Point" as const, coordinates: [-0.2, 5.6] as [number, number] };

describe("addImage", () => {
  it("counts null, present and below-threshold quality scores separately", () => {
    const s = emptyFieldStats();
    addImage(s, { id: "1", quality_score: 0.9 });
    addImage(s, { id: "2", quality_score: 0.2 });
    addImage(s, { id: "3" });
    addImage(s, { id: "4", quality_score: null as unknown as number });
    addImage(s, { id: "5", quality_score: Number.NaN });
    addImage(s, { id: "6", quality_score: 0.5 });
    expect(s.images).toBe(6);
    expect(s.qualityScorePresent).toBe(3);
    expect(s.qualityScoreNull).toBe(3);
    expect(s.qualityScoreBelow05).toBe(1);
  });
  it("counts missing computed fields, sequence, panoramas and capture years", () => {
    const s = emptyFieldStats();
    addImage(s, { id: "1", computed_geometry: pt, computed_compass_angle: 10, sequence: "a", captured_at: Date.UTC(2016, 5, 1), is_pano: false });
    addImage(s, { id: "2", captured_at: "2025-02-01T00:00:00Z", is_pano: true });
    addImage(s, { id: "3", computed_compass_angle: 0, computed_geometry: pt, sequence: "b" });
    expect(s.computedGeometryMissing).toBe(1);
    expect(s.computedCompassMissing).toBe(1);
    expect(s.sequenceMissing).toBe(1);
    expect(s.capturedAtMissing).toBe(1);
    expect(s.panoramas).toBe(1);
    expect(s.captureYear["2015-2019"]).toBe(1);
    expect(s.captureYear["2024+"]).toBe(1);
    expect(s.captureYear.unknown).toBe(1);
  });
});
