// Polyline6 encoder (counterpart of decodePolyline6 in valhalla.ts). Input is [lat, lon] pairs, like the decoder's output.
export function encodePolyline6(points: readonly (readonly [number, number])[]): string {
  let out = "", pLat = 0, pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6);
    out += enc(la - pLat) + enc(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}
