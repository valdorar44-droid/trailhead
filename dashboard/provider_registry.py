"""Provider registry and source-confidence scoring for Trailhead data."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import time
from typing import Any


@dataclass(frozen=True)
class ProviderMetadata:
    id: str
    name: str
    source_type: str
    update_cadence: str
    storage_rules: str
    attribution_text: str
    license_url: str
    freshness_label: str
    confidence_default: int
    allowed_surfaces: tuple[str, ...]
    offline_allowed: bool
    derivative_constraints: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["allowed_surfaces"] = list(self.allowed_surfaces)
        return data


PROVIDER_REGISTRY: dict[str, ProviderMetadata] = {
    "nps": ProviderMetadata(
        id="nps",
        name="National Park Service API",
        source_type="official",
        update_cadence="live API or cached import",
        storage_rules="Cache normalized park/place/alert fields with NPS attribution.",
        attribution_text="National Park Service",
        license_url="https://www.nps.gov/aboutus/disclaimer.htm",
        freshness_label="Official NPS data",
        confidence_default=88,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Do not imply live conditions when using cached records.",
    ),
    "ridb": ProviderMetadata(
        id="ridb",
        name="RIDB / Recreation.gov",
        source_type="official",
        update_cadence="live API or cached import",
        storage_rules="Cache facility, recreation area, and campsite fields with federal attribution.",
        attribution_text="Recreation.gov / RIDB",
        license_url="https://ridb.recreation.gov/docs",
        freshness_label="Official federal recreation data",
        confidence_default=86,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Booking, permit, and availability handoffs must go to the official/partner surface.",
    ),
    "recreation.gov": ProviderMetadata(
        id="recreation.gov",
        name="Recreation.gov",
        source_type="official",
        update_cadence="live API or cached import",
        storage_rules="Cache official recreation metadata; keep reservation/availability handoff explicit.",
        attribution_text="Recreation.gov",
        license_url="https://ridb.recreation.gov/docs",
        freshness_label="Official recreation data",
        confidence_default=86,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Do not cache or claim live booking availability without a fresh provider response.",
    ),
    "usfs": ProviderMetadata(
        id="usfs",
        name="USFS open data / FSGeodata",
        source_type="official",
        update_cadence="source-pack import",
        storage_rules="Cache normalized trail, recreation, and MVUM context with agency attribution.",
        attribution_text="USDA Forest Service",
        license_url="https://www.fs.usda.gov/about-agency/open-government",
        freshness_label="USFS open data",
        confidence_default=84,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="MVUM/legal access is not live gate status; show that distinction.",
    ),
    "blm": ProviderMetadata(
        id="blm",
        name="BLM open data",
        source_type="official",
        update_cadence="source-pack import",
        storage_rules="Cache normalized public-land and recreation context with agency attribution.",
        attribution_text="Bureau of Land Management",
        license_url="https://www.blm.gov/about/data",
        freshness_label="BLM open data",
        confidence_default=83,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Legal camping/access confidence must stay separate from inferred suitability.",
    ),
    "pakistan_gov": ProviderMetadata(
        id="pakistan_gov",
        name="Pakistan government tourism and wildlife portals",
        source_type="official",
        update_cadence="source-pack import",
        storage_rules="Cache normalized park, trail, wildlife, and advisory context with portal attribution.",
        attribution_text="Government of Pakistan regional tourism and wildlife portals",
        license_url="https://visitgilgitbaltistan.gov.pk/",
        freshness_label="Official regional source",
        confidence_default=78,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Do not infer permit, road, border, security, or guide status from static portal copy; surface those as verify-first notes.",
    ),
    "usgs": ProviderMetadata(
        id="usgs",
        name="USGS",
        source_type="official",
        update_cadence="source-pack import or live API",
        storage_rules="Cache normalized trails, topo, water, and geospatial records with source attribution.",
        attribution_text="U.S. Geological Survey",
        license_url="https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
        freshness_label="USGS source data",
        confidence_default=82,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Water and hazard values need timestamped freshness when surfaced as conditions.",
    ),
    "osm": ProviderMetadata(
        id="osm",
        name="OpenStreetMap",
        source_type="open_community",
        update_cadence="Geofabrik/Overpass import",
        storage_rules="Cache derived normalized features with ODbL attribution.",
        attribution_text="OpenStreetMap contributors",
        license_url="https://www.openstreetmap.org/copyright",
        freshness_label="Open map data",
        confidence_default=60,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Preserve attribution; do not overclaim access, difficulty, or legality from tags alone.",
    ),
    "geofabrik": ProviderMetadata(
        id="geofabrik",
        name="Geofabrik OSM extracts",
        source_type="open_community",
        update_cadence="source-pack import",
        storage_rules="Cache derived normalized features with ODbL attribution.",
        attribution_text="OpenStreetMap contributors via Geofabrik",
        license_url="https://www.geofabrik.de/geofabrik/geofabrik.html",
        freshness_label="OSM extract data",
        confidence_default=60,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Preserve OSM attribution and do not infer legal access without official corroboration.",
    ),
    "overpass": ProviderMetadata(
        id="overpass",
        name="Overpass / OSM",
        source_type="open_community",
        update_cadence="live/cached query",
        storage_rules="Cache only normalized results needed by Trailhead with OSM attribution.",
        attribution_text="OpenStreetMap contributors",
        license_url="https://www.openstreetmap.org/copyright",
        freshness_label="Open map query",
        confidence_default=58,
        allowed_surfaces=("explore", "map", "mission_control", "copilot"),
        offline_allowed=True,
        derivative_constraints="Respect OSM attribution and provider rate limits; avoid public Nominatim/systematic tile scraping.",
    ),
    "openbeta": ProviderMetadata(
        id="openbeta",
        name="OpenBeta",
        source_type="open_community",
        update_cadence="source-pack import",
        storage_rules="Cache normalized climbing area metadata with attribution.",
        attribution_text="OpenBeta",
        license_url="https://openbeta.io/about",
        freshness_label="Open climbing data",
        confidence_default=62,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Do not mix with Mountain Project proprietary route text or photos.",
    ),
    "wikidata": ProviderMetadata(
        id="wikidata",
        name="Wikidata",
        source_type="open",
        update_cadence="SPARQL import",
        storage_rules="Cache entity IDs, labels, coordinates, and Commons references with attribution.",
        attribution_text="Wikidata",
        license_url="https://www.wikidata.org/wiki/Wikidata:Licensing",
        freshness_label="Open entity data",
        confidence_default=56,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Use for identity/geography; do not treat as current access or condition source.",
    ),
    "wikipedia": ProviderMetadata(
        id="wikipedia",
        name="Wikipedia / Wikimedia Commons",
        source_type="open",
        update_cadence="source-pack import",
        storage_rules="Cache short extracts and media references with license/credit attribution.",
        attribution_text="Wikipedia / Wikimedia Commons contributors",
        license_url="https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
        freshness_label="Open reference data",
        confidence_default=54,
        allowed_surfaces=("explore", "map", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Respect article/media license and avoid claiming current conditions.",
    ),
    "viator": ProviderMetadata(
        id="viator",
        name="Viator",
        source_type="commercial_partner",
        update_cadence="live API/cache per partner terms",
        storage_rules="Follow partner cache rules; prefer live product/availability handoff.",
        attribution_text="Viator partner content",
        license_url="https://partnerresources.viator.com/",
        freshness_label="Partner experience data",
        confidence_default=68,
        allowed_surfaces=("explore", "mission_control", "copilot"),
        offline_allowed=False,
        derivative_constraints="Do not show stale availability/pricing as current; keep affiliate/partner handoff clear.",
    ),
    "outdoorsy": ProviderMetadata(
        id="outdoorsy",
        name="Outdoorsy",
        source_type="commercial_partner",
        update_cadence="TUNE affiliate links when configured; live rental inventory cadence is unconfirmed.",
        storage_rules="Store only normalized OutdoorOffer fields allowed by contract. Do not store raw TUNE or rental payloads, mirror provider images, or persist full listings until cache/content rights are confirmed.",
        attribution_text="Outdoorsy partner content",
        license_url="https://developers.tune.com/affiliate",
        freshness_label="Partner rental data",
        confidence_default=66,
        allowed_surfaces=("route_builder", "planner", "copilot", "library", "explore"),
        offline_allowed=False,
        derivative_constraints="Provider states: disabled, fixture_only, configured_affiliate_link, live_read_only, live_external_checkout, future_booking. Do not expose exact private pickup locations, stale availability, unconfirmed prices, or in-app booking claims.",
    ),
    "mapbox": ProviderMetadata(
        id="mapbox",
        name="Mapbox Search / Weather / Navigation",
        source_type="commercial",
        update_cadence="live API",
        storage_rules="Respect Mapbox temporary-use and service-specific terms.",
        attribution_text="Mapbox",
        license_url="https://www.mapbox.com/legal/tos",
        freshness_label="Live Mapbox data",
        confidence_default=72,
        allowed_surfaces=("map", "mission_control", "copilot"),
        offline_allowed=False,
        derivative_constraints="Do not cache/store restricted Search content beyond permitted temporary use; navigation billing requires explicit sessions.",
    ),
    "airnow": ProviderMetadata(
        id="airnow",
        name="AirNow",
        source_type="official",
        update_cadence="live API/cache",
        storage_rules="Cache timestamped AQI observations/forecasts with source attribution.",
        attribution_text="AirNow",
        license_url="https://www.airnow.gov/",
        freshness_label="Official air quality data",
        confidence_default=82,
        allowed_surfaces=("map", "mission_control", "copilot"),
        offline_allowed=False,
        derivative_constraints="Always show timestamp and do not extrapolate beyond provider geography/time window.",
    ),
    "nws": ProviderMetadata(
        id="nws",
        name="National Weather Service",
        source_type="official",
        update_cadence="live API/cache",
        storage_rules="Cache timestamped forecasts/alerts with weather.gov attribution.",
        attribution_text="National Weather Service",
        license_url="https://www.weather.gov/disclaimer",
        freshness_label="Official weather data",
        confidence_default=84,
        allowed_surfaces=("map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Cached forecasts must be labeled as cached and time-bound.",
    ),
    "firms": ProviderMetadata(
        id="firms",
        name="NASA FIRMS / WFIGS fire data",
        source_type="official",
        update_cadence="live API/cache",
        storage_rules="Cache timestamped fire hotspot/perimeter records with source attribution.",
        attribution_text="NASA FIRMS / WFIGS",
        license_url="https://firms.modaps.eosdis.nasa.gov/",
        freshness_label="Official fire data",
        confidence_default=82,
        allowed_surfaces=("map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Hotspots/perimeters are risk context, not evacuation guidance.",
    ),
    "natural_earth": ProviderMetadata(
        id="natural_earth",
        name="Natural Earth",
        source_type="open",
        update_cadence="source-pack import",
        storage_rules="Cache generalized geography/boundary context.",
        attribution_text="Natural Earth",
        license_url="https://www.naturalearthdata.com/about/terms-of-use/",
        freshness_label="Open geography data",
        confidence_default=55,
        allowed_surfaces=("map", "explore", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Use for generalized context, not precise access rules.",
    ),
    "trailhead_curated": ProviderMetadata(
        id="trailhead_curated",
        name="Trailhead curated data",
        source_type="first_party",
        update_cadence="curated release",
        storage_rules="Trailhead-owned normalized records with source notes.",
        attribution_text="Trailhead",
        license_url="",
        freshness_label="Trailhead curated",
        confidence_default=74,
        allowed_surfaces=("explore", "map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Keep source notes and avoid claiming official status unless backed by official data.",
    ),
    "trailhead_user": ProviderMetadata(
        id="trailhead_user",
        name="Trailhead community reports",
        source_type="community",
        update_cadence="live/community",
        storage_rules="Store user reports with privacy, moderation, TTL, and abuse controls.",
        attribution_text="Trailhead community",
        license_url="",
        freshness_label="Community report",
        confidence_default=52,
        allowed_surfaces=("map", "mission_control", "copilot", "offline"),
        offline_allowed=True,
        derivative_constraints="Decay stale reports and lower confidence for unconfirmed/conflicting reports.",
    ),
}

PROHIBITED_SYSTEMATIC_SOURCES = {
    "alltrails",
    "hipcamp",
    "glampinghub",
    "mountain_project",
    "ioverlander",
    "wikicamps",
    "public_osm_tiles",
    "public_nominatim",
}

SOURCE_ALIASES = {
    "recreationgov": "recreation.gov",
    "recreation_gov": "recreation.gov",
    "usda_forest_service": "usfs",
    "fsgeodata": "usfs",
    "usgs_digital_trails": "usgs",
    "openstreetmap": "osm",
    "osm_overpass": "overpass",
    "wikimedia": "wikipedia",
    "wfigs": "firms",
    "nasa_firms": "firms",
    "community": "trailhead_user",
    "trailhead": "trailhead_curated",
}


def normalize_provider_id(value: object) -> str:
    key = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    key = key.strip("_")
    return SOURCE_ALIASES.get(key, key)


def provider_metadata(source: object) -> ProviderMetadata | None:
    return PROVIDER_REGISTRY.get(normalize_provider_id(source))


def list_provider_metadata() -> list[dict[str, Any]]:
    return [provider.to_dict() for provider in sorted(PROVIDER_REGISTRY.values(), key=lambda item: item.id)]


def assert_provider_allowed(source: str) -> None:
    key = normalize_provider_id(source)
    if key in PROHIBITED_SYSTEMATIC_SOURCES:
        raise ValueError(f"source is not permitted for systematic import: {source}")
    if key not in PROVIDER_REGISTRY:
        raise ValueError(f"unknown provider registry source: {source}")


def _source_ref_id(source_ref: dict[str, Any]) -> str:
    return normalize_provider_id(
        source_ref.get("source")
        or source_ref.get("publisher")
        or source_ref.get("name")
        or source_ref.get("kind")
        or source_ref.get("title")
    )


def _is_recent(ts: int | float | None, now: int, days: int = 45) -> bool:
    return bool(ts and ts > 0 and now - int(ts) <= days * 86_400)


def _is_stale(ts: int | float | None, now: int, days: int = 365) -> bool:
    return bool(ts and ts > 0 and now - int(ts) > days * 86_400)


def source_quality_summary(
    sources: list[dict[str, Any]] | None,
    *,
    fetched_at: int | None = None,
    last_seen_at: int | None = None,
    community_confirmations: int = 0,
    inferred: bool = False,
    unknown_access: bool = False,
    now: int | None = None,
) -> dict[str, Any]:
    now = int(now or time.time())
    refs = [src for src in (sources or []) if isinstance(src, dict)]
    provider_ids = [_source_ref_id(src) for src in refs]
    providers = [PROVIDER_REGISTRY[pid] for pid in provider_ids if pid in PROVIDER_REGISTRY]
    primary = providers[0] if providers else None
    official = any(provider.source_type == "official" for provider in providers)
    recent = _is_recent(last_seen_at or fetched_at, now)
    stale = _is_stale(last_seen_at or fetched_at, now)
    multiple_sources = len({provider.id for provider in providers}) > 1 or len(refs) > 1

    score = 35
    factors: list[str] = []
    if official:
        score += 40
        factors.append("official")
    if recent:
        score += 20
        factors.append("recent")
    if multiple_sources:
        score += 15
        factors.append("multiple_sources")
    if community_confirmations > 0:
        score += 15
        factors.append("community_confirmed")
    if stale:
        score -= 20
        factors.append("stale")
    if inferred:
        score -= 20
        factors.append("inferred")
    if unknown_access:
        score -= 30
        factors.append("unknown_access")

    if primary and not official:
        score = max(score, primary.confidence_default)

    score = max(0, min(100, int(round(score))))
    if score >= 85:
        label = "high"
    elif score >= 65:
        label = "medium"
    elif score >= 40:
        label = "review"
    else:
        label = "low"

    return {
        "score": score,
        "label": label,
        "factors": factors,
        "primary_provider": primary.id if primary else "",
        "primary_name": primary.name if primary else "",
        "provider_ids": sorted({provider.id for provider in providers}),
        "freshness_label": primary.freshness_label if primary else "Source freshness unknown",
        "attribution": primary.attribution_text if primary else "",
        "offline_allowed": bool(primary.offline_allowed) if primary else False,
    }
