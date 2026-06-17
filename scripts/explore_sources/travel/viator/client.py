from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


DEFAULT_BASE_URL = "https://api.viator.com/partner"


@dataclass
class ViatorConfig:
    api_key: str = ""
    partner_id: str = ""
    affiliate_id: str = ""
    base_url: str = DEFAULT_BASE_URL
    enable_live: bool = False
    cache_ttl_hours: int = 24


def config_from_env(env: dict[str, str] | None = None) -> ViatorConfig:
    values = env or os.environ
    return ViatorConfig(
        api_key=values.get("VIATOR_API_KEY", "").strip(),
        partner_id=values.get("VIATOR_PARTNER_ID", "").strip(),
        affiliate_id=values.get("VIATOR_AFFILIATE_ID", "").strip(),
        base_url=values.get("VIATOR_API_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        enable_live=str(values.get("VIATOR_ENABLE_LIVE", "false")).lower() in {"1", "true", "yes", "on"},
        cache_ttl_hours=int(values.get("VIATOR_CACHE_TTL_HOURS", "24") or 24),
    )


class ViatorClient:
    def __init__(self, config: ViatorConfig | None = None, opener=None):
        self.config = config or config_from_env()
        self.opener = opener or urllib.request.urlopen

    def ready(self) -> bool:
        return bool(self.config.api_key and self.config.enable_live)

    def search_products(
        self,
        *,
        destination_id: str = "",
        tags: list[int] | None = None,
        flags: list[str] | None = None,
        start_date: str = "",
        end_date: str = "",
        sort: str = "REVIEW_AVG_RATING_D",
        order: str = "DESCENDING",
        count: int = 12,
        currency: str = "USD",
        timeout: float = 20.0,
    ) -> dict[str, Any]:
        if not self.ready():
            return {"products": [], "status": "disabled", "reason": "VIATOR_API_KEY missing or VIATOR_ENABLE_LIVE=false"}
        filtering: dict[str, Any] = {}
        if destination_id:
            filtering["destination"] = str(destination_id)
        if tags:
            filtering["tags"] = tags
        if flags:
            filtering["flags"] = flags
        if start_date:
            filtering["startDate"] = start_date
        if end_date:
            filtering["endDate"] = end_date
        payload = {
            "filtering": filtering,
            "sorting": {"sort": sort, "order": order},
            "pagination": {"start": 1, "count": max(1, min(int(count), 50))},
            "currency": currency,
        }
        return self._post_json("/products/search", payload, timeout=timeout)

    def _post_json(self, path: str, payload: dict[str, Any], timeout: float = 20.0) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.config.base_url}{path}",
            data=body,
            method="POST",
            headers={
                "Accept-Language": "en-US",
                "Content-Type": "application/json",
                "Accept": "application/json;version=2.0",
                "exp-api-key": self.config.api_key,
                "User-Agent": "Trailhead/1.0 ViatorBasicAccess",
            },
        )
        try:
            with self.opener(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            return {"products": [], "status": "error", "reason": str(exc), "fetched_at": int(time.time())}

