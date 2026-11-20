---
paths: ['~/dev/route-preview-ghana']
---
# Unattended / Headless Run Rules

These rules apply ONLY when Claude Code is invoked non-interactively (via `claude -p`, a cron job,
or any script — anything running with nobody watching in real time). They exist because unattended
runs cannot be interrupted mid-mistake the way an interactive session can.


## Hard denylist — never do these in a headless/unattended run, no exceptions

- Never `git push --force` or `git push -f` to any branch.
- Never delete a git branch, local or remote.
- Never run `rm -rf` outside of a project's own `node_modules`, `dist`, `build`, `.venv`,
  `__pycache__`, or explicitly named temp/cache directories.
- Never modify, rotate, or delete anything under `.env`, `.env.*`, or any secrets/credentials file.
- Never run a deploy command headlessly. Deploys require a human to trigger them, always.
- Never touch database migrations that drop or alter existing tables/columns — additive migrations
  (new tables, new nullable columns) are fine; destructive ones require an interactive session where
  a human reviews the migration file before it runs.
- Never modify CI/CD configuration files (`.github/workflows/`, `cloudbuild.yaml`, or equivalent) in
  a headless run — these need eyes-on review.

### Project-specific denylist (route-preview-ghana)

- Never commit or print a Mapillary access token, `client_id`, or any API key. Tokens come from
  `.env` (gitignored) only.
- Never upload, publish, or push any captured or rider imagery, or anything derived from Mapillary
  frames, to any external service or bucket. Local MinIO/localhost storage only.
- Never add any feature that syncs the preview to live GPS position or provides turn-by-turn
  guidance. The product is a pre-trip preview only.
- Never run `docker system prune`, `docker volume rm`, or `docker compose down -v` against anything
  other than this project's own named volumes, and never touch containers or volumes belonging to
  other projects.
- Never use Google Maps / Street View / Google 3D Tiles or Esri imagery sources.

## Scope discipline

- A headless run must be given ONE narrow, explicit task — not an open-ended "check if everything
  looks good." Vague prompts in unattended mode have historically caused agents to "fix" things
  nobody asked about, burning time and tokens on unrequested work.
- Every headless run must end with a REAL verification step — the actual test/build/lint command for
  that repo, not a self-assessment. "I reviewed the code and it looks correct" is not verification;
  `npm test` exiting 0 is.
- If a headless run's own verification step fails, it should stop and report the failure clearly
  (exit non-zero, write a clear summary) — it should never mark a task complete because a test suite
  passed vacuously (zero actual tests run) or because a build succeeded while the actual acceptance
  criteria weren't checked.
- The first code phase must add real tests before feature work. A run whose test suite executes
  zero tests counts as a failure.

## Resume-dialog trap (known Claude Code gotcha)

Headless invocations in a directory with an existing interactive session can hang forever on a
"resume this session?" prompt with no visible error. Always invoke headless runs one of these ways:
- In a directory/worktree NOT currently open in an interactive tmux session, OR
- With an explicit non-interactive flag/piped answer so the prompt can't block execution.
Never assume a headless run "just didn't do anything" — check first whether it's actually stuck on
this exact prompt before assuming a different failure.

## Allowed without restriction

- Read-only operations: running existing tests, linting, building, reading logs, summarizing diffs,
  checking dependency versions, running `git status`/`git log`/`git diff`.
- Writing NEW files that don't already exist (new tests, new docs, new non-destructive scripts).
- Additive code changes on a dedicated branch created specifically for that headless run — never
  committing directly to `main`/`master`/`develop` from an unattended run.
- Merging a task branch into `main` is allowed ONLY through the orchestrator's conditional
  auto-merge check (the five-condition bar in the pipeline's A6.5, evaluated fresh after review).
  It is never allowed for work touching payments, auth or database migrations, never by
  force-push, and a branch that fails any condition stays pushed and PR-ready. The one other way
  a merge happens is on Kevin's explicit instruction in chat; the agent never merges on its own.
- Scoped to this project only: `docker compose up -d` for Valhalla, PostGIS and MinIO bound to
  localhost, and downloading the Geofabrik `ghana-latest.osm.pbf` into the gitignored `data/`
  directory.

## Which repos/directories this applies to

- ~/dev/route-preview-ghana (headless setup, 2026-11-20 — no test suite yet; Phase 2 must add one
  before this counts as autonomous-ready for feature work)
