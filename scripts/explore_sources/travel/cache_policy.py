from __future__ import annotations

import time
from enum import StrEnum


class CachePolicy(StrEnum):
    PARTNER_API_INGEST = "partner_api_ingest"
    LIVE_ONLY = "live_only"
    OPEN_CACHE = "open_cache"
    RESEARCH_SNAPSHOT = "research_snapshot"
    SOURCE_LINK_ONLY = "source_link_only"


def ttl_seconds(active: bool = True, ttl_hours: int = 24) -> int:
    if active:
        return max(1, int(ttl_hours)) * 3600
    return 7 * 24 * 3600


def expires_at(fetched_at: int | None = None, active: bool = True, ttl_hours: int = 24) -> int:
    return int(fetched_at or time.time()) + ttl_seconds(active=active, ttl_hours=ttl_hours)


def is_expired(expires: int | None, now: int | None = None) -> bool:
    if not expires:
        return True
    return int(expires) <= int(now or time.time())

