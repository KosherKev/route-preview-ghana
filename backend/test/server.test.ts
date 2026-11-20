import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApproachServer, listenLoopback, parseApproachRequest, ValidationError, MAX_BODY_BYTES } from "../src/routing/server";
import type { ApproachResult } from "../src/routing/approach";

const OK = { origin: { lat: 5.6361, lon: -0.175 }, destination: { lat: 5.5502, lon: -0.2174 }, costing: "auto" };
let calls: unknown[] = [];
let slow = false;
const server = createApproachServer({
  deadlineMs: 200,
  extractor: async (c, o, d, opts) => {
    calls.push({ c, o, d, opts });
    if (slow) await new Promise((r) => setTimeout(r, 1000));
    return { costing: c, unpaved_fallback: false } as unknown as ApproachResult;
  },
});
let base = "";
beforeAll(async () => { await listenLoopback(server, 0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(() => new Promise<void>((r) => server.close(() => r())));
const post = (body: string) => fetch(`${base}/approach`, { method: "POST", body });

describe("approach HTTP service", () => {
  it("binds loopback only", async () => {
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    expect(() => listenLoopback(createApproachServer(), 0, "0.0.0.0")).toThrow(/loopback only/);
  });
  it("serves /health and POST /approach", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    const r = await post(JSON.stringify({ ...OK, approach_length_m: 300 }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ costing: "auto", unpaved_fallback: false });
    expect(calls.at(-1)).toMatchObject({ c: "auto", opts: { approachLengthM: 300 } });
  });
  it("validates input", async () => {
    const bad = [
      "not json", "[]", JSON.stringify({ ...OK, costing: "bike" }), JSON.stringify({ ...OK, origin: { lat: "5", lon: 0 } }),
      JSON.stringify({ ...OK, destination: { lat: 51.5, lon: -0.1 } }), JSON.stringify({ ...OK, approach_length_m: 1e9 }),
      JSON.stringify({ ...OK, decision_window_m: -1 }), JSON.stringify({ ...OK, origin: null }),
    ];
    const n = calls.length;
    for (const b of bad) expect((await post(b)).status, b).toBe(400);
    expect(calls.length).toBe(n);
  });
  it("rejects oversized bodies, wrong methods and unknown paths", async () => {
    expect((await post("x".repeat(MAX_BODY_BYTES + 10))).status).toBe(413);
    expect((await fetch(`${base}/approach`)).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
  it("times out slow upstream work with 504", async () => {
    slow = true;
    expect((await post(JSON.stringify(OK))).status).toBe(504);
    slow = false;
  });
  it("parseApproachRequest throws ValidationError", () => {
    expect(() => parseApproachRequest(null)).toThrow(ValidationError);
    expect(parseApproachRequest(OK).costing).toBe("auto");
  });
});
