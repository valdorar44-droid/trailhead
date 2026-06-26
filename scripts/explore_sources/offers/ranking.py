from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Any

from scripts.explore_sources.offers.schema import OutdoorOffer


def haversine_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_mi = 3958.8
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * radius_mi * asin(sqrt(a))


def _as_dict(offer: OutdoorOffer | dict[str, Any]) -> dict[str, Any]:
    return offer.to_public_dict() if isinstance(offer, OutdoorOffer) else dict(offer)


def _vehicle_match_score(offer: dict[str, Any], requested: str = "") -> float:
    requested = requested.strip().lower().replace("-", "_").replace(" ", "_")
    if not requested:
        return 0.0
    offer_type = str(offer.get("type") or "").lower()
    vehicle_class = str(offer.get("vehicle_class") or "").lower()
    if requested == offer_type or requested in vehicle_class:
        return 3.0
    if requested in {"rv", "rv_rental"} and ("rv" in offer_type or "rv" in vehicle_class):
        return 2.5
    if requested in {"van", "campervan", "campervan_rental"} and "van" in f"{offer_type} {vehicle_class}":
        return 2.5
    if requested in {"trailer", "travel_trailer", "camper_trailer"} and "trailer" in f"{offer_type} {vehicle_class}":
        return 2.5
    return 0.0


def offer_fit_score(offer: OutdoorOffer | dict[str, Any], context: dict[str, Any] | None = None) -> tuple[float, dict[str, Any]]:
    item = _as_dict(offer)
    ctx = context or {}
    score = 0.0

    start_lat = ctx.get("lat")
    start_lng = ctx.get("lng")
    if isinstance(start_lat, (int, float)) and isinstance(start_lng, (int, float)):
        offer_lat = item.get("approximate_lat")
        offer_lng = item.get("approximate_lng")
        if isinstance(offer_lat, (int, float)) and isinstance(offer_lng, (int, float)):
            distance = haversine_mi(float(start_lat), float(start_lng), float(offer_lat), float(offer_lng))
            item["pickup_distance_mi"] = round(distance, 1)
            score += max(0.0, 6.0 - min(distance, 120.0) / 20.0)

    requested_sleeps = ctx.get("sleeps")
    sleeps = item.get("sleeps")
    if isinstance(requested_sleeps, int) and requested_sleeps > 0 and isinstance(sleeps, int):
        if sleeps >= requested_sleeps:
            score += 3.0
        else:
            score -= 6.0

    score += _vehicle_match_score(item, str(ctx.get("vehicle_type") or ""))

    if ctx.get("pet_friendly") is True:
        score += 2.0 if item.get("pet_friendly") is True else -2.0
    if ctx.get("delivery") is True:
        score += 1.5 if item.get("delivery_available") is True else -1.0

    trip_nights = ctx.get("trip_nights")
    camp_nights = ctx.get("camp_nights")
    if isinstance(trip_nights, int) and trip_nights >= 2:
        score += 1.0
    if isinstance(camp_nights, int) and camp_nights >= 2:
        score += 1.5

    rating = item.get("rating")
    if isinstance(rating, (int, float)):
        score += max(0.0, min(2.0, float(rating) - 3.0))
    reviews = item.get("review_count")
    if isinstance(reviews, int) and reviews > 0:
        score += min(1.0, reviews / 100.0)
    if item.get("price_from") is not None and item.get("price_freshness"):
        score += 0.6
    if item.get("source_freshness"):
        score += 0.4

    if ctx.get("user_has_rig") is True and not ctx.get("requested_rental"):
        score -= 4.0
    if ctx.get("recently_dismissed") is True:
        score -= 5.0

    return score, item


def rank_offers(offers: list[OutdoorOffer | dict[str, Any]], context: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for index, offer in enumerate(offers):
        score, item = offer_fit_score(offer, context)
        item["_rank_score"] = round(score, 4)
        item["_rank_index"] = index
        ranked.append(item)
    ranked.sort(
        key=lambda item: (
            -(item.get("_rank_score") or 0),
            item.get("pickup_distance_mi") if isinstance(item.get("pickup_distance_mi"), (int, float)) else 9999,
            item.get("_rank_index") or 0,
        )
    )
    for item in ranked:
        item.pop("_rank_score", None)
        item.pop("_rank_index", None)
    return ranked
