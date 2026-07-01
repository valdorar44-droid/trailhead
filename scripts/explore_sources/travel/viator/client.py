from __future__ import annotations

import json
import os
import gzip
import socket
import time
import urllib.error
import urllib.parse
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
    enable_booking: bool = False
    cache_ttl_hours: int = 1
    request_timeout_seconds: float = 120.0
    page_size: int = 24


def config_from_env(env: dict[str, str] | None = None) -> ViatorConfig:
    values = env or os.environ
    return ViatorConfig(
        api_key=values.get("VIATOR_API_KEY", "").strip(),
        partner_id=values.get("VIATOR_PARTNER_ID", "").strip(),
        affiliate_id=values.get("VIATOR_AFFILIATE_ID", "").strip(),
        base_url=values.get("VIATOR_API_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        enable_live=str(values.get("VIATOR_ENABLE_LIVE", "false")).lower() in {"1", "true", "yes", "on"},
        enable_booking=str(values.get("VIATOR_ENABLE_BOOKING", "false")).lower() in {"1", "true", "yes", "on"},
        cache_ttl_hours=max(1, min(int(values.get("VIATOR_CACHE_TTL_HOURS", "1") or 1), 1)),
        request_timeout_seconds=max(2.0, min(float(values.get("VIATOR_TIMEOUT_SECONDS", "120") or 120), 120.0)),
        page_size=max(1, min(int(values.get("VIATOR_PAGE_SIZE", "24") or 24), 50)),
    )


class ViatorClient:
    def __init__(self, config: ViatorConfig | None = None, opener=None):
        self.config = config or config_from_env()
        self.opener = opener or urllib.request.urlopen

    def ready(self) -> bool:
        return bool(self.config.api_key and self.config.enable_live)

    def booking_ready(self) -> bool:
        return bool(self.ready() and self.config.enable_booking)

    def search_products(
        self,
        *,
        destination_id: str = "",
        tags: list[int] | None = None,
        flags: list[str] | None = None,
        start_date: str = "",
        end_date: str = "",
        lowest_price: float | None = None,
        highest_price: float | None = None,
        sort: str = "TRAVELER_RATING",
        order: str = "DESCENDING",
        count: int = 12,
        start: int = 1,
        currency: str = "USD",
        timeout: float | None = None,
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
        if lowest_price is not None:
            filtering["lowestPrice"] = float(lowest_price)
        if highest_price is not None:
            filtering["highestPrice"] = float(highest_price)
        payload = {
            "filtering": filtering,
            "sorting": {"sort": sort, "order": order},
            "pagination": {"start": max(1, int(start or 1)), "count": max(1, min(int(count), 50))},
            "currency": currency,
        }
        return self._post_json("/products/search", payload, timeout=timeout or self.config.request_timeout_seconds)

    def search_freetext(
        self,
        *,
        search_term: str,
        search_type: str = "PRODUCTS",
        count: int = 12,
        start: int = 1,
        currency: str = "USD",
        timeout: float | None = None,
    ) -> dict[str, Any]:
        if not self.ready():
            return {"products": [], "status": "disabled", "reason": "VIATOR_API_KEY missing or VIATOR_ENABLE_LIVE=false"}
        term = search_term.strip()
        if not term:
            return {"products": [], "status": "empty", "reason": "search_term missing"}
        payload = {
            "searchTerm": term,
            "currency": currency,
            "searchTypes": [
                {
                    "searchType": search_type,
                    "pagination": {"start": max(1, int(start or 1)), "count": max(1, min(int(count), 50))},
                }
            ],
        }
        return self._post_json("/search/freetext", payload, timeout=timeout or self.config.request_timeout_seconds)

    def get_destinations(self, *, timeout: float | None = None) -> dict[str, Any]:
        if not self.ready():
            return {"destinations": [], "status": "disabled", "reason": "VIATOR_API_KEY missing or VIATOR_ENABLE_LIVE=false"}
        return self._get_json("/destinations", timeout=timeout or self.config.request_timeout_seconds)

    def get_product(self, product_code: str, *, timeout: float | None = None) -> dict[str, Any]:
        if not self.ready():
            return {"status": "disabled", "reason": "VIATOR_API_KEY missing or VIATOR_ENABLE_LIVE=false"}
        code = self._path_token(product_code)
        if not code:
            return {"status": "empty", "reason": "product_code missing"}
        return self._get_json(f"/products/{code}", timeout=timeout or self.config.request_timeout_seconds)

    def get_availability_schedule(self, product_code: str, *, currency: str = "USD", timeout: float | None = None) -> dict[str, Any]:
        if not self.ready():
            return {"status": "disabled", "reason": "VIATOR_API_KEY missing or VIATOR_ENABLE_LIVE=false"}
        code = self._path_token(product_code)
        if not code:
            return {"status": "empty", "reason": "product_code missing"}
        params = self._query({"currency": currency or "USD"})
        return self._get_json(f"/availability/schedules/{code}{params}", timeout=timeout or self.config.request_timeout_seconds)

    def get_booking_questions(self, *, product_code: str = "", timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/products/booking-questions")
        params = self._query({"productCode": product_code} if product_code else {})
        return self._get_json(f"/products/booking-questions{params}", timeout=timeout or self.config.request_timeout_seconds)

    def check_availability(self, payload: dict[str, Any], *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/availability/check")
        return self._post_json("/availability/check", payload, timeout=timeout or self.config.request_timeout_seconds)

    def cart_hold(self, payload: dict[str, Any], *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/cart/hold")
        return self._post_json("/bookings/cart/hold", payload, timeout=timeout or self.config.request_timeout_seconds)

    def cart_book(self, payload: dict[str, Any], *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/cart/book")
        return self._post_json("/bookings/cart/book", payload, timeout=timeout or self.config.request_timeout_seconds)

    def checkout_payment_accounts(self, session_token: str, payload: dict[str, Any], *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/v1/checkoutsessions/{sessionToken}/paymentaccounts")
        token = self._path_token(session_token)
        if not token:
            return {"status": "empty", "reason": "session_token missing"}
        return self._post_json(f"/v1/checkoutsessions/{token}/paymentaccounts", payload, timeout=timeout or self.config.request_timeout_seconds)

    def booking_status(self, payload: dict[str, Any], *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/status")
        return self._post_json("/bookings/status", payload, timeout=timeout or self.config.request_timeout_seconds)

    def get_cancel_reasons(self, *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/cancel-reasons")
        return self._get_json("/bookings/cancel-reasons", timeout=timeout or self.config.request_timeout_seconds)

    def cancel_quote(self, booking_reference: str, payload: dict[str, Any] | None = None, *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/{booking-reference}/cancel-quote")
        ref = self._path_token(booking_reference)
        if not ref:
            return {"status": "empty", "reason": "booking_reference missing"}
        params = self._query(payload or {})
        return self._get_json(f"/bookings/{ref}/cancel-quote{params}", timeout=timeout or self.config.request_timeout_seconds)

    def cancel_booking(self, booking_reference: str, payload: dict[str, Any] | None = None, *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/{booking-reference}/cancel")
        ref = self._path_token(booking_reference)
        if not ref:
            return {"status": "empty", "reason": "booking_reference missing"}
        return self._post_json(f"/bookings/{ref}/cancel", payload or {}, timeout=timeout or self.config.request_timeout_seconds)

    def bookings_modified_since(self, *, cursor: str = "", modified_since: str = "", timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/modified-since")
        params = self._query({"cursor": cursor, "modifiedSince": modified_since})
        return self._get_json(f"/bookings/modified-since{params}", timeout=timeout or self.config.request_timeout_seconds)

    def acknowledge_modified_since(self, payload: dict[str, Any], *, timeout: float | None = None) -> dict[str, Any]:
        if not self.booking_ready():
            return self._booking_disabled_payload("/bookings/modified-since/acknowledge")
        return self._post_json("/bookings/modified-since/acknowledge", payload, timeout=timeout or self.config.request_timeout_seconds)

    def _headers(self) -> dict[str, str]:
        return {
            "Accept-Language": "en-US",
            "Content-Type": "application/json;version=2.0",
            "Accept": "application/json;version=2.0",
            "Accept-Encoding": "gzip",
            "exp-api-key": self.config.api_key,
            "User-Agent": "Trailhead/1.0 ViatorPartnerAPI",
        }

    def _post_json(self, path: str, payload: dict[str, Any], timeout: float = 20.0) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.config.base_url}{path}",
            data=body,
            method="POST",
            headers=self._headers(),
        )
        return self._open_json(request, path=path, timeout=timeout)

    def _get_json(self, path: str, timeout: float = 20.0) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self.config.base_url}{path}",
            method="GET",
            headers=self._headers(),
        )
        return self._open_json(request, path=path, timeout=timeout)

    def _booking_disabled_payload(self, endpoint: str) -> dict[str, Any]:
        return {
            "status": "disabled",
            "endpoint": endpoint,
            "reason": "VIATOR_ENABLE_BOOKING=false or booking endpoint access is not enabled",
            "fetched_at": int(time.time()),
        }

    @staticmethod
    def _path_token(value: str) -> str:
        return urllib.parse.quote(str(value or "").strip(), safe="")

    @staticmethod
    def _query(params: dict[str, Any]) -> str:
        clean = {key: value for key, value in params.items() if value not in {None, ""}}
        return f"?{urllib.parse.urlencode(clean)}" if clean else ""

    def _open_json(self, request: urllib.request.Request, *, path: str, timeout: float = 20.0) -> dict[str, Any]:
        try:
            with self.opener(request, timeout=timeout) as response:
                parsed = self._decode_response_json(response)
                if isinstance(parsed, dict):
                    parsed.setdefault("status", "ok")
                    parsed.setdefault("fetched_at", int(time.time()))
                    parsed.setdefault("endpoint", path)
                    tracking_id = self._header_value(response.headers, "X-Unique-ID") or self._header_value(
                        response.headers,
                        "X-Request-ID",
                    )
                    if tracking_id:
                        parsed.setdefault("tracking_id", tracking_id)
                    return parsed
                return {"status": "ok", "endpoint": path, "data": parsed, "fetched_at": int(time.time())}
        except urllib.error.HTTPError as exc:
            return self._http_error_payload(exc, path=path)
        except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as exc:
            timed_out = isinstance(exc, (TimeoutError, socket.timeout)) or "timed out" in str(exc).lower()
            return {
                "products": [],
                "status": "timeout" if timed_out else "error",
                "endpoint": path,
                "reason": str(exc),
                "fetched_at": int(time.time()),
            }

    def _decode_response_json(self, response: Any) -> Any:
        raw = response.read()
        encoding = self._header_value(response.headers, "Content-Encoding").lower()
        if "gzip" in encoding:
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))

    def _http_error_payload(self, exc: urllib.error.HTTPError, *, path: str) -> dict[str, Any]:
        body_text = ""
        body_json: dict[str, Any] = {}
        try:
            raw = exc.read()
            if "gzip" in self._header_value(exc.headers, "Content-Encoding").lower():
                raw = gzip.decompress(raw)
            body_text = raw.decode("utf-8")
            parsed = json.loads(body_text) if body_text else {}
            if isinstance(parsed, dict):
                body_json = parsed
        except Exception:
            body_json = {}
        tracking_id = (
            body_json.get("trackingId")
            or body_json.get("tracking_id")
            or self._header_value(exc.headers, "X-Unique-ID")
            or self._header_value(exc.headers, "X-Request-ID")
        )
        message = (
            body_json.get("message")
            or body_json.get("errorMessage")
            or body_json.get("error")
            or body_text[:240]
            or str(exc)
        )
        code = body_json.get("code") or body_json.get("errorCode")
        return {
            "products": [],
            "status": "error",
            "endpoint": path,
            "reason": message,
            "http_status": exc.code,
            "provider_code": code,
            "provider_message": message,
            "tracking_id": tracking_id,
            "fetched_at": int(time.time()),
        }

    @staticmethod
    def _header_value(headers: Any, name: str) -> str:
        if not headers:
            return ""
        getter = getattr(headers, "get", None)
        if callable(getter):
            value = getter(name) or getter(name.lower()) or getter(name.upper())
            return str(value or "")
        try:
            return str(headers[name] or "")
        except Exception:
            return ""
