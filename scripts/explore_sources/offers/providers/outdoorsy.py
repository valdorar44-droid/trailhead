from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from scripts.explore_sources.offers.disclosure import (
    PARTNER_BOOKING_DISCLOSURE_KIND,
    PARTNER_BOOKING_DISCLOSURE_LABEL,
)
from scripts.explore_sources.offers.providers.base import OfferProvider, OfferSearchQuery, OfferSearchResult
from scripts.explore_sources.offers.ranking import rank_offers
from scripts.explore_sources.offers.schema import OutdoorOffer, OutdoorOfferImage, normalize_offer_type


ALLOWED_PROVIDER_STATES = {
    "disabled",
    "fixture_only",
    "configured_affiliate_link",
    "live_read_only",
    "live_external_checkout",
    "future_booking",
}

ERROR_STATUSES = {"auth_error", "rate_limited", "transient_error", "malformed_response"}
TRACKING_TOKEN_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def _bool_env(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_int(value: object, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _safe_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return None


@dataclass
class OutdoorsyConfig:
    tune_network_id: str = ""
    tune_api_key: str = ""
    tune_api_base_url: str = ""
    tune_tracking_base_url: str = ""
    tune_affiliate_id: str = ""
    tune_offer_id: str = ""
    tune_rv_search_url_id: str = ""
    tune_source: str = "trailhead"
    enable_live: bool = False
    provider_state: str = "disabled"
    request_timeout_seconds: int = 12
    cache_ttl_seconds: int = 900
    fixture_mode: bool = False
    fixture_path: str = ""

    def normalized_state(self) -> str:
        state = str(self.provider_state or "disabled").strip().lower()
        return state if state in ALLOWED_PROVIDER_STATES else "disabled"

    def has_affiliate_credentials(self) -> bool:
        return bool(self.tune_network_id and self.tune_api_key)

    def has_offer_id(self) -> bool:
        return bool(_tracking_token(self.tune_offer_id))

    def has_direct_tracking_config(self) -> bool:
        return bool(self.has_offer_id() and _tracking_token(self.tune_affiliate_id) and _tracking_base_url(self))

    def live_inventory_allowed(self) -> bool:
        return False


def config_from_env(env: dict[str, str] | None = None) -> OutdoorsyConfig:
    values = env or os.environ
    return OutdoorsyConfig(
        tune_network_id=str(values.get("OUTDOORSY_TUNE_NETWORK_ID", "")).strip(),
        tune_api_key=str(values.get("OUTDOORSY_TUNE_API_KEY", "")).strip(),
        tune_api_base_url=str(values.get("OUTDOORSY_TUNE_API_BASE_URL", "")).strip().rstrip("/"),
        tune_tracking_base_url=str(values.get("OUTDOORSY_TUNE_TRACKING_BASE_URL", "")).strip().rstrip("/"),
        tune_affiliate_id=str(values.get("OUTDOORSY_TUNE_AFFILIATE_ID", "")).strip(),
        tune_offer_id=str(values.get("OUTDOORSY_TUNE_OFFER_ID", "")).strip(),
        tune_rv_search_url_id=str(values.get("OUTDOORSY_TUNE_RV_SEARCH_URL_ID", "")).strip(),
        tune_source=str(values.get("OUTDOORSY_TUNE_SOURCE", "trailhead")).strip() or "trailhead",
        enable_live=_bool_env(values.get("OUTDOORSY_ENABLE_LIVE", "false")),
        provider_state=str(values.get("OUTDOORSY_PROVIDER_STATE", "disabled")).strip().lower(),
        request_timeout_seconds=_safe_int(values.get("OUTDOORSY_REQUEST_TIMEOUT_SECONDS", "12"), 12, 1, 30),
        cache_ttl_seconds=_safe_int(values.get("OUTDOORSY_CACHE_TTL_SECONDS", "900"), 900, 60, 3600),
        fixture_mode=_bool_env(values.get("OUTDOORSY_FIXTURE_MODE", "false")),
        fixture_path=str(values.get("OUTDOORSY_FIXTURE_PATH", "")).strip(),
    )


def _tracking_token(value: object, max_len: int = 120) -> str:
    text = str(value or "").strip()
    text = TRACKING_TOKEN_RE.sub("", text)
    return text[:max_len]


def _tracking_base_url(config: OutdoorsyConfig) -> str:
    explicit = str(config.tune_tracking_base_url or "").strip().rstrip("/")
    if explicit:
        parsed = urlparse(explicit)
        if parsed.scheme == "https" and parsed.netloc:
            return explicit
        return ""
    network_id = _tracking_token(config.tune_network_id, 80).lower()
    if not network_id:
        return ""
    return f"https://{network_id}.go2cloud.org/aff_c"


def _tune_api_base_url(config: OutdoorsyConfig) -> str:
    explicit = str(config.tune_api_base_url or "").strip().rstrip("/")
    if explicit:
        parsed = urlparse(explicit)
        if parsed.scheme == "https" and parsed.netloc:
            return explicit
        return ""
    network_id = _tracking_token(config.tune_network_id, 80).lower()
    if not network_id:
        return ""
    return f"https://{network_id}.api.hasoffers.com/Apiv3/json"


def _tracking_params(config: OutdoorsyConfig) -> dict[str, str]:
    params = {
        "offer_id": _tracking_token(config.tune_offer_id, 40),
        "source": _tracking_token(config.tune_source, 120),
    }
    url_id = _tracking_token(config.tune_rv_search_url_id, 40)
    if url_id:
        params["url_id"] = url_id
    return {key: value for key, value in params.items() if value}


def _build_direct_tracking_url(config: OutdoorsyConfig) -> str:
    base_url = _tracking_base_url(config)
    offer_id = _tracking_token(config.tune_offer_id, 40)
    affiliate_id = _tracking_token(config.tune_affiliate_id, 40)
    if not base_url or not offer_id or not affiliate_id:
        return ""
    params = {"offer_id": offer_id, "aff_id": affiliate_id}
    for key, value in _tracking_params(config).items():
        if key != "offer_id":
            params[key] = value
    return f"{base_url}?{urlencode(params)}"


def _extract_tracking_url(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    response = payload.get("response") if isinstance(payload.get("response"), dict) else {}
    data = response.get("data") if isinstance(response.get("data"), dict) else {}
    for key in ("universal_tracking_link", "click_url"):
        value = str(data.get(key) or "").strip()
        parsed = urlparse(value)
        hostname = str(parsed.hostname or "").lower()
        if parsed.scheme == "https" and (hostname == "go2cloud.org" or hostname.endswith(".go2cloud.org")):
            return value[:2000]
    return ""


def _generate_tune_tracking_url(config: OutdoorsyConfig) -> str:
    if not config.enable_live or not config.has_affiliate_credentials() or not config.has_offer_id():
        return ""
    endpoint = _tune_api_base_url(config)
    if not endpoint:
        return ""
    form: dict[str, str] = {
        "NetworkId": _tracking_token(config.tune_network_id, 80),
        "api_key": config.tune_api_key,
        "Target": "Affiliate_Offer",
        "Method": "generateTrackingLink",
        "offer_id": _tracking_token(config.tune_offer_id, 40),
    }
    for key, value in _tracking_params(config).items():
        if key != "offer_id":
            form[f"params[{key}]"] = value
    body = urlencode(form).encode("utf-8")
    request = Request(endpoint, data=body, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urlopen(request, timeout=config.request_timeout_seconds) as response:
            return _extract_tracking_url(json.loads(response.read().decode("utf-8")))
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError):
        return ""


def _generic_search_offer(config: OutdoorsyConfig, query: OfferSearchQuery, *, fetched_at: int) -> OutdoorOffer | None:
    affiliate_url = _generate_tune_tracking_url(config) or _build_direct_tracking_url(config)
    if not affiliate_url:
        return None
    ttl_seconds = config.cache_ttl_seconds
    pickup_area = "Starting area" if query.lat is not None and query.lng is not None else "Trip start"
    return OutdoorOffer(
        id="outdoorsy:rv-search",
        provider="outdoorsy",
        provider_offer_id="rv-search",
        type="vehicle_rental",
        title="Search campervans and RVs",
        summary="Rental options open with Outdoorsy.",
        pickup_area=pickup_area,
        booking_url=affiliate_url,
        affiliate_url=affiliate_url,
        source_freshness="Outdoorsy search link",
        fetched_at=fetched_at,
        expires_at=fetched_at + ttl_seconds,
        disclosure_kind=PARTNER_BOOKING_DISCLOSURE_KIND,
        disclosure_label=PARTNER_BOOKING_DISCLOSURE_LABEL,
        external_checkout_status="unconfirmed",
    )


def _image_from_record(value: object) -> OutdoorOfferImage | None:
    if isinstance(value, str):
        url = value.strip()
        return OutdoorOfferImage(url=url) if url else None
    if not isinstance(value, dict):
        return None
    url = str(value.get("url") or "").strip()
    if not url:
        return None
    return OutdoorOfferImage(
        url=url,
        caption=str(value.get("caption") or "").strip(),
        credit=str(value.get("credit") or "").strip(),
        license=str(value.get("license") or "").strip(),
    )


def _pickup_area(record: dict[str, Any]) -> str:
    pickup = record.get("pickup") if isinstance(record.get("pickup"), dict) else {}
    direct = str(record.get("pickup_area") or "").strip()
    if direct:
        return direct[:120]
    city = str(pickup.get("city") or "").strip()
    region = str(pickup.get("region") or "").strip()
    return ", ".join(part for part in (city, region) if part)[:120]


def _approximate_coords(record: dict[str, Any]) -> tuple[float | None, float | None]:
    pickup = record.get("pickup") if isinstance(record.get("pickup"), dict) else {}
    precision = str(pickup.get("precision") or record.get("coordinate_precision") or "").strip().lower()
    if precision not in {"approximate", "area", "city", "market"}:
        return None, None
    lat = _safe_float(pickup.get("lat", record.get("approximate_lat")))
    lng = _safe_float(pickup.get("lng", record.get("approximate_lng")))
    if lat is None or lng is None or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        return None, None
    return round(lat, 4), round(lng, 4)


def _list_of_text(value: object, limit: int = 20) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text[:80])
        if len(out) >= limit:
            break
    return out


def normalize_outdoorsy_offer(record: dict[str, Any], *, fetched_at: int, ttl_seconds: int) -> OutdoorOffer | None:
    if not isinstance(record, dict):
        return None
    provider_offer_id = str(record.get("id") or record.get("provider_offer_id") or "").strip()
    title = str(record.get("title") or "").strip()
    if not provider_offer_id or not title:
        return None

    pricing = record.get("pricing") if isinstance(record.get("pricing"), dict) else {}
    availability = record.get("availability") if isinstance(record.get("availability"), dict) else {}
    lat, lng = _approximate_coords(record)
    images = [_image_from_record(item) for item in (record.get("images") or [])]
    clean_images = [image for image in images if image is not None]
    offer_type = normalize_offer_type(record.get("type") or record.get("vehicle_type"))
    source_freshness = str(record.get("source_freshness") or "Fixture data").strip()

    return OutdoorOffer(
        id=f"outdoorsy:{provider_offer_id}",
        provider="outdoorsy",
        provider_offer_id=provider_offer_id,
        type=offer_type,
        title=title[:160],
        summary=str(record.get("summary") or "").strip()[:500],
        images=clean_images,
        pickup_area=_pickup_area(record),
        approximate_lat=lat,
        approximate_lng=lng,
        vehicle_class=str(record.get("vehicle_class") or "").strip()[:80],
        sleeps=_safe_int(record.get("sleeps"), 0, 0, 20) or None,
        seats=_safe_int(record.get("seats"), 0, 0, 20) or None,
        pet_friendly=_safe_bool(record.get("pet_friendly")),
        delivery_available=_safe_bool(record.get("delivery_available")),
        amenities=_list_of_text(record.get("amenities")),
        price_from=_safe_float(pricing.get("from", record.get("price_from"))),
        currency=str(pricing.get("currency") or record.get("currency") or "USD").strip()[:8] or "USD",
        price_freshness=str(pricing.get("freshness") or record.get("price_freshness") or "").strip()[:120],
        availability_summary=str(availability.get("summary") or record.get("availability_summary") or "").strip()[:180],
        rating=_safe_float(record.get("rating")),
        review_count=_safe_int(record.get("review_count"), 0, 0, 1_000_000) or None,
        cancellation_summary=str(record.get("cancellation_summary") or "").strip()[:180],
        insurance_summary=str(record.get("insurance_summary") or "").strip()[:180],
        booking_url=str(record.get("booking_url") or "").strip(),
        affiliate_url=str(record.get("affiliate_url") or record.get("booking_url") or "").strip(),
        source_freshness=source_freshness[:120],
        fetched_at=fetched_at,
        expires_at=fetched_at + ttl_seconds,
        disclosure_kind=PARTNER_BOOKING_DISCLOSURE_KIND,
        disclosure_label=PARTNER_BOOKING_DISCLOSURE_LABEL,
        external_checkout_status="unconfirmed",
    )


def normalize_outdoorsy_payload(
    payload: dict[str, Any],
    *,
    query: OfferSearchQuery | None = None,
    fetched_at: int | None = None,
    ttl_seconds: int = 900,
) -> OfferSearchResult:
    now = int(fetched_at or time.time())
    if not isinstance(payload, dict):
        return OfferSearchResult("outdoorsy", "malformed_response", fetched_at=now, expires_at=now, reason="payload_not_object")
    status = str(payload.get("status") or "ok").strip().lower()
    if status in ERROR_STATUSES:
        return OfferSearchResult("outdoorsy", status, fetched_at=now, expires_at=now, reason=status)
    rentals = payload.get("rentals")
    if rentals is None:
        rentals = payload.get("offers")
    if not isinstance(rentals, list):
        return OfferSearchResult("outdoorsy", "malformed_response", fetched_at=now, expires_at=now, reason="rentals_not_list")

    seen: set[str] = set()
    offers: list[OutdoorOffer] = []
    for record in rentals:
        offer = normalize_outdoorsy_offer(record, fetched_at=now, ttl_seconds=ttl_seconds)
        if not offer or offer.provider_offer_id in seen:
            continue
        seen.add(offer.provider_offer_id)
        if query:
            if query.sleeps and offer.sleeps is not None and offer.sleeps < query.sleeps:
                continue
            if query.pet_friendly is True and offer.pet_friendly is not True:
                continue
            if query.delivery is True and offer.delivery_available is not True:
                continue
        offers.append(offer)

    if query:
        ranked = rank_offers(offers, query.ranking_context())[:query.safe_limit()]
        by_id = {offer.id: offer for offer in offers}
        offers = [by_id[item["id"]] for item in ranked if item.get("id") in by_id]
    return OfferSearchResult("outdoorsy", "ok", offers=offers, fetched_at=now, expires_at=now + ttl_seconds)


class OutdoorsyProvider(OfferProvider):
    provider_id = "outdoorsy"

    def __init__(self, config: OutdoorsyConfig | None = None):
        self.config = config or config_from_env()

    def search_rentals(self, query: OfferSearchQuery) -> OfferSearchResult:
        now = int(time.time())
        error = query.validation_error()
        if error:
            return OfferSearchResult(self.provider_id, "invalid_request", fetched_at=now, expires_at=now, reason=error)

        state = self.config.normalized_state()
        if state == "disabled":
            return OfferSearchResult(self.provider_id, "disabled", fetched_at=now, expires_at=now, reason="provider_disabled")

        if self.config.fixture_mode or state == "fixture_only":
            fixture = self.config.fixture_path
            if not fixture:
                return OfferSearchResult(self.provider_id, "empty", fetched_at=now, expires_at=now, reason="fixture_missing")
            try:
                payload = json.loads(Path(fixture).read_text())
            except (OSError, json.JSONDecodeError):
                return OfferSearchResult(self.provider_id, "malformed_response", fetched_at=now, expires_at=now, reason="fixture_unreadable")
            return normalize_outdoorsy_payload(payload, query=query, fetched_at=now, ttl_seconds=self.config.cache_ttl_seconds)

        if state == "configured_affiliate_link":
            offer = _generic_search_offer(self.config, query, fetched_at=now)
            if offer:
                return OfferSearchResult(
                    self.provider_id,
                    "ok",
                    offers=[offer],
                    fetched_at=now,
                    expires_at=offer.expires_at,
                    reason="affiliate_search_link",
                )
            return OfferSearchResult(self.provider_id, "affiliate_only", fetched_at=now, expires_at=now, reason="inventory_unconfirmed")

        if not self.config.enable_live or not self.config.has_affiliate_credentials():
            offer = _generic_search_offer(self.config, query, fetched_at=now)
            if offer:
                return OfferSearchResult(
                    self.provider_id,
                    "ok",
                    offers=[offer],
                    fetched_at=now,
                    expires_at=offer.expires_at,
                    reason="affiliate_search_link",
                )
            return OfferSearchResult(self.provider_id, "disabled", fetched_at=now, expires_at=now, reason="missing_backend_credentials")

        offer = _generic_search_offer(self.config, query, fetched_at=now)
        if offer:
            return OfferSearchResult(
                self.provider_id,
                "ok",
                offers=[offer],
                fetched_at=now,
                expires_at=offer.expires_at,
                reason="affiliate_search_link",
            )
        return OfferSearchResult(self.provider_id, "unconfirmed_contract", fetched_at=now, expires_at=now, reason="rental_inventory_contract_unconfirmed")
