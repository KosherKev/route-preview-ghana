#!/usr/bin/env bash
# Dev convenience: run the preview API in a detached tmux session named exactly `rpg-api`.
#   scripts/dev-api.sh start | stop | status
# Binds 127.0.0.1 only (the server refuses anything else). Port = PORT env, default 8787.
# PROTOTYPE_CLIP_SERVING and MAPILLARY_TOKEN are explicitly unset inside the session command.
# DB and Valhalla settings come from the repo's .env via the normal loadEnv(); this script never prints it.
# Not enabled at login: nothing here installs launchd agents or login items.
# Only the `rpg-api` tmux session is ever touched; any other tmux session is left alone.
set -euo pipefail
SESSION="rpg-api"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8787}"
case "$PORT" in ''|*[!0-9]*) echo "PORT must be a number" >&2; exit 2;; esac
running() { tmux has-session -t "=$SESSION" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "$SESSION already running"; exit 0; fi
    [ -f "$ROOT/.env" ] || { echo "missing $ROOT/.env (copy .env.example; contents are never printed)" >&2; exit 1; }
    tmux new-session -d -s "$SESSION" -c "$ROOT/backend" \
      "env -u PROTOTYPE_CLIP_SERVING -u MAPILLARY_TOKEN PORT=$PORT npx tsx scripts/serve-approach.ts"
    echo "started tmux session $SESSION (API on 127.0.0.1:$PORT)"
    ;;
  stop)
    if running; then tmux kill-session -t "=$SESSION"; echo "stopped $SESSION"; else echo "$SESSION not running"; fi
    ;;
  status)
    if running; then echo "$SESSION: running (port $PORT)"; else echo "$SESSION: not running"; exit 1; fi
    ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2;;
esac
