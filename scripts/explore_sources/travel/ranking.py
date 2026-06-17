from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Any


def haversine_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.8
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * r * asin(sqrt(a))


def category_intent_score(experience: dict[str, Any], place: dict[str, Any] | None = None) -> float:
    hay = " ".join([
        str(experience.get("title") or ""),
        str(experience.get("category") or ""),
        " ".join(experience.get("subcategories") or []),
        str(experience.get("summary") or ""),
    ]).lower()
    place_text = ""
    if place:
        summary = place.get("summary") or {}
        place_text = " ".join([
            str(summary.get("title") or ""),
            str(summary.get("category") or ""),
            str(summary.get("explore_group") or ""),
            " ".join(summary.get("tags") or []),
            str(place.get("category") or ""),
        ]).lower()
    score = 0.0
    if any(term in hay for term in ("hiking", "walk", "nature", "national park")) and any(term in place_text for term in ("trail", "park", "waterfall", "glacier")):
        score += 3
    if any(term in hay for term in ("jeep", "4x4", "utv", "off road", "canyon")) and any(term in place_text for term in ("offroad", "moab", "canyon", "public land")):
        score += 3
    if any(term in hay for term in ("raft", "boat", "kayak", "river", "cruise")) and any(term in place_text for term in ("water", "river", "lake", "shore")):
        score += 3
    return score


def rank_experiences(experiences: list[dict[str, Any]], place: dict[str, Any] | None = None, lat: float | None = None, lng: float | None = None) -> list[dict[str, Any]]:
    summary = (place or {}).get("summary") or {}
    center_lat = lat if lat is not None else summary.get("lat")
    center_lng = lng if lng is not None else summary.get("lng")
    place_title = str(summary.get("title") or "").lower()
    ranked = []
    for idx, exp in enumerate(experiences):
        item = dict(exp)
        score = 0.0
        text = f"{item.get('title', '')} {item.get('summary', '')} {' '.join(item.get('subcategories') or [])}".lower()
        if place_title and any(part for part in place_title.split() if len(part) > 3 and part in text):
            score += 4
        if center_lat is not None and center_lng is not None and item.get("lat") is not None and item.get("lng") is not None:
            try:
                distance = haversine_mi(float(center_lat), float(center_lng), float(item["lat"]), float(item["lng"]))
                item["distance_mi"] = round(distance, 1)
                score += max(0.0, 3.0 - min(distance, 60.0) / 20.0)
            except Exception:
                pass
        score += category_intent_score(item, place)
        rating = item.get("rating")
        if isinstance(rating, (int, float)):
            score += min(2.0, max(0.0, (float(rating) - 3.0)))
        reviews = item.get("review_count")
        if isinstance(reviews, int) and reviews > 0:
            score += min(1.0, reviews / 100.0)
        if item.get("price_from"):
            score += 0.4
        if item.get("hero_image_url"):
            score += 0.5
        item["_rank_score"] = round(score, 4)
        item["_rank_index"] = idx
        ranked.append(item)
    ranked.sort(key=lambda item: (-(item.get("_rank_score") or 0), item.get("distance_mi") if isinstance(item.get("distance_mi"), (int, float)) else 9999, item.get("_rank_index") or 0))
    for item in ranked:
        item.pop("_rank_score", None)
        item.pop("_rank_index", None)
    return ranked

