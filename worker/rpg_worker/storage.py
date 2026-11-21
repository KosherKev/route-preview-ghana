"""Clip storage abstraction. Only a local-filesystem implementation exists; no MinIO, R2 or S3 (nothing is uploaded or served).
Clips are indexed by edge_id plus direction."""
from __future__ import annotations

import json
import shutil
from abc import ABC, abstractmethod
from pathlib import Path


def clip_key(edge_id: int, direction: str) -> str:
    if not direction.isalnum():
        raise ValueError("direction must be alphanumeric")
    return f"{int(edge_id)}/{direction}.mp4"


class ClipStorage(ABC):
    @abstractmethod
    def exists(self, edge_id: int, direction: str) -> bool: ...

    @abstractmethod
    def put(self, edge_id: int, direction: str, src: Path, meta: dict) -> str: ...

    @abstractmethod
    def path(self, edge_id: int, direction: str) -> Path: ...

    @abstractmethod
    def meta(self, edge_id: int, direction: str) -> dict: ...


class LocalClipStorage(ClipStorage):
    def __init__(self, root: Path):
        self.root = Path(root)

    def path(self, edge_id: int, direction: str) -> Path:
        return self.root / clip_key(edge_id, direction)

    def _meta_path(self, edge_id: int, direction: str) -> Path:
        return self.path(edge_id, direction).with_suffix(".json")

    def exists(self, edge_id: int, direction: str) -> bool:
        return self.path(edge_id, direction).is_file() and self._meta_path(edge_id, direction).is_file()

    def put(self, edge_id: int, direction: str, src: Path, meta: dict) -> str:
        dest = self.path(edge_id, direction)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), dest)
        self._meta_path(edge_id, direction).write_text(json.dumps({**meta, "prototype": True}, indent=2))
        return clip_key(edge_id, direction)

    def meta(self, edge_id: int, direction: str) -> dict:
        return json.loads(self._meta_path(edge_id, direction).read_text())
