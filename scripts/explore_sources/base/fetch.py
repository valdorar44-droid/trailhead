from __future__ import annotations

import hashlib
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse


DEFAULT_USER_AGENT = "Trailhead/1.0 explore-source-fetcher"


def parse_headers(values: Iterable[str] | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    for raw in values or []:
        if ":" not in raw:
            raise ValueError(f"header must use 'Name: value' format: {raw}")
        name, value = raw.split(":", 1)
        name = name.strip()
        value = value.strip()
        if not name:
            raise ValueError(f"header name cannot be empty: {raw}")
        headers[name] = value
    return headers


def cache_path_for_url(cache_dir: str | Path, source: str, url: str) -> Path:
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix not in {".json", ".geojson"}:
        suffix = ".json"
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    safe_source = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in source.lower()) or "source"
    return Path(cache_dir) / safe_source / f"{digest}{suffix}"


def fetch_url_to_cache(
    url: str,
    cache_dir: str | Path,
    *,
    source: str,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
    force: bool = False,
) -> Path:
    target = cache_path_for_url(cache_dir, source, url)
    if target.exists() and not force:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    request_headers = {"User-Agent": DEFAULT_USER_AGENT, **(headers or {})}
    request = urllib.request.Request(url, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"failed to fetch {source} source URL {url}: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"failed to fetch {source} source URL {url}: {exc.reason}") from exc
    with tempfile.NamedTemporaryFile("wb", delete=False, dir=target.parent) as tmp:
        tmp.write(body)
        tmp_path = Path(tmp.name)
    tmp_path.replace(target)
    return target


def resolve_input_paths(
    fixtures: Iterable[str] | None,
    urls: Iterable[str] | None,
    *,
    source: str,
    cache_dir: str | Path,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
    force: bool = False,
) -> list[str]:
    paths = [str(path) for path in fixtures or []]
    for url in urls or []:
        paths.append(str(fetch_url_to_cache(url, cache_dir, source=source, headers=headers, timeout=timeout, force=force)))
    return paths
