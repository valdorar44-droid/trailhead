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
    {"name": "Gilgit Support Area", "lat": 35.9208, "lng": 74.3084, "type": "settlement", "subtype": "support_town", "tags": ["gilgit", "fuel", "medical", "supplies", "kkh"]},
    {"name": "Chilas Support Area", "lat": 35.4213, "lng": 74.0969, "type": "settlement", "subtype": "support_town", "tags": ["chilas", "fuel", "food", "kkh"]},
    {"name": "Jaglot Junction", "lat": 35.6764, "lng": 74.6296, "type": "settlement", "subtype": "road_junction", "tags": ["jaglot", "kkh", "skardu road", "fuel"]},
    {"name": "Raikot Bridge Staging Area", "lat": 35.4162, "lng": 74.5890, "type": "trailhead", "subtype": "jeep_track_staging", "tags": ["raikot", "fairy meadows", "nanga parbat", "jeep track"]},
    {"name": "Shigar Support Area", "lat": 35.4267, "lng": 75.7342, "type": "settlement", "subtype": "support_town", "tags": ["shigar", "skardu", "food", "lodging"]},
    {"name": "Khaplu Support Area", "lat": 35.1646, "lng": 76.3433, "type": "settlement", "subtype": "support_town", "tags": ["khaplu", "hushe", "food", "lodging"]},
    {"name": "Deosai Plains Access Area", "lat": 35.0300, "lng": 75.4100, "type": "attraction", "subtype": "high_plateau", "tags": ["deosai", "seasonal", "high altitude", "road check"]},
    {"name": "Satpara Lake", "lat": 35.2283, "lng": 75.6318, "type": "water", "subtype": "lake", "tags": ["satpara", "jheel", "skardu", "water"]},
    {"name": "Shigar Fort Area", "lat": 35.4260, "lng": 75.7355, "type": "attraction", "subtype": "heritage", "tags": ["shigar", "fort", "heritage", "lodging"]},
    {"name": "Katpana Desert View Area", "lat": 35.3090, "lng": 75.5455, "type": "viewpoint", "subtype": "scenic_area", "tags": ["katpana", "skardu", "cold desert"]},
    {"name": "Hopper Valley / Nagar Staging Area", "lat": 36.2078, "lng": 74.7725, "type": "trailhead", "subtype": "trek_start", "tags": ["hopper", "nagar", "glacier", "hunza"]},
    {"name": "Minapin Rakaposhi Staging Area", "lat": 36.1682, "lng": 74.4889, "type": "trailhead", "subtype": "trek_start", "tags": ["minapin", "rakaposhi", "base camp"]},
    {"name": "Shimshal Staging Area", "lat": 36.4264, "lng": 75.3387, "type": "trailhead", "subtype": "remote_valley", "tags": ["shimshal", "passu", "remote road", "trekking"]},
    {"name": "Khunjerab Pass", "lat": 36.8497, "lng": 75.4306, "type": "pass", "subtype": "border_pass", "tags": ["khunjerab", "pass", "border", "high altitude"]},
    {"name": "Sost Support Area", "lat": 36.7100, "lng": 74.8570, "type": "settlement", "subtype": "border_support_town", "tags": ["sost", "fuel", "food", "customs", "khunjerab"]},
)

PAKISTAN_KARAKORAM_TREKS: tuple[dict, ...] = (
    {
        "name": "K2 Base Camp Trek",
        "lat": 35.7455,
        "lng": 76.5142,
        "type": "trek",
        "feature_type": "trek",
        "subtype": "multi_day_glacier_trek",
        "area_name": "K2 / Baltoro / Concordia",
        "summary": "Multi-day Karakoram trek from Askole through Baltoro Glacier toward Concordia and K2 Base Camp.",
        "route_type": "Multi-day trek",
        "difficulty": "Expedition trek",
        "length_mi": 62.0,
        "typical_time": "12-18 days",
        "best_season": "June-September",
        "season_window": "June-September",
        "altitude_ft": 16900,
        "trekking_only": True,
        "guide_required": True,
        "permit_note": "Verify permits, licensed guide/porter requirements, and current access in Skardu or Askole.",
        "glacier_crossing": True,
        "route_lat": 35.6806,
        "route_lng": 75.8178,
        "route_name": "Askole Trailhead",
        "tags": ["k2", "baltoro", "concordia", "base camp", "glacier", "trekking only"],
        "warnings": [
            "Trekking-only corridor; do not use as vehicle navigation.",
            "Verify guide, permit, bridge, glacier, weather, and local safety conditions.",
        ],
        "official_url": "https://visitgilgitbaltistan.gov.pk/",
    },
    {
        "name": "Baltoro Glacier",
        "lat": 35.7391,
        "lng": 76.3482,
        "type": "glacier",
        "feature_type": "glacier",
        "subtype": "glacier",
        "area_name": "Central Karakoram",
        "summary": "Major Karakoram glacier on the K2 Base Camp approach, used here as an informational map feature.",
        "route_type": "Glacier feature",
        "difficulty": "Guide required",
        "best_season": "June-September",
        "season_window": "June-September",
        "trekking_only": True,
        "guide_required": True,
        "permit_note": "Treat glacier travel as guided expedition terrain; verify current conditions locally.",
        "glacier_crossing": True,
        "route_lat": 35.6806,
        "route_lng": 75.8178,
        "route_name": "Askole Trailhead",
        "tags": ["baltoro", "glacier", "k2", "concordia", "trekking only"],
        "warnings": ["Glacier feature for planning context only; not a safety assessment."],
        "official_url": "https://visitgilgitbaltistan.gov.pk/",
    },
    {
        "name": "Godwin-Austen Glacier",
        "lat": 35.8466,
        "lng": 76.5050,
        "type": "glacier",
        "feature_type": "glacier",
        "subtype": "glacier",
        "area_name": "K2 Base Camp",
        "summary": "Glacier system near K2 Base Camp, shown as an informational high-altitude trek feature.",
        "route_type": "Glacier feature",
        "difficulty": "Guide required",
        "best_season": "June-September",
        "season_window": "June-September",
        "trekking_only": True,
        "guide_required": True,
        "permit_note": "Verify expedition permits, guide support, weather, and glacier conditions.",
        "glacier_crossing": True,
        "route_lat": 35.6806,
        "route_lng": 75.8178,
        "route_name": "Askole Trailhead",
        "tags": ["godwin-austen", "glacier", "k2", "base camp", "trekking only"],
        "warnings": ["Glacier feature for planning context only; not a safety assessment."],
        "official_url": "https://visitgilgitbaltistan.gov.pk/",
    },
    {
        "name": "Gondogoro La Trek",
        "lat": 35.5906,
        "lng": 76.5586,
        "type": "trek",
        "feature_type": "pass",
        "subtype": "high_pass",
        "area_name": "Hushe / Concordia",
        "summary": "High pass trek linking the Baltoro/Concordia side with Hushe, subject to guide, rope, snow, and seasonal conditions.",
        "route_type": "High pass trek",
        "difficulty": "Expedition trek",
        "typical_time": "10-16 days",
        "best_season": "July-August",
        "season_window": "July-August",
        "altitude_ft": 18400,
        "trekking_only": True,
        "guide_required": True,
        "permit_note": "Verify guide, rope team, permit, and pass opening locally.",
        "glacier_crossing": True,
        "route_lat": 35.4519,
        "route_lng": 76.3582,
        "route_name": "Hushe Trailhead",
        "tags": ["gondogoro", "la", "pass", "hushe", "concordia", "guide required"],
        "warnings": ["High pass conditions can change quickly; verify locally before committing."],
        "official_url": "https://visitgilgitbaltistan.gov.pk/",
    },
    {
        "name": "Fairy Meadows / Nanga Parbat Base Camp Trek",
        "lat": 35.3525,
        "lng": 74.5774,
        "type": "trek",
        "feature_type": "trek",
        "subtype": "base_camp_trek",
        "area_name": "Nanga Parbat / Diamer",
        "summary": "Nanga Parbat trek area reached from Raikot Bridge and Fairy Meadows, with jeep-road and footpath access constraints.",
        "route_type": "Out and back trek",
        "difficulty": "Hard",
        "typical_time": "2-4 days",
        "best_season": "May-October",
        "season_window": "May-October",
        "altitude_ft": 13000,
        "trekking_only": True,
        "guide_required": False,
        "permit_note": "Verify jeep access, local rules, weather, and trail conditions at Raikot Bridge or Fairy Meadows.",
        "glacier_crossing": False,
        "route_lat": 35.4162,
        "route_lng": 74.5890,
        "route_name": "Raikot Bridge Staging Area",
        "tags": ["fairy meadows", "nanga parbat", "base camp", "raikot", "trekking"],
        "warnings": ["Route to the staging area first; jeep track and trail conditions must be checked locally."],
        "official_url": "https://visitgilgitbaltistan.gov.pk/",
    },
    {
        "name": "Rakaposhi Base Camp Trek",
        "lat": 36.1425,
        "lng": 74.4892,
        "type": "trek",
        "feature_type": "trek",
        "subtype": "base_camp_trek",
        "area_name": "Minapin / Nagar",
        "summary": "Hunza-Nagar trek from Minapin toward Rakaposhi Base Camp, with glacier and high-mountain views.",
        "route_type": "Out and back trek",
        "difficulty": "Hard",
        "typical_time": "2-3 days",
        "best_season": "May-October",
        "season_window": "May-October",
        "trekking_only": True,
        "guide_required": False,
        "permit_note": "Verify local trail, weather, and overnight rules before departure.",
        "glacier_crossing": False,
        "route_lat": 36.1682,
        "route_lng": 74.4889,
        "route_name": "Minapin Staging Area",
        "tags": ["rakaposhi", "minapin", "base camp", "hunza", "nagar"],
        "warnings": ["Mountain weather and access can change quickly; verify locally."],
        "official_url": "https://visitgilgitbaltistan.gov.pk/",
    },
    {
        "name": "Passu Glacier View Trek",
        "lat": 36.4828,
        "lng": 74.8825,
        "type": "trek",
        "feature_type": "glacier",
        "subtype": "glacier_view",
        "area_name": "Upper Hunza / Passu",
        "summary": "Upper Hunza glacier-view area near Passu and Borith, useful for short treks and viewpoint planning.",
        "route_type": "Glacier view trek",
        "difficulty": "Moderate",
        "typical_time": "Half day",
        "best_season": "May-October",
        "season_window": "May-October",
        "trekking_only": True,
        "guide_required": False,
        "permit_note": "Verify local trail access, bridge status, and weather.",
        "glacier_crossing": False,
        "route_lat": 36.4828,
        "route_lng": 74.8825,
        "route_name": "Passu Staging Area",
        "tags": ["passu", "glacier", "borith", "hunza", "viewpoint"],
        "warnings": ["Glacier-view route only; do not enter glacier terrain without local guidance."],
        "official_url": "https://visitgilgitbaltistan.gov.pk/",
    },
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
    {"name": "Gilgit Fuel and Supply Area", "lat": 35.9208, "lng": 74.3084, "type": "fuel", "subtype": "support_area", "tags": ["gilgit", "fuel", "supplies", "kkh"]},
    {"name": "Gilgit Medical Area", "lat": 35.9220, "lng": 74.3092, "type": "medical", "subtype": "hospital_area", "tags": ["gilgit", "hospital", "clinic", "medical"]},
    {"name": "Chilas Fuel and Food Area", "lat": 35.4213, "lng": 74.0969, "type": "fuel", "subtype": "support_area", "tags": ["chilas", "fuel", "food", "kkh"]},
    {"name": "Jaglot Fuel / Junction Area", "lat": 35.6764, "lng": 74.6296, "type": "fuel", "subtype": "road_junction", "tags": ["jaglot", "fuel", "skardu road", "kkh"]},
    {"name": "Shigar Food and Lodging Area", "lat": 35.4267, "lng": 75.7342, "type": "food", "subtype": "bazaar", "tags": ["shigar", "food", "lodging", "skardu"]},
    {"name": "Khaplu Food and Lodging Area", "lat": 35.1646, "lng": 76.3433, "type": "food", "subtype": "bazaar", "tags": ["khaplu", "food", "lodging", "hushe"]},
    {"name": "Aliabad Clinic Area", "lat": 36.3075, "lng": 74.6161, "type": "medical", "subtype": "clinic_area", "tags": ["aliabad", "hunza", "clinic", "medical"]},
    {"name": "Sost Fuel and Border Support Area", "lat": 36.7100, "lng": 74.8570, "type": "fuel", "subtype": "border_support", "tags": ["sost", "fuel", "customs", "khunjerab"]},
    {"name": "Khunjerab Checkpost Area", "lat": 36.8497, "lng": 75.4306, "type": "checkpost", "subtype": "border_pass", "tags": ["khunjerab", "checkpost", "border", "high altitude"]},
    {"name": "Raikot Bridge Jeep Staging Area", "lat": 35.4162, "lng": 74.5890, "type": "parking", "subtype": "jeep_track_staging", "tags": ["raikot", "fairy meadows", "parking", "jeep"]},
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
            **{
                key: item[key]
                for key in (
                    "feature_type", "area_name", "summary", "route_type", "difficulty", "length_mi",
                    "typical_time", "best_season", "season_window", "altitude_ft", "trekking_only",
                    "guide_required", "permit_note", "glacier_crossing", "route_lat", "route_lng",
                    "route_name", "warnings",
                )
                if key in item
            },
        })
    return sorted(rows, key=lambda row: float(row.get("distance_mi", 9999)))[:120]


def get_pakistan_curated_places(lat: float, lng: float, radius_miles: float = 50) -> list[dict]:
    return _curated_rows(PAKISTAN_KARAKORAM_PLACES, lat, lng, radius_miles, source_name="pakistan_karakoram_curated_places")


def get_pakistan_curated_services(lat: float, lng: float, radius_miles: float = 50) -> list[dict]:
    return _curated_rows(PAKISTAN_KARAKORAM_SERVICES, lat, lng, radius_miles, source_name="pakistan_karakoram_curated_services")


def get_pakistan_curated_treks(lat: float, lng: float, radius_miles: float = 80) -> list[dict]:
    return _curated_rows(PAKISTAN_KARAKORAM_TREKS, lat, lng, radius_miles, source_name="pakistan_karakoram_curated_treks")
