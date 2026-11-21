#!/usr/bin/env python3
"""Verify data/accra-v2.pmtiles (stdlib plus the pinned pmtiles package for the tile id maths). Prints PASS/FAIL per check, exits 1 if any gated check fails.
Usage: verify_tiles.py V2.pmtiles V1.pmtiles
Checks: PMTiles header and metadata, every tile decompresses and every feature geometry decodes, layer list with zoom ranges and
feature counts per layer and zoom, building/road/water counts equal to v1 (tolerance 0), land and sea point checks at z14,
and whether sea covers the centre of OSM water polygons that are named lagoons (reported, not gated)."""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmtiles.tile import tileid_to_zxy  # noqa: E402
from stats import header, walk, z_of, unz, layers, tags_of, pb, varint, zxy_to_tileid  # noqa: E402

FAILS = []
BHITS = []
def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: FAILS.append(msg)

def decode_geom(buf):
    """MVT geometry -> list of rings/lines (list of (x, y)). Raises on malformed input."""
    out, cur, i, x, y = [], None, 0, 0, 0
    zz = lambda n: (n >> 1) ^ -(n & 1)
    while i < len(buf):
        c, i = varint(buf, i); cmd, cnt = c & 7, c >> 3
        if cmd == 7: out.append(cur + [cur[0]]); cur = None; continue
        for _ in range(cnt):
            dx, i = varint(buf, i); dy, i = varint(buf, i); x += zz(dx); y += zz(dy)
            if cmd == 1:
                if cur: out.append(cur)
                cur = [(x, y)]
            elif cmd == 2: cur.append((x, y))
            else: raise ValueError("bad command")
    if cur: out.append(cur)
    return out

def feature_geom(feat):
    gt = 0; g = b""
    for f, w, v in pb(feat):
        if f == 3: gt = v
        elif f == 4: g = v
    return gt, decode_geom(g)

def scan(path, want_geoms=()):
    """Return (header, metadata, {layer: {zoom: count}}, tiles, geoms) for a pmtiles file; geoms: {layer: {(z,x,y): [(tags, rings)]}}."""
    b = open(path, "rb").read(); h = header(b)
    mo, ml = h["meta"]; meta = json.loads(unz(b[mo:mo + ml], h["internal_compression"]))
    counts, ntiles, geoms = {}, 0, {}
    global BSEA; BSEA = [0, 0]  # buildings checked, buildings whose first vertex is inside the sea polygon (z14 tiles with sea)
    for tid, off, ln in walk(b, h):
        z = z_of(tid); ntiles += 1
        z, x, y = tileid_to_zxy(tid)
        sea_rings, bpts = [], []
        for name, keys, vals, feats in layers(unz(b[off:off + ln], h["tile_compression"])):
            if z == 14 and name in ("sea", "building"):
                for f in feats:
                    rr = feature_geom(f)[1]
                    if name == "sea": sea_rings += rr
                    elif rr: bpts.append(rr[0][0])
            counts.setdefault(name, {}).setdefault(z, 0)
            counts[name][z] += len(feats)
            for f in feats:
                gt, rings = feature_geom(f)
                if name in want_geoms and z == 14:
                    geoms.setdefault(name, {}).setdefault((z, x, y), []).append((tags_of(f, keys, vals), rings))
        if sea_rings:
            for px, py in bpts:
                BSEA[0] += 1
                if pip(px, py, sea_rings):
                    BSEA[1] += 1; n = 1 << 14
                    BHITS.append((round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / 4096) / n)))), 2), round((x + px / 4096) / n * 360 - 180, 2)))
    return h, meta, counts, ntiles, geoms

def pip(px, py, rings):
    inside = False
    for r in rings:
        for (x1, y1), (x2, y2) in zip(r, r[1:]):
            if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1: inside = not inside
    return inside

def lonlat_tile(lon, lat, z=14):
    n = 1 << z
    fx = (lon + 180) / 360 * n; fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return (z, int(fx), int(fy)), (fx - int(fx)) * 4096, (fy - int(fy)) * 4096

def covered(geoms, layer, lon, lat, klass=None):
    key, px, py = lonlat_tile(lon, lat)
    return any(pip(px, py, rings) for tags, rings in geoms.get(layer, {}).get(key, []) if klass is None or tags.get("class") == klass)

LAND = {  # derived by hand from well known locations (lat, lon, WGS84)
    "Osu, Oxford Street": (5.5565, -0.1830), "Kwame Nkrumah Circle": (5.5706, -0.2174), "Accra Mall": (5.6219, -0.1732),
    "Tema, Community 1": (5.6698, -0.0166), "Kotoka International Airport": (5.6052, -0.1668), "Makola Market": (5.5465, -0.2095),
    "Korle Bu Teaching Hospital": (5.5367, -0.2263), "Legon, University of Ghana": (5.6504, -0.1869), "Teshie": (5.5830, -0.1060),
    "La General Hospital": (5.5700, -0.1560), "Weija": (5.5667, -0.3333), "Achimota": (5.6150, -0.2300), "Madina": (5.6700, -0.1650),
    "Jamestown lighthouse": (5.5336, -0.2118),
}
SEA = {  # open water south of the coast; the coast near Accra is at about lat 5.54 and near Tema at about 5.63
    "Gulf of Guinea off Weija": (5.46, -0.35), "off Korle Bu": (5.49, -0.23), "off Osu": (5.50, -0.18), "off Labadi": (5.51, -0.14),
    "off Teshie": (5.53, -0.09), "off Tema port": (5.60, 0.02), "south edge, lon -0.30": (5.455, -0.30), "south edge, lon 0.00": (5.455, 0.00),
}

def main(v2, v1):
    h, meta, c2, nt, geoms = scan(v2, want_geoms=("sea", "water", "landuse"))
    bsea = list(BSEA)
    _, _, c1, nt1, _ = scan(v1)
    check(h["tile_type"] == 1 and h["tile_compression"] == 2 and h["internal_compression"] == 2, f"header: MVT tiles, gzip tiles and directories (type {h['tile_type']}, tile comp {h['tile_compression']})")
    check(h["min_zoom"] == 0 and h["max_zoom"] == 14, f"header zoom range {h['min_zoom']}..{h['max_zoom']}")
    check(h["addressed"] == nt, f"every tile decoded: {nt} tiles read, header addressed {h['addressed']} (unique contents {h['contents']})")
    check(all(abs(a - b) < 0.011 for a, b in zip(h["bounds"], (-0.40, 5.45, 0.05, 5.80))), f"header bounds {h['bounds']}")
    print("metadata keys:", sorted(meta)); print("attribution:", meta.get("attribution"))
    vl = {l["id"]: (l.get("minzoom"), l.get("maxzoom")) for l in meta.get("vector_layers", [])}
    print("layers (zoom range from tiles | feature counts per zoom):")
    for name in sorted(c2):
        zs = sorted(c2[name]); print(f"  {name}: z{zs[0]}..z{zs[-1]} (metadata {vl.get(name)}), total {sum(c2[name].values())}, per zoom {dict(sorted(c2[name].items()))}")
    check({"building", "road", "water", "landuse", "sea"} <= set(c2), f"layers present: {sorted(c2)}")
    for name in ("building", "road", "water"):
        check(c2.get(name) == c1.get(name), f"{name} per-zoom feature counts equal v1 (tolerance 0; v1 total {sum(c1[name].values())}, v2 total {sum(c2[name].values())})")
    check(all(a >= 10 for a in c2["landuse"]), f"landuse starts at z{min(c2['landuse'])}")
    classes = {}
    for feats in geoms["landuse"].values():
        for tags, _ in feats: classes[tags.get("class")] = classes.get(tags.get("class"), 0) + 1
    print("landuse features per class at z14:", dict(sorted(classes.items())))
    check("other" not in classes, "no landuse feature fell back to class 'other'")
    hits = list(BHITS)
    from collections import Counter
    print("  buildings with first vertex inside sea, by 0.01 deg cell (lat, lon):", dict(sorted(Counter(hits).items())))
    check(bsea[1] <= 0.001 * bsea[0], f"OSM buildings inside the sea polygon under 0.1 percent (harbour and reclaimed land at 0 m): {bsea[1]} of {bsea[0]} z14 buildings in tiles that contain sea (first vertex tested)")
    for name, (lat, lon) in LAND.items():
        sea = covered(geoms, "sea", lon, lat)
        print(f"  land point {name} ({lat}, {lon}): sea={sea}")
        check(not sea, f"land point not in sea: {name}")
    for name, (lat, lon) in SEA.items():
        sea = covered(geoms, "sea", lon, lat)
        print(f"  sea point {name} ({lat}, {lon}): sea={sea}")
        check(sea, f"sea point in sea: {name}")
    # the sea polygon must reach the whole southern edge: sample the south edge of the bbox every 0.01 deg of longitude
    south = [lon / 100 for lon in range(-40, 6)]
    miss = [lon for lon in south if not covered(geoms, "sea", lon, 5.4505)]
    check(not miss, f"sea covers the southern bbox edge (lat 5.4505) at all {len(south)} sampled longitudes" + (f", missing {miss}" if miss else ""))
    # lagoons: report only
    print("OSM water polygons named lagoon/lake/reservoir, ring-vertex mean inside sea?")
    for key, feats in geoms["water"].items():
        for tags, rings in feats:
            nm = str(tags.get("name", ""))
            if any(w in nm.lower() for w in ("lagoon", "lake", "reservoir", "dam")) and rings:
                r = max(rings, key=len); mx = sum(p[0] for p in r) / len(r); my = sum(p[1] for p in r) / len(r)
                n = 1 << 14; lon = (key[1] + mx / 4096) / n * 360 - 180
                lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (key[2] + my / 4096) / n))))
                print(f"  {nm} tile {key[1]}/{key[2]} point ({lat:.4f}, {lon:.4f}) in sea: {covered(geoms, 'sea', lon, lat)}")
    print("FAILED" if FAILS else "ALL GATED CHECKS PASSED")
    sys.exit(1 if FAILS else 0)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
