# Dev-only clip serving

`GET|HEAD /clips/<edge_id>/<direction>.mp4` is a **local-development door** so the Phase 5B app, running on a simulator or emulator on the
same machine, can play a prototype clip named in a preview manifest (`segments[].clip.servePath`). It is **not a serving feature**.
Nothing is uploaded, published or cached anywhere else, no URL is public, and it does not change `isClipServable`, which stays `false`
for every prototype clip (D1: nothing derived from Mapillary is served publicly until written permission exists).

It answers only when all of these hold, checked on every request:

1. `PROTOTYPE_CLIP_SERVING=1` (exactly `1`; unset, `0`, `true` and anything else mean off). **Default off**: every `/clips/...` path is then
   a plain 404, the clip store is not even consulted.
2. The server socket is bound to loopback and the caller is on loopback; otherwise 403, flag or not. (`listenLoopback` already refuses any
   other bind; this is a second check.)
3. The key is registered in the `clips` table with a `local:<edge>/<direction>.mp4` video key that matches the request. File names are
   never taken from the caller; the path must match `/clips/<digits>/<letters>.mp4` on the raw request path (so `..`, encoded dots or
   slashes, backslashes and NULs are refused with 400 before any lookup), and the resolved file must be a regular file inside the clip
   cache (`realpath`, so a symlink out of the cache is refused).
4. The clip's imagery sources are not disabled by `IMAGERY_SOURCES_DISABLED` (403 otherwise; a malformed source summary also fails closed).

A successful response is `video/mp4` with `X-Prototype: true`, `Accept-Ranges: bytes`, `Cache-Control: no-store` and single-range support
(`206` with `Content-Range`; closed, open-ended and suffix ranges; `416` for unsatisfiable, malformed or multiple ranges). `HEAD` returns
the headers only.

```
PROTOTYPE_CLIP_SERVING=1 npm run serve        # in backend/, loopback only
curl -sI http://127.0.0.1:8787/clips/<edge_id>/forward.mp4
```

Tests: `backend/test/clip-serving.test.ts` (flag off and variants, flag on, range requests, traversal attempts, unregistered keys, symlink
escape, kill switch, non-loopback refusal, `isClipServable` unchanged).
