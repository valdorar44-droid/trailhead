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


RIDB_API_BASE = "https://ridb.recreation.gov/api/v1"
RIDB_USER_AGENT = "Trailhead/1.0 explore-ridb-fetcher"


UrlOpener = Callable[[urllib.request.Request, float], Any]


def fetch_ridb_facilities_to_cache(
    *,
    api_key: str | None = None,
    cache_dir: str | Path = "data/explore/source_cache",
    states: Iterable[str] | None = None,
    activities: Iterable[str] | None = None,
    query: str = "",
    latitude: float | None = None,
    longitude: float | None = None,
    radius: float | None = None,
    limit: int = 50,
    max_records: int = 500,
    timeout: float = 30.0,
    force: bool = False,
    opener: UrlOpener = urllib.request.urlopen,
) -> Path:
    key = (api_key or os.environ.get("RIDB_API_KEY") or os.environ.get("RECREATION_GOV_API_KEY") or "").strip()
    if not key:
        raise ValueError("RIDB_API_KEY is required for live RIDB fetches")
    target = cache_path(
        cache_dir,
        states=states,
        activities=activities,
        query=query,
        latitude=latitude,
        longitude=longitude,
        radius=radius,
        max_records=max_records,
    )
    if target.exists() and not force:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    facilities = fetch_ridb_facilities(
        api_key=key,
        states=states,
        activities=activities,
        query=query,
        latitude=latitude,
        longitude=longitude,
        radius=radius,
        limit=limit,
        max_records=max_records,
        timeout=timeout,
        opener=opener,
    )
    payload = {
        "source": "ridb",
        "endpoint": "facilities",
        "fetched_at": int(time.time()),
        "count": len(facilities),
        "RECDATA": facilities,
    }
    write_json_atomic(target, payload)
    return target


def fetch_ridb_facilities(
    *,
    api_key: str,
    states: Iterable[str] | None = None,
    activities: Iterable[str] | None = None,
    query: str = "",
    latitude: float | None = None,
    longitude: float | None = None,
    radius: float | None = None,
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
    offset = 0
    page_limit = min(limit, max_records)
    while len(out) < max_records:
        params = request_params(
            states=states,
            activities=activities,
            query=query,
            latitude=latitude,
            longitude=longitude,
            radius=radius,
            limit=page_limit,
            offset=offset,
        )
        page = ridb_get("facilities", api_key=api_key, params=params, timeout=timeout, opener=opener)
        items = page.get("RECDATA") or page.get("recdata") or page.get("data") or []
        if not isinstance(items, list) or not items:
            break
        out.extend(item for item in items if isinstance(item, dict))
        total = total_count(page)
        if total is not None and len(out) >= total:
            break
        if len(items) < page_limit:
            break
        offset += len(items)
    return out[:max_records]


def ridb_get(
    endpoint: str,
    *,
    api_key: str,
    params: dict[str, Any],
    timeout: float,
    opener: UrlOpener = urllib.request.urlopen,
) -> dict[str, Any]:
    query = urllib.parse.urlencode({key: value for key, value in params.items() if value not in (None, "", [])})
    url = f"{RIDB_API_BASE}/{endpoint}"
    if query:
        url = f"{url}?{query}"
    request = urllib.request.Request(
        url,
        headers={
            "apikey": api_key,
            "User-Agent": RIDB_USER_AGENT,
            "Accept": "application/json",
        },
    )
    try:
        with opener(request, timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"RIDB {endpoint} fetch failed: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"RIDB {endpoint} fetch failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"RIDB {endpoint} response was not valid JSON") from exc


def request_params(
    *,
    states: Iterable[str] | None = None,
    activities: Iterable[str] | None = None,
    query: str = "",
    latitude: float | None = None,
    longitude: float | None = None,
    radius: float | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    state_codes = compact_csv(states)
    activity_values = compact_csv(activities)
    if state_codes:
        params["state"] = state_codes
    if activity_values:
        params["activity"] = activity_values
    if query.strip():
        params["query"] = query.strip()
    if latitude is not None and longitude is not None:
        params["latitude"] = latitude
        params["longitude"] = longitude
    if radius is not None:
        params["radius"] = radius
    return params


def total_count(page: dict[str, Any]) -> int | None:
    metadata = page.get("METADATA") or page.get("metadata") or {}
    if isinstance(metadata, dict):
        results = metadata.get("RESULTS") or metadata.get("results") or {}
        if isinstance(results, dict):
            total = as_int(results.get("TOTAL_COUNT") or results.get("total_count") or results.get("total"))
            if total is not None:
                return total
    return as_int(page.get("total") or page.get("count"))


def cache_path(
    cache_dir: str | Path,
    *,
    states: Iterable[str] | None = None,
    activities: Iterable[str] | None = None,
    query: str = "",
    latitude: float | None = None,
    longitude: float | None = None,
    radius: float | None = None,
    max_records: int = 500,
) -> Path:
    parts = ["facilities"]
    state_codes = compact_csv(states).lower()
    activity_values = compact_csv(activities).lower()
    if state_codes:
        parts.append(f"states-{slug_part(state_codes)}")
    if activity_values:
        parts.append(f"activities-{slug_part(activity_values)}")
    if query.strip():
        parts.append(f"q-{slug_part(query)}")
    if latitude is not None and longitude is not None:
        parts.append(f"near-{slug_part(f'{latitude:.4f}-{longitude:.4f}')}")
    if radius is not None:
        parts.append(f"radius-{slug_part(str(radius))}")
    parts.append(f"max-{max_records}")
    return Path(cache_dir) / "ridb" / ("_".join(parts) + ".json")


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
