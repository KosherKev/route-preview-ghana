import { describe, expect, it } from "vitest";
import { classifyTimeline, DEFAULT_CLASSIFY_CONFIG, type ClassifyConfig } from "../src/classify/classify";
import type { MatchedFrame } from "../src/classify/match";
import type { EdgeSpan } from "../src/classify/types";

// Follow-up E (2026-11-20): at most maxBridgesPerSegment (default 2) bridges per STREET_VIDEO segment, and a bridge
// requires both runs to share the same non-missing sequence_id.
const L = 3000;
const edges: EdgeSpan[] = [{ edgeId: 1, startM: 0, endM: L, roadClass: "primary", use: "road", bridge: false, tunnel: false }];
const mf = (offsetM: number, i: number, seq: string | null): MatchedFrame => ({
  frame: { imageId: `f${i}`, sequenceId: seq, lat: 0, lon: 0, compassAngleDeg: 0, qualityScore: 1, capturedAt: null },
  offsetM: Math.round(offsetM * 1000) / 1000, lateralRightM: 1, localBearingDeg: 0, headingDeltaDeg: 0, edgeIndex: 0, edgeId: 1,
});
/** 60 m runs (13 frames every 5 m) separated by gapsMm; seqs[i] is the sequence of run i (default "s"). */
function chain(startM: number, gapsMm: number[], seqs: (string | null)[] = []): MatchedFrame[] {
  const out: MatchedFrame[] = [];
  let at = Math.round(startM * 1000);
  const run = (k: number) => { for (let i = 0; i < 13; i++) { out.push(mf(at / 1000, out.length, seqs[k] === undefined ? "s" : seqs[k]!)); if (i < 12) at += 5000; } };
  run(0);
  gapsMm.forEach((g, k) => { at += g; run(k + 1); });
  return out;
}
const cls = (fs: MatchedFrame[], cfg: Partial<ClassifyConfig> = {}) => classifyTimeline(L, edges, fs, { ...DEFAULT_CLASSIFY_CONFIG, ...cfg }).segments;
const modes = (s: ReturnType<typeof cls>) => s.map((x) => (x.mode === "STREET_VIDEO" ? `S${x.bridges.length}` : "B"));

describe("bridge cap (maxBridgesPerSegment)", () => {
  it("defaults to 2", () => expect(DEFAULT_CLASSIFY_CONFIG.maxBridgesPerSegment).toBe(2));
  it("three runs, two valid bridges: one segment with exactly 2 bridges", () => {
    const s = cls(chain(100, [20000, 25000]));
    expect(modes(s)).toEqual(["B", "S2", "B"]);
  });
  it("four runs, three valid gaps: 2-bridge segment, handoff at the third gap, fourth run its own segment", () => {
    const fs = chain(100, [20000, 25000, 22000]);
    const s = cls(fs);
    expect(modes(s)).toEqual(["B", "S2", "B", "S0", "B"]);
    const [, first, hand, fourth] = s;
    expect(first!.endM).toBe(fs[38]!.offsetM); // end of the third run
    expect(hand!.startM).toBe(first!.endM);
    expect(hand!.endM).toBe(fourth!.startM);
    expect(fourth!.startM).toBe(fs[39]!.offsetM);
    expect(first!.bridges).toHaveLength(2);
    expect(first!.crossfades).toHaveLength(2);
  });
  it("a later run after the cap can start a new segment that bridges again", () => {
    const s = cls(chain(100, [20000, 20000, 20000, 20000]));
    expect(modes(s)).toEqual(["B", "S2", "B", "S1", "B"]);
  });
  it("fourth run too short: flyover, not a segment", () => {
    const fs = chain(100, [20000, 25000, 22000]).slice(0, 39 + 5); // fourth run: 5 frames = 20 m
    expect(modes(cls(fs))).toEqual(["B", "S2", "B"]);
  });
  it("maxBridgesPerSegment = 1 splits after one bridge", () => {
    expect(modes(cls(chain(100, [20000, 25000]), { maxBridgesPerSegment: 1 }))).toEqual(["B", "S1", "B", "S0", "B"]);
  });
  it("maxBridgesPerSegment = 3 allows three bridges", () => {
    expect(modes(cls(chain(100, [20000, 25000, 22000]), { maxBridgesPerSegment: 3 }))).toEqual(["B", "S3", "B"]);
  });
  it("maxBridgesPerSegment = 0 never bridges", () => {
    expect(modes(cls(chain(100, [20000]), { maxBridgesPerSegment: 0 }))).toEqual(["B", "S0", "B", "S0", "B"]);
  });
  it("rejects a non-integer or negative cap", () => {
    expect(() => cls(chain(100, [20000]), { maxBridgesPerSegment: 2.5 })).toThrow(RangeError);
    expect(() => cls(chain(100, [20000]), { maxBridgesPerSegment: -1 })).toThrow(RangeError);
  });
});

describe("same-sequence rule for bridges", () => {
  it("same sequence_id bridges at 15.000 and 30.000, hands off at 30.001", () => {
    expect(modes(cls(chain(100, [15000])))).toEqual(["B", "S1", "B"]);
    expect(modes(cls(chain(100, [30000])))).toEqual(["B", "S1", "B"]);
    expect(modes(cls(chain(100, [30001])))).toEqual(["B", "S0", "B", "S0", "B"]);
  });
  it("different sequence_id across a 20 m gap hands off", () => {
    expect(modes(cls(chain(100, [20000], ["a", "b"])))).toEqual(["B", "S0", "B", "S0", "B"]);
  });
  it("different sequence_id at exactly 15 m and 30 m also hands off", () => {
    expect(modes(cls(chain(100, [15000], ["a", "b"])))).toEqual(["B", "S0", "B", "S0", "B"]);
    expect(modes(cls(chain(100, [30000], ["a", "b"])))).toEqual(["B", "S0", "B", "S0", "B"]);
  });
  it("missing sequence_id on either side hands off", () => {
    expect(modes(cls(chain(100, [20000], ["a", null])))).toEqual(["B", "S0", "B", "S0", "B"]);
    expect(modes(cls(chain(100, [20000], [null, "a"])))).toEqual(["B", "S0", "B", "S0", "B"]);
    expect(modes(cls(chain(100, [20000], [null, null])))).toEqual(["B", "S0", "B", "S0", "B"]);
  });
  it("a sequence change mid-chain ends the segment there; the cap counts only same-sequence bridges", () => {
    expect(modes(cls(chain(100, [20000, 20000], ["a", "a", "b"])))).toEqual(["B", "S1", "B", "S0", "B"]);
  });
});
