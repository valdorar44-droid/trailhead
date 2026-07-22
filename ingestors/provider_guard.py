"""Runtime-only provider telemetry, coalescing, and short caches.

This module intentionally stores data in memory only. It is safe for vendor
content that should not be persisted, while still preventing duplicate calls
when the app opens the same card repeatedly in one session.
"""
from __future__ import annotations

import asyncio
import os
import time
from collections import Counter, OrderedDict, deque
from threading import Lock
from typing import Any, Awaitable, Callable

_RECENT_CALLS: deque[dict[str, Any]] = deque(maxlen=500)
_RUNTIME_CACHE: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_IN_FLIGHT: dict[str, asyncio.Task] = {}
_BUDGET_RESERVATIONS: dict[tuple[str, str], deque[float]] = {}
_BUDGET_LOCK = Lock()

PAID_OR_FRAGILE_PROVIDERS = {"elevenlabs", "anthropic"}
HOSTED_LIGHTWEIGHT_PROVIDERS = {"locationiq"}
LIVE_FREE_PROVIDERS = {
    "nps", "ridb", "blm", "usfs", "wikimedia", "wikipedia", "overpass",
    "nominatim", "mapbox", "active", "fcc", "nz_doc",
    "australia_open_data", "canada_open_data",
}
OWNED_FREE_PROVIDERS = {"trailhead", "community", "osm", "openstreetmap", "overture", "offline", "place_pack", "explore"}

def _bounded_env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


PROVIDER_BUDGETS: dict[tuple[str, str], tuple[int, int]] = {
    ("active", "campgrounds"): (2, 1),
    ("active", "activities"): (5, 1),
    ("fcc", "vizmo"): (8, 1),
    # Geoapify's published free-plan ceiling is 5 geocoding requests/second.
    # Leave headroom for other workloads sharing the same account and clamp an
    # operator override below that ceiling. Zero remains an intentional kill
    # switch. Places retains its existing, independently managed behavior.
    ("geoapify", "autocomplete"): (
        _bounded_env_int(
            "GEOAPIFY_AUTOCOMPLETE_MAX_REQUESTS_PER_SECOND",
            4,
            minimum=0,
            maximum=4,
        ),
        1,
    ),
}


def _prune_runtime_cache(
    now: float,
    *,
    namespace: str = "",
    max_entries: int | None = None,
) -> None:
    """Remove expired entries and enforce an optional namespace-local LRU cap."""
    for cache_key, (expires_at, _value) in list(_RUNTIME_CACHE.items()):
        if expires_at <= now:
            _RUNTIME_CACHE.pop(cache_key, None)

    if max_entries is None:
        return
    normalized_max = max(0, int(max_entries))
    matching_keys = [
        cache_key for cache_key in _RUNTIME_CACHE
        if not namespace or cache_key.startswith(namespace)
    ]
    for cache_key in matching_keys[:max(0, len(matching_keys) - normalized_max)]:
        _RUNTIME_CACHE.pop(cache_key, None)


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


def _budget_usage_locked(
    provider_key: str,
    endpoint_key: str,
    *,
    now: float,
    window_seconds: int,
) -> tuple[int, deque[float]]:
    reservation_key = (provider_key, endpoint_key)
    reservations = _BUDGET_RESERVATIONS.setdefault(reservation_key, deque())
    while reservations and now - reservations[0] > window_seconds:
        reservations.popleft()
    completed_without_reservation = sum(
        1 for call in _RECENT_CALLS
        if call.get("provider") == provider_key
        and call.get("endpoint") == endpoint_key
        and str(call.get("cache_status") or "miss") == "miss"
        and not bool(call.get("budget_reserved"))
        and now - float(call.get("ts") or 0) <= window_seconds
    )
    return completed_without_reservation + len(reservations), reservations


def provider_budget_available(
    provider: str,
    endpoint: str,
    *,
    reserve: bool = False,
) -> bool:
    """Check a provider window and optionally reserve one outbound attempt.

    Callers that can run concurrently must reserve before making the network
    request. The reservation remains for the window even after completion, so
    successes and failures consume exactly one slot rather than being counted
    once at admission and again in telemetry.
    """
    provider_key = str(provider or "").strip().lower()
    endpoint_key = str(endpoint or "").strip().lower()
    budget = PROVIDER_BUDGETS.get((provider_key, endpoint_key))
    if not budget:
        return True
    max_calls, window_seconds = budget
    if max_calls <= 0:
        return False
    now = time.time()
    with _BUDGET_LOCK:
        used, reservations = _budget_usage_locked(
            provider_key,
            endpoint_key,
            now=now,
            window_seconds=window_seconds,
        )
        if used >= max_calls:
            return False
        if reserve:
            reservations.append(now)
        return True


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
    budget_reserved: bool = False,
) -> None:
    provider_key = str(provider or "unknown").strip().lower()
    call = {
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
    }
    if budget_reserved:
        call["budget_reserved"] = True
    with _BUDGET_LOCK:
        _RECENT_CALLS.append(call)


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
        with _BUDGET_LOCK:
            used, _reservations = _budget_usage_locked(
                provider,
                endpoint,
                now=now,
                window_seconds=window_seconds,
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
    max_entries: int | None = None,
    cache_namespace: str = "",
) -> Any:
    now = time.time()
    _prune_runtime_cache(
        now,
        namespace=cache_namespace,
        max_entries=max_entries,
    )
    cached = _RUNTIME_CACHE.get(key)
    if cached and cached[0] > now:
        _RUNTIME_CACHE.move_to_end(key)
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
            _RUNTIME_CACHE.move_to_end(key)
            _prune_runtime_cache(
                time.time(),
                namespace=cache_namespace,
                max_entries=max_entries,
            )
        return value
    finally:
        _IN_FLIGHT.pop(key, None)
