from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class BookableExperience:
    id: str
    source: str
    source_id: str
    source_badge: str = "Viator"
    source_url: str = ""
    booking_url: str = ""
    affiliate_url: str = ""
    cache_policy: str = "partner_api_ingest"
    fetched_at: int = 0
    expires_at: int = 0
    last_seen_at: int = 0
    title: str = ""
    category: str = "guided_tour"
    subcategories: list[str] = field(default_factory=list)
    lat: float | None = None
    lng: float | None = None
    region: str = ""
    country: str = ""
    summary: str = ""
    description: str = ""
    highlights: list[str] = field(default_factory=list)
    inclusions: list[str] = field(default_factory=list)
    exclusions: list[str] = field(default_factory=list)
    duration_label: str = ""
    price_from: str = ""
    currency: str = "USD"
    rating: float | None = None
    review_count: int | None = None
    hero_image_url: str = ""
    images: list[dict[str, Any]] = field(default_factory=list)
    cancellation_summary: str = ""
    availability_summary: str = ""
    mobile_ticket: bool | None = None
    instant_confirmation: bool | None = None
    languages: list[str] = field(default_factory=list)
    supplier_name: str = ""
    attribution: str = "Source: Viator"
    primary_action: str = "Book on Viator"
    secondary_actions: list[str] = field(default_factory=lambda: ["Save", "Add to Planner", "Show Area"])
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def planner_stop_from_experience(experience: BookableExperience | dict[str, Any], day: int | None = None) -> dict[str, Any]:
    item = experience.to_dict() if isinstance(experience, BookableExperience) else dict(experience)
    return {
        "type": "bookable_experience",
        "source": item.get("source") or "viator",
        "source_id": item.get("source_id") or "",
        "name": item.get("title") or "Bookable experience",
        "lat": item.get("lat"),
        "lng": item.get("lng"),
        "booking_url": item.get("booking_url") or item.get("affiliate_url") or item.get("source_url") or "",
        "day": day,
        "notes": item.get("summary") or "",
        "estimated_duration": item.get("duration_label") or "",
        "price_from": item.get("price_from") or "",
        "status": "needs_booking",
    }

