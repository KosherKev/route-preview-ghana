#!/usr/bin/env python3
"""Extract OSM natural=coastline ways (and named nodes) inside a padded bbox from a Geofabrik .osm.pbf, using only the stdlib and numpy.
In OSM, land is on the LEFT of a coastline way's direction and water on the right.
Usage: osm_coast.py EXTRACT.osm.pbf OUT.json [--bbox lon0,lat0,lon1,lat1] [--names Osu,Labadi,...]
Output JSON: {"coast": [[[lon, lat], ...], ...] (way segments restricted to nodes inside the bbox, direction kept),
              "nodes": [{"id", "lon", "lat", "tags": {...}}]  (nodes whose name, alt_name, old_name or name:en contains one of the --names, case sensitive)}"""
import json, sys, zlib
import numpy as np

def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7F) << s; s += 7
        if c < 0x80: return r, i

def fields(b):
    i, n = 0, len(b)
    while i < n:
        k, i = varint(b, i); f, w = k >> 3, k & 7
        if w == 0: v, i = varint(b, i)
        elif w == 2:
            l, i = varint(b, i); v = b[i:i + l]; i += l
        elif w == 1: v = b[i:i + 8]; i += 8
        elif w == 5: v = b[i:i + 4]; i += 4
        else: raise ValueError("wire type %d" % w)
        yield f, v

def packed(buf, signed=False, delta=False):
    """Decode a packed varint array with numpy."""
    if not buf: return np.zeros(0, np.int64)
    a = np.frombuffer(buf, np.uint8)
    ends = np.nonzero(a < 128)[0]
    starts = np.concatenate(([0], ends[:-1] + 1))
    pos = np.arange(len(a)) - np.repeat(starts, ends - starts + 1)
    vals = np.add.reduceat(((a & 127).astype(np.uint64) << (7 * pos).astype(np.uint64)), starts)
    if signed: v = (vals >> np.uint64(1)).astype(np.int64) ^ -((vals & np.uint64(1)).astype(np.int64))
    else: v = vals.astype(np.int64)
    return np.cumsum(v) if delta else v

def blobs(path):
    with open(path, "rb") as fh:
        while True:
            h = fh.read(4)
            if not h: return
            hl = int.from_bytes(h, "big"); hdr = dict(fields(fh.read(hl)))
            body = fh.read(hdr[3]); blob = dict(fields(body))
            yield hdr[1].decode(), (zlib.decompress(blob[3]) if 3 in blob else blob[1])

def main(pbf, out, bbox, names):
    x0, y0, x1, y1 = bbox
    ids, lons, lats, named = [], [], [], []
    ways = []
    for typ, data in blobs(pbf):
        if typ != "OSMData": continue
        st, groups, gran, lat_off, lon_off = [], [], 100, 0, 0
        for f, v in fields(data):
            if f == 1: st = [s for ff, s in fields(v) if ff == 1]
            elif f == 2: groups.append(v)
            elif f == 17: gran = v
            elif f == 19: lat_off = v
            elif f == 20: lon_off = v
        sc = gran * 1e-9
        for g in groups:
            for f, v in fields(g):
                if f == 2:  # dense nodes
                    d = dict(fields(v))
                    nid = packed(d.get(1, b""), True, True); la = packed(d.get(8, b""), True, True); lo = packed(d.get(9, b""), True, True)
                    lat = (lat_off + la * gran) * 1e-9; lon = (lon_off + lo * gran) * 1e-9
                    m = (lon >= x0) & (lon <= x1) & (lat >= y0) & (lat <= y1)
                    ids.append(nid[m]); lons.append(lon[m]); lats.append(lat[m])
                    if 10 in d and any(n.encode() in b"".join(st) for n in names):
                        kv = packed(d[10]); i = 0; k = 0
                        while k < len(nid):
                            tags = {}
                            while kv[i] != 0:
                                tags[st[kv[i]].decode()] = st[kv[i + 1]].decode(); i += 2
                            i += 1
                            if m[k] and any(n in tags.get(t, "") for t in ("name", "alt_name", "old_name", "name:en") for n in names):
                                named.append({"id": int(nid[k]), "lon": float(lon[k]), "lat": float(lat[k]), "tags": tags})
                            k += 1
                elif f == 3:  # way
                    d = {}
                    for ff, vv in fields(v): d[ff] = vv
                    if 2 in d:
                        ks, vs = packed(d[2]), packed(d[3])
                        if any(st[a] == b"natural" and st[b] == b"coastline" for a, b in zip(ks, vs)):
                            ways.append((int(d[1]), packed(d.get(8, b""), True, True)))
    ids = np.concatenate(ids); lons = np.concatenate(lons); lats = np.concatenate(lats)
    order = np.argsort(ids); ids, lons, lats = ids[order], lons[order], lats[order]
    coast = []
    for wid, refs in ways:
        idx = np.searchsorted(ids, refs); idx[idx >= len(ids)] = 0
        ok = ids[idx] == refs
        run = []
        for j, o in enumerate(ok):
            if o: run.append([float(lons[idx[j]]), float(lats[idx[j]])])
            else:
                if len(run) > 1: coast.append(run)
                run = []
        if len(run) > 1: coast.append(run)
    json.dump({"coast": coast, "nodes": named}, open(out, "w"))
    print(f"coastline ways {len(ways)}, segments inside bbox {len(coast)}, vertices {sum(len(c) for c in coast)}, named nodes {len(named)}")

if __name__ == "__main__":
    a = sys.argv[1:]
    bbox = tuple(float(x) for x in a[a.index("--bbox") + 1].split(",")) if "--bbox" in a else (-0.60, 5.30, 0.30, 5.95)
    names = a[a.index("--names") + 1].split(",") if "--names" in a else ["Osu Castle", "Labadi"]
    main(a[0], a[1], bbox, names)
