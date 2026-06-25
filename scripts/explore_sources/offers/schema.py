from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


OUTDOOR_OFFER_TYPES = {
    "rv_rental",
    "campervan_rental",
    "travel_trailer",
    "camper_trailer",
    "adventure_vehicle",
    "vehicle_rental",
}


@dataclass
class OutdoorOfferImage:
    url: str
    caption: str = ""
    credit: str = ""
    license: str = ""


@dataclass
class OutdoorOffer:
    id: str
    provider: str
    provider_offer_id: str
    type: str
    title: str
    summary: str = ""
    images: list[OutdoorOfferImage] = field(default_factory=list)
    pickup_area: str = ""
    approximate_lat: float | None = None
    approximate_lng: float | None = None
    vehicle_class: str = ""
    sleeps: int | None = None
    seats: int | None = None
    pet_friendly: bool | None = None
    delivery_available: bool | None = None
    amenities: list[str] = field(default_factory=list)
    price_from: float | None = None
    currency: str = "USD"
    price_freshness: str = ""
    availability_summary: str = ""
    rating: float | None = None
    review_count: int | None = None
    cancellation_summary: str = ""
    insurance_summary: str = ""
    booking_url: str = ""
    affiliate_url: str = ""
    source_freshness: str = ""
    fetched_at: int = 0
    expires_at: int = 0
    disclosure_kind: str = "partner_booking"
    disclosure_label: str = "Partner booking · Trailhead may earn."
    external_checkout_status: str = "unconfirmed"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_public_dict(self) -> dict[str, Any]:
        data = self.to_dict()
        data["images"] = [asdict(image) if isinstance(image, OutdoorOfferImage) else dict(image) for image in self.images]
        return data


def normalize_offer_type(value: object) -> str:
    candidate = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    return candidate if candidate in OUTDOOR_OFFER_TYPES else "vehicle_rental"
