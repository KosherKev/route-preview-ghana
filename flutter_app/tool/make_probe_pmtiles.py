"""Write a tiny SYNTHETIC PMTiles v3 archive for the 5B-1 PMTiles probe (plugin loads pmtiles:// on iOS?).

One z14 vector tile, one layer "probe", three invented squares with a `height` property. No real data, nothing derived
from Mapillary. The output (*.pmtiles) is git-ignored: write it outside the repo.

usage: python3 tool/make_probe_pmtiles.py /path/to/probe.pmtiles [--gzip]

--gzip compresses the directory, metadata and tile (internal and tile compression = gzip), like typical real archives.
"""
import gzip
import json
import math
import struct
import sys

Z = 14
LAT, LON = 5.5900, -0.2000  # same invented scene location as the fixture
EXTENT = 4096


def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def zigzag(n):
    return (n << 1) ^ (n >> 31)


def field_len(tag, payload):
    return varint((tag << 3) | 2) + varint(len(payload)) + payload


def field_varint(tag, value):
    return varint((tag << 3) | 0) + varint(value)


def square(x0, y0, x1, y1):
    """Exterior ring, clockwise in tile coordinates (y down): MoveTo, LineTo x3, ClosePath."""
    cmds = [9, zigzag(x0), zigzag(y0), 26, zigzag(x1 - x0), 0, 0, zigzag(y1 - y0), zigzag(x0 - x1), 0, 15]
    # LineTo with count 3 = (3 << 3) | 2 = 26: (x1,y0) (x1,y1) (x0,y1) expressed as deltas.
    return b"".join(varint(c) for c in cmds)


def mvt_tile():
    boxes = [(900, 1400, 1500, 2000, 20), (1800, 1400, 2400, 2000, 60), (2700, 1400, 3300, 2000, 120)]
    layer = field_varint(15, 2) + field_len(1, b"probe")
    for i, (x0, y0, x1, y1, _h) in enumerate(boxes):
        feat = field_len(2, varint(0) + varint(i)) + field_varint(3, 3) + field_len(4, square(x0, y0, x1, y1))
        layer += field_len(2, feat)
    layer += field_len(3, b"height")
    for *_rest, h in boxes:
        layer += field_len(4, field_varint(5, h))
    layer += field_varint(5, EXTENT)
    return field_len(3, layer)


def tile_xy(lat, lon, z):
    n = 1 << z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def tile_id(z, x, y):
    """Hilbert tile id as in the PMTiles v3 spec."""
    acc = (4 ** z - 1) // 3
    n = 1 << z
    d, s = 0, n // 2
    while s > 0:
        rx = 1 if (x & s) else 0
        ry = 1 if (y & s) else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x, y = n - 1 - x, n - 1 - y
            x, y = y, x
        s //= 2
    return acc + d


def main(out_path, use_gzip=False):
    x, y = tile_xy(LAT, LON, Z)
    tid = tile_id(Z, x, y)
    tile = mvt_tile()
    if use_gzip:
        tile = gzip.compress(tile, mtime=0)
    meta = json.dumps({
        "name": "route-preview-probe",
        "description": "synthetic probe tile, invented squares",
        "vector_layers": [{"id": "probe", "fields": {"height": "Number"}, "minzoom": Z, "maxzoom": Z}],
    }).encode()
    if use_gzip:
        meta = gzip.compress(meta, mtime=0)
    # Directory (uncompressed): 1 entry. tile_id delta, run_length 1, length, offset+1 (first entry is not "contiguous").
    directory = varint(1) + varint(tid) + varint(1) + varint(len(tile)) + varint(0 + 1)
    if use_gzip:
        directory = gzip.compress(directory, mtime=0)

    root_off = 127
    meta_off = root_off + len(directory)
    data_off = meta_off + len(meta)
    # bounds of the single tile
    n = 1 << Z
    min_lon = x / n * 360.0 - 180.0
    max_lon = (x + 1) / n * 360.0 - 180.0
    lat_of = lambda ty: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    max_lat, min_lat = lat_of(y), lat_of(y + 1)
    e7 = lambda v: int(round(v * 1e7))
    # layout after magic+version (8 bytes): root_off, root_len, meta_off, meta_len, leaf_off, leaf_len, data_off, data_len,
    # addressed, entries, contents (u64 each, 11 values), then 1-byte flags and i32 bounds.
    header = b"PMTiles" + bytes([3]) + struct.pack(
        "<QQQQQQQQQQQ", root_off, len(directory), meta_off, len(meta), 0, 0, data_off, len(tile), 1, 1, 1)
    comp = 2 if use_gzip else 1  # PMTiles: 1 = none, 2 = gzip
    header += bytes([1, comp, comp, 1, Z, Z])  # clustered, internal compression, tile compression, tile type MVT, min/max zoom
    header += struct.pack("<iiii", e7(min_lon), e7(min_lat), e7(max_lon), e7(max_lat))
    header += bytes([Z]) + struct.pack("<ii", e7((min_lon + max_lon) / 2), e7((min_lat + max_lat) / 2))
    assert len(header) == 127, len(header)
    with open(out_path, "wb") as f:
        f.write(header + directory + meta + tile)
    clat, clon = (min_lat + max_lat) / 2, (min_lon + max_lon) / 2
    print("wrote %s (%d bytes); tile z%d/%d/%d id=%d; centre lat=%.6f lon=%.6f" % (out_path, 127 + len(directory) + len(meta) + len(tile), Z, x, y, tid, clat, clon))


if __name__ == "__main__":
    main(sys.argv[1], use_gzip='--gzip' in sys.argv[2:])
