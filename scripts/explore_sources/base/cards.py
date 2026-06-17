from __future__ import annotations

from .normalize import compact_text
from .schema import ExplorePlaceV3


CATEGORY_FALLBACKS = {
    "trail": "Mapped trail or route; check current trail conditions, permits, weather, daylight, and navigation before starting.",
    "trailhead": "Mapped trail access point; confirm parking, road conditions, closures, daylight, and route details before starting.",
    "waterfall": "Mapped waterfall or cascade; check trail access, seasonal flow, closures, and slippery terrain.",
    "campground": "Mapped camping location; check access, fees, fire restrictions, reservations, and seasonal road conditions.",
    "hut": "Backcountry shelter or hut; confirm condition, reservations, weather, and seasonal access.",
    "shelter": "Backcountry shelter or hut; confirm condition, reservations, weather, and seasonal access.",
    "climbing_area": "Mapped climbing area or crag; confirm access, closures, route information, land-manager rules, and current conditions.",
    "fuel": "Mapped service stop; verify hours, availability, road access, and payment options.",
    "resupply": "Mapped resupply stop; verify hours, availability, road access, and payment options.",
    "viewpoint": "Mapped viewpoint or overlook; check access, road conditions, weather, and daylight.",
    "peak": "Mapped summit or high point; verify route, weather, exposure, and land-manager rules.",
    "hot_spring": "Mapped hot spring; verify legality, temperature, access, water safety, and local rules.",
    "lake": "Mapped lake or reservoir; verify access, water safety, seasonal conditions, local rules, and weather.",
    "water_source": "Mapped water source; verify access, potability, season, and reliability before depending on it.",
    "glacier": "Mapped glacier or ice feature; verify access, glacier conditions, permits, guide needs, and weather.",
    "park": "Official park or protected area; check current access, fees, closures, permits, weather, and local rules.",
    "public_land": "Mapped public land or protected area; verify land rules, access, closures, and current restrictions.",
    "dispersed_camp": "Mapped dispersed camping area; confirm overnight limits, road access, fire restrictions, human-waste rules, and current closures.",
    "forest": "Official forest or ranger-district context; verify road access, fire restrictions, seasonal closures, and land-use rules.",
    "forest_road": "Mapped forest road or access route; verify vehicle suitability, gates, seasonal closures, snow, and road condition.",
    "offroad_route": "Mapped OHV or overland route; verify vehicle suitability, current route status, seasonal closures, permits, and land-manager rules.",
    "scenic_drive": "Mapped scenic drive or byway; verify road condition, seasonal closures, fuel range, weather, and daylight.",
}

PRIMARY_ACTIONS = {
    "trail": "Open trail",
    "trailhead": "Show access",
    "campground": "Check camping",
    "dispersed_camp": "Check camping",
    "fuel": "Route to fuel",
    "resupply": "Check hours",
    "offroad_route": "Open route",
    "scenic_drive": "Open drive",
}


def source_badge(place: ExplorePlaceV3) -> str:
    if place.quality == "official_source":
        return "Official source"
    if place.quality == "curated_trailhead":
        return "TrailHead curated"
    if place.quality == "community_verified":
        return "Community verified"
    if place.quality == "open_community_data":
        return "Open map data"
    if place.quality == "needs_verification":
        return "Needs verification"
    return "Basic map data"


def build_card(place: ExplorePlaceV3) -> ExplorePlaceV3:
    fallback = CATEGORY_FALLBACKS.get(place.category, "Mapped outdoor place; verify access, current conditions, and local rules before relying on it.")
    summary = compact_text(place.summary or place.description or fallback)
    facts = []
    if place.category:
        facts.append(place.category.replace("_", " ").title())
    if place.region:
        facts.append(place.region)
    if place.access:
        facts.append(place.access)
    warnings = ["Verify access", "Check official source or local rules", "Offline maps recommended"]
    if place.category in {"trail", "trailhead", "peak", "glacier"}:
        warnings.append("Check weather and daylight")
    place.card = {
        "headline": place.name or "Explore stop",
        "summary": summary,
        "quick_facts": facts[:4],
        "warnings": warnings[:4],
        "best_for": best_for(place.category),
        "source_badge": source_badge(place),
        "primary_action": PRIMARY_ACTIONS.get(place.category, "Show on map"),
        "secondary_actions": ["Save", "Route", "Weather"],
    }
    if not place.summary:
        place.summary = summary
    if not place.description:
        place.description = fallback
    return place


def best_for(category: str) -> list[str]:
    return {
        "trail": ["Hiking", "Route planning", "Weather checks"],
        "trailhead": ["Trail access", "Parking check", "Route start"],
        "campground": ["Overnight planning", "Fire rule checks", "Nearby trails"],
        "dispersed_camp": ["Wild camping", "Fire rule checks", "Road access"],
        "waterfall": ["Short detours", "Photos", "Flow checks"],
        "lake": ["Water access", "Scenic stops", "Weather checks"],
        "hut": ["Backcountry stays", "Weather checks", "Reservation planning"],
        "offroad_route": ["Overland routes", "Road status", "Vehicle planning"],
        "scenic_drive": ["Road trips", "Viewpoints", "Fuel planning"],
        "fuel": ["Road trips", "Range planning", "Service checks"],
        "resupply": ["Food", "Gear", "Trip support"],
    }.get(category, ["Map context", "Nearby stops", "Route planning"])
