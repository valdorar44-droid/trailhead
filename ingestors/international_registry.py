"""International outdoor provider registry.

Keeps country/region dispatch data-driven so new providers do not require
scattering bbox checks through API endpoints.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from config.settings import settings
from ingestors.australia_open_data import get_australia_open_data_campsites
from ingestors.canada_open_data import get_canada_open_data_campsites
from ingestors.nz_doc import get_nz_doc_campsites
from ingestors.osm import get_osm_outdoor_stays
from ingestors.pakistan_curated import get_pakistan_curated_stays

CampProvider = Callable[[float, float, float, list[str] | None], Awaitable[list[dict]]]


@dataclass(frozen=True)
class InternationalCampProvider:
    key: str
    country: str
    label: str
    bbox: tuple[float, float, float, float]
    source_tier: str
    feature_types: tuple[str, ...]
    provider: CampProvider
    enabled: Callable[[], bool]


def _point_in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float]) -> bool:
    min_lat, min_lng, max_lat, max_lng = bbox
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


async def _nz_doc_provider(lat: float, lng: float, radius: float, type_filters: list[str] | None) -> list[dict]:
    return await get_nz_doc_campsites(lat, lng, radius_miles=radius, type_filters=type_filters)


async def _australia_open_data_provider(lat: float, lng: float, radius: float, type_filters: list[str] | None) -> list[dict]:
    return await get_australia_open_data_campsites(lat, lng, radius_miles=radius, type_filters=type_filters)


async def _canada_open_data_provider(lat: float, lng: float, radius: float, type_filters: list[str] | None) -> list[dict]:
    return await get_canada_open_data_campsites(lat, lng, radius_miles=radius, type_filters=type_filters)


async def _pakistan_karakoram_provider(lat: float, lng: float, radius: float, type_filters: list[str] | None) -> list[dict]:
    radius_m = int(min(max(radius, 30), 60) * 1609.344)
    rows = get_pakistan_curated_stays(lat, lng, radius_miles=max(radius, 30))
    try:
        rows.extend(await get_osm_outdoor_stays(lat, lng, radius_m=radius_m, profile="pakistan_karakoram"))
    except Exception:
        pass
    return rows


INTERNATIONAL_CAMP_PROVIDERS: tuple[InternationalCampProvider, ...] = (
    InternationalCampProvider(
        key="nz_doc",
        country="NZ",
        label="New Zealand DOC",
        bbox=(-47.5, 165.0, -33.0, 179.9),
        source_tier="official_api",
        feature_types=("camp", "hut", "track"),
        provider=_nz_doc_provider,
        enabled=lambda: bool(settings.international_camp_providers_enabled and settings.nz_doc_api_key),
    ),
    InternationalCampProvider(
        key="australia_open_data",
        country="AU",
        label="Australian open data",
        bbox=(-44.5, 112.0, -10.0, 154.5),
        source_tier="official_open_data",
        feature_types=("camp", "caravan", "park"),
        provider=_australia_open_data_provider,
        enabled=lambda: bool(settings.international_camp_providers_enabled and settings.australia_open_data_enabled),
    ),
    InternationalCampProvider(
        key="canada_open_data",
        country="CA",
        label="Canadian open data",
        bbox=(41.0, -141.5, 84.5, -52.0),
        source_tier="official_open_data",
        feature_types=("camp", "provincial_park", "territorial_park"),
        provider=_canada_open_data_provider,
        enabled=lambda: bool(settings.international_camp_providers_enabled and settings.canada_open_data_enabled),
    ),
    InternationalCampProvider(
        key="pakistan_karakoram_osm",
        country="PK",
        label="Pakistan Karakoram mixed sources",
        bbox=(23.5, 60.5, 37.4, 77.9),
        source_tier="mixed_osm_curated",
        feature_types=("camp", "hut", "shelter", "trekking_lodge", "trail_area"),
        provider=_pakistan_karakoram_provider,
        enabled=lambda: bool(settings.international_camp_providers_enabled and settings.pakistan_mixed_source_enabled),
    ),
)


def matching_international_providers(lat: float, lng: float) -> list[InternationalCampProvider]:
    if not settings.international_camp_providers_enabled:
        return []
    return [
        provider
        for provider in INTERNATIONAL_CAMP_PROVIDERS
        if provider.enabled() and _point_in_bbox(lat, lng, provider.bbox)
    ]


def international_camp_tasks(lat: float, lng: float, radius: float, type_filters: list[str] | None) -> list[Awaitable[list[dict]]]:
    return [
        provider.provider(lat, lng, radius, type_filters)
        for provider in matching_international_providers(lat, lng)
    ]
