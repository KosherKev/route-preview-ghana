import logging

import pytest
import requests

from rpg_worker.budget import Budget, BudgetExceeded
from rpg_worker.fetch import FetchError, MapillaryFetcher
from rpg_worker.killswitch import SourceDisabledError

TOKEN = "MLY|FAKE-TEST-TOKEN-123"  # obviously fake, test-only
SIGNED = "https://scontent.example-cdn.net/img.jpg?sig=SECRETSIG"


class Resp:
    def __init__(self, status=200, body=None, headers=None, content=b"\xff\xd8jpegbytes"):
        self.status_code, self._body, self.headers, self._content = status, body, headers or {}, content

    def json(self):
        return self._body

    def iter_content(self, n):
        yield self._content

    def close(self):
        pass


class Session:
    def __init__(self, script):
        self.script, self.calls = list(script), []

    def get(self, url, headers=None, params=None, timeout=None, allow_redirects=None, stream=None):
        self.calls.append({"url": url, "headers": dict(headers or {}), "params": params, "allow_redirects": allow_redirects})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def mk(tmp_path, script, **kw):
    sleeps = []
    s = Session(script)
    f = MapillaryFetcher(TOKEN, Budget(tmp_path / "b.json", kw.pop("max_downloads", 1000)), session=s, min_interval_s=0, sleep=sleeps.append, **kw)
    return f, s, sleeps


def test_downloads_with_2048_url_and_counts(tmp_path):
    f, s, _ = mk(tmp_path, [Resp(body={"thumb_2048_url": SIGNED, "thumb_1024_url": "https://x/1024"}), Resp()])
    assert f.download("img1", tmp_path / "c" / "img1.jpg") is True
    assert (tmp_path / "c" / "img1.jpg").read_bytes().startswith(b"\xff\xd8")
    assert (f.budget.api_calls, f.budget.downloads) == (1, 1)
    assert s.calls[0]["params"] == {"fields": "thumb_2048_url,thumb_1024_url"}
    assert s.calls[0]["headers"]["Authorization"] == f"OAuth {TOKEN}"
    assert s.calls[1]["url"] == SIGNED and "Authorization" not in s.calls[1]["headers"]  # the token never goes to the CDN
    assert s.calls[1]["allow_redirects"] is False


def test_falls_back_to_1024(tmp_path):
    f, s, _ = mk(tmp_path, [Resp(body={"thumb_1024_url": "https://cdn.example/1024?sig=Z"}), Resp()])
    f.download("img1", tmp_path / "i.jpg")
    assert s.calls[1]["url"].startswith("https://cdn.example/1024")


def test_cached_image_costs_nothing(tmp_path):
    f, s, _ = mk(tmp_path, [])
    p = tmp_path / "i.jpg"
    p.write_bytes(b"x")
    assert f.download("img1", p) is False
    assert s.calls == [] and (f.budget.api_calls, f.budget.downloads) == (0, 0)


def test_kill_switch_blocks_before_any_request(tmp_path, monkeypatch):
    monkeypatch.setenv("IMAGERY_SOURCES_DISABLED", " Mapillary ")
    f, s, _ = mk(tmp_path, [])
    with pytest.raises(SourceDisabledError):
        f.download("img1", tmp_path / "i.jpg")
    assert s.calls == [] and f.budget.api_calls == 0


def test_hard_download_budget(tmp_path):
    f, s, _ = mk(tmp_path, [Resp(body={"thumb_2048_url": SIGNED}), Resp(), Resp(body={"thumb_2048_url": SIGNED})], max_downloads=1)
    f.download("a", tmp_path / "a.jpg")
    with pytest.raises(BudgetExceeded):
        f.download("b", tmp_path / "b.jpg")
    assert f.budget.downloads == 1
    assert not (tmp_path / "b.jpg").exists()


def test_retry_after_is_honoured_and_capped(tmp_path):
    f, _, sleeps = mk(tmp_path, [Resp(429, headers={"Retry-After": "7"}), Resp(429, headers={"Retry-After": "9999"}), Resp(body={"thumb_2048_url": SIGNED})])
    assert f.image_url("a") == SIGNED
    assert sleeps == [7.0, 60.0]
    assert f.budget.api_calls == 3  # every attempt is counted


def test_gives_up_after_retries(tmp_path):
    f, _, _ = mk(tmp_path, [Resp(503)] * 4, max_retries=3)
    with pytest.raises(FetchError, match="HTTP 503"):
        f.image_url("a")


def test_no_url_or_token_in_errors_logs_or_repr(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    boom = requests.ConnectionError(f"HTTPSConnectionPool: {SIGNED} {TOKEN}")
    f, _, _ = mk(tmp_path, [boom] * 4, max_retries=3)
    with pytest.raises(FetchError) as e:
        f.image_url("img9")
    blob = str(e.value) + repr(e.value.__cause__) + repr(f) + str(f) + caplog.text
    assert TOKEN not in blob and "SECRETSIG" not in blob and "cdn" not in blob
    f2, _, _ = mk(tmp_path, [Resp(404)])
    with pytest.raises(FetchError) as e2:
        f2.image_url("img9")
    assert TOKEN not in str(e2.value)


def test_download_error_message_has_no_url(tmp_path):
    f, _, _ = mk(tmp_path, [Resp(body={"thumb_2048_url": SIGNED}), Resp(403)])
    with pytest.raises(FetchError) as e:
        f.download("img1", tmp_path / "i.jpg")
    assert "SECRETSIG" not in str(e.value) and "img1" in str(e.value)


def test_rejects_non_https_location(tmp_path):
    f, _, _ = mk(tmp_path, [Resp(body={"thumb_2048_url": "http://insecure.example/x.jpg"})])
    with pytest.raises(FetchError, match="non-https"):
        f.image_url("a")


def test_requires_a_token(tmp_path):
    with pytest.raises(FetchError, match="not set"):
        MapillaryFetcher("", Budget(tmp_path / "b.json"))
