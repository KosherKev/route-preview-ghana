# Offline bundle: `contentHash`

Reference for clients that import an offline bundle (the Home Mac Flutter app). It documents what `backend/src/preview/bundle.ts` does,
exactly. The test `backend/test/bundle-hash-doc.test.ts` recomputes the hash from this document alone and must match the builder.

## Where it lives

`contentHash` is a field of the **`bundle.json` envelope**, next to `hashAlgorithm: "sha256"`. It is **not** in `preview.json` (the
manifest). The hash covers the manifest, so storing it inside the manifest would be circular: the value would have to be part of the bytes
it is computed over. (The Phase 5A spec said "the manifest records the content hash"; the implementation, and this document, put it in the
envelope.) The tar is `bundle.json`, `preview.json`, `clips/<edge>_<direction>.mp4` per ready clip, and an empty `tiles/`.

## What it covers

Two things, and nothing else (no timestamp, no envelope field, no tar header, no tiles):

1. The preview manifest **as a parsed JSON value**, serialised canonically. It is **not** the raw bytes of `preview.json`, which is
   pretty-printed with the producer's key order.
2. Every clip in the bundle, as one text line each: `<key> <bytes> <sha256 of the clip file>`, where `key` is the clip key in
   `bundle.json` `clips[].key` (for example `1/forward.mp4`; the file is stored at `clips[].path`, here `clips/1_forward.mp4`), `bytes` is
   the file size in decimal, and `sha256` is lowercase hex.

## Algorithm

```
canonical(x)  = JSON.stringify of x with the keys of every object sorted ascending (UTF-16 code-unit order) at every level;
                arrays keep their order; no whitespace; strings and numbers as JSON.stringify writes them
line(clip)    = key + " " + decimal(byte length of clip) + " " + lowercase_hex(sha256(clip bytes))
lines         = [line(c) for each clip c, sorted ascending by c.key]
preimage      = join("\n", ["rpg-bundle-v1", canonical(manifest), ...lines])      // no trailing newline; UTF-8
contentHash   = lowercase_hex(sha256(UTF-8 bytes of preimage))                      // 64 hex characters
```

With no clips, `lines` is empty and the preimage is `"rpg-bundle-v1\n<canonical manifest>"`.

## How a client recomputes it

1. Read `bundle.json`. Check `bundleVersion` is 1 and `hashAlgorithm` is `"sha256"`; refuse anything else. Check `expiresAt` has not passed.
2. Read `preview.json` and **parse** it (do not hash its raw bytes).
3. Canonicalise the parsed manifest as above: sort object keys at every level, keep array order, emit no whitespace.
4. For each entry of `bundle.json` `clips[]`, read the file at `path`, and form `key + " " + size + " " + sha256hex(file)`.
5. Sort those lines by `key`, ascending.
6. Join `"rpg-bundle-v1"`, the canonical manifest and the lines with a single `"\n"` (no trailing newline), UTF-8 encode, take sha256, write as
   lowercase hex.
7. Compare with `bundle.json` `contentHash`.

Cautions for a non-JavaScript client: the canonical form must match `JSON.stringify` byte for byte, so number formatting (for example
`1e21`, `-0` written as `0`, shortest round-trip decimals) and string escaping (only `"`, `\`, control characters; non-ASCII is written
as is, not `\u`-escaped) must follow ECMAScript. Object keys sort by UTF-16 code unit, which differs from UTF-8 byte order only for
characters outside the Basic Multilingual Plane.

## What a mismatch means

The files you hold are not the files the envelope describes: a clip or the manifest changed, was truncated, or the bundle is corrupt.
**Refuse the import** and tell the user to refresh (rebuild the bundle with `POST /preview/bundle`). Do not play any clip from it. The
per-file `files[]` entries (`path`, `bytes`, `sha256`) can be used to say which file differs, but `contentHash` is the check that decides.

## Worked example (synthetic)

Invented bytes: not video, not imagery, nothing from Mapillary. Two clips:

| key | bytes | content | sha256 |
| --- | --- | --- | --- |
| `1/forward.mp4` | 18 | ASCII `synthetic clip one` | `6d4a3a591d0a1740d8c25b14ea0f87702926410fca304007f2244fc7c5125d10` |
| `2/backward.mp4` | 32 | ASCII `synthetic clip two, a bit longer` | `fe2a3e3760c2ded961f6b42ca0a729b0b2bb770c94808b027de782322ee18575` |

Manifest (shortened to the fields the builder reads for this example; keys deliberately out of order, and the clips listed in reverse):

```json
{"segments":[{"clip":{"edge_id":2,"direction":"backward","key":"2/backward.mp4"}},{"clip":{"edge_id":1,"direction":"forward","key":"1/forward.mp4"}}],"manifestVersion":1,"attribution":{"sources":["synthetic"],"requiresLogoAndLink":true},"prototype":true,"note":"café"}
```

Canonical form (step 3; `é` is written as is):

```
{"attribution":{"requiresLogoAndLink":true,"sources":["synthetic"]},"manifestVersion":1,"note":"café","prototype":true,"segments":[{"clip":{"direction":"backward","edge_id":2,"key":"2/backward.mp4"}},{"clip":{"direction":"forward","edge_id":1,"key":"1/forward.mp4"}}]}
```

Preimage (steps 4 to 6; the clip lines are sorted by key, so `1/...` precedes `2/...` although the manifest lists them the other way round):

```
rpg-bundle-v1
{"attribution":{...canonical manifest above...}]}
1/forward.mp4 18 6d4a3a591d0a1740d8c25b14ea0f87702926410fca304007f2244fc7c5125d10
2/backward.mp4 32 fe2a3e3760c2ded961f6b42ca0a729b0b2bb770c94808b027de782322ee18575
```

(The second line is the full canonical manifest, abbreviated here for width.) Result:

```
sha256(canonical manifest)  = 7b57389e9400d98834707e660e9ebdbdadfd651d980effd235773f89a41f0d61   (informational, not part of the hash)
contentHash                 = ea88eabd2d678e39d37ebfc2e658b08f1d35960883ff63005b95d27cb9da5446
```

These values are asserted by `backend/test/bundle-hash-doc.test.ts`, which builds this bundle with the real builder.
