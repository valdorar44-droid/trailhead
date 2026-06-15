"""Curated Pakistan/Karakoram outdoor stay fallback.

This is intentionally small and mixed-confidence. It keeps K2/Hunza/Skardu
search useful when live Overpass is slow or unavailable, while the production
Geofabrik import/road-confidence work is built.
"""
from __future__ import annotations

import math
import re


PAKISTAN_KARAKORAM_STAYS: tuple[dict, ...] = (
    {"name": "K2 Base Camp", "lat": 35.8808, "lng": 76.5158, "land_type": "Trekking Camp", "tags": ["k2", "base camp", "trekking", "baltoro"]},
    {"name": "Broad Peak Base Camp", "lat": 35.8108, "lng": 76.5669, "land_type": "Trekking Camp", "tags": ["broad peak", "base camp", "trekking", "baltoro"]},
    {"name": "Concordia Camp", "lat": 35.7455, "lng": 76.5142, "land_type": "Trekking Camp", "tags": ["concordia", "trekking", "baltoro"]},
    {"name": "Paju Camp", "lat": 35.6772, "lng": 76.1257, "land_type": "Trekking Camp", "tags": ["paju", "trekking", "baltoro"]},
    {"name": "Liligo Camp", "lat": 35.7008, "lng": 76.1944, "land_type": "Trekking Camp", "tags": ["liligo", "trekking", "baltoro"]},
    {"name": "Urdokas Camp", "lat": 35.7275, "lng": 76.2850, "land_type": "Trekking Camp", "tags": ["urdokas", "trekking", "baltoro"]},
    {"name": "Korophon Camp", "lat": 35.6893, "lng": 75.9144, "land_type": "Trekking Camp", "tags": ["askole", "trekking", "baltoro"]},
    {"name": "Bardumal Camp", "lat": 35.6555, "lng": 75.9997, "land_type": "Trekking Camp", "tags": ["askole", "trekking", "baltoro"]},
    {"name": "Saitcho Camp", "lat": 35.5168, "lng": 76.4010, "land_type": "Trekking Camp", "tags": ["hushe", "trekking", "karakoram"]},
    {"name": "Masherbrum Base Camp", "lat": 35.5609, "lng": 76.2997, "land_type": "Trekking Camp", "tags": ["masherbrum", "base camp", "trekking"]},
    {"name": "Askole Staging Area", "lat": 35.6806, "lng": 75.8178, "land_type": "Trekking Lodge Area", "tags": ["askole", "guest house", "trekking lodge"]},
    {"name": "Hushe Guest House Area", "lat": 35.4519, "lng": 76.3582, "land_type": "Trekking Lodge Area", "tags": ["hushe", "guest house", "trekking lodge"]},
    {"name": "Passu Peak Inn Area", "lat": 36.4828, "lng": 74.8825, "land_type": "Trekking Lodge Area", "tags": ["hunza", "passu", "trekking lodge"]},
    {"name": "Iqbal Guest House Area", "lat": 36.4252, "lng": 74.8700, "land_type": "Trekking Lodge Area", "tags": ["hunza", "guest house", "trekking lodge"]},
    {"name": "Karimabad Guest House Area", "lat": 36.3167, "lng": 74.6500, "land_type": "Trekking Lodge Area", "tags": ["hunza", "karimabad", "guest house"]},
    {"name": "Skardu Trekking Lodge Area", "lat": 35.2971, "lng": 75.6333, "land_type": "Trekking Lodge Area", "tags": ["skardu", "guest house", "trekking lodge"]},
    {"name": "Khaplu Inn Area", "lat": 35.1646, "lng": 76.3433, "land_type": "Trekking Lodge Area", "tags": ["khaplu", "guest house", "trekking lodge"]},
    {"name": "Raikot Serai", "lat": 35.3858, "lng": 74.5805, "land_type": "Trekking Camp", "tags": ["fairy meadows", "nanga parbat", "trekking"]},
    {"name": "Behal Campsite", "lat": 35.3525, "lng": 74.5774, "land_type": "Trekking Camp", "tags": ["fairy meadows", "nanga parbat", "trekking"]},
    {"name": "Nanga Parbat Base Camp", "lat": 35.3192, "lng": 74.5903, "land_type": "Trekking Camp", "tags": ["nanga parbat", "base camp", "trekking"]},
    {"name": "Herrligkoffer Base Camp", "lat": 35.2064, "lng": 74.6474, "land_type": "Trekking Camp", "tags": ["nanga parbat", "base camp", "trekking"]},
    {"name": "Latbo Camp", "lat": 35.1917, "lng": 74.6039, "land_type": "Trekking Camp", "tags": ["nanga parbat", "trekking"]},
    {"name": "Rakaposhi Base Camp Area", "lat": 36.1425, "lng": 74.4892, "land_type": "Trekking Camp", "tags": ["rakaposhi", "base camp", "hunza", "trekking"]},
    {"name": "Attabad Lake Stay Area", "lat": 36.3450, "lng": 74.8670, "land_type": "Trekking Lodge Area", "tags": ["hunza", "attabad", "guest house", "scenic"]},
)

PAKISTAN_KARAKORAM_PLACES: tuple[dict, ...] = (
    {"name": "Askole Trailhead", "lat": 35.6806, "lng": 75.8178, "type": "trailhead", "subtype": "trek_start", "tags": ["askole", "baltoro", "k2", "jeep track", "porter staging"]},
    {"name": "Baltoro Glacier", "lat": 35.7391, "lng": 76.3482, "type": "glacier", "subtype": "glacier", "tags": ["baltoro", "k2", "concordia", "trekking only"]},
    {"name": "Godwin-Austen Glacier", "lat": 35.8466, "lng": 76.5050, "type": "glacier", "subtype": "glacier", "tags": ["k2", "base camp", "trekking only"]},
    {"name": "Concordia", "lat": 35.7455, "lng": 76.5142, "type": "viewpoint", "subtype": "glacier_junction", "tags": ["concordia", "baltoro", "k2", "broad peak"]},
    {"name": "Gondogoro La", "lat": 35.5906, "lng": 76.5586, "type": "pass", "subtype": "mountain_pass", "tags": ["la", "pass", "gondogoro", "guide required", "trekking only"]},
    {"name": "Ali Camp", "lat": 35.6045, "lng": 76.5131, "type": "camp", "subtype": "high_camp", "tags": ["gondogoro", "ali camp", "trekking"]},
    {"name": "Hushe Trailhead", "lat": 35.4519, "lng": 76.3582, "type": "trailhead", "subtype": "trek_start", "tags": ["hushe", "gondogoro", "masherbrum"]},
    {"name": "Fairy Meadows", "lat": 35.3858, "lng": 74.5805, "type": "settlement", "subtype": "meadow", "tags": ["fairy meadows", "nanga parbat", "raikot serai"]},
    {"name": "Nanga Parbat Viewpoint", "lat": 35.3192, "lng": 74.5903, "type": "viewpoint", "subtype": "mountain_view", "tags": ["nanga parbat", "base camp", "fairy meadows"]},
    {"name": "Rakaposhi Base Camp Trailhead", "lat": 36.1682, "lng": 74.4889, "type": "trailhead", "subtype": "trek_start", "tags": ["rakaposhi", "minapin", "hunza"]},
    {"name": "Rakaposhi Base Camp", "lat": 36.1425, "lng": 74.4892, "type": "camp", "subtype": "base_camp", "tags": ["rakaposhi", "base camp", "hunza"]},
    {"name": "Passu Glacier View Area", "lat": 36.4828, "lng": 74.8825, "type": "viewpoint", "subtype": "glacier_view", "tags": ["passu", "glacier", "hunza"]},
    {"name": "Borith Lake", "lat": 36.4269, "lng": 74.8617, "type": "water", "subtype": "lake", "tags": ["borith", "jheel", "lake", "hunza"]},
    {"name": "Attabad Lake", "lat": 36.3450, "lng": 74.8670, "type": "water", "subtype": "lake", "tags": ["attabad", "jheel", "lake", "hunza"]},
    {"name": "Skardu Support Area", "lat": 35.2971, "lng": 75.6333, "type": "settlement", "subtype": "support_town", "tags": ["skardu", "fuel", "food", "lodging", "permits"]},
    {"name": "Karimabad Support Area", "lat": 36.3167, "lng": 74.6500, "type": "settlement", "subtype": "support_town", "tags": ["karimabad", "hunza", "food", "lodging"]},
)

PAKISTAN_KARAKORAM_SERVICES: tuple[dict, ...] = (
    {"name": "Skardu Fuel and Supply Area", "lat": 35.2971, "lng": 75.6333, "type": "fuel", "subtype": "support_area", "tags": ["skardu", "fuel", "supplies", "approach"]},
    {"name": "Skardu Clinic and Pharmacy Area", "lat": 35.2978, "lng": 75.6339, "type": "medical", "subtype": "clinic_area", "tags": ["skardu", "clinic", "pharmacy", "medical"]},
    {"name": "Skardu Food and Bazaar Area", "lat": 35.2967, "lng": 75.6330, "type": "food", "subtype": "bazaar", "tags": ["skardu", "bazaar", "food", "grocery"]},
    {"name": "Karimabad Bazaar Area", "lat": 36.3167, "lng": 74.6500, "type": "food", "subtype": "bazaar", "tags": ["karimabad", "hunza", "bazaar", "food"]},
    {"name": "Aliabad Fuel and Supply Area", "lat": 36.3075, "lng": 74.6161, "type": "fuel", "subtype": "support_area", "tags": ["aliabad", "hunza", "fuel", "supplies"]},
    {"name": "Passu Support Area", "lat": 36.4828, "lng": 74.8825, "type": "lodging", "subtype": "guest_house_area", "tags": ["passu", "guest house", "food", "hunza"]},
    {"name": "Askole Checkpost / Staging Area", "lat": 35.6806, "lng": 75.8178, "type": "checkpost", "subtype": "staging_area", "tags": ["askole", "checkpost", "porter staging", "permits"]},
    {"name": "Hushe Staging Area", "lat": 35.4519, "lng": 76.3582, "type": "lodging", "subtype": "guest_house_area", "tags": ["hushe", "guest house", "staging"]},
)


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _safe_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:80]


def get_pakistan_curated_stays(lat: float, lng: float, radius_miles: float = 50) -> list[dict]:
    rows: list[dict] = []
    for item in PAKISTAN_KARAKORAM_STAYS:
        distance = _haversine_miles(lat, lng, float(item["lat"]), float(item["lng"]))
        if distance > radius_miles:
            continue
        tags = sorted(set(["pakistan", "karakoram", "mixed_source", "trekking", *(item.get("tags") or [])]))
        rows.append({
            "id": f"pk_karakoram_curated_{_safe_id(str(item['name']))}",
            "name": item["name"],
            "lat": item["lat"],
            "lng": item["lng"],
            "tags": tags,
            "land_type": item["land_type"],
            "description": "Curated Pakistan/Karakoram planning lead. Verify permits, guide requirements, access, safety, and current local conditions before relying on it.",
            "photo_url": None,
            "reservable": False,
            "cost": "Verify locally",
            "url": "https://visitgilgitbaltistan.gov.pk/",
            "official_url": "https://visitgilgitbaltistan.gov.pk/",
            "booking_url": "",
            "ada": False,
            "source": "pakistan_karakoram_curated",
            "source_tier": "mixed_curated",
            "verified_source": "Trailhead curated from OSM and official destination sources",
            "source_badge": "Trailhead mixed",
            "source_confidence": "mixed",
            "source_freshness": "Curated fallback for Pakistan mountain planning; verify all access, permits, safety, and availability locally.",
            "link_label": "Official tourism source",
            "rich_detail_available": False,
            "rich_detail_locked": False,
            "rich_detail_reason": "",
            "amenities": [],
            "site_types": [item["land_type"]],
            "distance_mi": round(distance, 2),
        })
    return sorted(rows, key=lambda row: float(row.get("distance_mi", 9999)))[:80]


def _curated_rows(items: tuple[dict, ...], lat: float, lng: float, radius_miles: float, *, source_name: str) -> list[dict]:
    rows: list[dict] = []
    for item in items:
        distance = _haversine_miles(lat, lng, float(item["lat"]), float(item["lng"]))
        if distance > radius_miles:
            continue
        tags = sorted(set(["pakistan", "karakoram", "mixed_source", *(item.get("tags") or [])]))
        rows.append({
            "id": f"pk_karakoram_curated_{_safe_id(str(item['name']))}",
            "name": item["name"],
            "lat": item["lat"],
            "lng": item["lng"],
            "type": item.get("type") or "poi",
            "subtype": item.get("subtype") or "",
            "tags": tags,
            "amenities": item.get("amenities") or [],
            "site_types": item.get("site_types") or [item.get("subtype") or item.get("type") or "Place"],
            "description": "Curated Pakistan/Karakoram planning lead. Verify permits, guide requirements, access, safety, and current local conditions before relying on it.",
            "official_url": "https://visitgilgitbaltistan.gov.pk/",
            "source": source_name,
            "source_badge": "Trailhead mixed",
            "source_confidence": "mixed",
            "source_freshness": "Curated fallback for Pakistan mountain planning; verify all access, permits, safety, and availability locally.",
            "distance_mi": round(distance, 2),
        })
    return sorted(rows, key=lambda row: float(row.get("distance_mi", 9999)))[:120]


def get_pakistan_curated_places(lat: float, lng: float, radius_miles: float = 50) -> list[dict]:
    return _curated_rows(PAKISTAN_KARAKORAM_PLACES, lat, lng, radius_miles, source_name="pakistan_karakoram_curated_places")


def get_pakistan_curated_services(lat: float, lng: float, radius_miles: float = 50) -> list[dict]:
    return _curated_rows(PAKISTAN_KARAKORAM_SERVICES, lat, lng, radius_miles, source_name="pakistan_karakoram_curated_services")
