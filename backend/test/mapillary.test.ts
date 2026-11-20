import { describe, expect, it, vi } from "vitest";
import { MapillarySource, requireToken, tileBBox, toFrameRow, FRAME_FIELDS } from "../src/ingest/mapillary";

const TOKEN = "TEST-TOKEN-not-real";
const img = (id: string, lon: number, lat: number, extra = {}) => ({
  id, sequence: "seq1", computed_geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
  computed_compass_angle: 90, captured_at: 1700000000000, is_pano: false, camera_type: "perspective",
  width: 4000, height: 3000, quality_score: 0.8, creator: { username: "mapper", id: "1" }, ...extra,
});
const ok = (data: unknown[], paging?: unknown) => new Response(JSON.stringify({ data, paging }), { status: 200 });

function make(responses: (() => Response)[], extra = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = queue.shift();
    if (!r) throw new Error("unexpected extra request");
    return r();
  }) as unknown as typeof fetch;
  let t = 0;
  const src = new MapillarySource({
    token: TOKEN, fetchImpl, sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, minIntervalMs: 100, ...extra,
  });
  return { src, calls, sleeps };
}

describe("MapillarySource (mocked HTTP)", () => {
  it("queries /images with bbox and the frame fields; token only in the header", async () => {
    const { src, calls } = make([() => ok([img("1", -0.2, 5.6)])]);
    const rows = await src.frameRowsInBBox([-0.21, 5.59, -0.19, 5.61]);
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe("https://graph.mapillary.com/images");
    expect(u.searchParams.get("bbox")).toBe("-0.21,5.59,-0.19,5.61");
    for (const f of ["computed_geometry", "computed_compass_angle", "captured_at", "sequence"]) {
      expect(u.searchParams.get("fields")!.split(",")).toContain(f);
    }
    expect(calls[0]!.url).not.toContain(TOKEN);
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(`OAuth ${TOKEN}`);
    expect(rows[0]).toMatchObject({
      image_id: "1", sequence_id: "seq1", lon: -0.2, lat: 5.6, computed_compass_angle: 90, is_pano: false,
      source: "mapillary", creator: "mapper", captured_at: new Date(1700000000000).toISOString(),
    });
  });

  it("supports radius queries", async () => {
    const { src, calls } = make([() => ok([])]);
    await src.imagesNear(-0.175, 5.636, 50);
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get("closeto")).toBe("-0.175,5.636");
    expect(u.searchParams.get("radius")).toBe("50");
  });

  it("honors Retry-After on 429 then succeeds", async () => {
    const { src, calls, sleeps } = make([
      () => new Response("slow down", { status: 429, headers: { "Retry-After": "7" } }),
      () => ok([img("2", -0.2, 5.6)]),
    ]);
    const rows = await src.frameRowsInBBox([-0.21, 5.59, -0.19, 5.61]);
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(7000);
  });

  it("retries 5xx with Retry-After and falls back to backoff without it", async () => {
    const { src, sleeps } = make([
      () => new Response("", { status: 502 }),
      () => new Response("", { status: 503, headers: { "Retry-After": "2" } }),
      () => ok([]),
    ]);
    await src.imagesNear(0, 0, 10);
    expect(sleeps).toContain(1000); // 502 without header: 1000 * 2^0 backoff
    expect(sleeps).toContain(2000); // 503 with Retry-After: 2
  });

  it("gives up after maxRetries without leaking the token", async () => {
    const { src } = make(Array.from({ length: 3 }, () => () => new Response("", { status: 429, headers: { "Retry-After": "0" } })), { maxRetries: 2 });
    const err = await src.imagesNear(0, 0, 10).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("429");
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("does not retry 4xx client errors", async () => {
    const { src, calls } = make([() => new Response("", { status: 400 })]);
    await expect(src.imagesNear(0, 0, 10)).rejects.toThrow("400");
    expect(calls).toHaveLength(1);
  });

  it("throttles consecutive requests", async () => {
    const { src, sleeps } = make([() => ok([]), () => ok([])]);
    await src.imagesNear(0, 0, 10);
    await src.imagesNear(0, 0, 10);
    expect(sleeps).toEqual([100]);
  });

  it("follows same-host paging and strips access_token", async () => {
    const { src, calls } = make([
      () => ok([img("a", 0, 0)], { next: "https://graph.mapillary.com/images?bbox=1&access_token=LEAK&after=x" }),
      () => ok([img("b", 0, 0)]),
    ]);
    expect(await src.imagesNear(0, 0, 10)).toHaveLength(2);
    expect(calls[1]!.url).toContain("after=x");
    expect(calls[1]!.url).not.toContain("LEAK");
  });

  it("refuses to follow paging links to another host", async () => {
    const { src, calls } = make([() => ok([img("a", 0, 0)], { next: "https://evil.example/images?after=x" })]);
    expect(await src.imagesNear(0, 0, 10)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("tiles large bboxes and dedupes images", async () => {
    expect(tileBBox([0, 0, 0.2, 0.1], 0.09)).toHaveLength(3 * 2);
    const { src, calls } = make([() => ok([img("x", 0, 0)]), () => ok([img("x", 0, 0)])]);
    expect(await src.imagesInBBox([0, 0, 0.1, 0.05])).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("framesAlong returns frames within the buffer, ordered along the path", async () => {
    const path: [number, number][] = [[5.6, -0.2], [5.6, -0.19]];
    const { src } = make([() => ok([
      img("far", -0.195, 5.7), img("late", -0.191, 5.6001), img("early", -0.199, 5.6),
    ])]);
    const frames = await src.framesAlong(path, 30);
    expect(frames.map((f) => f.ref)).toEqual(["mapillary:early", "mapillary:late"]);
    expect(src.id).toBe("mapillary");
    expect(src.attribution()).toMatch(/Mapillary/);
  });
});

describe("token handling", () => {
  it("requireToken stops with a clear message when unset or blank", () => {
    expect(() => requireToken({})).toThrow(/MAPILLARY_TOKEN is not set/);
    expect(() => requireToken({ MAPILLARY_TOKEN: "  " })).toThrow(/MAPILLARY_TOKEN is not set/);
    expect(requireToken({ MAPILLARY_TOKEN: "abc" })).toBe("abc");
  });

  it("skips images without geometry", () => {
    expect(toFrameRow({ id: "9" })).toBeNull();
    expect(FRAME_FIELDS).toContain("computed_geometry");
  });
});
