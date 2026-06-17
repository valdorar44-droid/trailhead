from __future__ import annotations

import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable


NPS_API_BASE = "https://developer.nps.gov/api/v1"
NPS_USER_AGENT = "Trailhead/1.0 explore-nps-fetcher"


UrlOpener = Callable[[urllib.request.Request, float], Any]


def fetch_nps_parks_to_cache(
    *,
    api_key: str | None = None,
    cache_dir: str | Path = "data/explore/source_cache",
    park_codes: Iterable[str] | None = None,
    states: Iterable[str] | None = None,
    query: str = "",
    limit: int = 50,
    max_records: int = 500,
    timeout: float = 30.0,
    force: bool = False,
    opener: UrlOpener = urllib.request.urlopen,
) -> Path:
    key = (api_key or os.environ.get("NPS_API_KEY") or "").strip()
    if not key:
        raise ValueError("NPS_API_KEY is required for live NPS fetches")
    target = cache_path(cache_dir, park_codes=park_codes, states=states, query=query, max_records=max_records)
    if target.exists() and not force:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    parks = fetch_nps_parks(
        api_key=key,
        park_codes=park_codes,
        states=states,
        query=query,
        limit=limit,
        max_records=max_records,
        timeout=timeout,
        opener=opener,
    )
    payload = {
        "source": "nps",
        "endpoint": "parks",
        "fetched_at": int(time.time()),
        "count": len(parks),
        "data": parks,
    }
    write_json_atomic(target, payload)
    return target


def fetch_nps_parks(
    *,
    api_key: str,
    park_codes: Iterable[str] | None = None,
    states: Iterable[str] | None = None,
    query: str = "",
    limit: int = 50,
    max_records: int = 500,
    timeout: float = 30.0,
    opener: UrlOpener = urllib.request.urlopen,
) -> list[dict[str, Any]]:
    if limit <= 0:
        raise ValueError("limit must be positive")
    if max_records <= 0:
        raise ValueError("max_records must be positive")
    out: list[dict[str, Any]] = []
    start = 0
    page_limit = min(limit, max_records)
    while len(out) < max_records:
        params = request_params(park_codes=park_codes, states=states, query=query, limit=page_limit, start=start)
        page = nps_get("parks", api_key=api_key, params=params, timeout=timeout, opener=opener)
        items = page.get("data") or []
        if not isinstance(items, list) or not items:
            break
        out.extend(item for item in items if isinstance(item, dict))
        total = as_int(page.get("total"))
        if total is not None and len(out) >= total:
            break
        if len(items) < page_limit:
            break
        start += len(items)
    return out[:max_records]


def nps_get(
    endpoint: str,
    *,
    api_key: str,
    params: dict[str, Any],
    timeout: float,
    opener: UrlOpener = urllib.request.urlopen,
) -> dict[str, Any]:
    query = urllib.parse.urlencode({key: value for key, value in params.items() if value not in (None, "", [])})
    url = f"{NPS_API_BASE}/{endpoint}"
    if query:
        url = f"{url}?{query}"
    request = urllib.request.Request(
        url,
        headers={
            "X-Api-Key": api_key,
            "User-Agent": NPS_USER_AGENT,
            "Accept": "application/json",
        },
    )
    try:
        with opener(request, timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"NPS {endpoint} fetch failed: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"NPS {endpoint} fetch failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"NPS {endpoint} response was not valid JSON") from exc


def request_params(
    *,
    park_codes: Iterable[str] | None = None,
    states: Iterable[str] | None = None,
    query: str = "",
    limit: int = 50,
    start: int = 0,
) -> dict[str, Any]:
    params: dict[str, Any] = {"limit": limit, "start": start}
    codes = compact_csv(park_codes)
    state_codes = compact_csv(states)
    if codes:
        params["parkCode"] = codes
    if state_codes:
        params["stateCode"] = state_codes
    if query.strip():
        params["q"] = query.strip()
    return params


def cache_path(
    cache_dir: str | Path,
    *,
    park_codes: Iterable[str] | None = None,
    states: Iterable[str] | None = None,
    query: str = "",
    max_records: int = 500,
) -> Path:
    parts = ["parks"]
    codes = compact_csv(park_codes).lower()
    state_codes = compact_csv(states).lower()
    if codes:
        parts.append(f"codes-{slug_part(codes)}")
    if state_codes:
        parts.append(f"states-{slug_part(state_codes)}")
    if query.strip():
        parts.append(f"q-{slug_part(query)}")
    parts.append(f"max-{max_records}")
    return Path(cache_dir) / "nps" / ("_".join(parts) + ".json")


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=path.parent, encoding="utf-8") as tmp:
        json.dump(payload, tmp, indent=2, ensure_ascii=False)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def compact_csv(values: Iterable[str] | None) -> str:
    return ",".join(value.strip() for value in values or [] if value and value.strip())


def slug_part(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")[:80] or "all"


def as_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except Exception:
        return None
