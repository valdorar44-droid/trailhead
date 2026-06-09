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

PAID_OR_FRAGILE_PROVIDERS = {"elevenlabs", "anthropic"}
HOSTED_LIGHTWEIGHT_PROVIDERS = {"locationiq"}
LIVE_FREE_PROVIDERS = {"nps", "ridb", "blm", "usfs", "wikimedia", "wikipedia", "overpass", "nominatim", "mapbox", "active", "fcc"}
OWNED_FREE_PROVIDERS = {"trailhead", "community", "osm", "openstreetmap", "overture", "offline", "place_pack", "explore"}

PROVIDER_BUDGETS: dict[tuple[str, str], tuple[int, int]] = {
    ("active", "campgrounds"): (2, 1),
    ("active", "activities"): (5, 1),
    ("fcc", "vizmo"): (8, 1),
}


def source_tier_for_provider(provider: str) -> str:
    clean = str(provider or "").strip().lower()
    if clean in PAID_OR_FRAGILE_PROVIDERS:
        return "paid_gated"
    if clean in HOSTED_LIGHTWEIGHT_PROVIDERS:
        return "hosted_lightweight"
    if clean in LIVE_FREE_PROVIDERS:
        return "live_free"
    if clean in OWNED_FREE_PROVIDERS:
        return "free_auto"
    return "unknown"


def provider_budget_available(provider: str, endpoint: str) -> bool:
    provider_key = str(provider or "").strip().lower()
    endpoint_key = str(endpoint or "").strip().lower()
    budget = PROVIDER_BUDGETS.get((provider_key, endpoint_key))
    if not budget:
        return True
    max_calls, window_seconds = budget
    if max_calls <= 0:
        return False
    now = time.time()
    used = sum(
        1 for call in _RECENT_CALLS
        if call.get("provider") == provider_key
        and call.get("endpoint") == endpoint_key
        and str(call.get("cache_status") or "miss") == "miss"
        and now - float(call.get("ts") or 0) <= window_seconds
    )
    return used < max_calls


def record_provider_call(
    provider: str,
    endpoint: str,
    *,
    status_code: int | None = None,
    duration_ms: int | None = None,
    cache_status: str = "miss",
    source_action: str = "",
    premium_fields: bool = False,
    source_tier: str = "",
    key: str = "",
) -> None:
    provider_key = str(provider or "unknown").strip().lower()
    _RECENT_CALLS.append({
        "ts": round(time.time(), 3),
        "provider": provider_key,
        "endpoint": endpoint,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "cache_status": cache_status,
        "source_action": source_action,
        "premium_fields": premium_fields,
        "source_tier": source_tier or source_tier_for_provider(provider_key),
        "key": key[:160],
    })


def provider_call_snapshot(limit: int = 100) -> dict[str, Any]:
    limit = max(1, min(int(limit or 100), 500))
    calls = list(_RECENT_CALLS)[-limit:]
    by_provider = Counter(str(c.get("provider") or "unknown") for c in calls)
    by_action = Counter(f"{c.get('provider') or 'unknown'}:{c.get('endpoint') or 'unknown'}" for c in calls)
    by_tier = Counter(str(c.get("source_tier") or "unknown") for c in calls)
    premium = sum(1 for c in calls if c.get("premium_fields"))
    cache_hits = sum(1 for c in calls if c.get("cache_status") == "hit")
    budget_risk = []
    now = time.time()
    for (provider, endpoint), (max_calls, window_seconds) in PROVIDER_BUDGETS.items():
        used = sum(
            1 for c in _RECENT_CALLS
            if c.get("provider") == provider
            and c.get("endpoint") == endpoint
            and str(c.get("cache_status") or "miss") == "miss"
            and now - float(c.get("ts") or 0) <= window_seconds
        )
        budget_risk.append({
            "provider": provider,
            "action": endpoint,
            "used": used,
            "limit": max_calls,
            "window_seconds": window_seconds,
            "blocked": max_calls <= 0 or used >= max_calls,
            "source_tier": source_tier_for_provider(provider),
        })
    return {
        "total": len(calls),
        "premium": premium,
        "cache_hits": cache_hits,
        "by_provider": dict(by_provider),
        "by_action": dict(by_action),
        "by_tier": dict(by_tier),
        "budget_risk": budget_risk,
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
    source_tier: str = "",
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
            source_tier=source_tier,
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
            source_tier=source_tier,
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
