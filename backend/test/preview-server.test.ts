import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Candidate, GeocodeFn } from "../src/geo/geocode";
import { createPreviewBuilder } from "../src/preview/build";
import { createApproachServer, listenLoopback, parsePreviewRequest, PREVIEW_REQUEST_FIELDS, ValidationError } from "../src/routing/server";
import { manifestErrors } from "./helpers/manifestSchema";
import { clipRecord, depsFixture, scene, streetFrames } from "./helpers/previewFixture";

const cand = (name: string, lat: number, lon: number, score: number): Candidate => ({ name, lat, lon, source: "landmarks", score, distance_m: null });
const TABLE: Record<string, Candidate[]> = {
  "total": [cand("Total", 5.5652, -0.1814, 1), cand("Total", 5.6423, -0.152, 1)],
  "kotoka": [cand("Kotoka International Airport", 5.6038, -0.1683, 0.95)],
};
const geocode: GeocodeFn = async (p) => ({ query: p.q, candidates: TABLE[p.q.toLowerCase()] ?? [], degraded: p.q === "kotoka" });
const O = scene.axis.points[0]!, D = scene.axis.points.at(-1)!;
const OK = { origin: O, destination: D, costing: "motor_scooter" };

const mk = (preview = true) => createApproachServer({
  onError: () => {}, geocode,
  extractor: async () => { throw new Error("approach extractor must not be used by /preview"); },
  ...(preview ? { preview: createPreviewBuilder(depsFixture({ frames: streetFrames(950, 1100), clips: [clipRecord(1009, 150)] })) } : {}),
});
let srv: ReturnType<typeof mk>, off: ReturnType<typeof mk>;
let base = "", offBase = "";
beforeAll(async () => {
  srv = mk(); off = mk(false);
  await listenLoopback(srv, 0); await listenLoopback(off, 0);
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; offBase = `http://127.0.0.1:${(off.address() as AddressInfo).port}`;
});
afterAll(async () => { await Promise.all([srv, off].map((s) => new Promise<void>((r) => s.close(() => r())))); });
const post = (b: unknown, url = base, path = "/preview") => fetch(`${url}${path}`, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });

describe("POST /preview", () => {
  it("returns a schema-valid manifest for lat/lon input", async () => {
    const r = await post({ ...OK, approach_length_m: 500, landmark_max_per_100m: 2 });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    const m = await r.json() as { prototype: boolean; segments: unknown[]; overlays: { landmarkOptions: { maxPer100m: number } } };
    expect(manifestErrors(m)).toEqual([]);
    expect(m.prototype).toBe(true);
    expect(m.overlays.landmarkOptions.maxPer100m).toBe(2);
  });
  it("resolves a name, reports it, and marks the manifest degraded when the name lookup was", async () => {
    const m = await (await post({ origin: O, destination_query: "kotoka", costing: "motor_scooter" })).json() as { resolved: Record<string, any>; degraded: boolean };
    expect(m.resolved.destination).toMatchObject({ query: "kotoka", name: "Kotoka International Airport", degraded: true });
    expect(m.degraded).toBe(true);
    expect(manifestErrors(m)).toEqual([]);
  });
  it("ambiguous names return the same 422 disambiguation problem JSON as /approach and compute no route", async () => {
    const r = await post({ origin: O, destination_query: "Total", costing: "auto" });
    expect(r.status).toBe(422);
    expect(r.headers.get("content-type")).toBe("application/problem+json");
    const b = await r.json() as Record<string, any>;
    expect(b).toMatchObject({ title: "Ambiguous place", status: 422, field: "destination_query", query: "Total" });
    expect(b.candidates).toHaveLength(2);
  });
  it("PRODUCT BOUNDARY: any unknown field, including live/device/current position names, is a 400, never ignored", async () => {
    for (const k of ["current_position", "live_location", "device_location", "gps", "position", "rider_lat", "x".repeat(500)]) {
      const r = await post({ ...OK, [k]: { lat: 5.6, lon: -0.2 } });
      expect(r.status, k).toBe(400);
      expect(r.headers.get("content-type")).toBe("application/problem+json");
      const text = JSON.stringify(await r.json());
      expect(text).toContain("unknown field");
      expect(text.length).toBeLessThan(400);
    }
  });
  it("the accepted field list names no live position", () => {
    expect([...PREVIEW_REQUEST_FIELDS]).toEqual(["origin", "destination", "origin_query", "destination_query", "costing", "approach_length_m", "decision_window_m", "landmark_max_distance_m", "landmark_max_per_100m"]);
  });
  it("validates input with problem JSON", async () => {
    for (const body of [{ ...OK, costing: "bicycle" }, { ...OK, landmark_max_per_100m: 2.5 }, { ...OK, landmark_max_distance_m: 1 }, { ...OK, approach_length_m: 10 }, { ...OK, origin: { lat: 40, lon: 40 } }, [1, 2]]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.headers.get("content-type")).toBe("application/problem+json");
    }
    expect(() => parsePreviewRequest({ ...OK, surprise: 1 })).toThrow(ValidationError);
  });
  it("405 on GET, 415 on wrong content type, 404 when the preview builder is not configured", async () => {
    expect((await fetch(`${base}/preview`)).status).toBe(405);
    expect((await fetch(`${base}/preview`, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await post(OK, offBase)).status).toBe(404);
  });
  it("an upstream failure is a generic 502 problem JSON with no internals", async () => {
    const s = createApproachServer({
      onError: () => {},
      preview: async () => { throw new Error("valhalla blew up at /secret/path"); },
    });
    await listenLoopback(s, 0);
    const r = await post(OK, `http://127.0.0.1:${(s.address() as AddressInfo).port}`);
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
    await new Promise<void>((res) => s.close(() => res()));
  });
  it("answers 504 when the builder exceeds the deadline", async () => {
    const s = createApproachServer({ onError: () => {}, deadlineMs: 50, preview: () => new Promise(() => {}) });
    await listenLoopback(s, 0);
    const r = await post(OK, `http://127.0.0.1:${(s.address() as AddressInfo).port}`);
    expect(r.status).toBe(504);
    await new Promise<void>((res) => s.close(() => res()));
  });
});
