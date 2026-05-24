"""Runtime-only provider telemetry, coalescing, and short caches.

This module intentionally stores data in memory only. It is safe for vendor
content that should not be persisted, while still preventing duplicate calls
when the app opens the same card repeatedly in one session.
"""
from __future__ import annotations

import asyncio
import time
from collections import Counter, deque
from typing import Any, Awaitable, Callable

_RECENT_CALLS: deque[dict[str, Any]] = deque(maxlen=500)
_RUNTIME_CACHE: dict[str, tuple[float, Any]] = {}
_IN_FLIGHT: dict[str, asyncio.Task] = {}


def record_provider_call(
    provider: str,
    endpoint: str,
    *,
    status_code: int | None = None,
    duration_ms: int | None = None,
    cache_status: str = "miss",
    source_action: str = "",
    premium_fields: bool = False,
    key: str = "",
) -> None:
    _RECENT_CALLS.append({
        "ts": round(time.time(), 3),
        "provider": provider,
        "endpoint": endpoint,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "cache_status": cache_status,
        "source_action": source_action,
        "premium_fields": premium_fields,
        "key": key[:160],
    })


def provider_call_snapshot(limit: int = 100) -> dict[str, Any]:
    limit = max(1, min(int(limit or 100), 500))
    calls = list(_RECENT_CALLS)[-limit:]
    by_provider = Counter(str(c.get("provider") or "unknown") for c in calls)
    premium = sum(1 for c in calls if c.get("premium_fields"))
    cache_hits = sum(1 for c in calls if c.get("cache_status") == "hit")
    return {
        "total": len(calls),
        "premium": premium,
        "cache_hits": cache_hits,
        "by_provider": dict(by_provider),
        "calls": calls,
    }


async def runtime_cached_call(
    key: str,
    ttl_seconds: int,
    factory: Callable[[], Awaitable[Any]],
    *,
    provider: str,
    endpoint: str,
    source_action: str = "",
    premium_fields: bool = False,
    cache_empty: bool = True,
) -> Any:
    now = time.time()
    cached = _RUNTIME_CACHE.get(key)
    if cached and cached[0] > now:
        record_provider_call(
            provider,
            endpoint,
            cache_status="hit",
            source_action=source_action,
            premium_fields=premium_fields,
            key=key,
        )
        return cached[1]

    task = _IN_FLIGHT.get(key)
    if task:
        record_provider_call(
            provider,
            endpoint,
            cache_status="in_flight",
            source_action=source_action,
            premium_fields=premium_fields,
            key=key,
        )
        return await task

    task = asyncio.create_task(factory())
    _IN_FLIGHT[key] = task
    try:
        value = await task
        is_empty = value is None or value == [] or value == {}
        if ttl_seconds > 0 and (cache_empty or not is_empty):
            _RUNTIME_CACHE[key] = (time.time() + ttl_seconds, value)
        return value
    finally:
        _IN_FLIGHT.pop(key, None)
