import { describe, expect, it } from "vitest";
import { COSTING_OPTIONS, decodePolyline6, edgesFromTraceAttributes, postJson, routeRequest, routeWithEdges } from "../src/routing/valhalla";

const A = { lat: 5.6361, lon: -0.175 };
const B = { lat: 5.5502, lon: -0.2174 };

describe("valhalla helpers", () => {
  it("decodes a precision-6 polyline", () => {
    // encodes [[38.5,-120.2],[40.7,-120.95]] at precision 5 in the Google docs; at precision 6 use own fixture
    const enc = (vals: number[]) => vals.map((v) => {
      let n = v < 0 ? ~(v << 1) : v << 1; let s = "";
      while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
      return s + String.fromCharCode(n + 63);
    }).join("");
    const e = enc([5636100, -175000]) + enc([10, -20]);
    expect(decodePolyline6(e)).toEqual([[5.6361, -0.175], [5.636110, -0.175020]]);
  });

  it("sends exclude_unpaved for auto and only supported options for scooter", () => {
    expect(routeRequest("auto", A, B).costing_options).toEqual({ auto: { exclude_unpaved: true } });
    expect(COSTING_OPTIONS.motor_scooter).not.toHaveProperty("exclude_unpaved");
  });

  it("extracts edge ids", () => {
    expect(edgesFromTraceAttributes({ edges: [{ id: 11, way_id: 5, length: 0.1 }, { id: 12 }] }).map((e) => e.id)).toEqual([11, 12]);
  });

  it("routes then map-matches through injected fetch", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      const body = url.endsWith("/route")
        ? { trip: { summary: { length: 1.2, time: 90 }, legs: [{ shape: "_p~iF~ps|U" }] } }
        : { edges: [{ id: 101 }, { id: 202 }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await routeWithEdges("http://v", "auto", A, B, fake);
    expect(calls).toEqual(["http://v/route", "http://v/trace_attributes"]);
    expect(r.edges.map((e) => e.id)).toEqual([101, 202]);
  });

  it("throws a clear error when the route has no leg", async () => {
    const fake = (async () => new Response(JSON.stringify({ trip: { legs: [] } }), { status: 200 })) as unknown as typeof fetch;
    await expect(routeWithEdges("http://v", "auto", A, B, fake)).rejects.toThrow(/no route leg/);
    const noTrip = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(routeWithEdges("http://v", "auto", A, B, noTrip)).rejects.toThrow(/no route leg/);
  });

  it("passes a timeout signal and reports a timeout clearly", async () => {
    let signal: AbortSignal | undefined;
    const slow = (async (_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    await expect(postJson("http://v", "/route", {}, slow, 50)).rejects.toThrow("Valhalla /route timed out after 50 ms");
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
