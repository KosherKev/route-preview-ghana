import { describe, expect, it, vi } from "vitest";
import {
  MapillarySource, requireToken, tileBBox, toFrameRow, FRAME_FIELDS, parseRetryAfterMs, validateBBox, countTiles,
  MAX_RETRY_AFTER_MS, DEFAULT_MAX_TILES,
} from "../src/ingest/mapillary";

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

const timeoutErr = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("Retry-After handling", () => {
  it("parses the HTTP-date form relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:12 GMT", now)).toBe(12_000);
  });

  it("treats a past date as 0, and negative/NaN/garbage as unusable", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfterMs("Wed, 31 Dec 2025 00:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfterMs("-5", now)).toBeNull();
    expect(parseRetryAfterMs("NaN", now)).toBeNull();
    expect(parseRetryAfterMs("Infinity", now)).toBeNull();
    expect(parseRetryAfterMs("soon", now)).toBeNull();
    expect(parseRetryAfterMs("", now)).toBeNull();
    expect(parseRetryAfterMs(null, now)).toBeNull();
  });

  it("caps seconds and dates at 60 s", () => {
    expect(MAX_RETRY_AFTER_MS).toBe(60_000);
    expect(parseRetryAfterMs("99999999", 0)).toBe(60_000);
    expect(parseRetryAfterMs("Fri, 01 Jan 2100 00:00:00 GMT", 0)).toBe(60_000);
    expect(parseRetryAfterMs("60", 0)).toBe(60_000);
    expect(parseRetryAfterMs("59", 0)).toBe(59_000);
  });

  it("a hostile Retry-After sleeps at most 60000 ms in the retry loop", async () => {
    const { src, sleeps } = make([
      () => new Response("", { status: 429, headers: { "Retry-After": "99999999" } }),
      () => ok([]),
    ]);
    await src.imagesNear(0, 0, 10);
    expect(Math.max(...sleeps)).toBe(60_000);
  });

  it("honors an HTTP-date Retry-After in the retry loop", async () => {
    // fake clock starts at 0 (1970-01-01T00:00:00Z); throttle sleeps are only 0 or 100 ms
    const { src, sleeps } = make([
      () => new Response("", { status: 503, headers: { "Retry-After": "Thu, 01 Jan 1970 00:00:09 GMT" } }),
      () => ok([]),
    ]);
    await src.imagesNear(0, 0, 10);
    expect(sleeps.some((ms) => ms >= 8000 && ms <= 9000)).toBe(true);
  });
});

describe("request timeout", () => {
  it("passes an abort signal to every fetch", async () => {
    const { src, calls } = make([() => ok([])]);
    await src.imagesNear(0, 0, 10);
    expect(calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries after a timeout and then succeeds", async () => {
    const { src, calls } = make([
      () => { throw timeoutErr(); },
      () => ok([img("t", 0, 0)]),
    ]);
    expect(await src.imagesNear(0, 0, 10)).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("gives a clear, token-free error when timeouts exhaust retries", async () => {
    const { src, calls } = make(Array.from({ length: 3 }, () => () => { throw timeoutErr(); }), { maxRetries: 2, requestTimeoutMs: 1234 });
    const err = (await src.imagesNear(0, 0, 10).catch((e: Error) => e)) as Error;
    expect(err.message).toBe("Mapillary request timed out after 1234 ms (3 attempts)");
    expect(err.message).not.toContain(TOKEN);
    expect(calls).toHaveLength(3);
  });
});

describe("captured_at validation", () => {
  it("accepts epoch 0, epoch-ms numbers, numeric strings and ISO strings", () => {
    expect(toFrameRow(img("z", 0, 0, { captured_at: 0 }))!.captured_at).toBe("1970-01-01T00:00:00.000Z");
    expect(toFrameRow(img("n", 0, 0, { captured_at: "1700000000000" }))!.captured_at).toBe(new Date(1700000000000).toISOString());
    expect(toFrameRow(img("i", 0, 0, { captured_at: "2023-11-14T22:13:20Z" }))!.captured_at).toBe("2023-11-14T22:13:20.000Z");
    expect(toFrameRow(img("u", 0, 0, { captured_at: undefined }))!.captured_at).toBeNull();
  });

  it("skips invalid captured_at without throwing and counts it", async () => {
    expect(() => toFrameRow(img("b", 0, 0, { captured_at: "not-a-date" }))).not.toThrow();
    expect(toFrameRow(img("b", 0, 0, { captured_at: 8.64e15 + 1 }))).toBeNull();
    const { src } = make([() => ok([
      img("good", 0, 0), img("bad1", 0, 0, { captured_at: "garbage" }), img("bad2", 0, 0, { captured_at: 1e20 }),
      { id: "nogeo" },
    ])]);
    const { rows, skipped } = await src.frameRowsWithStats([0, 0, 0.01, 0.01]);
    expect(rows.map((r) => r.image_id)).toEqual(["good"]);
    expect(skipped).toEqual({ invalid_captured_at: 2, no_geometry: 1 });
  });
});

describe("bbox validation and tile cap", () => {
  it("rejects out-of-range, non-finite and inverted boxes", () => {
    expect(() => validateBBox([-0.2, 5.5, -0.1, 5.6])).not.toThrow();
    expect(() => validateBBox([-181, 0, 0, 1])).toThrow(/longitude/);
    expect(() => validateBBox([0, 0, 181, 1])).toThrow(/longitude/);
    expect(() => validateBBox([0, -91, 1, 1])).toThrow(/latitude/);
    expect(() => validateBBox([0, 0, 1, 91])).toThrow(/latitude/);
    expect(() => validateBBox([0, 0, Number.NaN, 1])).toThrow(/finite/);
    expect(() => validateBBox([1, 0, 1, 1])).toThrow(/minLon < maxLon/);
    expect(() => validateBBox([0, 1, 1, 1])).toThrow(/minLat < maxLat/);
    expect(() => validateBBox([0, 2, 1, 1])).toThrow(/minLat < maxLat/);
  });

  it("rejects an antimeridian-crossing box with a clear message", () => {
    expect(() => validateBBox([170, 0, -170, 1])).toThrow(/antimeridian.*not supported/);
  });

  it("refuses a bbox above the tile cap before any request, and allows raising it", async () => {
    expect(DEFAULT_MAX_TILES).toBe(400);
    expect(countTiles([0, 0, 2, 2], 0.09)).toBe(23 * 23);
    const big = make([]);
    await expect(big.src.imagesInBBox([0, 0, 2, 2])).rejects.toThrow(/529 tiles.*limit of 400.*--max-tiles/);
    expect(big.calls).toHaveLength(0);
    const raised = make(Array.from({ length: 529 }, () => () => ok([])), { maxTiles: 600 });
    await expect(raised.src.imagesInBBox([0, 0, 2, 2])).resolves.toEqual([]);
    expect(raised.calls).toHaveLength(529);
  });

  it("imagesInBBox validates the box too", async () => {
    const { src, calls } = make([]);
    await expect(src.imagesInBBox([0, 0, 0, 1])).rejects.toThrow(/minLon/);
    expect(calls).toHaveLength(0);
  });
});

describe("kill switch flipped mid-ingestion", () => {
  const KEY = "IMAGERY_SOURCES_DISABLED";
  it("stops before page 2 when the variable is set after page 1", async () => {
    const saved = process.env[KEY];
    try {
      delete process.env[KEY];
      const { src, calls } = make([
        () => { process.env[KEY] = "mapillary"; return ok([img("1", -0.2, 5.6)], { next: "https://graph.mapillary.com/images?after=p2" }); },
        () => ok([img("2", -0.2, 5.6)]),
      ]);
      await expect(src.imagesNear(-0.2, 5.6, 50)).rejects.toThrow(/"mapillary" is disabled by IMAGERY_SOURCES_DISABLED/);
      expect(calls).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved;
    }
  });
  it("stops before a retry attempt when the variable is set after a failed attempt", async () => {
    const saved = process.env[KEY];
    try {
      delete process.env[KEY];
      const { src, calls } = make([
        () => { process.env[KEY] = "mapillary"; return new Response("x", { status: 503 }); },
        () => ok([]),
      ]);
      await expect(src.imagesNear(-0.2, 5.6, 50)).rejects.toThrow(/is disabled by IMAGERY_SOURCES_DISABLED/);
      expect(calls).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved;
    }
  });
});
