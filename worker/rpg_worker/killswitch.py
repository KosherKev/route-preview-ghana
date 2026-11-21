"""IMAGERY_SOURCES_DISABLED, mirroring backend/src/imagery/sources.ts: comma list, trimmed, lower-cased, read at call time."""
from __future__ import annotations

import os
from collections.abc import Mapping

VAR = "IMAGERY_SOURCES_DISABLED"


class SourceDisabledError(RuntimeError):
    pass


def disabled_sources(env: Mapping[str, str] | None = None) -> list[str]:
    raw = (os.environ if env is None else env).get(VAR, "")
    out: list[str] = []
    for part in raw.split(","):
        name = part.strip().lower()
        if name and name not in out:
            out.append(name)
    return out


def assert_source_enabled(name: str, env: Mapping[str, str] | None = None) -> None:
    if name.strip().lower() in disabled_sources(env):
        raise SourceDisabledError(f'imagery source "{name}" is disabled by {VAR}; refusing to use it')
