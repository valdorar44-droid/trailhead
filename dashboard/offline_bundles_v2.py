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
from dataclasses import dataclass
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


class OfflineBundlePrepareRequestV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    bounds: OfflineBoundsV2
    min_zoom: int = Field(default=6, ge=0, le=24)
    max_zoom: int = Field(default=14, ge=0, le=24)
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
    "blm": ("US-FEDERAL-PUBLIC-DATA", "Bureau of Land Management"),
    "recreation.gov": ("US-FEDERAL-PUBLIC-DATA", "Recreation.gov"),
    "ridb": ("US-FEDERAL-PUBLIC-DATA", "Recreation.gov"),
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
    for filename, _mtime, size in signature:
        path = Path(filename)
        if size <= 0:
            continue
        raw = path.read_bytes()
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(raw)
        payload = json.loads(raw)
        generated_at = max(generated_at, int(payload.get("generated_at") or 0))

        if path.name == "explore_catalog_v3.json":
            records = payload.get("places") or []
            for record in records:
                if not isinstance(record, dict):
                    continue
                source_quality = record.get("source_quality") or {}
                if isinstance(source_quality, dict) and source_quality.get("offline_allowed") is False:
                    continue
                sources = record.get("sources") or []
                source = sources[0] if sources and isinstance(sources[0], dict) else {}
                rights = _source_rights(
                    source.get("source") or source_quality.get("primary_provider")
                )
                if not rights:
                    continue
                lat = _clean_coordinate(record.get("lat"), -90, 90)
                lng = _clean_coordinate(record.get("lng"), -180, 180)
                item_id = str(record.get("id") or "").strip()
                if lat is None or lng is None or not item_id:
                    continue
                kind = "trail" if str(record.get("category") or "").lower() == "trail" else "place"
                spatial_bounds = _geometry_bounds(record.get("geometry")) if kind == "trail" else None
                if kind == "trail" and spatial_bounds is None:
                    # An anchor can be far from a trail segment that crosses
                    # the selected area (or inside while the geometry is not).
                    # Exclude it until the canonical index carries geometry.
                    continue
                items[item_id] = OfflineCatalogItemV2(
                    item_id=item_id,
                    kind=kind,
                    lat=lat,
                    lng=lng,
                    source_label=str(
                        source.get("source") or source_quality.get("primary_provider") or ""
                    ),
                    license_id=rights[0],
                    attribution=str(source.get("attribution") or rights[1]),
                    licensed_thumbnail=_media_is_licensed(record.get("media")),
                    spatial_bounds=spatial_bounds,
                )
            continue

        records = payload.get("items") or []
        kind: Literal["place", "trail"] = "trail" if "trail" in path.name else "place"
        for record in records:
            if not isinstance(record, dict) or record.get("review_only") is True:
                continue
            rights = _source_rights(record.get("source_label") or record.get("source"))
            lat = _clean_coordinate(record.get("lat"), -90, 90)
            lng = _clean_coordinate(record.get("lng"), -180, 180)
            item_id = str(record.get("id") or "").strip()
            if not rights or lat is None or lng is None or not item_id:
                continue
            # The V1 trail index contains only a label point plus a geometry
            # reference. Until that reference is resolved into geometry, it
            # cannot truthfully participate in selected-area coverage.
            if kind == "trail":
                continue
            items[item_id] = OfflineCatalogItemV2(
                item_id=item_id,
                kind=kind,
                lat=lat,
                lng=lng,
                source_label=str(record.get("source_label") or record.get("source") or ""),
                license_id=rights[0],
                attribution=rights[1],
                licensed_thumbnail=False,
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
    )
    return _load_catalog_snapshot_cached(_file_signature(paths))


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


def load_offline_renderer_config_v2() -> OfflineRendererConfigV2:
    renderer_id = str(os.getenv("TRAILHEAD_OFFLINE_RENDERER", "rnmapbox")).strip().lower()
    if renderer_id not in {"rnmapbox", "maplibre"}:
        raise OfflineBundlePreparationError(
            "invalid_server_renderer", "The configured offline renderer is invalid.", http_status=503,
        )
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
        revision = "style-" + hashlib.sha256(style_uri.encode("utf-8")).hexdigest()[:16]
    return OfflineRendererConfigV2(
        id=renderer_id, style_uri=style_uri, style_revision=revision,
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
    return OfflineRendererConfigV2(
        id=renderer.id,
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
    materialized_artifacts: tuple[OfflineMaterializedArtifactV2, ...] | None = None,
    renderer: OfflineRendererConfigV2 | None = None,
    now_epoch: int | None = None,
) -> OfflineBundleManifestV2:
    snapshot = snapshot or load_offline_catalog_snapshot_v2()
    _validate_snapshot_freshness(snapshot, int(now_epoch if now_epoch is not None else time.time()))
    renderer = _validated_renderer_config_v2(
        renderer or load_offline_renderer_config_v2(),
    )
    sources = _read_materialized_artifacts(materialized_artifacts)

    selected = tuple(item for item in snapshot.items if (
        _bounds_intersect(item.spatial_bounds, request.bounds)
        if item.kind == "trail" and item.spatial_bounds is not None
        else item.kind == "place"
        and request.bounds.west <= item.lng <= request.bounds.east
        and request.bounds.south <= item.lat <= request.bounds.north
    ))
    places = tuple(item for item in selected if item.kind == "place")
    trails = tuple(item for item in selected if item.kind == "trail")
    thumbnails = tuple(item for item in selected if item.licensed_thumbnail)

    expected_counts = {
        "places": len(places),
        "trails": len(trails),
        "search_index": len(places) + len(trails),
        "thumbnail": len(thumbnails),
    }
    required_kinds = {"places", "trails", "search_index"}
    if thumbnails:
        required_kinds.add("thumbnail")
    if request.options.routing:
        required_kinds.add("routing")
    if request.options.contours:
        required_kinds.add("contours")
    if request.options.extended_media:
        required_kinds.add("media")
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
        "style_uri": renderer.style_uri,
        "bounds": request.bounds.model_dump(mode="json"),
        "min_zoom": request.min_zoom,
        "max_zoom": request.max_zoom,
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
        "thumbnail_ids": [item.item_id for item in thumbnails],
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
            style_uri=renderer.style_uri,
            style_revision=renderer.style_revision,
            style_pack_id=style_pack_id,
            tile_region_id=tile_region_id,
        ).model_dump(mode="json", exclude_none=True),
        "bounds": request.bounds.model_dump(mode="json"),
        "min_zoom": request.min_zoom,
        "max_zoom": request.max_zoom,
        "artifacts": [artifact.model_dump(mode="json", exclude_none=True) for artifact in artifacts],
        "capabilities": OfflineBundleCapabilitiesV2(
            map=True,
            places="places" in sources,
            trails="trails" in sources,
            search="search_index" in sources,
            routing=request.options.routing and "routing" in sources,
            contours=request.options.contours and "contours" in sources,
            media=any(artifact.kind in {"thumbnail", "media"} for artifact in artifacts),
        ).model_dump(mode="json"),
        "required_storage_bytes": required_storage_bytes,
        "source_attribution": sorted(attribution),
        "license_ids": sorted(license_ids),
        "replaces_revisions": [],
    }
    manifest_payload["manifest_sha256"] = offline_manifest_sha256_v2(manifest_payload)
    return OfflineBundleManifestV2.model_validate(manifest_payload)
