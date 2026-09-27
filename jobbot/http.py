"""Shared HTTP client with sane timeouts and retries on transient failures only."""

from __future__ import annotations

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)


def make_client(timeout: float = 30.0) -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(timeout, connect=10.0),
        headers={"User-Agent": "jobbot/0.1 (+personal job search)"},
        follow_redirects=True,
    )


def _transient(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False


@retry(
    retry=retry_if_exception(_transient),
    stop=stop_after_attempt(3),
    wait=wait_exponential(1, max=8),
    reraise=True,
)
def get_json(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    resp = client.get(url, **kwargs)
    resp.raise_for_status()
    return resp


@retry(
    retry=retry_if_exception(_transient),
    stop=stop_after_attempt(3),
    wait=wait_exponential(1, max=8),
    reraise=True,
)
def post_json(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    resp = client.post(url, **kwargs)
    resp.raise_for_status()
    return resp


def status_of(exc: BaseException) -> str:
    """Map a fetch failure to a source health status."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403, 429, 999):
            return "blocked"
        return "error"
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, (KeyError, TypeError, ValueError)):
        return "broken"
    text = str(exc).lower()
    if any(s in text for s in ("429", "403", "blocked", "captcha", "too many requests")):
        return "blocked"
    return "error"
