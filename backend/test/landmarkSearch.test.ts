import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbConfig, loadEnv } from "../src/config";
import { MAX_LIMIT, MAX_QUERY_CHARS, parseSearchParams, searchLandmarks, SearchInputError } from "../src/geo/landmarkSearch";
import { createApproachServer, listenLoopback } from "../src/routing/server";
import type http from "node:http";

const sp = (s: string) => new URLSearchParams(s);

describe("parseSearchParams", () => {
  it("accepts a plain query with defaults", () => {
    expect(parseSearchParams(sp("q=Total"))).toEqual({ q: "Total", near: undefined, limit: 5 });
  });
  it("parses near and limit", () => {
    expect(parseSearchParams(sp("q=x&near=5.6,-0.2&limit=3"))).toEqual({ q: "x", near: { lat: 5.6, lon: -0.2 }, limit: 3 });
  });
  it.each([
    ["missing q", ""],
    ["empty q", "q="],
    ["blank q", "q=%20%20"],
    ["over-long q", `q=${"a".repeat(MAX_QUERY_CHARS + 1)}`],
    ["control char", "q=a%00b"],
    ["limit 0", "q=x&limit=0"],
    ["huge limit", `q=x&limit=${MAX_LIMIT + 1}`],
    ["limit 1e9", "q=x&limit=1000000000"],
    ["fractional limit", "q=x&limit=2.5"],
    ["non-numeric limit", "q=x&limit=abc"],
    ["NaN near", "q=x&near=NaN,NaN"],
    ["Infinity near", "q=x&near=Infinity,0"],
    ["empty near", "q=x&near="],
    ["one-part near", "q=x&near=5.6"],
    ["three-part near", "q=x&near=1,2,3"],
    ["lat out of range", "q=x&near=91,0"],
    ["lon out of range", "q=x&near=0,181"],
    ["exponent near", "q=x&near=1e2,0"],
  ])("rejects %s", (_n, qs) => {
    expect(() => parseSearchParams(sp(qs))).toThrow(SearchInputError);
  });
  it("accepts a query of exactly the maximum length", () => {
    expect(parseSearchParams(sp(`q=${"a".repeat(MAX_QUERY_CHARS)}`)).q).toHaveLength(MAX_QUERY_CHARS);
  });
});

// The rest runs against the live, loaded landmarks table (read-only): docker compose up -d postgis, migrations applied.
loadEnv();
let db: pg.Client;
beforeAll(async () => {
  db = new pg.Client(dbConfig());
  await db.connect();
  const n = Number((await db.query("SELECT count(*) AS n FROM landmarks")).rows[0]!.n);
  if (n < 1000) throw new Error(`landmarks table has ${n} rows; load it first (scripts/load-landmarks.sh)`);
});
afterAll(async () => { await db?.end(); });

// Queries written from names that exist in the loaded data (some misspelled / reworded the way a rider might type them).
const CASES: Array<[query: string, expectedName: string]> = [
  ["Asylum Down Pharmacy", "Asylum Down Pharmacy"],
  ["asilum down farmacy", "Asylum Down Pharmacy"],
  ["Lapaz Tema station", "Lapaz — Tema Station"],
  ["Sarkodie basic school", "Sarkodie M/A Basic School"],
  ["Christ Faith Mision School", "Christ Faith Mission School"],
  ["yilostar microfinance", "YiloStar Microfinance Limited"],
  ["Achimota Petroleum Police", "Achimota - Petroleum Police Post"],
  ["Darkuman Junction Total Energies", "Darkuman Junction TotalEnergies"],
  ["East Cantonments Pharmacy", "East Cantoments Pharmacy Retail"],
  ["Liberation Road Total", "Liberation Road TotalEnergies"],
  ["Eribel Farmacy", "Eribel Pharmacy"],
  ["Kanda Overhed Total", "Kanda Overhead Total"],
];

describe("searchLandmarks on the real Accra data", () => {
  it("puts the intended row in the top 3 (hit rate reported)", async () => {
    const misses: string[] = [];
    const ranks: string[] = [];
    for (const [q, want] of CASES) {
      const rows = await searchLandmarks(db, { q, limit: 3 });
      const rank = rows.findIndex((r) => r.name === want);
      ranks.push(`#${rank + 1} ${q}`);
      if (rank < 0) misses.push(`${q} -> expected "${want}", got [${rows.map((r) => r.name).join(" | ")}]`);
    }
    console.log(`landmark top-3 hit rate: ${CASES.length - misses.length}/${CASES.length}${misses.length ? "\nmisses:\n" + misses.join("\n") : ""}\nranks: ${ranks.join("; ")}`);
    expect(misses).toEqual([]);
  });

  it("ranks the nearest of many identically named stations first when near is given", async () => {
    const near = { lat: 5.6006, lon: -0.1973 };
    const rows = await searchLandmarks(db, { q: "Total", near, limit: 5 });
    expect(rows[0]!.name).toBe("Total");
    expect(rows[0]!.distance_m).toBeLessThan(100);
    const same = rows.filter((r) => r.score === rows[0]!.score).map((r) => r.distance_m!);
    expect(same).toEqual([...same].sort((a, b) => a - b));
  });

  it("returns null distance without near, and respects limit", async () => {
    const rows = await searchLandmarks(db, { q: "Goil", limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.distance_m === null)).toBe(true);
    expect(rows[0]).toEqual(expect.objectContaining({ name: expect.any(String), category: expect.any(String), lat: expect.any(Number), lon: expect.any(Number), score: expect.any(Number) }));
  });

  it("treats quotes, semicolons and SQL as data (parameterised)", async () => {
    const before = Number((await db.query("SELECT count(*) AS n FROM landmarks")).rows[0]!.n);
    for (const q of ["'; DROP TABLE landmarks; --", "Total'); DELETE FROM landmarks; --", `" OR 1=1 --`, "a\\'b;"]) {
      const rows = await searchLandmarks(db, { q, limit: 5 });
      expect(Array.isArray(rows)).toBe(true);
    }
    expect(Number((await db.query("SELECT count(*) AS n FROM landmarks")).rows[0]!.n)).toBe(before);
  });

  it("returns an empty list for gibberish", async () => {
    expect(await searchLandmarks(db, { q: "qqzzxxvv", limit: 5 })).toEqual([]);
  });

  it("uses the trigram index for the name filter", async () => {
    await db.query("SET enable_seqscan = off");
    try {
      const plan = (await db.query("EXPLAIN SELECT 1 FROM landmarks WHERE landmarks_norm(name) % landmarks_norm('Asylum Down Pharmacy')")).rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(plan).toContain("landmarks_name_trgm_idx");
    } finally {
      await db.query("RESET enable_seqscan");
    }
  });
});

describe("GET /landmarks/search over HTTP", () => {
  let server: http.Server;
  let base: string;
  const errors: unknown[] = [];
  beforeAll(async () => {
    server = createApproachServer({
      landmarkSearch: (p) => searchLandmarks(db, p),
      onError: (e) => errors.push(e),
    });
    await listenLoopback(server, 0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); });

  it("returns ranked results for a real query", async () => {
    const r = await fetch(`${base}/landmarks/search?q=Asylum%20Down%20Pharmacy&near=5.57,-0.20&limit=3`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const body = (await r.json()) as { results: Array<{ name: string; distance_m: number }> };
    expect(body.results[0]!.name).toBe("Asylum Down Pharmacy");
    expect(body.results[0]!.distance_m).toBeLessThan(1000);
  });

  it.each([
    "q=", "", `q=${"a".repeat(MAX_QUERY_CHARS + 1)}`, "q=x&limit=0", "q=x&limit=100000", "q=x&near=NaN,NaN", "q=x&near=Infinity,Infinity",
  ])("answers bad input %s with problem JSON and no internals", async (qs) => {
    const r = await fetch(`${base}/landmarks/search?${qs}`);
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ type: "about:blank", title: "Invalid request", status: 400 });
    expect(typeof body.detail).toBe("string");
    expect(text).not.toMatch(/select|from landmarks|stack|\bat \w+.*\(|node_modules|pg_trgm|ECONN/i);
  });

  it("rejects non-GET with problem JSON", async () => {
    const r = await fetch(`${base}/landmarks/search?q=x`, { method: "POST" });
    expect(r.status).toBe(405);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
  });

  it("hides database failures behind a generic 500 problem", async () => {
    const bad = createApproachServer({
      landmarkSearch: async () => { throw new Error('relation "landmarks" does not exist at /secret/path'); },
      onError: () => {},
    });
    await listenLoopback(bad, 0);
    try {
      const r = await fetch(`http://127.0.0.1:${(bad.address() as { port: number }).port}/landmarks/search?q=x`);
      expect(r.status).toBe(500);
      expect(r.headers.get("content-type")).toContain("application/problem+json");
      const text = await r.text();
      expect(text).not.toMatch(/relation|secret/);
      expect(JSON.parse(text)).toEqual({ type: "about:blank", title: "Internal Server Error", status: 500 });
    } finally {
      await new Promise((r) => bad.close(r));
    }
  });

  it("carries a quote and semicolon in q through the endpoint without error", async () => {
    const r = await fetch(`${base}/landmarks/search?q=${encodeURIComponent("'; DROP TABLE landmarks;--")}`);
    expect(r.status).toBe(200);
    expect(errors).toEqual([]);
  });
});
