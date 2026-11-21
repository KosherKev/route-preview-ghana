# Tailnet dev API

The preview API can be reached from Kevin's own devices (for example the iPhone running the Flutter app) over Tailscale. This is a
development convenience for a pre-trip preview prototype, not a public service.

- URL: `https://servermac.tail607401.ts.net:8444`
- Routes: the same as `npm run serve` (`GET /health`, `POST /preview`, `POST /approach`, `GET /geocode`, `GET /landmarks/search`, `POST /preview/bundle`).
- Reachable only from devices on Kevin's tailnet. It is published with `tailscale serve` (tailnet only), never `tailscale funnel`, so it is
  not on the public internet. Port 443 on this node carries a different, pre-existing Funnel for another service; it is not part of this
  project and must not be changed, reset or replaced. Only port 8444 belongs to this API.

## Start and stop

```sh
scripts/dev-api.sh start    # detached tmux session `rpg-api`; API on 127.0.0.1:8787 (PORT env overrides)
scripts/dev-api.sh status
scripts/dev-api.sh stop     # kills only the `rpg-api` tmux session
```

The session runs with `PROTOTYPE_CLIP_SERVING` and `MAPILLARY_TOKEN` explicitly unset. Database and Valhalla settings come from the
repo's gitignored `.env`. PostGIS and Valhalla (Docker Compose) must already be up.

The tailnet mapping is set once and survives restarts of the API session:

```sh
tailscale serve --bg --https=8444 http://127.0.0.1:8787   # enable (tailnet only)
tailscale serve --https=8444 off                          # remove only this mapping
```

The `rpg-api` session is a dev convenience. Nothing is enabled at login: no launchd job, no login item. After a reboot, start it again by hand.

## Clips are never served this way

`tailscale serve` forwards from localhost, so every request looks like loopback to the API. To keep clips out of reach, `/clips/...` is
refused (403 problem JSON) whenever the request carries any proxy header, even if `PROTOTYPE_CLIP_SERVING=1` were set. Names are compared
case-insensitively and an empty value still counts: any header whose name contains `forwarded` (`X-Forwarded-For`, `X-Forwarded-Host`,
`X-Forwarded-Proto`, `Forwarded`, `Forwarded-For`, ...), `Via`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`, `X-Client-IP`,
`Client-IP`, `X-Cluster-Client-IP`, `X-Originating-IP`, `Fastly-Client-IP`, and any `Tailscale-*` header. The session also leaves the flag unset, so `/clips/...` answers 404
(or 403 with those headers). Do not set the flag on a process that is published with `serve`.

In the manifest, a street segment with a clip in the local cache reports `status: ready`, `playback: clip` and a `clipRef`/`clip.key`; without
one it reports `status: not_rendered`, `clip: null` and `playback: flyover` (reason `clip_not_rendered`). A `ready` segment carries no flyover (`flyover: null`) and its clip cannot be fetched over the tailnet, so the app must treat it as unplayable here and show its own fallback (the route and
markers); `not_rendered` segments carry flyover keyframes the app can play. See
[the manifest](preview-manifest.md).

## Risk: no authentication yet

There is no auth and no rate limiting on this API until the D5 backlog is built. Anyone on the tailnet (or with a shared device or node on
it) can call it. It serves route manifests and landmark data only, never imagery, but keep the tailnet membership tight and do not widen
this to Funnel or any public path.
