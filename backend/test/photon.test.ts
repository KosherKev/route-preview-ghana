import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parsePhotonBody, PHOTON_MAX_BODY_BYTES, photonClient, PhotonError } from "../src/geo/photon";
import { photonIsUp, SKIP_NOTE } from "./helpers/photon";

const servers: http.Server[] = [];
async function serve(h: http.RequestListener): Promise<string> {
  const s = http.createServer(h);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); }))); });

const good = { features: [{ geometry: { coordinates: [-0.1683, 5.6038] }, properties: { name: "Kotoka International Airport", city: "Accra" } }] };

describe("photonClient hardening", () => {
  it("rejects a redirect and never follows it", async () => {
    let followed = 0;
    const target = await serve((_q, res) => { followed++; res.end(JSON.stringify(good)); });
    const base = await serve((_q, res) => { res.writeHead(302, { location: `${target}/api?q=x` }); res.end(); });
    await expect(photonClient(base).search("x")).rejects.toThrow(/redirect/);
    expect(followed).toBe(0);
  });
  it("treats a redirect as unavailable for the probe too", async () => {
    const base = await serve((_q, res) => { res.writeHead(301, { location: "http://127.0.0.1:1/" }); res.end(); });
    expect(await photonClient(base).available()).toBe(false);
  });
  it("refuses non-loopback base URLs", () => {
    for (const u of ["https://photon.example.org", "http://10.0.0.5:2322", "nonsense"]) expect(() => photonClient(u)).toThrow(/loopback/);
  });
  it("rejects an oversized body (declared and streamed)", async () => {
    const big = "x".repeat(PHOTON_MAX_BODY_BYTES + 10);
    const declared = await serve((_q, res) => { res.setHeader("content-type", "application/json"); res.end(big); });
    await expect(photonClient(declared).search("x")).rejects.toThrow(/too large/);
    const streamed = await serve((_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write(big); res.end(); });
    await expect(photonClient(streamed).search("x")).rejects.toThrow(PhotonError);
  });
  it("rejects non-JSON, wrong shape and error statuses", async () => {
    const notJson = await serve((_q, res) => res.end("<html>"));
    await expect(photonClient(notJson).search("x")).rejects.toThrow(/JSON/);
    const wrong = await serve((_q, res) => res.end(JSON.stringify({ features: "nope" })));
    await expect(photonClient(wrong).search("x")).rejects.toThrow(/shape/);
    const five = await serve((_q, res) => { res.statusCode = 503; res.end(); });
    await expect(photonClient(five).search("x")).rejects.toThrow(/503/);
  });
  it("times out a hung server", async () => {
    const base = await serve(() => { /* never answers */ });
    await expect(photonClient(base, 150).search("x")).rejects.toThrow(PhotonError);
  });
  it("parses a good answer, passes limit and location bias, and caps limit", async () => {
    let seen = "";
    const base = await serve((q, res) => { seen = q.url ?? ""; res.end(JSON.stringify(good)); });
    const out = await photonClient(base).search("kotoka", { limit: 999, near: { lat: 5.6, lon: -0.2 } });
    expect(out).toEqual([{ name: "Kotoka International Airport", label: "Kotoka International Airport, Accra", lat: 5.6038, lon: -0.1683 }]);
    expect(seen).toContain("limit=20");
    expect(seen).toContain("lat=5.6");
  });
  it("drops features with unusable geometry", () => {
    const body = { features: [{ geometry: { coordinates: ["a", 1] } }, { geometry: { coordinates: [0, 99] } }, { geometry: { coordinates: [-0.2, 5.6] }, properties: { name: "ok" } }, null] };
    expect(parsePhotonBody(body, "q").map((p) => p.name)).toEqual(["ok"]);
  });
  it("reports availability from /status and caches it", async () => {
    let hits = 0;
    const base = await serve((_q, res) => { hits++; res.end("{}"); });
    const c = photonClient(base);
    expect(await c.available()).toBe(true);
    expect(await c.available()).toBe(true);
    expect(hits).toBe(1);
    expect(await photonClient("http://127.0.0.1:1").available()).toBe(false);
  });
});

const up = await photonIsUp();
if (!up) console.warn(SKIP_NOTE);
describe.skipIf(!up)("live Photon (skipped when Photon is not running)", () => {
  it("resolves Kotoka International Airport near its real position", async () => {
    const [p] = await photonClient().search("Kotoka International Airport", { limit: 3 });
    expect(p!.lat).toBeCloseTo(5.6038, 1);
    expect(p!.lon).toBeCloseTo(-0.1683, 1);
  });
});
