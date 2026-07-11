#!/usr/bin/env python3
"""Live Explorer API checks against the local FastAPI app and current catalog data."""

from __future__ import annotations

import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from dashboard.server import _clean_explore_public_response_profile, _load_explore_catalog, app  # noqa: E402


LOCAL_DUP_DISTANCE_MI = 120.0


def fail(message: str) -> None:
    print(f"Explore live audit failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def haversine_mi(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    radius_mi = 3958.7613
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    lat1 = math.radians(a_lat)
    lat2 = math.radians(b_lat)
    value = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    return radius_mi * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def summary_image(place: dict[str, Any]) -> str:
    summary = place.get("summary") if isinstance(place.get("summary"), dict) else {}
    image = summary.get("image_url") or summary.get("thumbnail_url") or ""
    return image if isinstance(image, str) else ""


def source_pack_quality(place: dict[str, Any]) -> bool:
    source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    summary = place.get("summary") if isinstance(place.get("summary"), dict) else {}
    return bool(
        summary.get("short_description")
        or source_pack.get("extract")
        or source_pack.get("official_url")
        or source_pack.get("primary")
        or source_pack.get("sources")
        or source_pack.get("photos")
        or source_pack.get("things_to_see")
        or source_pack.get("things_to_do")
        or source_pack.get("campgrounds")
    )


def user_facing_text(place: dict[str, Any]) -> str:
    summary = place.get("summary") if isinstance(place.get("summary"), dict) else {}
    profile = place.get("profile") if isinstance(place.get("profile"), dict) else {}
    source_pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    values = [
        summary.get("title"),
        summary.get("hook"),
        summary.get("short_description"),
        profile.get("summary"),
        profile.get("story"),
        source_pack.get("extract"),
        source_pack.get("source_note"),
    ]
    return "\n".join(str(value or "") for value in values)


def main() -> int:
    client = TestClient(app)
    catalog_places = _load_explore_catalog().get("places") or []
    cleaned_catalog: list[dict[str, Any]] = []
    for place in catalog_places:
        if isinstance(place, dict):
            cleaned_catalog.append(_clean_explore_public_response_profile(place))
    if len(cleaned_catalog) < 1000:
        fail(f"expected a full Explore catalog, got {len(cleaned_catalog)} records")

    index_response = client.get("/api/explore/catalog/index?limit=144&cursor=0")
    if index_response.status_code != 200:
        fail(f"catalog index returned HTTP {index_response.status_code}")
    index_payload = index_response.json()
    index_places = index_payload.get("places") if isinstance(index_payload, dict) else []
    if not isinstance(index_places, list) or len(index_places) < 72:
        fail(f"expected at least 72 catalog places, got {len(index_places) if isinstance(index_places, list) else 0}")

    ids = [str(place.get("id") or "") for place in index_places[:120] if isinstance(place, dict) and place.get("id")]
    places: list[dict[str, Any]] = []
    missing: list[str] = []
    for start in range(0, len(ids), 24):
        chunk = ids[start:start + 24]
        bulk_response = client.post("/api/explore/places/bulk", json={"ids": chunk, "force_refresh": True})
        if bulk_response.status_code != 200:
            fail(f"bulk detail chunk {start // 24 + 1} returned HTTP {bulk_response.status_code}")
        bulk_payload = bulk_response.json()
        chunk_places = bulk_payload.get("places") if isinstance(bulk_payload, dict) else []
        if isinstance(chunk_places, list):
            places.extend(place for place in chunk_places if isinstance(place, dict))
        chunk_missing = bulk_payload.get("missing") if isinstance(bulk_payload, dict) else []
        if isinstance(chunk_missing, list):
            missing.extend(str(item) for item in chunk_missing)
    if missing:
        fail(f"bulk detail missed ids: {missing[:5]}")
    if len(places) < 96:
        fail(f"expected at least 96 bulk-hydrated places, got {len(places)}")

    weak: list[str] = []
    local_images: dict[str, list[tuple[str, str, float, float]]] = defaultdict(list)
    blocked_copy = re.compile(r"\b(?:api|endpoint|schema|database|raw record|undefined|null|nan)\b", re.I)
    copy_hits: list[str] = []

    for place in [*cleaned_catalog, *places]:
        if not isinstance(place, dict):
            continue
        summary = place.get("summary") if isinstance(place.get("summary"), dict) else {}
        place_id = str(place.get("id") or summary.get("id") or "")
        title = str(summary.get("title") or place_id)
        lat = summary.get("lat")
        lng = summary.get("lng")
        if not title or not source_pack_quality(place):
            weak.append(place_id or title)
        image = summary_image(place)
        if image.startswith("/assets/explore/") and isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            local_images[image].append((place_id, title, float(lat), float(lng)))
        match = blocked_copy.search(user_facing_text(place))
        if match:
            copy_hits.append(f"{title}: {match.group(0)}")

    if weak:
        fail(f"bulk detail returned weak profiles: {weak[:8]}")
    if copy_hits:
        fail(f"bulk detail exposed dev/raw wording: {copy_hits[:6]}")

    far_duplicates: list[str] = []
    for image, records in local_images.items():
        for index, first in enumerate(records):
            for second in records[index + 1:]:
                distance = haversine_mi(first[2], first[3], second[2], second[3])
                if distance > LOCAL_DUP_DISTANCE_MI:
                    far_duplicates.append(f"{image}: {first[1]} / {second[1]} ({distance:.0f} mi)")
                    break
            if far_duplicates:
                break
    if far_duplicates:
        fail(f"far-apart local image reuse found: {far_duplicates[:5]}")

    unique_local_images = len(local_images)
    total_local_image_records = sum(len(records) for records in local_images.values())
    print(
        "Explore live audit passed "
        f"({len(cleaned_catalog)} full-catalog records, {len(index_places)} index records, "
        f"{len(places)} bulk details, {unique_local_images}/{total_local_image_records} unique local image URLs)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
