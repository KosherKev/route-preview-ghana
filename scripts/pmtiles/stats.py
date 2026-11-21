#!/usr/bin/env python3
"""PMTiles v3 stats (stdlib only): header, tiles per zoom, and for the `building` layer how many features carry a real OSM height,
building levels, or neither (the flagged default). Counts z14 tiles only (buildings appear from z13, so lower zooms would double count).
Usage: python3 -I scripts/pmtiles/stats.py data/accra.pmtiles [--zoom 14]
       python3 -I scripts/pmtiles/stats.py data/accra.pmtiles --corridor manifest.json [--buffer 150]
The second form reports how big a slice of the archive covering a preview's route corridor would be (read-only: nothing is written)."""
import gzip, json, math, struct, sys

def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7F) << s; s += 7
        if c < 0x80: return r, i

def header(b):
    if b[:7] != b"PMTiles" or b[7] != 3: raise SystemExit("not a PMTiles v3 file")
    u = struct.unpack("<8Q", b[8:72]); (ro, rl, mo, ml, lo, ll, do, dl) = u
    n_addr, n_entries, n_contents = struct.unpack("<3Q", b[72:96])
    clustered, icomp, tcomp, ttype, minz, maxz = struct.unpack("<6B", b[96:102])
    minlon, minlat, maxlon, maxlat = (v / 1e7 for v in struct.unpack("<4i", b[102:118]))
    return dict(root=(ro, rl), meta=(mo, ml), leaf=(lo, ll), data=(do, dl), addressed=n_addr, entries=n_entries, contents=n_contents,
                internal_compression=icomp, tile_compression=tcomp, tile_type=ttype, min_zoom=minz, max_zoom=maxz,
                bounds=[minlon, minlat, maxlon, maxlat])

def unz(raw, comp): return gzip.decompress(raw) if comp == 2 else raw

def directory(raw):
    n, i = varint(raw, 0); ids = []; last = 0
    for _ in range(n):
        d, i = varint(raw, i); last += d; ids.append(last)
    runs = []
    for _ in range(n): v, i = varint(raw, i); runs.append(v)
    lens = []
    for _ in range(n): v, i = varint(raw, i); lens.append(v)
    offs = []; prev = None
    for k in range(n):
        v, i = varint(raw, i)
        if v == 0 and prev is not None: v = prev[0] + prev[1]
        else: v = v - 1
        offs.append(v); prev = (v, lens[k])
    return list(zip(ids, runs, lens, offs))

def z_of(tile_id):
    z, acc = 0, 0
    while True:
        cnt = 4 ** z
        if tile_id < acc + cnt: return z
        acc += cnt; z += 1

def walk(b, h):
    ro, rl = h["root"]; lo, _ = h["leaf"]; do, _ = h["data"]; ic = h["internal_compression"]
    stack = [directory(unz(b[ro:ro + rl], ic))]
    while stack:
        for tid, run, ln, off in stack.pop():
            if run == 0: stack.append(directory(unz(b[lo + off:lo + off + ln], ic)))
            else:
                for r in range(run): yield tid + r, do + off, ln

def pb(buf):  # yield (field, wiretype, value)
    i = 0
    while i < len(buf):
        k, i = varint(buf, i); f, w = k >> 3, k & 7
        if w == 0: v, i = varint(buf, i)
        elif w == 2: l, i = varint(buf, i); v = buf[i:i + l]; i += l
        elif w == 1: v = buf[i:i + 8]; i += 8
        elif w == 5: v = buf[i:i + 4]; i += 4
        else: raise ValueError("bad wire type")
        yield f, w, v

def layers(tile):
    for f, w, v in pb(tile):
        if f != 3: continue
        name, keys, vals, feats = "", [], [], []
        for lf, lw, lv in pb(v):
            if lf == 1: name = lv.decode()
            elif lf == 3: keys.append(lv.decode())
            elif lf == 4:
                for vf, vw, vv in pb(lv):
                    vals.append(vv.decode() if vf == 1 else vv)
            elif lf == 2: feats.append(lv)
        yield name, keys, vals, feats

def tags_of(feat, keys, vals):
    for f, w, v in pb(feat):
        if f == 2:
            ids = []; i = 0
            while i < len(v): x, i = varint(v, i); ids.append(x)
            return {keys[ids[j]]: vals[ids[j + 1]] for j in range(0, len(ids), 2)}
    return {}

def parse_height_m(s):
    s = str(s).strip().lower().replace(",", ".")
    for suf, mul in (("meters", 1), ("metres", 1), ("m", 1), ("ft", 0.3048), ("feet", 0.3048)):
        if s.endswith(suf):
            s = s[: -len(suf)].strip(); try_mul = mul; break
    else: try_mul = 1
    try: v = float(s) * try_mul
    except ValueError: return None
    return v if 0 < v < 1000 else None

def rot(n, x, y, rx, ry):
    if ry == 0:
        if rx == 1: x, y = n - 1 - x, n - 1 - y
        x, y = y, x
    return x, y

def zxy_to_tileid(z, x, y):
    acc = ((4 ** z) - 1) // 3; d = 0; s = (2 ** z) // 2
    while s > 0:
        rx = 1 if x & s else 0; ry = 1 if y & s else 0
        d += s * s * ((3 * rx) ^ ry); x, y = rot(s, x, y, rx, ry); s //= 2
    return acc + d

def decode_polyline6(s):
    i = lat = lon = 0; out = []
    while i < len(s):
        for k in (0, 1):
            sh = r = 0
            while True:
                c = ord(s[i]) - 63; i += 1; r |= (c & 31) << sh; sh += 5
                if c < 32: break
            d = ~(r >> 1) if r & 1 else r >> 1
            if k == 0: lat += d
            else: lon += d
        out.append((lat / 1e6, lon / 1e6))
    return out

def corridor(b, h, manifest_path, buf_m):
    m = json.load(open(manifest_path))
    pts = []
    for seg in m["segments"]: pts += decode_polyline6(seg["polyline6"])
    dense = []
    for (a, c) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot((c[0] - a[0]) * 110574, (c[1] - a[1]) * 111320 * math.cos(math.radians(a[0]))) // 20))
        dense += [(a[0] + (c[0] - a[0]) * t / n, a[1] + (c[1] - a[1]) * t / n) for t in range(n)]
    dense.append(pts[-1])
    dlat = buf_m / 110574
    sizes = {t: ln for t, off, ln in walk(b, h)}
    per_z = {}; total = 0; n_tiles = 0
    for z in range(h["min_zoom"], h["max_zoom"] + 1):
        want = set()
        for lat, lon in dense:
            dlon = buf_m / (111320 * math.cos(math.radians(lat)))
            for la in (lat - dlat, lat + dlat):
                for lo in (lon - dlon, lon + dlon):
                    n = 2 ** z
                    x = min(n - 1, int((lo + 180) / 360 * n)); y = min(n - 1, max(0, int((1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n)))
                    want.add((x, y))
        # tiles between the four corner tiles of each sample (the buffer can span at most 2 tiles at these zooms)
        xs = {}
        for x, y in want: xs.setdefault(x, []).append(y)
        full = {(x, y) for x, ys in xs.items() for y in range(min(ys), max(ys) + 1)} if z <= 11 else want
        have = [zxy_to_tileid(z, x, y) for x, y in full if zxy_to_tileid(z, x, y) in sizes]
        per_z[z] = {"tiles_needed": len(full), "tiles_in_archive": len(have), "bytes": sum(sizes[t] for t in have)}
        total += per_z[z]["bytes"]; n_tiles += len(have)
    print(json.dumps({"manifest": manifest_path, "buffer_m": buf_m, "route_points": len(pts), "slice_tiles": n_tiles, "slice_bytes_compressed_tiles": total,
                      "whole_archive_bytes": len(b), "slice_share_of_archive": total / len(b), "per_zoom": per_z}, indent=2))

def main():
    path = sys.argv[1]
    if "--corridor" in sys.argv:
        buf = float(sys.argv[sys.argv.index("--buffer") + 1]) if "--buffer" in sys.argv else 150.0
        b = open(path, "rb").read(); return corridor(b, header(b), sys.argv[sys.argv.index("--corridor") + 1], buf)
    zoom = int(sys.argv[sys.argv.index("--zoom") + 1]) if "--zoom" in sys.argv else 14
    b = open(path, "rb").read(); h = header(b)
    per_z = {}; counts = {"total": 0, "height_tag": 0, "height_parsable": 0, "levels_only": 0, "levels_parsable": 0, "default": 0, "named": 0}
    layer_feats = {}; tiles_z = 0
    for tid, off, ln in walk(b, h):
        z = z_of(tid); per_z[z] = per_z.get(z, 0) + 1
        if z != zoom: continue
        tiles_z += 1
        for name, keys, vals, feats in layers(unz(b[off:off + ln], h["tile_compression"])):
            layer_feats[name] = layer_feats.get(name, 0) + len(feats)
            if name != "building": continue
            for f in feats:
                t = tags_of(f, keys, vals); counts["total"] += 1
                src = t.get("height_source")
                if "name" in t: counts["named"] += 1
                if src == "height":
                    counts["height_tag"] += 1
                    if parse_height_m(t.get("height")) is not None: counts["height_parsable"] += 1
                elif src == "levels":
                    counts["levels_only"] += 1
                    try:
                        if float(str(t.get("building:levels")).strip()) > 0: counts["levels_parsable"] += 1
                    except ValueError: pass
                else: counts["default"] += 1
    t = counts["total"] or 1
    real = counts["height_parsable"] + counts["levels_parsable"]
    out = dict(file=path, bytes=len(b), header={k: h[k] for k in ("min_zoom", "max_zoom", "bounds", "addressed", "entries", "contents", "tile_compression", "tile_type")},
               tiles_per_zoom=dict(sorted(per_z.items())), counted_zoom=zoom, tiles_at_zoom=tiles_z, features_per_layer=layer_feats, building=counts,
               share=dict(real_height_tag=counts["height_parsable"] / t, levels_only=counts["levels_parsable"] / t,
                          real_total=real / t, flagged_default=1 - real / t))
    print(json.dumps(out, indent=2))

if __name__ == "__main__": main()
