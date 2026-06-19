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
NPS_USER_AGENT = "Trailhead/1.0"
NPS_RELATED_ENDPOINTS = (
    "places",
    "thingstodo",
    "campgrounds",
    "visitorcenters",
    "alerts",
    "articles",
    "events",
    "tours",
    "parkinglots",
    "feespasses",
)
NPS_PER_PARK_ENDPOINTS: set[str] = set()
NPS_RETRY_STATUS_CODES = {429, 500, 502, 503, 504}


UrlOpener = Callable[[urllib.request.Request, float], Any]


def fetch_nps_source_pack_to_cache(
    *,
    api_key: str | None = None,
    cache_dir: str | Path = "data/explore/source_cache",
    park_codes: Iterable[str] | None = None,
    states: Iterable[str] | None = None,
    query: str = "",
    limit: int = 50,
    max_records: int = 500,
    related_endpoints: Iterable[str] | None = None,
    per_park_endpoints: Iterable[str] | None = None,
    related_max_records: int = 100,
    timeout: float = 30.0,
    force: bool = False,
    opener: UrlOpener = urllib.request.urlopen,
) -> Path:
    key = (api_key or os.environ.get("NPS_API_KEY") or "").strip()
    if not key:
        raise ValueError("NPS_API_KEY is required for live NPS fetches")
    endpoints = normalize_related_endpoints(related_endpoints)
    per_park = normalize_per_park_endpoints(per_park_endpoints)
    target = source_pack_cache_path(
        cache_dir,
        park_codes=park_codes,
        states=states,
        query=query,
        max_records=max_records,
        related_endpoints=endpoints,
    )
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
    park_code_list = [str(park.get("parkCode") or park.get("id") or "").strip() for park in parks if isinstance(park, dict)]
    park_code_list = [code for code in park_code_list if code]
    related: dict[str, dict[str, list[dict[str, Any]]]] = {
        code: {endpoint: [] for endpoint in endpoints}
        for code in park_code_list
    }
    for endpoint in endpoints:
        if endpoint in per_park:
            for code in park_code_list:
                related[code][endpoint] = fetch_nps_endpoint(
                    endpoint,
                    api_key=key,
                    park_codes=[code],
                    limit=limit,
                    max_records=related_max_records,
                    timeout=timeout,
                    opener=opener,
                )
            continue
        for code_batch in chunks(park_code_list, 50):
            endpoint_items = fetch_nps_endpoint(
                endpoint,
                api_key=key,
                park_codes=code_batch,
                limit=limit,
                max_records=max(related_max_records, related_max_records * max(len(code_batch), 1)),
                timeout=timeout,
                opener=opener,
            )
            for item in endpoint_items:
                codes = park_codes_for_item(item)
                if not codes and len(code_batch) == 1:
                    codes = [code_batch[0]]
                for code in codes:
                    if code in related:
                        bucket = related[code].setdefault(endpoint, [])
                        if item not in bucket and len(bucket) < related_max_records:
                            bucket.append(item)
    payload = {
        "source": "nps",
        "endpoint": "source_pack",
        "related_endpoints": endpoints,
        "fetched_at": int(time.time()),
        "count": len(parks),
        "data": parks,
        "related": related,
    }
    write_json_atomic(target, payload)
    return target


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


def fetch_nps_endpoint(
    endpoint: str,
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
    endpoint = endpoint.strip().lower()
    if not endpoint:
        raise ValueError("endpoint is required")
    if limit <= 0:
        raise ValueError("limit must be positive")
    if max_records <= 0:
        raise ValueError("max_records must be positive")
    out: list[dict[str, Any]] = []
    start = 0
    page_limit = min(limit, max_records)
    while len(out) < max_records:
        params = request_params(park_codes=park_codes, states=states, query=query, limit=page_limit, start=start)
        page = nps_get(endpoint, api_key=api_key, params=params, timeout=timeout, opener=opener)
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
    query_params = {key: value for key, value in params.items() if value not in (None, "", [])}
    query_params["api_key"] = api_key
    query = urllib.parse.urlencode(query_params)
    url = f"{NPS_API_BASE}/{endpoint}"
    if query:
        url = f"{url}?{query}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": NPS_USER_AGENT,
            "Accept": "application/json",
        },
    )
    for attempt in range(4):
        try:
            with opener(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in NPS_RETRY_STATUS_CODES and attempt < 3:
                time.sleep(retry_delay(exc, attempt))
                continue
            raise RuntimeError(f"NPS {endpoint} fetch failed: HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            if attempt < 3:
                time.sleep(retry_delay(exc, attempt))
                continue
            raise RuntimeError(f"NPS {endpoint} fetch failed: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"NPS {endpoint} response was not valid JSON") from exc
    raise RuntimeError(f"NPS {endpoint} fetch failed after retries")


def retry_delay(exc: Exception, attempt: int) -> float:
    retry_after = None
    headers = getattr(exc, "headers", None)
    if headers:
        retry_after = headers.get("Retry-After")
    try:
        if retry_after:
            return min(float(retry_after), 60.0)
    except Exception:
        pass
    return min(2.0 * (attempt + 1), 10.0)


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


def source_pack_cache_path(
    cache_dir: str | Path,
    *,
    park_codes: Iterable[str] | None = None,
    states: Iterable[str] | None = None,
    query: str = "",
    max_records: int = 500,
    related_endpoints: Iterable[str] | None = None,
) -> Path:
    parts = ["source-pack"]
    codes = compact_csv(park_codes).lower()
    state_codes = compact_csv(states).lower()
    endpoints = ",".join(normalize_related_endpoints(related_endpoints))
    if codes:
        parts.append(f"codes-{slug_part(codes)}")
    if state_codes:
        parts.append(f"states-{slug_part(state_codes)}")
    if query.strip():
        parts.append(f"q-{slug_part(query)}")
    if endpoints:
        parts.append(f"with-{slug_part(endpoints)}")
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


def normalize_related_endpoints(values: Iterable[str] | None) -> list[str]:
    out = []
    for value in values or NPS_RELATED_ENDPOINTS:
        endpoint = str(value or "").strip().lower()
        if endpoint and endpoint not in out:
            out.append(endpoint)
    return out or list(NPS_RELATED_ENDPOINTS)


def normalize_per_park_endpoints(values: Iterable[str] | None) -> set[str]:
    if values is None:
        return set(NPS_PER_PARK_ENDPOINTS)
    return {str(value or "").strip().lower() for value in values if str(value or "").strip()}


def park_codes_for_item(item: dict[str, Any]) -> list[str]:
    codes: list[str] = []
    for key in ("parkCode", "park_code"):
        value = item.get(key)
        if isinstance(value, str):
            codes.extend(part.strip() for part in value.split(",") if part.strip())
        elif isinstance(value, list):
            codes.extend(str(part).strip() for part in value if str(part).strip())
    for key in ("relatedParks", "parks"):
        values = item.get(key)
        if not isinstance(values, list):
            continue
        for park in values:
            if isinstance(park, dict):
                code = str(park.get("parkCode") or park.get("id") or "").strip()
            else:
                code = str(park or "").strip()
            if code:
                codes.append(code)
    for key in ("url", "related_url"):
        code = park_code_from_url(item.get(key))
        if code:
            codes.append(code)
    out = []
    for code in codes:
        if code and code not in out:
            out.append(code)
    return out


def park_code_from_url(value: Any) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return ""
    if "nps.gov" not in parsed.netloc.lower():
        return ""
    parts = [part for part in parsed.path.split("/") if part]
    if not parts:
        return ""
    first = parts[0].strip().lower()
    if 2 <= len(first) <= 8 and first.isalnum() and first not in {"subjects", "places", "articles"}:
        return first
    return ""


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for idx in range(0, len(values), max(size, 1)):
        yield values[idx:idx + max(size, 1)]


def slug_part(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")[:80] or "all"


def as_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except Exception:
        return None
