"""Production materialization for immutable OfflineBundleManifestV2 artifacts."""
from __future__ import annotations

import hashlib
import io
import ipaddress
import json
import math
import os
import re
import shutil
import socket
import sqlite3
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import quote, urlsplit

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from config.settings import settings
from dashboard.pmtiles_states import REGION_BBOXES, STATE_BBOXES
from dashboard.offline_bundles_v2 import (
    OfflineBoundsV2,
    OfflineBundleManifestV2,
    OfflineBundlePreparationError,
    OfflineBundlePrepareRequestV2,
    OfflineCatalogItemV2,
    OfflineCatalogSnapshotV2,
    OfflineMaterializedArtifactV2,
    OfflineRendererConfigV2,
    _compact_public_document,
    _geometry_bounds,
    _licensed_thumbnail,
    _source_rights,
    load_offline_catalog_snapshot_v2,
    load_offline_renderer_config_v2,
    merge_offline_catalog_snapshot_v2,
    prepare_offline_bundle_manifest_v2,
)


@dataclass(frozen=True)
class StoredOfflineArtifactV2:
    artifact_id: str
    kind: str
    storage_path: str
    media_type: str
    byte_count: int
    sha256: str
    record_count: int


@dataclass(frozen=True)
class OfflineMaterializationResultV2:
    manifest: OfflineBundleManifestV2
    artifacts: tuple[StoredOfflineArtifactV2, ...]


ThumbnailFetcherV2 = Callable[[str], tuple[bytes, str]]
RendererProbeV2 = Callable[[OfflineBundlePrepareRequestV2, OfflineRendererConfigV2], None]
ProgressCallbackV2 = Callable[[int], None]


DEFAULT_PLACE_PACK_ROOT_V2 = (
    Path(__file__).resolve().parents[1] / "data" / "place_packs"
)

# Keep this in lockstep with dashboard.place_packs.PACK_DEFINITIONS. V2 reads
# the immutable V1 outputs so existing offline inventory is preserved while
# the mobile client migrates to content-hashed artifacts.
OFFLINE_PLACE_PACK_FAMILIES_V2 = (
    "camps",
    "essentials",
    "services",
    "outdoors",
    "water",
    "trek_places",
)

# These rows are Trailhead-curated fallbacks, but their checked-in V1 packs do
# not carry a redistribution license. Do not silently omit them and issue a
# misleading Ready bundle. Preparation fails explicitly until their rights are
# documented or a redistribution-safe Pakistan source replaces them.
_UNVERIFIED_OFFLINE_PACK_SOURCES_V2 = frozenset({
    "pakistan_karakoram_curated",
    "pakistan_karakoram_curated_places",
    "pakistan_karakoram_curated_services",
    "pakistan_karakoram_curated_treks",
})
_PLACE_PACK_REGION_BOUNDS_V2 = {
    **{key.lower(): value for key, value in STATE_BBOXES.items()},
    **{key.lower(): value for key, value in REGION_BBOXES.items()},
}


def offline_artifact_root_v2() -> Path:
    configured = str(os.getenv("TRAILHEAD_OFFLINE_ARTIFACT_ROOT") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if Path("/data").is_dir():
        return Path("/data/offline_artifacts").resolve()
    return (Path(__file__).resolve().parent / "offline_artifacts").resolve()


def _json_object(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value:
        return {}
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _json_list(value: object) -> list:
    if isinstance(value, list):
        return value
    if not isinstance(value, str) or not value:
        return []
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        return []
    return decoded if isinstance(decoded, list) else []


def _database_catalog_items_v2(bounds: OfflineBoundsV2) -> tuple[OfflineCatalogItemV2, ...]:
    """Load only public, license-compatible canonical records in/intersecting the box."""
    path = Path(settings.db_path)
    if not path.is_file():
        return ()
    db = sqlite3.connect(str(path))
    db.row_factory = sqlite3.Row
    items: dict[str, OfflineCatalogItemV2] = {}
    try:
        tables = {
            row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "places" in tables:
            rows = db.execute(
                """SELECT * FROM places
                   WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
                   ORDER BY trailhead_place_id""",
                (bounds.south, bounds.north, bounds.west, bounds.east),
            ).fetchall()
            for row in rows:
                raw = dict(row)
                source = str(raw.get("source") or raw.get("source_label") or "")
                rights = _source_rights(source)
                if not rights:
                    continue
                item_id = str(raw.get("trailhead_place_id") or "").strip()
                if not item_id:
                    continue
                metadata = _json_object(raw.get("display_metadata"))
                record = {**metadata, **raw, "id": item_id}
                media = metadata.get("media") or metadata.get("photos")
                thumbnail = _licensed_thumbnail(media)
                document = _compact_public_document(
                    record,
                    item_id=item_id,
                    kind="place",
                    lat=float(raw["lat"]),
                    lng=float(raw["lng"]),
                    source_label=str(raw.get("source_label") or source),
                    attribution=rights[1],
                )
                aliases = tuple(
                    str(value)[:120] for value in (
                        metadata.get("search_aliases") or metadata.get("aliases") or []
                    )[:80] if str(value or "").strip()
                )
                items[item_id] = OfflineCatalogItemV2(
                    item_id=item_id,
                    kind="place",
                    lat=float(raw["lat"]),
                    lng=float(raw["lng"]),
                    source_label=str(raw.get("source_label") or source),
                    license_id=rights[0],
                    attribution=rights[1],
                    licensed_thumbnail=thumbnail is not None,
                    title=str(raw.get("name") or item_id)[:240],
                    subtitle=str(metadata.get("summary") or raw.get("category") or "")[:500],
                    category=str(raw.get("category") or raw.get("subtype") or "place")[:80],
                    parent_destination=str(metadata.get("admin") or metadata.get("region") or "")[:180],
                    aliases=aliases,
                    document=document,
                    thumbnail_url=thumbnail[0] if thumbnail else None,
                    thumbnail_license_id=thumbnail[1] if thumbnail else None,
                    thumbnail_attribution=thumbnail[2] if thumbnail else None,
                )
        if "trail_profiles" in tables:
            rows = db.execute(
                "SELECT * FROM trail_profiles WHERE geometry IS NOT NULL ORDER BY id"
            ).fetchall()
            for row in rows:
                raw = dict(row)
                source = str(raw.get("source") or raw.get("source_label") or "")
                rights = _source_rights(source)
                geometry = _json_object(raw.get("geometry"))
                geometry_bounds = _geometry_bounds(geometry)
                if not rights or geometry_bounds is None:
                    continue
                west, south, east, north = geometry_bounds
                if (
                    east < bounds.west or west > bounds.east
                    or north < bounds.south or south > bounds.north
                ):
                    continue
                item_id = str(raw.get("id") or "").strip()
                if not item_id:
                    continue
                photos = _json_list(raw.get("photos"))
                record = {
                    **raw,
                    "id": item_id,
                    "activities": _json_list(raw.get("activities")),
                    "trailheads": _json_list(raw.get("trailheads")),
                    "photos": photos,
                }
                thumbnail = _licensed_thumbnail(photos)
                document = _compact_public_document(
                    record,
                    item_id=item_id,
                    kind="trail",
                    lat=float(raw["lat"]),
                    lng=float(raw["lng"]),
                    source_label=str(raw.get("source_label") or source),
                    attribution=rights[1],
                )
                items[item_id] = OfflineCatalogItemV2(
                    item_id=item_id,
                    kind="trail",
                    lat=float(raw["lat"]),
                    lng=float(raw["lng"]),
                    source_label=str(raw.get("source_label") or source),
                    license_id=rights[0],
                    attribution=rights[1],
                    licensed_thumbnail=thumbnail is not None,
                    spatial_bounds=geometry_bounds,
                    title=str(raw.get("name") or item_id)[:240],
                    subtitle=str(raw.get("summary") or raw.get("difficulty") or "")[:500],
                    category="trail",
                    aliases=tuple(str(value)[:120] for value in record["activities"][:80]),
                    document=document,
                    geometry=geometry,
                    thumbnail_url=thumbnail[0] if thumbnail else None,
                    thumbnail_license_id=thumbnail[1] if thumbnail else None,
                    thumbnail_attribution=thumbnail[2] if thumbnail else None,
                )
    finally:
        db.close()
    return tuple(items[key] for key in sorted(items))


def _merge_pack_value_v2(existing: object, incoming: object) -> object:
    """Combine two records from the same stable source/id without losing detail."""
    if isinstance(existing, list) and isinstance(incoming, list):
        values: list = []
        seen: set[str] = set()
        for value in [*existing, *incoming]:
            marker = json.dumps(
                value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
            )
            if marker not in seen:
                seen.add(marker)
                values.append(value)
        return values
    if isinstance(existing, dict) and isinstance(incoming, dict):
        return {**existing, **incoming}
    return incoming if incoming not in (None, "", [], {}) else existing


def _place_pack_root_v2(configured: Path | None = None) -> Path:
    if configured is not None:
        return configured.expanduser().resolve()
    env_root = str(os.getenv("TRAILHEAD_PLACE_PACK_ROOT") or "").strip()
    return (
        Path(env_root).expanduser().resolve()
        if env_root else DEFAULT_PLACE_PACK_ROOT_V2.resolve()
    )


def _place_pack_path_intersects_v2(path: Path, bounds: OfflineBoundsV2) -> bool:
    """Skip known region files that cannot contribute to the selected box."""
    region_id = path.name.split("-", 1)[0].lower()
    region_bounds = _PLACE_PACK_REGION_BOUNDS_V2.get(region_id)
    if region_bounds is None:
        return True
    west, south, east, north = region_bounds
    return not (
        east < bounds.west or west > bounds.east
        or north < bounds.south or south > bounds.north
    )


def load_offline_place_pack_items_v2(
    bounds: OfflineBoundsV2,
    *,
    root: Path | None = None,
) -> tuple[OfflineCatalogItemV2, ...]:
    """Load every intersecting, redistribution-safe V1 place-pack family.

    The V1 packs remain the richest current source for campground/site detail,
    practical services, outdoors context, and specialized water inventory.
    Records are deduplicated by their server-owned source and stable source ID.
    Unknown providers and bare ``photo_url`` values are intentionally excluded;
    only explicit redistribution licenses can create a thumbnail artifact.
    """
    pack_root = _place_pack_root_v2(root)
    if not pack_root.is_dir():
        return ()
    paths = sorted({
        path
        for family in OFFLINE_PLACE_PACK_FAMILIES_V2
        for path in pack_root.glob(f"*-{family}.json")
        if _place_pack_path_intersects_v2(path, bounds)
    })
    accumulated: dict[tuple[str, str], dict] = {}
    unverified_sources: set[str] = set()
    for path in paths:
        try:
            if path.stat().st_size > 128 * 1024 * 1024:
                raise ValueError("pack exceeds size limit")
            raw = path.read_bytes()
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("pack payload is invalid")
            points = payload.get("points")
            if not isinstance(points, list):
                raise ValueError("pack payload is invalid")
            if len(points) > 500_000:
                raise ValueError("pack record limit exceeded")
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise OfflineBundlePreparationError(
                "offline_place_pack_invalid",
                "A packaged offline place source is invalid.",
                http_status=503,
            ) from exc
        pack_id = str(payload.get("pack_id") or path.stem).strip()[:120]
        pack_revision = hashlib.sha256(raw).hexdigest()
        try:
            generated_at = int(payload.get("generated_at") or 0)
        except (TypeError, ValueError):
            generated_at = 0
        region = str(payload.get("region_name") or payload.get("region_id") or "").strip()
        for candidate in points:
            if not isinstance(candidate, dict):
                continue
            try:
                lat = float(candidate.get("lat"))
                lng = float(candidate.get("lng"))
            except (TypeError, ValueError):
                continue
            if (
                not math.isfinite(lat) or not math.isfinite(lng)
                or not (bounds.south <= lat <= bounds.north)
                or not (bounds.west <= lng <= bounds.east)
            ):
                continue
            source = str(candidate.get("source") or "").strip().lower()
            rights = _source_rights(source)
            source_id = str(candidate.get("id") or "").strip()
            if not rights:
                if source in _UNVERIFIED_OFFLINE_PACK_SOURCES_V2:
                    unverified_sources.add(source)
                continue
            if not source_id:
                continue
            key = (source, source_id)
            entry = accumulated.get(key)
            if entry is None:
                record = dict(candidate)
                if region and not record.get("region"):
                    record["region"] = region
                entry = {
                    "record": record,
                    "rights": rights,
                    "provenance": [],
                }
                accumulated[key] = entry
            else:
                record = entry["record"]
                for field, value in candidate.items():
                    record[field] = _merge_pack_value_v2(record.get(field), value)
            provenance = {
                "source": source,
                "source_id": source_id,
                "license": rights[0],
                "attribution": rights[1],
                "pack_id": pack_id,
                "revision": pack_revision,
                "generated_at": generated_at,
            }
            if provenance not in entry["provenance"]:
                entry["provenance"].append(provenance)

    if unverified_sources:
        raise OfflineBundlePreparationError(
            "offline_place_inventory_rights_unverified",
            "Verified offline place coverage is not available for this area yet.",
            http_status=503,
        )

    sources_by_raw_id: dict[str, set[str]] = {}
    for source, source_id in accumulated:
        sources_by_raw_id.setdefault(source_id, set()).add(source)

    items: list[OfflineCatalogItemV2] = []
    for (source, source_id), entry in sorted(accumulated.items()):
        record = dict(entry["record"])
        rights = entry["rights"]
        item_id = (
            source_id
            if len(sources_by_raw_id[source_id]) == 1
            else f"{source}:{source_id}"
        )
        record["id"] = item_id
        record["sources"] = entry["provenance"]
        lat = float(record["lat"])
        lng = float(record["lng"])
        category = str(record.get("category") or record.get("type") or "place").strip()[:80]
        aliases: list[str] = []
        for key in ("aliases", "search_terms", "local_terms", "tags", "site_types"):
            values = record.get(key)
            if isinstance(values, str):
                values = [values]
            if not isinstance(values, list):
                continue
            for value in values:
                clean = str(value or "").strip()
                if clean and clean not in aliases:
                    aliases.append(clean[:120])
        licensed_thumbnail = _licensed_thumbnail(record.get("media"))
        document = _compact_public_document(
            record,
            item_id=item_id,
            kind="place",
            lat=lat,
            lng=lng,
            source_label=source,
            attribution=rights[1],
        )
        items.append(OfflineCatalogItemV2(
            item_id=item_id,
            kind="place",
            lat=lat,
            lng=lng,
            source_label=source,
            license_id=rights[0],
            attribution=rights[1],
            licensed_thumbnail=licensed_thumbnail is not None,
            title=str(record.get("name") or item_id).strip()[:240],
            subtitle=str(record.get("subtype") or record.get("address") or category).strip()[:500],
            category=category,
            parent_destination=str(record.get("region") or "").strip()[:180],
            aliases=tuple(aliases[:80]),
            document=document,
            thumbnail_url=licensed_thumbnail[0] if licensed_thumbnail else None,
            thumbnail_license_id=licensed_thumbnail[1] if licensed_thumbnail else None,
            thumbnail_attribution=licensed_thumbnail[2] if licensed_thumbnail else None,
        ))
    return tuple(items)


def _selected_items_v2(
    snapshot: OfflineCatalogSnapshotV2,
    bounds: OfflineBoundsV2,
) -> tuple[OfflineCatalogItemV2, ...]:
    selected = []
    for item in snapshot.items:
        if item.kind == "trail":
            if item.spatial_bounds is None:
                continue
            west, south, east, north = item.spatial_bounds
            if east < bounds.west or west > bounds.east or north < bounds.south or south > bounds.north:
                continue
        elif not (bounds.west <= item.lng <= bounds.east and bounds.south <= item.lat <= bounds.north):
            continue
        selected.append(item)
    return tuple(sorted(selected, key=lambda item: item.item_id))


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")


def _sha256_file_v2(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _places_artifact(path: Path, items: tuple[OfflineCatalogItemV2, ...], revision: str) -> int:
    records = [item.document or {
        "id": item.item_id,
        "kind": "place",
        "name": item.title or item.item_id,
        "lat": item.lat,
        "lng": item.lng,
        "category": item.category or "place",
        "source_label": item.source_label,
        "attribution": item.attribution,
    } for item in items if item.kind == "place"]
    source_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    for item in items:
        if item.kind != "place":
            continue
        source_counts[item.source_label] = source_counts.get(item.source_label, 0) + 1
        category = item.category or "place"
        category_counts[category] = category_counts.get(category, 0) + 1
    path.write_bytes(_canonical_json_bytes({
        "schema_version": 2,
        "catalog_revision": revision,
        "count": len(records),
        "source_counts": dict(sorted(source_counts.items())),
        "category_counts": dict(sorted(category_counts.items())),
        "places": records,
        "live_only": [
            "weather", "fire", "reports", "closures", "reservations",
            "availability", "current_conditions",
        ],
    }))
    return len(records)


def _trails_artifact(path: Path, items: tuple[OfflineCatalogItemV2, ...], revision: str) -> int:
    features = []
    for item in items:
        if item.kind != "trail" or not isinstance(item.geometry, dict):
            continue
        properties = dict(item.document or {})
        properties.pop("geometry", None)
        properties.setdefault("id", item.item_id)
        properties.setdefault("name", item.title or item.item_id)
        properties.setdefault("source_label", item.source_label)
        properties.setdefault("attribution", item.attribution)
        features.append({
            "type": "Feature",
            "id": item.item_id,
            "geometry": item.geometry,
            "properties": properties,
        })
    path.write_bytes(_canonical_json_bytes({
        "type": "FeatureCollection",
        "schema_version": 2,
        "catalog_revision": revision,
        "count": len(features),
        "features": features,
    }))
    return len(features)


def _search_artifact(path: Path, items: tuple[OfflineCatalogItemV2, ...]) -> int:
    db = sqlite3.connect(str(path))
    try:
        db.executescript("""
            PRAGMA page_size=4096;
            PRAGMA journal_mode=DELETE;
            PRAGMA synchronous=FULL;
            PRAGMA auto_vacuum=NONE;
            PRAGMA application_id=1414679602;
            PRAGMA user_version=2;
            CREATE TABLE offline_search_documents (
                result_id TEXT NOT NULL UNIQUE,
                canonical_place_id TEXT,
                title TEXT NOT NULL,
                subtitle TEXT,
                kind TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                parent_destination TEXT
            );
            CREATE VIRTUAL TABLE offline_search_fts USING fts5(
                title, subtitle, aliases,
                tokenize='unicode61 remove_diacritics 2'
            );
            CREATE VIRTUAL TABLE offline_search_spatial USING rtree(
                id, min_lng, max_lng, min_lat, max_lat
            );
        """)
        for item in items:
            title = item.title or str((item.document or {}).get("name") or item.item_id)
            subtitle = item.subtitle or str((item.document or {}).get("summary") or "")
            kind = item.category or item.kind
            cursor = db.execute(
                """INSERT INTO offline_search_documents
                   (result_id,canonical_place_id,title,subtitle,kind,lat,lng,parent_destination)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (
                    item.item_id, item.item_id, title, subtitle, kind,
                    item.lat, item.lng, item.parent_destination or None,
                ),
            )
            rowid = int(cursor.lastrowid)
            aliases = " ".join(item.aliases)
            db.execute(
                "INSERT INTO offline_search_fts(rowid,title,subtitle,aliases) VALUES (?,?,?,?)",
                (rowid, title, subtitle, aliases),
            )
            west, south, east, north = (
                item.spatial_bounds
                if item.kind == "trail" and item.spatial_bounds is not None
                else (item.lng, item.lat, item.lng, item.lat)
            )
            db.execute(
                """INSERT INTO offline_search_spatial
                   (id,min_lng,max_lng,min_lat,max_lat) VALUES (?,?,?,?,?)""",
                (rowid, west, east, south, north),
            )
        db.commit()
        quick = db.execute("PRAGMA quick_check").fetchone()
        if not quick or str(quick[0]).lower() != "ok":
            raise OfflineBundlePreparationError(
                "offline_search_index_invalid",
                "The generated offline search index failed its integrity check.",
                http_status=503,
            )
    finally:
        db.close()
    return len(items)


def _validate_public_thumbnail_url(url: str) -> str:
    parsed = urlsplit(str(url or "").strip())
    if (
        parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
        or parsed.fragment
    ):
        raise OfflineBundlePreparationError(
            "offline_thumbnail_url_invalid", "A licensed thumbnail URL is invalid.", http_status=503,
        )
    try:
        addresses = {
            item[4][0] for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        }
    except OSError as exc:
        raise OfflineBundlePreparationError(
            "offline_thumbnail_unreachable", "A licensed thumbnail could not be resolved.", http_status=503,
        ) from exc
    if not addresses or any(
        ipaddress.ip_address(address).is_private
        or ipaddress.ip_address(address).is_loopback
        or ipaddress.ip_address(address).is_link_local
        or ipaddress.ip_address(address).is_reserved
        or ipaddress.ip_address(address).is_multicast
        for address in addresses
    ):
        raise OfflineBundlePreparationError(
            "offline_thumbnail_url_invalid", "A licensed thumbnail URL is invalid.", http_status=503,
        )
    return parsed.geturl()


def _fetch_thumbnail_v2(url: str) -> tuple[bytes, str]:
    safe_url = _validate_public_thumbnail_url(url)
    with httpx.Client(timeout=httpx.Timeout(8.0, connect=3.0), follow_redirects=False) as client:
        with client.stream("GET", safe_url, headers={"Accept": "image/jpeg,image/png,image/webp"}) as response:
            if response.status_code != 200:
                raise OfflineBundlePreparationError(
                    "offline_thumbnail_unavailable",
                    "A licensed thumbnail is not available for offline use.",
                    http_status=503,
                )
            content_type = str(response.headers.get("content-type") or "").split(";", 1)[0].lower()
            if content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise OfflineBundlePreparationError(
                    "offline_thumbnail_type_invalid",
                    "A licensed thumbnail has an unsupported image format.",
                    http_status=503,
                )
            chunks = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 8 * 1024 * 1024:
                    raise OfflineBundlePreparationError(
                        "offline_thumbnail_too_large",
                        "A licensed thumbnail is too large for offline use.",
                        http_status=503,
                    )
                chunks.append(chunk)
    return b"".join(chunks), content_type


def _normalize_thumbnail_v2(raw: bytes) -> bytes:
    Image.MAX_IMAGE_PIXELS = 36_000_000
    try:
        with Image.open(io.BytesIO(raw)) as source:
            source.verify()
        with Image.open(io.BytesIO(raw)) as source:
            if getattr(source, "n_frames", 1) != 1:
                raise OfflineBundlePreparationError(
                    "offline_thumbnail_animated",
                    "Animated images are not supported for offline thumbnails.",
                    http_status=503,
                )
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=86, optimize=True, progressive=False)
            return output.getvalue()
    except OfflineBundlePreparationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise OfflineBundlePreparationError(
            "offline_thumbnail_decode_failed",
            "A licensed thumbnail could not be prepared.",
            http_status=503,
        ) from exc


def _thumbnail_artifact(
    path: Path,
    items: tuple[OfflineCatalogItemV2, ...],
    fetcher: ThumbnailFetcherV2,
) -> int:
    selected = [item for item in items if item.licensed_thumbnail]
    manifest = []
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for item in selected:
            if not item.thumbnail_url or not item.thumbnail_license_id:
                raise OfflineBundlePreparationError(
                    "offline_thumbnail_metadata_missing",
                    "A licensed thumbnail is missing its offline license metadata.",
                    http_status=503,
                )
            raw, _content_type = fetcher(item.thumbnail_url)
            image = _normalize_thumbnail_v2(raw)
            digest = hashlib.sha256(image).hexdigest()
            filename = f"images/{digest}.jpg"
            info = zipfile.ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, image)
            manifest.append({
                "item_id": item.item_id,
                "file": filename,
                "sha256": digest,
                "license_id": item.thumbnail_license_id,
                "attribution": item.thumbnail_attribution or "",
                "source_url": item.thumbnail_url,
            })
        info = zipfile.ZipInfo("manifest.json", date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, _canonical_json_bytes({
            "schema_version": 2, "count": len(manifest), "items": manifest,
        }))
    return len(manifest)


def _mapbox_public_token() -> str:
    token = str(
        os.getenv("TRAILHEAD_RNMAPBOX_PUBLIC_TOKEN")
        or os.getenv("MAPBOX_TOKEN")
        or settings.mapbox_token
        or ""
    ).strip()
    if not re.fullmatch(r"pk\.[A-Za-z0-9._-]{20,500}", token):
        raise OfflineBundlePreparationError(
            "rnmapbox_token_missing",
            "RNMapbox offline style and tile provisioning is not configured.",
            http_status=503,
        )
    return token


def verify_rnmapbox_provisioning_v2(
    request: OfflineBundlePrepareRequestV2,
    renderer: OfflineRendererConfigV2,
) -> None:
    if renderer.id != "rnmapbox":
        raise OfflineBundlePreparationError(
            "offline_renderer_mismatch",
            "Offline V2 currently requires the Trailhead RNMapbox renderer.",
            http_status=503,
        )
    parts = [part for part in renderer.style_uri.removeprefix("mapbox://styles/").split("/") if part]
    if len(parts) != 2:
        raise OfflineBundlePreparationError(
            "invalid_server_style", "The configured RNMapbox style is invalid.", http_status=503,
        )
    token = _mapbox_public_token()
    url = f"https://api.mapbox.com/styles/v1/{quote(parts[0], safe='')}/{quote(parts[1], safe='')}"
    try:
        with httpx.Client(timeout=httpx.Timeout(6.0, connect=3.0), follow_redirects=False) as client:
            response = client.get(url, params={"access_token": token})
    except httpx.HTTPError as exc:
        raise OfflineBundlePreparationError(
            "rnmapbox_style_unreachable",
            "The configured RNMapbox style could not be verified for offline use.",
            http_status=503,
        ) from exc
    if response.status_code != 200:
        raise OfflineBundlePreparationError(
            "rnmapbox_style_not_provisioned",
            "The configured RNMapbox style is not available for offline use.",
            http_status=503,
        )
    try:
        style = response.json()
    except ValueError:
        style = None
    if not isinstance(style, dict) or not isinstance(style.get("sources"), dict):
        raise OfflineBundlePreparationError(
            "rnmapbox_style_invalid",
            "The configured RNMapbox style could not be used for offline maps.",
            http_status=503,
        )


def _optional_artifact(
    kind: str,
    request: OfflineBundlePrepareRequestV2,
) -> tuple[Path, str, int, str]:
    env_name = {
        "routing": "TRAILHEAD_OFFLINE_ROUTING_MANIFEST",
        "contours": "TRAILHEAD_OFFLINE_CONTOURS_MANIFEST",
        "media": "TRAILHEAD_OFFLINE_MEDIA_MANIFEST",
    }[kind]
    manifest_path = Path(str(os.getenv(env_name) or "")).expanduser()
    if not manifest_path.is_file():
        raise OfflineBundlePreparationError(
            f"offline_{kind}_not_provisioned",
            f"The requested offline {kind} data is not provisioned for this area.",
            http_status=503,
        )
    try:
        descriptor = json.loads(manifest_path.read_text(encoding="utf-8"))
        source = (manifest_path.parent / str(descriptor["path"])).resolve()
        coverage = OfflineBoundsV2.model_validate(descriptor["bounds"])
        expected_sha = str(descriptor["sha256"])
        record_count = int(descriptor.get("record_count") or 0)
        media_type = str(descriptor.get("media_type") or "application/octet-stream")
    except Exception as exc:
        raise OfflineBundlePreparationError(
            f"offline_{kind}_manifest_invalid",
            f"The configured offline {kind} manifest is invalid.",
            http_status=503,
        ) from exc
    if not (
        coverage.west <= request.bounds.west <= request.bounds.east <= coverage.east
        and coverage.south <= request.bounds.south <= request.bounds.north <= coverage.north
    ) or not source.is_file():
        raise OfflineBundlePreparationError(
            f"offline_{kind}_coverage_missing",
            f"The requested offline {kind} data does not cover this area.",
            http_status=503,
        )
    digest = _sha256_file_v2(source)
    if digest != expected_sha:
        raise OfflineBundlePreparationError(
            f"offline_{kind}_integrity_failed",
            f"The configured offline {kind} data failed integrity verification.",
            http_status=503,
        )
    return source, media_type, record_count, digest


def _persist_local_artifact(source: Path, digest: str, kind: str) -> str:
    root = offline_artifact_root_v2()
    suffix = source.suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,10}", source.suffix) else ".bin"
    destination = (root / "objects" / digest[:2] / f"{digest}-{kind}{suffix}").resolve()
    if root != destination and root not in destination.parents:
        raise OfflineBundlePreparationError(
            "offline_artifact_path_invalid", "Offline artifact storage is invalid.", http_status=503,
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        if _sha256_file_v2(destination) != digest:
            raise OfflineBundlePreparationError(
                "offline_artifact_store_conflict",
                "Offline artifact storage contains conflicting data.",
                http_status=503,
            )
        return str(destination)
    temporary = destination.parent / (
        f".{destination.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        with source.open("rb") as reader, temporary.open("xb") as writer:
            shutil.copyfileobj(reader, writer, length=1024 * 1024)
            writer.flush()
            os.fsync(writer.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return str(destination)


def _r2_client():
    if not (
        settings.r2_account_id and settings.r2_access_key_id
        and settings.r2_secret_access_key and settings.r2_bucket
    ):
        raise OfflineBundlePreparationError(
            "offline_object_store_not_configured",
            "Offline object storage is not configured.",
            http_status=503,
        )
    try:
        import boto3
        from botocore.config import Config
        return boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    except Exception as exc:
        raise OfflineBundlePreparationError(
            "offline_object_store_unavailable",
            "Offline object storage is unavailable.",
            http_status=503,
        ) from exc


def offline_r2_client_v2():
    """Return the configured private R2 client for authenticated delivery."""
    return _r2_client()


def _persist_r2_artifact(
    source: Path,
    digest: str,
    kind: str,
    media_type: str,
    record_count: int,
) -> str:
    client = _r2_client()
    prefix = str(os.getenv("TRAILHEAD_OFFLINE_R2_PREFIX") or "offline-v2").strip("/")
    if not re.fullmatch(r"[A-Za-z0-9/_-]{1,120}", prefix):
        raise OfflineBundlePreparationError(
            "offline_object_prefix_invalid", "Offline object storage is invalid.", http_status=503,
        )
    suffix = source.suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,10}", source.suffix) else ".bin"
    key = f"{prefix}/objects/{digest[:2]}/{digest}-{kind}{suffix}"
    try:
        with source.open("rb") as body:
            client.put_object(
                Bucket=settings.r2_bucket,
                Key=key,
                Body=body,
                ContentType=media_type,
                CacheControl="private, max-age=31536000, immutable",
                Metadata={
                    "sha256": digest,
                    "record-count": str(record_count),
                    "schema-version": "2",
                },
            )
        head = client.head_object(Bucket=settings.r2_bucket, Key=key)
    except Exception as exc:
        raise OfflineBundlePreparationError(
            "offline_object_store_write_failed",
            "An offline artifact could not be stored.",
            http_status=503,
        ) from exc
    if (
        int(head.get("ContentLength") or -1) != source.stat().st_size
        or str((head.get("Metadata") or {}).get("sha256") or "") != digest
    ):
        raise OfflineBundlePreparationError(
            "offline_object_store_verify_failed",
            "An offline artifact could not be verified after storage.",
            http_status=503,
        )
    return f"r2://{settings.r2_bucket}/{key}"


def _persist_artifact(
    source: Path,
    digest: str,
    kind: str,
    media_type: str,
    record_count: int,
) -> str:
    backend = str(os.getenv("TRAILHEAD_OFFLINE_ARTIFACT_STORE") or "local").strip().lower()
    if backend == "local":
        return _persist_local_artifact(source, digest, kind)
    if backend == "r2":
        return _persist_r2_artifact(source, digest, kind, media_type, record_count)
    raise OfflineBundlePreparationError(
        "offline_artifact_store_invalid",
        "The configured offline artifact store is invalid.",
        http_status=503,
    )


def materialize_offline_bundle_v2(
    preparation_id: str,
    request: OfflineBundlePrepareRequestV2,
    *,
    snapshot: OfflineCatalogSnapshotV2 | None = None,
    renderer: OfflineRendererConfigV2 | None = None,
    thumbnail_fetcher: ThumbnailFetcherV2 | None = None,
    renderer_probe: RendererProbeV2 | None = None,
    include_database: bool = True,
    include_place_packs: bool | None = None,
    place_pack_root: Path | None = None,
    progress_callback: ProgressCallbackV2 | None = None,
) -> OfflineMaterializationResultV2:
    """Build, verify, persist, and bind all immutable artifacts for one job."""
    if not re.fullmatch(r"offprep_[A-Za-z0-9_-]{8,80}", preparation_id):
        raise OfflineBundlePreparationError(
            "offline_preparation_id_invalid", "Offline preparation is invalid.", http_status=503,
        )
    caller_supplied_snapshot = snapshot is not None
    snapshot = snapshot or load_offline_catalog_snapshot_v2()
    if include_place_packs is None:
        include_place_packs = not caller_supplied_snapshot
    if include_place_packs:
        snapshot = merge_offline_catalog_snapshot_v2(
            snapshot,
            load_offline_place_pack_items_v2(request.bounds, root=place_pack_root),
        )
    if include_database:
        snapshot = merge_offline_catalog_snapshot_v2(
            snapshot, _database_catalog_items_v2(request.bounds),
        )
    renderer = renderer or load_offline_renderer_config_v2(request.renderer_style_id)
    if request.renderer_style_id and renderer.style_id != request.renderer_style_id:
        raise OfflineBundlePreparationError(
            "offline_renderer_style_mismatch",
            "The prepared offline map style does not match the requested approved style.",
            http_status=503,
        )
    (renderer_probe or verify_rnmapbox_provisioning_v2)(request, renderer)
    if progress_callback:
        progress_callback(12)
    selected = _selected_items_v2(snapshot, request.bounds)
    if progress_callback:
        progress_callback(20)
    root = offline_artifact_root_v2()
    root.mkdir(parents=True, exist_ok=True)
    stored: list[StoredOfflineArtifactV2] = []
    with tempfile.TemporaryDirectory(prefix="offline-v2-", dir=str(root)) as temp:
        temp_root = Path(temp)
        definitions: list[tuple[str, Path, str, int]] = []
        places_path = temp_root / "places.json"
        definitions.append((
            "places", places_path, "application/json",
            _places_artifact(places_path, selected, snapshot.revision),
        ))
        if progress_callback:
            progress_callback(35)
        trails_path = temp_root / "trails.geojson"
        definitions.append((
            "trails", trails_path, "application/geo+json",
            _trails_artifact(trails_path, selected, snapshot.revision),
        ))
        if progress_callback:
            progress_callback(50)
        search_path = temp_root / "search.sqlite"
        definitions.append((
            "search_index", search_path, "application/vnd.sqlite3",
            _search_artifact(search_path, selected),
        ))
        if progress_callback:
            progress_callback(70)
        # Keep licensed image references in canonical place source data, but do
        # not materialize a 1.0.10 thumbnail ZIP until mobile can atomically
        # install it and resolve local photo paths. An unused ZIP would consume
        # storage without providing an offline image capability.
        if progress_callback:
            progress_callback(80)
        for kind, enabled in (
            ("routing", request.options.routing),
            ("contours", request.options.contours),
        ):
            if not enabled:
                continue
            source, media_type, count, _digest = _optional_artifact(kind, request)
            destination = temp_root / f"{kind}{source.suffix or '.bin'}"
            shutil.copyfile(source, destination)
            definitions.append((kind, destination, media_type, count))

        materialized: list[OfflineMaterializedArtifactV2] = []
        digests: dict[str, str] = {}
        for kind, path, media_type, count in definitions:
            if not path.is_file() or path.stat().st_size <= 0:
                raise OfflineBundlePreparationError(
                    "offline_artifact_empty",
                    f"The generated {kind} offline artifact is empty.",
                    http_status=503,
                )
            digest = _sha256_file_v2(path)
            digests[kind] = digest
            materialized.append(OfflineMaterializedArtifactV2(
                kind=kind,  # type: ignore[arg-type]
                path=path,
                uri=(
                    f"/api/offline/bundles/{quote(preparation_id, safe='')}/"
                    f"artifacts/{quote(kind, safe='')}"
                ),
                revision=f"{kind}-{digest[:24]}",
                media_type=media_type,
                record_count=count,
            ))
        manifest = prepare_offline_bundle_manifest_v2(
            request,
            snapshot=snapshot,
            materialized_artifacts=tuple(materialized),
            renderer=renderer,
        )
        if progress_callback:
            progress_callback(88)
        for index, (kind, path, media_type, count) in enumerate(definitions):
            digest = digests[kind]
            storage_path = _persist_artifact(path, digest, kind, media_type, count)
            stored.append(StoredOfflineArtifactV2(
                artifact_id=kind,
                kind=kind,
                storage_path=storage_path,
                media_type=media_type,
                byte_count=path.stat().st_size,
                sha256=digest,
                record_count=count,
            ))
            if progress_callback:
                progress_callback(90 + int(8 * (index + 1) / max(1, len(definitions))))
    return OfflineMaterializationResultV2(manifest=manifest, artifacts=tuple(stored))
