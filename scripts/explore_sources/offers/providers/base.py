from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
import time
from typing import Any

from scripts.explore_sources.offers.schema import OutdoorOffer


def _parse_date(value: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


@dataclass
class OfferSearchQuery:
    lat: float | None = None
    lng: float | None = None
    start_date: str = ""
    end_date: str = ""
    sleeps: int | None = None
    vehicle_type: str = ""
    pet_friendly: bool | None = None
    delivery: bool | None = None
    limit: int = 12
    provider: str = ""

    def safe_limit(self, maximum: int = 24) -> int:
        try:
            value = int(self.limit)
        except (TypeError, ValueError):
            value = 12
        return max(1, min(value, maximum))

    def validation_error(self) -> str:
        start = _parse_date(self.start_date)
        end = _parse_date(self.end_date)
        if self.start_date and not start:
            return "invalid_start_date"
        if self.end_date and not end:
            return "invalid_end_date"
        if start and end and end <= start:
            return "invalid_date_range"
        if self.lat is not None and not -90 <= float(self.lat) <= 90:
            return "invalid_lat"
        if self.lng is not None and not -180 <= float(self.lng) <= 180:
            return "invalid_lng"
        if self.sleeps is not None and int(self.sleeps) < 1:
            return "invalid_sleeps"
        return ""

    def ranking_context(self) -> dict[str, Any]:
        return {
            "lat": self.lat,
            "lng": self.lng,
            "sleeps": self.sleeps,
            "vehicle_type": self.vehicle_type,
            "pet_friendly": self.pet_friendly,
            "delivery": self.delivery,
        }


@dataclass
class OfferSearchResult:
    provider: str
    status: str
    offers: list[OutdoorOffer] = field(default_factory=list)
    fetched_at: int = field(default_factory=lambda: int(time.time()))
    expires_at: int = 0
    reason: str = ""

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "status": self.status,
            "offers": [offer.to_public_dict() for offer in self.offers],
            "count": len(self.offers),
            "fetched_at": self.fetched_at,
            "expires_at": self.expires_at,
            "reason": self.reason,
        }


class OfferProvider:
    provider_id = ""

    def search_rentals(self, query: OfferSearchQuery) -> OfferSearchResult:
        raise NotImplementedError
