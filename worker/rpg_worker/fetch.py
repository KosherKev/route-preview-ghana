"""Mapillary frame fetcher. Image URLs are signed and short-lived: they are requested immediately before each download,
never stored, never logged, and never placed in an exception message. The token is sent only as an Authorization header to
graph.mapillary.com (never to the image CDN) and is never logged or stored."""
from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlparse

import requests

from .budget import Budget
from .killswitch import assert_source_enabled

GRAPH = "https://graph.mapillary.com"
SOURCE = "mapillary"
MAX_RETRY_AFTER_S = 60.0
MAX_IMAGE_BYTES = 25 * 1024 * 1024
URL_FIELDS = ("thumb_2048_url", "thumb_1024_url")


class FetchError(RuntimeError):
    """Messages carry an image id and an HTTP status at most: never a URL, header or token."""


class MapillaryFetcher:
    def __init__(
        self, token: str, budget: Budget, session: requests.Session | None = None, min_interval_s: float = 0.25,
        max_retries: int = 3, sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic,
        timeout_s: float = 30.0,
    ):
        if not token:
            raise FetchError("MAPILLARY_TOKEN is not set; nothing was requested")
        self._token = token
        self.budget = budget
        self.session = session or requests.Session()
        self.min_interval_s = min_interval_s
        self.max_retries = max_retries
        self._sleep = sleep
        self._clock = clock
        self._last = -1e9
        self.timeout_s = timeout_s

    def __repr__(self) -> str:  # never expose the token through repr/log formatting
        return "MapillaryFetcher(token=<hidden>)"

    def _throttle(self) -> None:
        wait = self.min_interval_s - (self._clock() - self._last)
        if wait > 0:
            self._sleep(wait)
        self._last = self._clock()

    def _get(self, url: str, image_id: str, headers: dict[str, str], params: dict[str, str] | None, count_as: str) -> requests.Response:
        """One logical GET with throttle, Retry-After handling and bounded retries. count_as is 'api' or 'download'."""
        for attempt in range(self.max_retries + 1):
            assert_source_enabled(SOURCE)  # kill switch is re-read on every request
            self._throttle()
            if count_as == "api":
                self.budget.record_api_call()
            else:
                self.budget.reserve_download()
            try:
                r = self.session.get(url, headers=headers, params=params, timeout=self.timeout_s, allow_redirects=False, stream=count_as == "download")
            except requests.RequestException as e:
                if attempt >= self.max_retries:
                    raise FetchError(f"network error for image {image_id} ({type(e).__name__})") from None
                self._sleep(min(2.0 ** attempt, MAX_RETRY_AFTER_S))
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                if attempt >= self.max_retries:
                    raise FetchError(f"HTTP {r.status_code} for image {image_id} after {attempt + 1} attempts")
                ra = r.headers.get("Retry-After")
                try:
                    delay = float(ra) if ra is not None else 2.0 ** attempt
                except ValueError:
                    delay = 2.0 ** attempt
                self._sleep(max(0.0, min(delay, MAX_RETRY_AFTER_S)))
                r.close()
                continue
            return r
        raise FetchError(f"gave up on image {image_id}")  # pragma: no cover

    def image_url(self, image_id: str) -> str:
        """Fresh signed URL for the largest thumbnail available (2048, else 1024). Returned to the caller only; never stored or logged."""
        r = self._get(f"{GRAPH}/{image_id}", image_id, {"Authorization": f"OAuth {self._token}"}, {"fields": ",".join(URL_FIELDS)}, "api")
        if r.status_code != 200:
            raise FetchError(f"HTTP {r.status_code} resolving image {image_id}")
        try:
            body = r.json()
        except ValueError:
            raise FetchError(f"unparseable response resolving image {image_id}") from None
        for f in URL_FIELDS:
            u = body.get(f)
            if isinstance(u, str) and u:
                if urlparse(u).scheme != "https":
                    raise FetchError(f"non-https image location for image {image_id}")
                return u
        raise FetchError(f"no thumbnail url available for image {image_id}")

    def download(self, image_id: str, dest: Path) -> bool:
        """Fetch one image into dest. Returns False (no call, no budget use) when it is already cached."""
        dest = Path(dest)
        if dest.exists() and dest.stat().st_size > 0:
            return False
        assert_source_enabled(SOURCE)
        url = self.image_url(image_id)  # resolved immediately before the download
        r = self._get(url, image_id, {}, None, "download")  # no Authorization header to the CDN
        del url
        if r.status_code != 200:
            raise FetchError(f"HTTP {r.status_code} downloading image {image_id}")
        data = b""
        for chunk in r.iter_content(65536):
            data += chunk
            if len(data) > MAX_IMAGE_BYTES:
                raise FetchError(f"image {image_id} exceeds the size cap")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return True
