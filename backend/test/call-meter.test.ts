import { describe, expect, it } from "vitest";
import { CallMeter } from "../src/ingest/callMeter";
import { MapillarySource } from "../src/ingest/mapillary";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe("CallMeter", () => {
  it("counts calls by status and records 429s with Retry-After", async () => {
    const m = new CallMeter(250);
    const seq = [json({}, 429, { "retry-after": "2" }), json({}, 503), json({ data: [] })];
    const f = m.wrapFetch((async () => seq.shift()!) as unknown as typeof fetch);
    for (let i = 0; i < 3; i++) await f("https://example.test/x");
    expect(m.stats.calls).toBe(3);
    expect(m.stats.byStatus).toEqual({ "429": 1, "503": 1, "200": 1 });
    expect(m.stats.retriedResponses).toBe(2);
    expect(m.stats.rateLimitEvents).toEqual([{ atCall: 1, status: 429, retryAfter: "2" }]);
  });
  it("counts network errors and rethrows", async () => {
    const m = new CallMeter(250);
    const f = m.wrapFetch((async () => { throw new TypeError("boom"); }) as unknown as typeof fetch);
    await expect(f("https://example.test/x")).rejects.toThrow("boom");
    expect(m.stats.networkErrors).toBe(1);
    expect(m.stats.calls).toBe(1);
  });
  it("sums only waits longer than the throttle interval", async () => {
    const m = new CallMeter(250);
    const s = m.wrapSleep(async () => {});
    await s(100); await s(250); await s(2000);
    expect(m.stats.backoffWaitMs).toBe(2000);
  });
  it("never stores the URL or token in its stats, and the source's retry honours Retry-After through it", async () => {
    const m = new CallMeter(0);
    const TOKEN = "TESTTOKEN-not-real-123";
    const waits: number[] = [];
    const seq = [json({}, 429, { "retry-after": "3" }), json({ data: [{ id: "1", computed_geometry: { type: "Point", coordinates: [-0.2, 5.6] } }] })];
    const src = new MapillarySource({
      token: TOKEN, minIntervalMs: 0, fetchImpl: m.wrapFetch((async () => seq.shift()!) as unknown as typeof fetch),
      sleep: m.wrapSleep(async (ms) => { waits.push(ms); }),
    });
    const imgs = await src.imagesInBBox([-0.201, 5.599, -0.199, 5.601]);
    expect(imgs).toHaveLength(1);
    expect(waits).toContain(3000);
    expect(m.stats.calls).toBe(2);
    expect(m.stats.backoffWaitMs).toBe(3000);
    expect(JSON.stringify(m.stats)).not.toContain(TOKEN);
  });
});
