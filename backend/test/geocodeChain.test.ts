import { describe, expect, it } from "vitest";
import { coordinateGeocoder, geocodeWithFallback, httpGeocoder } from "../src/patterns/geocodeChain";

describe("geocodeChain", () => {
  it("parses coordinate input without network", async () => {
    const out = await coordinateGeocoder().geocode("5.6037, -0.1870");
    expect(out).toEqual({
      answered: true,
      place: { lat: 5.6037, lon: -0.187, label: "5.6037, -0.1870", source: "coordinates" },
    });
  });

  it("falls through a failed provider (AbortSignal.any available)", async () => {
    const failing = httpGeocoder("down", async () => { throw new Error("boom"); });
    const res = await geocodeWithFallback([failing, coordinateGeocoder()], "5.6, -0.2", new AbortController().signal);
    expect(res.answeredBy).toBe("coordinates");
  });
});
