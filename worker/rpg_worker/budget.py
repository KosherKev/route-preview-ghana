"""Persisted Mapillary usage counter with a hard download cap. Counts only; never records URLs or tokens."""
from __future__ import annotations

import json
import os
from pathlib import Path

MAX_DOWNLOADS = 1000


class BudgetExceeded(RuntimeError):
    pass


class Budget:
    def __init__(self, path: Path, max_downloads: int = MAX_DOWNLOADS):
        self.path = Path(path)
        self.max_downloads = max_downloads
        self.state = {"downloads": 0, "api_calls": 0}
        if self.path.exists():
            data = json.loads(self.path.read_text())
            self.state.update({k: int(data.get(k, 0)) for k in self.state})

    @property
    def downloads(self) -> int:
        return self.state["downloads"]

    @property
    def api_calls(self) -> int:
        return self.state["api_calls"]

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state))
        os.replace(tmp, self.path)

    def record_api_call(self) -> None:
        """Count a Graph API call BEFORE it is made, so a crash mid-request can never under-count."""
        self.state["api_calls"] += 1
        self._save()

    def reserve_download(self) -> None:
        """Count one image download BEFORE it is made; refuse once the cap is reached."""
        if self.state["downloads"] >= self.max_downloads:
            raise BudgetExceeded(f"image download budget of {self.max_downloads} reached; refusing further downloads")
        self.state["downloads"] += 1
        self._save()
