"""Immutable, renderer-aware offline bundle preparation.

The V2 manifest is generated from server-owned catalog snapshots. Clients
choose only a bounded area and options; renderer/style, bundle IDs, revisions,
artifact hashes, record counts, and source metadata stay server-owned.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator


OFFLINE_BUNDLE_SCHEMA_VERSION = 2
SHA256_HEX_RE = re.compile(r"^[a-f0-9]{64}$")
SAFE_REVISION_RE = re.compile(r"^[a-zA-Z0-9._:-]{1,120}$")
CATALOG_ROOT = Path(__file__).resolve().parent


class OfflineBundlePreparationError(ValueError):
    """A safe, client-facing preparation failure."""

    def __init__(self, code: str, message: str, *, http_status: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


class OfflineBoundsV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)

    @model_validator(mode="after")
    def validate_box(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("bounds must be a valid west/south/east/north box")
        # V2 excludes antimeridian wrapping. A future schema can model split
        # regions without making existing manifests ambiguous.
        if self.east - self.west > 12 or self.north - self.south > 12:
            raise ValueError("selected areas cannot span more than 12 degrees")
        return self


class OfflineBundleOptionsV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    routing: bool = False
    contours: bool = False
    extended_media: bool = False


class OfflineTrailScopeV2(BaseModel):
    """Server-resolved identity for one complete canonical trail pack."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["trail"] = "trail"
    trail_id: str = Field(
        min_length=3,
        max_length=240,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$",
    )
    geometry_revision: str = Field(min_length=3, max_length=240)
    corridor_m: int = Field(default=1200, ge=250, le=5000)


class OfflineBundlePrepareRequestV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    bounds: OfflineBoundsV2
    min_zoom: int = Field(default=6, ge=0, le=24)
    max_zoom: int = Field(default=14, ge=0, le=24)
    # Clients select only a server-approved identifier. They can never submit
    # an arbitrary style URI or revision.
    renderer_style_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$",
    )
    scope: OfflineTrailScopeV2 | None = None
    options: OfflineBundleOptionsV2 = Field(default_factory=OfflineBundleOptionsV2)

    @model_validator(mode="after")
    def validate_zoom_range(self):
        if self.min_zoom > self.max_zoom:
            raise ValueError("min_zoom cannot exceed max_zoom")
        if self.max_zoom - self.min_zoom > 14:
            raise ValueError("zoom range is too large for one offline bundle")
        return self


class OfflineBundleArtifactV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    kind: Literal[
        "map_style", "map_tiles", "places", "trails", "search_index",
        "routing", "contours", "thumbnail", "media",
    ]
    storage: Literal[
        "file", "renderer_style_pack", "renderer_tile_region", "renderer_legacy_pack",
    ]
    required: bool
    revision: str
    bytes: int = Field(ge=0)
    size_kind: Literal["exact", "estimated"]
    integrity: Literal["sha256", "renderer_probe"]
    sha256: str | None = None
    uri: str | None = None
    media_type: str | None = None
    record_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_descriptor(self):
        if self.storage == "file":
            if not self.uri:
                raise ValueError("file artifacts require a URI")
            if self.size_kind != "exact" or self.integrity != "sha256":
                raise ValueError("file artifacts require exact size and SHA-256 integrity")
            if not self.sha256 or not SHA256_HEX_RE.fullmatch(self.sha256):
                raise ValueError("file artifact sha256 must be a SHA-256 hex digest")
        else:
            if self.uri is not None or self.sha256 is not None:
                raise ValueError("renderer artifacts cannot advertise file URLs or checksums")
            if self.size_kind != "estimated" or self.integrity != "renderer_probe":
                raise ValueError("renderer artifacts require renderer-probe integrity")
        return self


class OfflineBundleCapabilitiesV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    map: bool
    places: bool
    trails: bool
    search: bool
    routing: bool
    contours: bool
    media: bool


class OfflineBundleRendererV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Literal["rnmapbox", "maplibre"]
    style_id: str | None = Field(default=None, max_length=64)
    style_uri: str
    style_revision: str
    style_pack_id: str
    tile_region_id: str


class OfflineBundleManifestV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[2] = OFFLINE_BUNDLE_SCHEMA_VERSION
    bundle_id: str
    revision: str
    manifest_sha256: str
    created_at: str
    renderer: OfflineBundleRendererV2
    bounds: OfflineBoundsV2
    min_zoom: int
    max_zoom: int
    scope: OfflineTrailScopeV2 | None = None
    artifacts: tuple[OfflineBundleArtifactV2, ...]
    capabilities: OfflineBundleCapabilitiesV2
    required_storage_bytes: int = Field(ge=0)
    source_attribution: tuple[str, ...]
    license_ids: tuple[str, ...]
    replaces_revisions: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_manifest_digest(self):
        if not SHA256_HEX_RE.fullmatch(self.manifest_sha256):
            raise ValueError("manifest_sha256 must be a SHA-256 hex digest")
        return self


class OfflineBundlePreparationIssueV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=500)


class OfflineBundlePreparationV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[2] = OFFLINE_BUNDLE_SCHEMA_VERSION
    id: str = Field(min_length=8, max_length=100)
    status: Literal["queued", "running", "ready", "error"]
    progress: int = Field(ge=0, le=100)
    bundle_id: str | None = Field(default=None, max_length=80)
    revision: str | None = Field(default=None, max_length=80)
    manifest: OfflineBundleManifestV2 | None = None
    error: OfflineBundlePreparationIssueV2 | None = None
    created_at: int
    updated_at: int
    completed_at: int | None = None


@dataclass(frozen=True)
class OfflineCatalogItemV2:
    item_id: str
    kind: Literal["place", "trail"]
    lat: float
    lng: float
    source_label: str
    license_id: str
    attribution: str
    licensed_thumbnail: bool = False
    # Places use their point. Trails must carry real geometry bounds; an
    # arbitrary label/anchor point is not sufficient to claim area coverage.
    spatial_bounds: tuple[float, float, float, float] | None = None
    title: str = ""
    subtitle: str = ""
    category: str = ""
    parent_destination: str = ""
    aliases: tuple[str, ...] = ()
    document: dict | None = None
    geometry: dict | None = None
    thumbnail_url: str | None = None
    thumbnail_license_id: str | None = None
    thumbnail_attribution: str | None = None


@dataclass(frozen=True)
class OfflineCatalogSnapshotV2:
    revision: str
    generated_at: int
    items: tuple[OfflineCatalogItemV2, ...]


@dataclass(frozen=True)
class OfflineRendererConfigV2:
    id: Literal["rnmapbox", "maplibre"]
    style_uri: str
    style_revision: str
    style_id: str = "server_default"


@dataclass(frozen=True)
class OfflineMaterializedArtifactV2:
    """A server-trusted, already-materialized file artifact.

    Preparation never invents one of these. The path must exist so its exact
    byte size and digest can be bound into the immutable manifest, and ``uri``
    must point at a separately implemented delivery endpoint.
    """

    kind: Literal[
        "places", "trails", "search_index", "routing", "contours", "thumbnail", "media",
    ]
    path: Path
    uri: str
    revision: str
    media_type: str
    record_count: int


_SOURCE_RIGHTS = {
    "osm": ("ODbL-1.0", "OpenStreetMap contributors"),
    "openstreetmap": ("ODbL-1.0", "OpenStreetMap contributors"),
    "nps": ("US-FEDERAL-PUBLIC-DATA", "National Park Service"),
    "usfs": ("US-FEDERAL-PUBLIC-DATA", "U.S. Forest Service"),
    "u.s. forest service": ("US-FEDERAL-PUBLIC-DATA", "U.S. Forest Service"),
    "blm": ("US-FEDERAL-PUBLIC-DATA", "Bureau of Land Management"),
    "bureau of land management": ("US-FEDERAL-PUBLIC-DATA", "Bureau of Land Management"),
    "national park service": ("US-FEDERAL-PUBLIC-DATA", "National Park Service"),
    "recreation.gov": ("US-FEDERAL-PUBLIC-DATA", "Recreation.gov"),
    "ridb": ("US-FEDERAL-PUBLIC-DATA", "Recreation.gov"),
    "trailhead": ("TRAILHEAD-FIRST-PARTY", "Trailhead"),
    "trailhead_explore": ("TRAILHEAD-FIRST-PARTY", "Trailhead"),
}


def _source_rights(value: object) -> tuple[str, str] | None:
    clean = str(value or "").strip().lower()
    return _SOURCE_RIGHTS.get(clean)


def _media_is_licensed(media: object) -> bool:
    if not isinstance(media, list):
        return False
    for item in media:
        if not isinstance(item, dict) or not str(item.get("url") or "").startswith("https://"):
            continue
        license_text = str(item.get("license") or "").lower()
        if any(
            marker in license_text
            for marker in ("public domain", "cc0", "cc by", "creative commons attribution")
        ):
            return True
    return False


def _licensed_thumbnail(media: object) -> tuple[str, str, str] | None:
    """Return one redistribution-safe image candidate, never a provider photo by default."""
    if not isinstance(media, list):
        return None
    for item in media:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https" or not parsed.netloc
            or parsed.username or parsed.password or parsed.fragment
        ):
            continue
        license_text = str(item.get("license") or "").strip()
        normalized = license_text.lower()
        if "public domain" in normalized:
            license_id = "PUBLIC-DOMAIN"
        elif "cc0" in normalized:
            license_id = "CC0-1.0"
        elif "cc by" in normalized or "creative commons attribution" in normalized:
            license_id = "CC-BY"
        else:
            continue
        attribution = str(
            item.get("attribution") or item.get("credit") or item.get("caption") or ""
        ).strip()
        if license_id == "CC-BY" and not attribution:
            continue
        return url, license_id, attribution
    return None


def _compact_public_document(
    record: dict,
    *,
    item_id: str,
    kind: Literal["place", "trail"],
    lat: float,
    lng: float,
    source_label: str,
    attribution: str,
) -> dict:
    """Copy durable place-sheet/search fields while excluding volatile live data."""
    scalar_keys = (
        "name", "category", "kind", "type", "subtype", "label", "land_type", "country", "region",
        "admin", "summary", "description", "difficulty", "best_season", "access",
        "safety", "official_url", "reservation_url", "reservable", "verified",
        "distance_mi", "elevation_gain_ft", "elevation_loss_ft", "route_shape",
        "activity", "surface", "allowed_uses", "land_manager", "seasonal_notes",
        "campsite_count", "campsites_count", "max_rig_length", "max_vehicle_length",
        "max_trailer_length", "max_rv_length", "cost", "ada", "phone", "address",
        "website", "booking_url", "access_notes", "bail_out_notes", "stay_limit",
        "reservation_notes", "source_confidence_notes", "link_label", "site_type",
        "camp_type", "rig_suitability", "vehicle_suitability", "fuel_types",
        "elevation", "source_badge", "source_freshness", "last_checked",
    )
    document: dict = {
        "id": item_id,
        "kind": kind,
        "lat": lat,
        "lng": lng,
        "source_label": source_label,
        "attribution": attribution,
    }
    for key in scalar_keys:
        value = record.get(key)
        if value is None or value == "":
            continue
        if isinstance(value, (str, int, float, bool)):
            document[key] = value
    for key in (
        "subcategories", "tags", "search_aliases", "amenities", "activities",
        "site_types", "camp_types", "fact_labels", "trailheads", "linked_trail_ids",
        "linked_place_ids", "rig_types", "vehicle_types", "aliases", "search_terms",
        "local_terms",
    ):
        values = record.get(key)
        if isinstance(values, list):
            document[key] = [
                value for value in values[:100]
                if isinstance(value, (str, int, float, bool))
            ]
    normalized_site_types: list[str] = []
    for value in [
        *(record.get("site_types") if isinstance(record.get("site_types"), list) else []),
        *(record.get("camp_types") if isinstance(record.get("camp_types"), list) else []),
        record.get("site_type"), record.get("camp_type"),
    ]:
        clean = str(value or "").strip()
        if clean and clean not in normalized_site_types:
            normalized_site_types.append(clean[:120])
    if normalized_site_types:
        document["site_types"] = normalized_site_types[:100]
    reservations = record.get("reservations")
    if isinstance(reservations, dict):
        durable = {
            key: reservations[key]
            for key in ("reservation_url", "reservable", "required")
            if isinstance(reservations.get(key), (str, bool))
        }
        if durable:
            document["reservations"] = durable
    sources = []
    for source in record.get("sources") or []:
        if not isinstance(source, dict):
            continue
        public_source = {
            key: source[key]
            for key in (
                "source", "source_id", "url", "license", "attribution", "quality",
                "pack_id", "revision", "generated_at",
            )
            if isinstance(source.get(key), (str, int, float, bool))
        }
        if public_source:
            sources.append(public_source)
    if sources:
        document["sources"] = sources[:12]
    campsites = record.get("campsites")
    if isinstance(campsites, list):
        campsite_keys = {
            "id", "name", "type", "loop", "map_card_id", "facility_id", "lat", "lng",
            "max_people", "equipment_length", "driveway", "surface", "accessible",
            "shade", "fire", "pets", "hookups", "check_in", "check_out", "reserve_type",
        }
        document["campsites"] = [
            {
                key: value for key, value in campsite.items()
                if key in campsite_keys and isinstance(value, (str, int, float, bool))
            }
            for campsite in campsites[:500]
            if isinstance(campsite, dict)
        ]
    # Live weather, fire, reports, closures, availability, and reservation
    # inventory are intentionally not copied into immutable bundles.
    return document


def _clean_coordinate(value: object, low: float, high: float) -> float | None:
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        return None
    return coordinate if math.isfinite(coordinate) and low <= coordinate <= high else None


def _geometry_bounds(geometry: object) -> tuple[float, float, float, float] | None:
    if not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    points: list[tuple[float, float]] = []

    def visit(value: object) -> None:
        if not isinstance(value, (list, tuple)):
            return
        if len(value) >= 2 and not isinstance(value[0], (list, tuple)):
            lng = _clean_coordinate(value[0], -180, 180)
            lat = _clean_coordinate(value[1], -90, 90)
            if lng is not None and lat is not None:
                points.append((lng, lat))
            return
        for child in value:
            visit(child)

    visit(coordinates)
    if not points:
        return None
    lngs = [point[0] for point in points]
    lats = [point[1] for point in points]
    return min(lngs), min(lats), max(lngs), max(lats)


def _trail_line_geometry_v2(geometry: object) -> dict | None:
    """Normalize trusted route GeoJSON to a valid line geometry artifact."""
    lines: list[list[list[float]]] = []

    def add(raw: object) -> None:
        if not isinstance(raw, (list, tuple)):
            return
        points: list[list[float]] = []
        for point in raw:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            lng = _clean_coordinate(point[0], -180, 180)
            lat = _clean_coordinate(point[1], -90, 90)
            if lng is not None and lat is not None:
                points.append([lng, lat])
        if len(points) >= 2:
            lines.append(points)

    def visit(value: object) -> None:
        if not isinstance(value, dict):
            return
        kind = value.get("type")
        coordinates = value.get("coordinates")
        if kind == "LineString":
            add(coordinates)
        elif kind == "MultiLineString" and isinstance(coordinates, list):
            for line in coordinates:
                add(line)
        elif kind == "Feature":
            visit(value.get("geometry"))
        elif kind == "FeatureCollection":
            for feature in value.get("features") or []:
                visit(feature)

    visit(geometry)
    if not lines:
        return None
    return {
        "type": "LineString" if len(lines) == 1 else "MultiLineString",
        "coordinates": lines[0] if len(lines) == 1 else lines,
    }


def offline_trail_scope_catalog_item_v2(system: dict) -> OfflineCatalogItemV2:
    """Build one licensed immutable catalog item from a trusted TrailSystemV2."""
    trail_id = str(system.get("id") or "").strip()
    name = str(system.get("name") or "").strip()
    revision = str(system.get("geometry_revision") or "").strip()
    if (
        not trail_id or not name or not revision
        or str(system.get("geometry_status") or "") != "complete"
    ):
        raise OfflineBundlePreparationError(
            "offline_trail_incomplete",
            "A complete verified trail route is required for this download.",
        )
    geometry = _trail_line_geometry_v2(system.get("geometry"))
    spatial_bounds = _geometry_bounds(geometry)
    center = system.get("center") if isinstance(system.get("center"), dict) else {}
    lat = _clean_coordinate(center.get("lat"), -90, 90)
    lng = _clean_coordinate(center.get("lng"), -180, 180)
    if geometry is None or spatial_bounds is None or lat is None or lng is None:
        raise OfflineBundlePreparationError(
            "offline_trail_geometry_unavailable",
            "The verified trail route is not available for offline use.",
            http_status=503,
        )
    sources = system.get("sources") if isinstance(system.get("sources"), list) else []
    source = next((item for item in sources if isinstance(item, dict)), {})
    source_label = str(source.get("label") or "Trailhead").strip()
    rights = _source_rights(source_label)
    if rights is None:
        raise OfflineBundlePreparationError(
            "offline_trail_rights_unverified",
            "This trail cannot be included until its offline data rights are verified.",
            http_status=503,
        )
    facts = system.get("facts") if isinstance(system.get("facts"), dict) else {}
    document = {
        "id": trail_id,
        "kind": "trail",
        "name": name,
        "lat": lat,
        "lng": lng,
        "primary_trail_id": str(system.get("primary_trail_id") or "").strip(),
        "geometry_revision": revision,
        "geometry_status": "complete",
        "source_label": source_label,
        "attribution": rights[1],
    }
    for key in (
        "distance_mi", "elevation_gain_ft", "estimated_time", "difficulty",
        "route_shape", "surface", "season",
    ):
        value = facts.get(key)
        if isinstance(value, (str, int, float, bool)) and value != "":
            document[key] = value
    for key in ("activities", "permitted_uses", "member_trail_ids"):
        values = system.get(key)
        if isinstance(values, list):
            document[key] = [
                value for value in values[:100]
                if isinstance(value, (str, int, float, bool))
            ]
    trailheads = []
    for item in system.get("trailheads") or []:
        if not isinstance(item, dict):
            continue
        item_lat = _clean_coordinate(item.get("lat"), -90, 90)
        item_lng = _clean_coordinate(item.get("lng"), -180, 180)
        if item_lat is None or item_lng is None:
            continue
        trailheads.append({
            **({"name": str(item.get("name")).strip()} if item.get("name") else {}),
            "lat": item_lat,
            "lng": item_lng,
            **({"source": str(item.get("source")).strip()} if item.get("source") else {}),
        })
    if trailheads:
        document["trailheads"] = trailheads[:24]
    summary = str(system.get("summary") or "").strip()
    if summary:
        document["summary"] = summary[:1200]
    return OfflineCatalogItemV2(
        item_id=trail_id,
        kind="trail",
        lat=lat,
        lng=lng,
        source_label=source_label,
        license_id=rights[0],
        attribution=rights[1],
        spatial_bounds=spatial_bounds,
        title=name[:240],
        subtitle=summary[:500],
        category="trail",
        aliases=tuple(
            str(value).strip()[:120]
            for value in [*(system.get("activities") or []), *(system.get("permitted_uses") or [])]
            if str(value or "").strip()
        )[:80],
        document=document,
        geometry=geometry,
    )


def _bounds_intersect(
    left: tuple[float, float, float, float],
    right: OfflineBoundsV2,
) -> bool:
    west, south, east, north = left
    return not (
        east < right.west or west > right.east
        or north < right.south or south > right.north
    )


def _file_signature(paths: tuple[Path, ...]) -> tuple[tuple[str, int, int], ...]:
    signature = []
    for path in paths:
        try:
            stat = path.stat()
            signature.append((str(path), stat.st_mtime_ns, stat.st_size))
        except OSError:
            signature.append((str(path), 0, 0))
    return tuple(signature)


@lru_cache(maxsize=4)
def _load_catalog_snapshot_cached(
    signature: tuple[tuple[str, int, int], ...],
) -> OfflineCatalogSnapshotV2:
    items: dict[str, OfflineCatalogItemV2] = {}
    generated_at = 0
    digest = hashlib.sha256()
    payloads: dict[str, dict] = {}
    for filename, _mtime, size in signature:
        path = Path(filename)
        if size <= 0:
            continue
        raw = path.read_bytes()
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(raw)
        payload = json.loads(raw)
        payloads[path.name] = payload
        generated_at = max(generated_at, int(payload.get("generated_at") or 0))

    geometry_records = {
        str(record.get("id") or ""): record
        for record in (payloads.get("explore_trail_geometries_v1.json", {}).get("trails") or [])
        if isinstance(record, dict) and str(record.get("id") or "")
    }

    def aliases(record: dict) -> tuple[str, ...]:
        values: list[str] = []
        for key in ("search_aliases", "tags", "subcategories", "activities", "allowed_uses"):
            raw_values = record.get(key)
            if isinstance(raw_values, str):
                raw_values = [raw_values]
            if not isinstance(raw_values, list):
                continue
            for value in raw_values:
                clean = str(value or "").strip()
                if clean and clean not in values:
                    values.append(clean[:120])
        return tuple(values[:80])

    def add_record(
        record: dict,
        *,
        kind: Literal["place", "trail"],
        rights: tuple[str, str],
        source_label: str,
        attribution: str,
        geometry: dict | None = None,
    ) -> None:
        lat = _clean_coordinate(
            record.get("lat", record.get("representative_lat")), -90, 90,
        )
        lng = _clean_coordinate(
            record.get("lng", record.get("representative_lng")), -180, 180,
        )
        item_id = str(record.get("id") or "").strip()
        if lat is None or lng is None or not item_id:
            return
        spatial_bounds = _geometry_bounds(geometry) if kind == "trail" else None
        if kind == "trail" and spatial_bounds is None:
            return
        thumbnail = _licensed_thumbnail(record.get("media") or record.get("photos"))
        title = str(record.get("name") or record.get("label") or item_id).strip()[:240]
        subtitle = str(
            record.get("summary") or record.get("label") or record.get("category") or ""
        ).strip()[:500]
        category = str(record.get("category") or record.get("kind") or kind).strip()[:80]
        parent_destination = str(record.get("admin") or record.get("region") or "").strip()[:180]
        document = _compact_public_document(
            record,
            item_id=item_id,
            kind=kind,
            lat=lat,
            lng=lng,
            source_label=source_label,
            attribution=attribution,
        )
        items[item_id] = OfflineCatalogItemV2(
            item_id=item_id,
            kind=kind,
            lat=lat,
            lng=lng,
            source_label=source_label,
            license_id=rights[0],
            attribution=attribution,
            licensed_thumbnail=thumbnail is not None,
            spatial_bounds=spatial_bounds,
            title=title,
            subtitle=subtitle,
            category=category,
            parent_destination=parent_destination,
            aliases=aliases(record),
            document=document,
            geometry=geometry,
            thumbnail_url=thumbnail[0] if thumbnail else None,
            thumbnail_license_id=thumbnail[1] if thumbnail else None,
            thumbnail_attribution=thumbnail[2] if thumbnail else None,
        )

    for record in payloads.get("explore_catalog_v3.json", {}).get("places") or []:
        if not isinstance(record, dict):
            continue
        source_quality = record.get("source_quality") or {}
        if isinstance(source_quality, dict) and source_quality.get("offline_allowed") is False:
            continue
        sources = record.get("sources") or []
        source = sources[0] if sources and isinstance(sources[0], dict) else {}
        source_label = str(
            source.get("source") or (
                source_quality.get("primary_provider") if isinstance(source_quality, dict) else ""
            ) or ""
        )
        rights = _source_rights(source_label)
        if not rights:
            continue
        kind: Literal["place", "trail"] = (
            "trail" if str(record.get("category") or "").lower() == "trail" else "place"
        )
        add_record(
            record,
            kind=kind,
            rights=rights,
            source_label=source_label,
            attribution=str(source.get("attribution") or rights[1]),
            geometry=record.get("geometry") if kind == "trail" else None,
        )

    for record in payloads.get("canonical_camp_index_v1.json", {}).get("items") or []:
        if not isinstance(record, dict) or record.get("review_only") is True:
            continue
        source_label = str(record.get("source_label") or record.get("source") or "")
        rights = _source_rights(source_label)
        if rights:
            add_record(
                record, kind="place", rights=rights, source_label=source_label,
                attribution=rights[1],
            )

    used_geometry: set[str] = set()
    for record in payloads.get("canonical_trail_index_v1.json", {}).get("items") or []:
        if not isinstance(record, dict) or record.get("review_only") is True:
            continue
        source_label = str(record.get("source_label") or record.get("source") or "")
        rights = _source_rights(source_label)
        geometry_id = str(record.get("geometry_ref") or record.get("id") or "")
        geometry_record = geometry_records.get(geometry_id)
        geometry = (
            geometry_record.get("geometry_line") or geometry_record.get("geometry")
            if isinstance(geometry_record, dict) else None
        )
        if rights and isinstance(geometry, dict):
            merged = {**geometry_record, **record}
            add_record(
                merged, kind="trail", rights=rights, source_label=source_label,
                attribution=rights[1], geometry=geometry,
            )
            used_geometry.add(geometry_id)

    for geometry_id, record in geometry_records.items():
        if geometry_id in used_geometry:
            continue
        sources = record.get("sources") or []
        source = sources[0] if sources and isinstance(sources[0], dict) else {}
        source_label = str(source.get("source") or "")
        rights = _source_rights(source_label)
        geometry = record.get("geometry_line") or record.get("geometry")
        if rights and isinstance(geometry, dict):
            add_record(
                record, kind="trail", rights=rights, source_label=source_label,
                attribution=str(source.get("attribution") or rights[1]), geometry=geometry,
            )

    if not generated_at:
        generated_at = int(datetime.now(tz=timezone.utc).timestamp())
    return OfflineCatalogSnapshotV2(
        revision=digest.hexdigest(),
        generated_at=generated_at,
        items=tuple(sorted(items.values(), key=lambda item: item.item_id)),
    )


def load_offline_catalog_snapshot_v2() -> OfflineCatalogSnapshotV2:
    paths = (
        CATALOG_ROOT / "explore_catalog_v3.json",
        CATALOG_ROOT / "canonical_camp_index_v1.json",
        CATALOG_ROOT / "canonical_trail_index_v1.json",
        CATALOG_ROOT / "explore_trail_geometries_v1.json",
    )
    return _load_catalog_snapshot_cached(_file_signature(paths))


def merge_offline_catalog_snapshot_v2(
    snapshot: OfflineCatalogSnapshotV2,
    items: tuple[OfflineCatalogItemV2, ...],
) -> OfflineCatalogSnapshotV2:
    """Merge current database records into the serving snapshot deterministically."""
    def merge_list(left: list, right: list) -> list:
        result: list = []
        seen: set[str] = set()
        for value in [*left, *right]:
            marker = json.dumps(
                value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
            )
            if marker in seen:
                continue
            seen.add(marker)
            result.append(value)
        return result

    def merge_document(left: dict | None, right: dict | None) -> dict | None:
        if not left:
            return dict(right) if right else None
        if not right:
            return dict(left)
        result = dict(left)
        for key, value in right.items():
            existing = result.get(key)
            if isinstance(existing, list) and isinstance(value, list):
                result[key] = merge_list(existing, value)
            elif isinstance(existing, dict) and isinstance(value, dict):
                result[key] = {**existing, **value}
            elif value not in (None, "", [], {}):
                # The incoming source is deliberately later in the precedence
                # order (serving snapshot -> packaged records -> live DB).
                result[key] = value
        return result

    def merge_item(
        existing: OfflineCatalogItemV2,
        incoming: OfflineCatalogItemV2,
    ) -> OfflineCatalogItemV2:
        if existing.kind != incoming.kind:
            return incoming
        aliases = tuple(dict.fromkeys((*existing.aliases, *incoming.aliases)))[:80]
        use_incoming_thumbnail = bool(
            incoming.licensed_thumbnail
            and incoming.thumbnail_url
            and incoming.thumbnail_license_id
        )
        return replace(
            incoming,
            title=incoming.title or existing.title,
            subtitle=incoming.subtitle or existing.subtitle,
            category=incoming.category or existing.category,
            parent_destination=incoming.parent_destination or existing.parent_destination,
            aliases=aliases,
            document=merge_document(existing.document, incoming.document),
            geometry=incoming.geometry or existing.geometry,
            spatial_bounds=incoming.spatial_bounds or existing.spatial_bounds,
            licensed_thumbnail=(
                incoming.licensed_thumbnail or existing.licensed_thumbnail
            ),
            thumbnail_url=(
                incoming.thumbnail_url if use_incoming_thumbnail else existing.thumbnail_url
            ),
            thumbnail_license_id=(
                incoming.thumbnail_license_id
                if use_incoming_thumbnail else existing.thumbnail_license_id
            ),
            thumbnail_attribution=(
                incoming.thumbnail_attribution
                if use_incoming_thumbnail else existing.thumbnail_attribution
            ),
        )

    merged = {item.item_id: item for item in snapshot.items}
    for item in items:
        existing = merged.get(item.item_id)
        merged[item.item_id] = merge_item(existing, item) if existing else item
    ordered = tuple(sorted(merged.values(), key=lambda item: item.item_id))
    revision_payload = [
        {
            "id": item.item_id,
            "kind": item.kind,
            "lat": item.lat,
            "lng": item.lng,
            "bounds": item.spatial_bounds,
            "document": item.document,
            "geometry": item.geometry,
            "thumbnail_url": item.thumbnail_url,
            "thumbnail_license_id": item.thumbnail_license_id,
        }
        for item in sorted(items, key=lambda item: item.item_id)
    ]
    revision = hashlib.sha256(
        (
            snapshot.revision + "\0" + json.dumps(
                revision_payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
            )
        ).encode("utf-8")
    ).hexdigest()
    return OfflineCatalogSnapshotV2(
        revision=revision,
        generated_at=snapshot.generated_at,
        items=ordered,
    )


def _validate_server_style_uri(renderer_id: str, uri: str) -> str:
    clean = uri.strip()
    if (
        clean != uri
        or not clean
        or len(clean) > 500
        or any(ord(char) < 32 for char in clean)
        or any(char.isspace() for char in clean)
    ):
        raise OfflineBundlePreparationError(
            "invalid_server_style", "The configured offline map style is invalid.", http_status=503,
        )
    parsed = urlsplit(clean)
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise OfflineBundlePreparationError(
            "invalid_server_style", "The configured offline map style is invalid.", http_status=503,
        )
    if renderer_id == "rnmapbox":
        parts = [part for part in clean.removeprefix("mapbox://styles/").split("/") if part]
        if not clean.startswith("mapbox://styles/") or len(parts) < 2:
            raise OfflineBundlePreparationError(
                "invalid_server_style", "The configured RNMapbox style is invalid.", http_status=503,
            )
    elif parsed.scheme not in {"https", "asset"}:
        raise OfflineBundlePreparationError(
            "invalid_server_style", "The configured MapLibre style is invalid.", http_status=503,
        )
    return clean


_RNMAPBOX_APPROVED_STYLES_V2: dict[str, str] = {
    "standard": "mapbox://styles/mapbox/standard",
    "standard_satellite": "mapbox://styles/mapbox/standard-satellite",
    "satellite_streets": "mapbox://styles/mapbox/satellite-streets-v12",
    "streets": "mapbox://styles/mapbox/streets-v12",
    "outdoors": "mapbox://styles/mapbox/outdoors-v12",
    "navigation_day": "mapbox://styles/mapbox/navigation-day-v1",
    "navigation_night": "mapbox://styles/mapbox/navigation-night-v1",
}


def _style_revision_v2(uri: str) -> str:
    return "style-" + hashlib.sha256(uri.encode("utf-8")).hexdigest()[:16]


def _rnmapbox_style_allowlist_v2() -> dict[str, OfflineRendererConfigV2]:
    approved = {
        style_id: OfflineRendererConfigV2(
            id="rnmapbox",
            style_id=style_id,
            style_uri=uri,
            style_revision=_style_revision_v2(uri),
        )
        for style_id, uri in _RNMAPBOX_APPROVED_STYLES_V2.items()
    }
    configured = str(
        os.getenv("TRAILHEAD_OFFLINE_RNMAPBOX_STYLE_ALLOWLIST") or ""
    ).strip()
    if not configured:
        return approved
    try:
        payload = json.loads(configured)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise OfflineBundlePreparationError(
            "offline_style_allowlist_invalid",
            "The server offline style allowlist is invalid.",
            http_status=503,
        ) from exc
    if not isinstance(payload, dict) or len(payload) > 32:
        raise OfflineBundlePreparationError(
            "offline_style_allowlist_invalid",
            "The server offline style allowlist is invalid.",
            http_status=503,
        )
    for style_id, descriptor in payload.items():
        if (
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", str(style_id))
            or not isinstance(descriptor, dict)
        ):
            raise OfflineBundlePreparationError(
                "offline_style_allowlist_invalid",
                "The server offline style allowlist is invalid.",
                http_status=503,
            )
        uri = _validate_server_style_uri(
            "rnmapbox", str(descriptor.get("uri") or ""),
        )
        revision = str(descriptor.get("revision") or _style_revision_v2(uri)).strip()
        if not SAFE_REVISION_RE.fullmatch(revision):
            raise OfflineBundlePreparationError(
                "offline_style_allowlist_invalid",
                "The server offline style allowlist is invalid.",
                http_status=503,
            )
        approved[str(style_id)] = OfflineRendererConfigV2(
            id="rnmapbox",
            style_id=str(style_id),
            style_uri=uri,
            style_revision=revision,
        )
    return approved


def load_offline_renderer_config_v2(
    requested_style_id: str | None = None,
) -> OfflineRendererConfigV2:
    renderer_id = str(os.getenv("TRAILHEAD_OFFLINE_RENDERER", "rnmapbox")).strip().lower()
    if renderer_id not in {"rnmapbox", "maplibre"}:
        raise OfflineBundlePreparationError(
            "invalid_server_renderer", "The configured offline renderer is invalid.", http_status=503,
        )
    clean_requested = str(requested_style_id or "").strip()
    if clean_requested:
        if renderer_id != "rnmapbox":
            raise OfflineBundlePreparationError(
                "offline_style_not_allowed",
                "The selected map style is not available for offline use.",
            )
        selected = _rnmapbox_style_allowlist_v2().get(clean_requested)
        if selected is None:
            raise OfflineBundlePreparationError(
                "offline_style_not_allowed",
                "The selected map style is not available for offline use.",
            )
        return selected
    if renderer_id == "rnmapbox":
        configured_default_id = str(
            os.getenv("TRAILHEAD_OFFLINE_DEFAULT_STYLE_ID") or ""
        ).strip()
        if configured_default_id:
            selected = _rnmapbox_style_allowlist_v2().get(configured_default_id)
            if selected is None:
                raise OfflineBundlePreparationError(
                    "offline_default_style_invalid",
                    "The configured default offline style is invalid.",
                    http_status=503,
                )
            return selected
    env_name = (
        "TRAILHEAD_RNMAPBOX_STYLE_URI"
        if renderer_id == "rnmapbox"
        else "TRAILHEAD_MAPLIBRE_STYLE_URI"
    )
    default_uri = (
        "mapbox://styles/mapbox/outdoors-v12"
        if renderer_id == "rnmapbox"
        else ""
    )
    style_uri = _validate_server_style_uri(
        renderer_id,
        str(os.getenv(env_name, default_uri)),
    )
    env_name = (
        "TRAILHEAD_RNMAPBOX_STYLE_REVISION"
        if renderer_id == "rnmapbox"
        else "TRAILHEAD_MAPLIBRE_STYLE_REVISION"
    )
    configured = str(os.getenv(env_name, "")).strip()
    if configured:
        if not SAFE_REVISION_RE.fullmatch(configured):
            raise OfflineBundlePreparationError("invalid_style_revision", f"{env_name} is invalid")
        revision = configured
    else:
        revision = _style_revision_v2(style_uri)
    style_id = "server_default"
    if renderer_id == "rnmapbox":
        matches = [
            candidate_id for candidate_id, candidate_uri
            in _RNMAPBOX_APPROVED_STYLES_V2.items()
            if candidate_uri == style_uri
        ]
        if matches:
            style_id = matches[0]
    return OfflineRendererConfigV2(
        id=renderer_id,
        style_id=style_id,
        style_uri=style_uri,
        style_revision=revision,
    )


def _validated_renderer_config_v2(
    renderer: OfflineRendererConfigV2,
) -> OfflineRendererConfigV2:
    if renderer.id not in {"rnmapbox", "maplibre"}:
        raise OfflineBundlePreparationError(
            "invalid_server_renderer", "The configured offline renderer is invalid.", http_status=503,
        )
    style_uri = _validate_server_style_uri(renderer.id, renderer.style_uri)
    if not SAFE_REVISION_RE.fullmatch(renderer.style_revision):
        raise OfflineBundlePreparationError(
            "invalid_style_revision", "The configured offline style revision is invalid.", http_status=503,
        )
    style_id = str(renderer.style_id or "server_default").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", style_id):
        raise OfflineBundlePreparationError(
            "invalid_style_id", "The configured offline style identifier is invalid.", http_status=503,
        )
    return OfflineRendererConfigV2(
        id=renderer.id,
        style_id=style_id,
        style_uri=style_uri,
        style_revision=renderer.style_revision,
    )


def _tile_count(bounds: OfflineBoundsV2, min_zoom: int, max_zoom: int) -> int:
    def tile_x(lng: float, zoom: int) -> int:
        return max(0, min((1 << zoom) - 1, int((lng + 180.0) / 360.0 * (1 << zoom))))

    def tile_y(lat: float, zoom: int) -> int:
        clipped = max(-85.05112878, min(85.05112878, lat))
        rad = math.radians(clipped)
        value = (1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * (1 << zoom)
        return max(0, min((1 << zoom) - 1, int(value)))

    total = 0
    for zoom in range(min_zoom, max_zoom + 1):
        west_x, east_x = tile_x(bounds.west, zoom), tile_x(bounds.east, zoom)
        north_y, south_y = tile_y(bounds.north, zoom), tile_y(bounds.south, zoom)
        total += (east_x - west_x + 1) * (south_y - north_y + 1)
    return total


def _canonical_json_value(value: object) -> object:
    if isinstance(value, dict):
        return {
            str(key): _canonical_json_value(item)
            for key, item in sorted(value.items())
        }
    if isinstance(value, (list, tuple)):
        return [_canonical_json_value(item) for item in value]
    # JSON.parse/JSON.stringify normalizes 1.0 to 1 on mobile. Mirror that so
    # a manifest digest is portable across Python and JavaScript.
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return value


def canonical_offline_manifest_json_v2(value: dict) -> str:
    payload = {key: item for key, item in value.items() if key != "manifest_sha256"}
    return json.dumps(
        _canonical_json_value(payload),
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def offline_manifest_sha256_v2(value: dict) -> str:
    return hashlib.sha256(canonical_offline_manifest_json_v2(value).encode("utf-8")).hexdigest()


def _artifact_delivery_uri(value: str) -> str:
    uri = str(value or "").strip()
    parsed = urlsplit(uri)
    if uri.startswith("/api/offline/bundles/") and not parsed.query and not parsed.fragment:
        return uri
    if (
        parsed.scheme == "https"
        and parsed.netloc
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    ):
        return uri
    raise OfflineBundlePreparationError(
        "offline_artifact_uri_invalid",
        "An offline artifact delivery URI is invalid.",
        http_status=503,
    )


def _catalog_max_age_seconds() -> int:
    raw = str(os.getenv("TRAILHEAD_OFFLINE_CATALOG_MAX_AGE_SECONDS", "2592000")).strip()
    try:
        value = int(raw)
    except ValueError:
        value = 0
    if value < 300 or value > 31_536_000:
        raise OfflineBundlePreparationError(
            "invalid_catalog_freshness_policy",
            "The offline catalog freshness policy is invalid.",
            http_status=503,
        )
    return value


def _validate_snapshot_freshness(snapshot: OfflineCatalogSnapshotV2, now_epoch: int) -> None:
    if snapshot.generated_at <= 0 or snapshot.generated_at > now_epoch + 300:
        raise OfflineBundlePreparationError(
            "offline_catalog_timestamp_invalid",
            "The offline catalog timestamp cannot be verified.",
            http_status=503,
        )
    if now_epoch - snapshot.generated_at > _catalog_max_age_seconds():
        raise OfflineBundlePreparationError(
            "offline_catalog_stale",
            "The offline catalog must be refreshed before a bundle can be prepared.",
            http_status=503,
        )


def _read_materialized_artifacts(
    sources: tuple[OfflineMaterializedArtifactV2, ...] | None,
) -> dict[str, tuple[OfflineMaterializedArtifactV2, int, str]]:
    if not sources:
        raise OfflineBundlePreparationError(
            "offline_artifacts_not_ready",
            "Complete offline bundle files are not available yet. No download was prepared.",
            http_status=503,
        )
    result: dict[str, tuple[OfflineMaterializedArtifactV2, int, str]] = {}
    for source in sources:
        if source.kind in result:
            raise OfflineBundlePreparationError(
                "offline_artifact_duplicate",
                f"The {source.kind} offline artifact is duplicated.",
                http_status=503,
            )
        if not SAFE_REVISION_RE.fullmatch(source.revision):
            raise OfflineBundlePreparationError(
                "offline_artifact_revision_invalid",
                f"The {source.kind} offline artifact revision is invalid.",
                http_status=503,
            )
        if source.record_count < 0:
            raise OfflineBundlePreparationError(
                "offline_artifact_count_invalid",
                f"The {source.kind} offline artifact count is invalid.",
                http_status=503,
            )
        try:
            raw = source.path.read_bytes()
        except OSError as exc:
            raise OfflineBundlePreparationError(
                "offline_artifact_missing",
                f"The {source.kind} offline artifact is not materialized.",
                http_status=503,
            ) from exc
        if not raw:
            raise OfflineBundlePreparationError(
                "offline_artifact_empty",
                f"The {source.kind} offline artifact is empty.",
                http_status=503,
            )
        _artifact_delivery_uri(source.uri)
        result[source.kind] = (source, len(raw), hashlib.sha256(raw).hexdigest())
    return result


def prepare_offline_bundle_manifest_v2(
    request: OfflineBundlePrepareRequestV2,
    *,
    snapshot: OfflineCatalogSnapshotV2 | None = None,
    selected_items: tuple[OfflineCatalogItemV2, ...] | None = None,
    materialized_artifacts: tuple[OfflineMaterializedArtifactV2, ...] | None = None,
    renderer: OfflineRendererConfigV2 | None = None,
    now_epoch: int | None = None,
) -> OfflineBundleManifestV2:
    snapshot = snapshot or load_offline_catalog_snapshot_v2()
    _validate_snapshot_freshness(snapshot, int(now_epoch if now_epoch is not None else time.time()))
    renderer = _validated_renderer_config_v2(
        renderer or load_offline_renderer_config_v2(request.renderer_style_id),
    )
    if (
        request.renderer_style_id
        and renderer.style_id != request.renderer_style_id
    ):
        raise OfflineBundlePreparationError(
            "offline_renderer_style_mismatch",
            "The prepared offline map style does not match the requested approved style.",
            http_status=503,
        )
    sources = _read_materialized_artifacts(materialized_artifacts)

    if selected_items is None:
        selected = tuple(item for item in snapshot.items if (
            _bounds_intersect(item.spatial_bounds, request.bounds)
            if item.kind == "trail" and item.spatial_bounds is not None
            else item.kind == "place"
            and request.bounds.west <= item.lng <= request.bounds.east
            and request.bounds.south <= item.lat <= request.bounds.north
        ))
    else:
        snapshot_items = {item.item_id: item for item in snapshot.items}
        if (
            len({item.item_id for item in selected_items}) != len(selected_items)
            or any(snapshot_items.get(item.item_id) != item for item in selected_items)
        ):
            raise OfflineBundlePreparationError(
                "offline_catalog_selection_invalid",
                "The selected offline catalog records are invalid.",
                http_status=503,
            )
        selected = selected_items
    places = tuple(item for item in selected if item.kind == "place")
    trails = tuple(item for item in selected if item.kind == "trail")
    expected_counts = {
        "places": len(places),
        "trails": len(trails),
        "search_index": len(places) + len(trails),
    }
    required_kinds = {"places", "trails", "search_index"}
    if request.options.routing:
        required_kinds.add("routing")
    if request.options.contours:
        required_kinds.add("contours")
    # 1.0.10 preserves licensed thumbnail metadata in the canonical catalog,
    # but does not publish thumbnail/media payloads until the mobile client has
    # an atomic installer and a verified local-photo consumer. Shipping unused
    # ZIPs would waste storage and make the manifest's media claim untrue.
    missing = sorted(required_kinds.difference(sources))
    if missing:
        raise OfflineBundlePreparationError(
            "offline_artifacts_incomplete",
            f"Complete offline bundle files are not ready ({', '.join(missing)}).",
            http_status=503,
        )
    for kind, expected in expected_counts.items():
        if kind in sources and sources[kind][0].record_count != expected:
            raise OfflineBundlePreparationError(
                "offline_artifact_catalog_mismatch",
                f"The {kind} artifact does not match the selected catalog revision.",
                http_status=503,
            )

    identity_payload = {
        "schema_version": OFFLINE_BUNDLE_SCHEMA_VERSION,
        "renderer": renderer.id,
        "renderer_style_id": renderer.style_id,
        "style_uri": renderer.style_uri,
        "bounds": request.bounds.model_dump(mode="json"),
        "min_zoom": request.min_zoom,
        "max_zoom": request.max_zoom,
        **({"scope": request.scope.model_dump(mode="json")} if request.scope else {}),
    }
    bundle_hash = hashlib.sha256(
        json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    bundle_id = f"offline_{bundle_hash[:24]}"
    revision_payload = {
        **identity_payload,
        "style_revision": renderer.style_revision,
        "catalog_revision": snapshot.revision,
        "catalog_generated_at": snapshot.generated_at,
        "options": request.options.model_dump(mode="json"),
        "place_ids": [item.item_id for item in places],
        "trail_ids": [item.item_id for item in trails],
        "artifact_digests": {
            kind: digest for kind, (_source, _size, digest) in sorted(sources.items())
            if kind in required_kinds
        },
    }
    revision_hash = hashlib.sha256(
        json.dumps(revision_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    revision = f"v2-{revision_hash[:24]}"
    style_pack_id = f"{bundle_id}-{revision}-style"
    tile_region_id = f"{bundle_id}-{revision}-tiles"

    tiles = _tile_count(request.bounds, request.min_zoom, request.max_zoom)
    if tiles > 350_000:
        raise OfflineBundlePreparationError(
            "offline_area_too_large",
            "This area and zoom range are too large for one reliable offline bundle.",
        )
    map_style_bytes = 4_500_000 if renderer.id == "rnmapbox" else 1_500_000
    map_tiles_bytes = max(
        256_000,
        tiles * (18_000 if renderer.id == "rnmapbox" else 22_000),
    )

    if renderer.id == "rnmapbox":
        style_storage = "renderer_style_pack"
        tile_storage = "renderer_tile_region"
    else:
        style_storage = tile_storage = "renderer_legacy_pack"

    artifacts: list[OfflineBundleArtifactV2] = []

    def add_renderer_artifact(
        kind: Literal[
            "map_style", "map_tiles",
        ],
        storage: Literal[
            "file", "renderer_style_pack", "renderer_tile_region", "renderer_legacy_pack",
        ],
        bytes_count: int,
        *,
        record_count: int | None = None,
    ) -> None:
        artifact_id = f"{bundle_id}-{kind}"
        artifacts.append(OfflineBundleArtifactV2(
            id=artifact_id,
            kind=kind,
            storage=storage,
            required=True,
            revision=revision,
            bytes=bytes_count,
            size_kind="estimated",
            integrity="renderer_probe",
            record_count=record_count,
        ))

    add_renderer_artifact("map_style", style_storage, map_style_bytes)
    add_renderer_artifact("map_tiles", tile_storage, map_tiles_bytes, record_count=tiles)

    included_file_kinds = required_kinds
    for kind in sorted(included_file_kinds):
        source, exact_bytes, digest = sources[kind]
        artifacts.append(OfflineBundleArtifactV2(
            id=f"{bundle_id}-{kind}",
            kind=kind,
            storage="file",
            required=kind in required_kinds,
            revision=source.revision,
            bytes=exact_bytes,
            size_kind="exact",
            integrity="sha256",
            sha256=digest,
            uri=_artifact_delivery_uri(source.uri),
            media_type=source.media_type,
            record_count=source.record_count,
        ))

    required_bytes = sum(artifact.bytes for artifact in artifacts if artifact.required)
    required_storage_bytes = math.ceil(required_bytes * 1.08)
    if required_storage_bytes > 8_000_000_000:
        raise OfflineBundlePreparationError(
            "offline_bundle_too_large",
            "This bundle would exceed the supported offline storage limit.",
        )

    attribution = {item.attribution for item in selected if item.attribution}
    license_ids = {item.license_id for item in selected if item.license_id}
    if renderer.id == "rnmapbox":
        attribution.add("Mapbox")
        license_ids.add("MAPBOX-MOBILE-OFFLINE")
    else:
        attribution.add("OpenStreetMap contributors")
        license_ids.add("ODbL-1.0")

    created_at = datetime.fromtimestamp(
        snapshot.generated_at, tz=timezone.utc,
    ).isoformat().replace("+00:00", "Z")
    manifest_payload = {
        "schema_version": OFFLINE_BUNDLE_SCHEMA_VERSION,
        "bundle_id": bundle_id,
        "revision": revision,
        "created_at": created_at,
        "renderer": OfflineBundleRendererV2(
            id=renderer.id,
            style_id=renderer.style_id,
            style_uri=renderer.style_uri,
            style_revision=renderer.style_revision,
            style_pack_id=style_pack_id,
            tile_region_id=tile_region_id,
        ).model_dump(mode="json", exclude_none=True),
        "bounds": request.bounds.model_dump(mode="json"),
        "min_zoom": request.min_zoom,
        "max_zoom": request.max_zoom,
        **({"scope": request.scope.model_dump(mode="json")} if request.scope else {}),
        "artifacts": [artifact.model_dump(mode="json", exclude_none=True) for artifact in artifacts],
        "capabilities": OfflineBundleCapabilitiesV2(
            map=True,
            places="places" in sources,
            trails="trails" in sources,
            search="search_index" in sources,
            routing=request.options.routing and "routing" in sources,
            contours=request.options.contours and "contours" in sources,
            media=False,
        ).model_dump(mode="json"),
        "required_storage_bytes": required_storage_bytes,
        "source_attribution": sorted(attribution),
        "license_ids": sorted(license_ids),
        "replaces_revisions": [],
    }
    manifest_payload["manifest_sha256"] = offline_manifest_sha256_v2(manifest_payload)
    return OfflineBundleManifestV2.model_validate(manifest_payload)
