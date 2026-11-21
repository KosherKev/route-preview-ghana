"""Repo-relative locations. Everything the worker writes lives under <repo>/data (gitignored)."""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA = REPO_ROOT / "data"
FRAMES_CACHE = DATA / "frames-cache"
CLIPS_CACHE = DATA / "clips-cache"
PLANS = DATA / "clips" / "plans"
RESULTS = DATA / "clips" / "results"
BUDGET_FILE = DATA / "mapillary-budget.json"
TOKEN_FILE = REPO_ROOT / ".env.mapillary"  # gitignored; holds only MAPILLARY_TOKEN, mode 600
