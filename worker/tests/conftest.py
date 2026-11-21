import os

import pytest


def pytest_sessionstart(session):
    # No test may read a real token: the suite refuses to run with one in the environment.
    if os.environ.get("MAPILLARY_TOKEN"):
        pytest.exit("MAPILLARY_TOKEN is set; run the tests with `env -u MAPILLARY_TOKEN`", returncode=3)


@pytest.fixture(autouse=True)
def _no_kill_switch(monkeypatch):
    monkeypatch.delenv("IMAGERY_SOURCES_DISABLED", raising=False)
