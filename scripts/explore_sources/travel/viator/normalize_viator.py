from __future__ import annotations

import time
from typing import Any

from scripts.explore_sources.travel.cache_policy import CachePolicy, expires_at
from scripts.explore_sources.travel.cards import build_experience_card
from scripts.explore_sources.travel.normalize import as_float, as_int, compact_text, slugify, sorted_unique
from scripts.explore_sources.travel.schema import BookableExperience


def normalize_viator_products(payload: dict[str, Any], *, fetched_at: int | None = None, ttl_hours: int = 24) -> list[BookableExperience]:
    now = int(fetched_at or time.time())
    products = payload.get("products") if isinstance(payload, dict) else []
    if not isinstance(products, list):
        return []
    experiences = []
    seen = set()
    for product in products:
        if not isinstance(product, dict):
            continue
        exp = normalize_viator_product(product, fetched_at=now, ttl_hours=ttl_hours)
        if not exp or exp.source_id in seen:
            continue
        seen.add(exp.source_id)
        experiences.append(exp)
    return experiences


def normalize_viator_product(product: dict[str, Any], *, fetched_at: int | None = None, ttl_hours: int = 24) -> BookableExperience | None:
    now = int(fetched_at or time.time())
    product_code = compact_text(product.get("productCode") or product.get("product_code") or product.get("code"))
    title = compact_text(product.get("title"))
    if not product_code or not title:
        return None
    product_url = compact_text(product.get("productUrl") or product.get("product_url") or product.get("webURL"))
    reviews = product.get("reviews") or {}
    pricing = product.get("pricing") or {}
    pricing_summary = pricing.get("summary") if isinstance(pricing, dict) else {}
    destination_refs = product.get("destinations") if isinstance(product.get("destinations"), list) else []
    region = compact_text(product.get("region") or product.get("destinationName") or primary_destination_ref(destination_refs))
    lat = as_float(product.get("lat") or product.get("latitude"))
    lng = as_float(product.get("lng") or product.get("longitude"))
    image = primary_image(product)
    flags = [compact_text(flag) for flag in product.get("flags") or [] if compact_text(flag)]
    tags = [str(tag) for tag in product.get("tags") or [] if str(tag).strip()]
    subcategories = category_terms(title, product.get("description"), tags, flags)
    rating = as_float(reviews.get("combinedAverageRating") if isinstance(reviews, dict) else None)
    review_count = as_int(reviews.get("totalReviews") if isinstance(reviews, dict) else None)
    experience = BookableExperience(
        id=f"viator:{slugify(product_code)}",
        source="viator",
        source_id=product_code,
        source_badge="Viator",
        source_url=product_url,
        booking_url=product_url,
        affiliate_url=product_url,
        cache_policy=CachePolicy.PARTNER_API_INGEST.value,
        fetched_at=now,
        expires_at=expires_at(now, active=True, ttl_hours=ttl_hours),
        last_seen_at=now,
        title=title,
        category=category_from_terms(subcategories),
        subcategories=subcategories,
        lat=lat,
        lng=lng,
        region=region,
        country=compact_text(product.get("country")),
        summary=summary_from_product(product),
        description=compact_text(product.get("description")),
        highlights=highlights_from_product(product),
        inclusions=text_list(product.get("inclusions")),
        exclusions=text_list(product.get("exclusions")),
        duration_label=duration_label(product),
        price_from=price_from(pricing_summary if isinstance(pricing_summary, dict) else {}),
        currency=compact_text((pricing.get("currency") if isinstance(pricing, dict) else "") or product.get("currency") or "USD"),
        rating=rating,
        review_count=review_count,
        hero_image_url=image.get("url", ""),
        images=all_images(product),
        cancellation_summary="Free cancellation" if "FREE_CANCELLATION" in flags else "",
        availability_summary="Likely to sell out" if "LIKELY_TO_SELL_OUT" in flags else "",
        mobile_ticket=True if "MOBILE_TICKET" in flags else None,
        instant_confirmation=True if "INSTANT_CONFIRMATION" in flags else None,
        languages=text_list(product.get("languages")),
        supplier_name=compact_text(product.get("supplierName") or product.get("supplier_name")),
        attribution="Tours and experiences sourced from Viator.",
        raw=product,
    )
    return build_experience_card(experience)


def primary_destination_ref(destinations: list[Any]) -> str:
    for item in destinations:
        if isinstance(item, dict) and item.get("primary"):
            return compact_text(item.get("name") or item.get("ref"))
    for item in destinations:
        if isinstance(item, dict):
            return compact_text(item.get("name") or item.get("ref"))
    return ""


def primary_image(product: dict[str, Any]) -> dict[str, str]:
    images = all_images(product)
    if not images:
        return {}
    cover = next((item for item in images if item.get("is_cover")), None)
    return cover or images[0]


def all_images(product: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for image in product.get("images") or []:
        if not isinstance(image, dict):
            continue
        variants = image.get("variants") if isinstance(image.get("variants"), list) else []
        best = best_variant(variants)
        if best:
            out.append({
                "url": best,
                "caption": compact_text(image.get("caption") or product.get("title")),
                "credit": "Viator supplier",
                "license": "Viator Partner API media; display with Viator product attribution",
                "is_cover": bool(image.get("isCover")),
            })
    return out


def best_variant(variants: list[Any]) -> str:
    best_url = ""
    best_area = -1
    for variant in variants:
        if not isinstance(variant, dict):
            continue
        url = compact_text(variant.get("url"))
        if not url:
            continue
        width = as_int(variant.get("width")) or 0
        height = as_int(variant.get("height")) or 0
        area = width * height
        if area > best_area:
            best_area = area
            best_url = url
    return best_url


def summary_from_product(product: dict[str, Any]) -> str:
    desc = compact_text(product.get("description"))
    if not desc:
        return "Guided tour or local experience near this Explore area."
    return desc[:360]


def text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, dict):
                out.append(item.get("description") or item.get("text") or item.get("name"))
            else:
                out.append(item)
        return sorted_unique(out)
    return sorted_unique([value] if value else [])


def highlights_from_product(product: dict[str, Any]) -> list[str]:
    raw = product.get("highlights") or product.get("flags") or []
    return text_list(raw)[:6]


def duration_label(product: dict[str, Any]) -> str:
    duration = product.get("duration") or {}
    if isinstance(duration, dict):
        fixed = duration.get("fixedDurationInMinutes")
        if fixed:
            return minutes_label(as_int(fixed) or 0)
        start = as_int(duration.get("fromMinutes"))
        end = as_int(duration.get("toMinutes"))
        if start and end and start != end:
            return f"{minutes_label(start)}-{minutes_label(end)}"
        if start:
            return minutes_label(start)
    return compact_text(product.get("durationLabel") or product.get("duration_label"))


def minutes_label(minutes: int) -> str:
    if minutes <= 0:
        return ""
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes / 60
    return f"{hours:.1f} hours".replace(".0", "")


def price_from(summary: dict[str, Any]) -> str:
    value = summary.get("fromPrice") or summary.get("from_price")
    if value in (None, ""):
        return ""
    try:
        return f"{float(value):.2f}"
    except Exception:
        return compact_text(value)


def category_terms(title: Any, description: Any, tags: list[str], flags: list[str]) -> list[str]:
    hay = f"{title} {description} {' '.join(tags)} {' '.join(flags)}".lower()
    terms = []
    for key, words in {
        "hiking": ("hiking", "walk", "trek", "trail"),
        "national_park": ("national park", "yosemite", "arches", "canyonlands"),
        "offroad": ("jeep", "4x4", "utv", "off-road", "off road"),
        "rafting": ("raft", "river", "whitewater"),
        "boat": ("boat", "cruise", "kayak"),
        "climbing": ("climb", "canyoneering", "canyon"),
        "wildlife": ("wildlife", "whale", "bird"),
        "family": ("family", "kid"),
        "tickets": ("ticket", "admission", "attraction"),
        "free_cancellation": ("free_cancellation", "free cancellation"),
    }.items():
        if any(word in hay for word in words):
            terms.append(key)
    return sorted_unique([*terms, *tags[:4]])


def category_from_terms(terms: list[str]) -> str:
    if any(term in terms for term in ("hiking", "offroad", "rafting", "boat", "climbing", "wildlife")):
        return "guided_tour"
    if "tickets" in terms:
        return "attraction_ticket"
    return "local_experience"

