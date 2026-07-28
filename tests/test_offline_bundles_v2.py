from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import ANY, AsyncMock, patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
from PIL import Image

import dashboard.server as server
from config.settings import settings
from db import store
from dashboard.offline_bundles_v2 import (
    OfflineBoundsV2,
    OfflineBundlePrepareRequestV2,
    OfflineBundlePreparationError,
    OfflineCatalogItemV2,
    OfflineCatalogSnapshotV2,
    OfflineMaterializedArtifactV2,
    OfflineRendererConfigV2,
    _compact_public_document,
    _tile_count,
    load_offline_renderer_config_v2,
    offline_manifest_sha256_v2,
    offline_trail_scope_catalog_item_v2,
    prepare_offline_bundle_manifest_v2,
)
from dashboard.trails_v2 import TrailSystemV2
from dashboard.offline_materializer_v2 import (
    OFFLINE_PLACE_PACK_FAMILIES_V2,
    _database_catalog_items_v2,
    load_offline_place_pack_items_v2,
    materialize_offline_bundle_v2,
)


NOW_EPOCH = 1_784_586_544


def _snapshot(revision: str = "a" * 64) -> OfflineCatalogSnapshotV2:
    return OfflineCatalogSnapshotV2(
        revision=revision,
        generated_at=1_783_231_656,
        items=(
            OfflineCatalogItemV2(
                item_id="place:nps:moab-camp",
                kind="place",
                lat=38.58,
                lng=-109.55,
                source_label="NPS",
                license_id="US-FEDERAL-PUBLIC-DATA",
                attribution="National Park Service",
                licensed_thumbnail=True,
            ),
            OfflineCatalogItemV2(
                item_id="trail:usfs:moab-trail",
                kind="trail",
                lat=38.62,
                lng=-109.61,
                source_label="USFS",
                license_id="US-FEDERAL-PUBLIC-DATA",
                attribution="U.S. Forest Service",
                spatial_bounds=(-109.72, 38.51, -109.42, 38.72),
            ),
            OfflineCatalogItemV2(
                item_id="place:osm:outside",
                kind="place",
                lat=40.75,
                lng=-111.89,
                source_label="OSM",
                license_id="ODbL-1.0",
                attribution="OpenStreetMap contributors",
            ),
        ),
    )


def _request(
    *,
    options: dict | None = None,
    renderer_style_id: str | None = None,
) -> OfflineBundlePrepareRequestV2:
    return OfflineBundlePrepareRequestV2.model_validate({
        "bounds": {"west": -109.8, "south": 38.4, "east": -109.4, "north": 38.8},
        "min_zoom": 8,
        "max_zoom": 14,
        **({"renderer_style_id": renderer_style_id} if renderer_style_id else {}),
        "options": options or {},
    })


def _trail_system() -> TrailSystemV2:
    return TrailSystemV2.model_validate({
        "id": "trail-system:trail:usfs:moab-short:abc123",
        "primary_trail_id": "trail:usfs:moab-short",
        "name": "Moab Short Trail",
        "kind": "trail",
        "center": {"lat": 38.58, "lng": -109.55},
        "geometry_status": "complete",
        "geometry_revision": "canonical-7:trail:usfs:moab-short",
        "activities": ["Hiking"],
        "permitted_uses": ["Hiking"],
        "facts": {"distance_mi": 2.4, "elevation_gain_ft": 340},
        "trailheads": [{"name": "South Trailhead", "lat": 38.57, "lng": -109.56, "source": "USFS"}],
        "media": [],
        "sources": [{"label": "USFS", "kind": "official"}],
        "freshness": {"checked_at": NOW_EPOCH - 100},
        "capabilities": {
            "details": True, "save": True, "navigate": True,
            "highlight": True, "preview": True, "download": True,
            "build_route": True,
        },
        "summary": "A short source-backed trail.",
        "detail_ref": "/api/trails/v2/trail-system:trail:usfs:moab-short:abc123",
        "preview_ref": "/api/trails/v2/trail-system:trail:usfs:moab-short:abc123/preview",
        "member_trail_ids": ["trail:usfs:moab-short"],
        "geometry": {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[-109.56, 38.57], [-109.54, 38.59]]},
                "properties": {},
            }],
        },
        "bounds": {"west": -109.56, "south": 38.57, "east": -109.54, "north": 38.59},
    })


def _renderer(renderer: str = "rnmapbox") -> OfflineRendererConfigV2:
    return OfflineRendererConfigV2(
        id=renderer,
        style_uri=(
            "mapbox://styles/trailhead/outdoors-v2"
            if renderer == "rnmapbox"
            else "https://maps.gettrailhead.app/styles/outdoors-v2.json"
        ),
        style_revision="style-test-7",
        style_id="server_default",
    )


def _materialized(
    root: Path,
    *,
    options: dict | None = None,
    trail_count: int = 1,
) -> tuple[OfflineMaterializedArtifactV2, ...]:
    counts = {"places": 1, "trails": trail_count, "search_index": 1 + trail_count, "thumbnail": 1}
    media_types = {
        "places": "application/x-sqlite3",
        "trails": "application/vnd.geo+json",
        "search_index": "application/x-sqlite3",
        "thumbnail": "application/zip",
        "routing": "application/octet-stream",
        "contours": "application/octet-stream",
        "media": "application/zip",
    }
    kinds = ["places", "trails", "search_index", "thumbnail"]
    options = options or {}
    if options.get("routing"):
        kinds.append("routing")
        counts["routing"] = 3
    if options.get("contours"):
        kinds.append("contours")
        counts["contours"] = 4
    if options.get("extended_media"):
        kinds.append("media")
        counts["media"] = 1
    artifacts = []
    for kind in kinds:
        path = root / f"{kind}.bin"
        path.write_bytes(f"real-{kind}-artifact".encode("utf-8"))
        artifacts.append(OfflineMaterializedArtifactV2(
            kind=kind,
            path=path,
            uri=f"https://assets.test/offline/{kind}.bin",
            revision=f"{kind}-7",
            media_type=media_types[kind],
            record_count=counts[kind],
        ))
    return tuple(artifacts)


def _prepare(
    root: Path,
    *,
    renderer: str = "rnmapbox",
    options: dict | None = None,
    snapshot: OfflineCatalogSnapshotV2 | None = None,
    trail_count: int = 1,
):
    return prepare_offline_bundle_manifest_v2(
        _request(options=options),
        snapshot=snapshot or _snapshot(),
        materialized_artifacts=_materialized(root, options=options, trail_count=trail_count),
        renderer=_renderer(renderer),
        now_epoch=NOW_EPOCH,
    )


class OfflineBundleV2ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_manifest_is_deterministic_server_owned_and_mobile_compatible(self):
        first = _prepare(self.root)
        second = _prepare(self.root)

        self.assertEqual(first, second)
        self.assertEqual(first.schema_version, 2)
        self.assertTrue(first.bundle_id.startswith("offline_"))
        self.assertTrue(first.revision.startswith("v2-"))
        self.assertEqual(first.renderer.id, "rnmapbox")
        self.assertEqual(first.renderer.style_uri, "mapbox://styles/trailhead/outdoors-v2")
        self.assertIn(first.revision, first.renderer.style_pack_id)
        self.assertIn(first.revision, first.renderer.tile_region_id)
        self.assertEqual(first.replaces_revisions, ())

        by_kind = {artifact.kind: artifact for artifact in first.artifacts}
        self.assertEqual(by_kind["map_style"].storage, "renderer_style_pack")
        self.assertEqual(by_kind["map_tiles"].storage, "renderer_tile_region")
        self.assertEqual(by_kind["places"].record_count, 1)
        self.assertEqual(by_kind["trails"].record_count, 1)
        self.assertEqual(by_kind["search_index"].record_count, 2)
        self.assertNotIn("thumbnail", by_kind)
        self.assertNotIn("media", by_kind)
        self.assertFalse(first.capabilities.media)
        renderer_artifacts = [item for item in first.artifacts if item.storage != "file"]
        file_artifacts = [item for item in first.artifacts if item.storage == "file"]
        self.assertTrue(all(item.sha256 is None and item.uri is None for item in renderer_artifacts))
        self.assertTrue(all(item.integrity == "renderer_probe" for item in renderer_artifacts))
        self.assertTrue(all(item.size_kind == "estimated" for item in renderer_artifacts))
        self.assertTrue(all(item.sha256 and len(item.sha256) == 64 for item in file_artifacts))
        self.assertTrue(all(item.uri and item.integrity == "sha256" for item in file_artifacts))
        self.assertEqual(
            first.manifest_sha256,
            offline_manifest_sha256_v2(first.model_dump(mode="json", exclude_none=True)),
        )
        required_bytes = sum(item.bytes for item in first.artifacts if item.required)
        self.assertGreaterEqual(first.required_storage_bytes, required_bytes)
        self.assertIn("National Park Service", first.source_attribution)
        self.assertIn("U.S. Forest Service", first.source_attribution)
        self.assertIn("MAPBOX-MOBILE-OFFLINE", first.license_ids)
        self.assertIn("US-FEDERAL-PUBLIC-DATA", first.license_ids)

    def test_trail_scope_is_version_bound_and_legacy_request_stays_unchanged(self):
        system = _trail_system()
        scope = {
            "kind": "trail",
            "trail_id": system.id,
            "geometry_revision": system.geometry_revision,
            "corridor_m": 1200,
        }
        scoped_request = OfflineBundlePrepareRequestV2.model_validate(
            {**_request().model_dump(mode="json"), "scope": scope},
        )
        scoped_item = offline_trail_scope_catalog_item_v2(
            system.model_dump(mode="json", exclude_none=True),
        )
        snapshot = OfflineCatalogSnapshotV2(
            revision="b" * 64,
            generated_at=_snapshot().generated_at,
            items=(*_snapshot().items, scoped_item),
        )
        manifest = prepare_offline_bundle_manifest_v2(
            scoped_request,
            snapshot=snapshot,
            materialized_artifacts=_materialized(self.root, trail_count=2),
            renderer=_renderer(),
            now_epoch=NOW_EPOCH,
        )
        legacy = _prepare(self.root)

        self.assertEqual(manifest.scope.trail_id, system.id)
        self.assertEqual(manifest.scope.geometry_revision, system.geometry_revision)
        self.assertNotEqual(manifest.bundle_id, legacy.bundle_id)
        self.assertIsNone(legacy.scope)
        self.assertEqual(scoped_item.geometry["type"], "LineString")
        self.assertEqual(scoped_item.document["trailheads"][0]["name"], "South Trailhead")
        self.assertEqual(
            manifest.manifest_sha256,
            offline_manifest_sha256_v2(manifest.model_dump(mode="json", exclude_none=True)),
        )

    def test_trail_scope_rejects_unlicensed_or_incomplete_routes(self):
        incomplete = _trail_system().model_copy(update={
            "geometry_status": "partial",
            "geometry": None,
        })
        with self.assertRaises(OfflineBundlePreparationError) as incomplete_error:
            offline_trail_scope_catalog_item_v2(
                incomplete.model_dump(mode="json", exclude_none=True),
            )
        self.assertEqual(incomplete_error.exception.code, "offline_trail_incomplete")

        unlicensed = TrailSystemV2.model_validate({
            **_trail_system().model_dump(mode="json"),
            "sources": [{"label": "Unknown provider", "kind": "open"}],
        })
        with self.assertRaises(OfflineBundlePreparationError) as rights_error:
            offline_trail_scope_catalog_item_v2(
                unlicensed.model_dump(mode="json", exclude_none=True),
            )
        self.assertEqual(rights_error.exception.code, "offline_trail_rights_unverified")

    def test_catalog_or_option_edit_changes_revision_without_changing_bundle_identity(self):
        base = _prepare(self.root)
        catalog_edit = _prepare(self.root, snapshot=_snapshot("b" * 64))
        option_edit = _prepare(self.root, options={"routing": True})
        media_option = _prepare(self.root, options={"extended_media": True})

        self.assertEqual(base.bundle_id, catalog_edit.bundle_id)
        self.assertEqual(base.bundle_id, option_edit.bundle_id)
        self.assertNotEqual(base.revision, catalog_edit.revision)
        self.assertNotEqual(base.revision, option_edit.revision)
        self.assertFalse(base.capabilities.routing)
        self.assertFalse(media_option.capabilities.media)
        self.assertNotIn(
            "thumbnail", {artifact.kind for artifact in media_option.artifacts},
        )
        self.assertNotIn(
            "media", {artifact.kind for artifact in media_option.artifacts},
        )
        self.assertTrue(option_edit.capabilities.routing)
        self.assertFalse(any(item.kind == "routing" for item in base.artifacts))
        self.assertTrue(next(
            item for item in option_edit.artifacts if item.kind == "routing"
        ).required)

    def test_maplibre_uses_legacy_pack_descriptors_not_rnmapbox_pack_ids(self):
        rnmapbox = _prepare(self.root)
        maplibre = _prepare(self.root, renderer="maplibre")

        self.assertNotEqual(rnmapbox.bundle_id, maplibre.bundle_id)
        self.assertEqual(maplibre.renderer.id, "maplibre")
        renderer_artifacts = [
            item for item in maplibre.artifacts if item.kind in {"map_style", "map_tiles"}
        ]
        self.assertEqual(
            {item.storage for item in renderer_artifacts}, {"renderer_legacy_pack"},
        )
        self.assertIn("ODbL-1.0", maplibre.license_ids)
        self.assertNotIn("MAPBOX-MOBILE-OFFLINE", maplibre.license_ids)

    def test_request_rejects_forged_metadata_and_style_credentials(self):
        with self.assertRaises(ValidationError):
            OfflineBundlePrepareRequestV2.model_validate({
                **_request().model_dump(mode="json"),
                "bundle_id": "client-owned",
            })
        with self.assertRaises(ValidationError):
            OfflineBundlePrepareRequestV2.model_validate({
                **_request().model_dump(mode="json"),
                "renderer": {
                    "id": "rnmapbox",
                    "style_uri": "mapbox://styles/trailhead/outdoors-v2?access_token=secret",
                },
            })
        with self.assertRaises(ValidationError):
            OfflineBundlePrepareRequestV2.model_validate({
                **_request().model_dump(mode="json"),
                "renderer_style_id": "mapbox://styles/attacker/custom",
            })

    def test_requested_active_style_is_allowlisted_echoed_and_revision_bound(self):
        requested = _request(renderer_style_id="satellite_streets")
        default_request = _request()
        with patch.dict(os.environ, {
            "TRAILHEAD_OFFLINE_RENDERER": "rnmapbox",
            "TRAILHEAD_RNMAPBOX_STYLE_URI": "mapbox://styles/mapbox/outdoors-v12",
            "TRAILHEAD_RNMAPBOX_STYLE_REVISION": "",
            "TRAILHEAD_OFFLINE_DEFAULT_STYLE_ID": "",
            "TRAILHEAD_OFFLINE_RNMAPBOX_STYLE_ALLOWLIST": "",
        }, clear=False):
            selected = prepare_offline_bundle_manifest_v2(
                requested,
                snapshot=_snapshot(),
                materialized_artifacts=_materialized(self.root),
                now_epoch=NOW_EPOCH,
            )
            default = prepare_offline_bundle_manifest_v2(
                default_request,
                snapshot=_snapshot(),
                materialized_artifacts=_materialized(self.root),
                now_epoch=NOW_EPOCH,
            )

        self.assertEqual(selected.renderer.style_id, "satellite_streets")
        self.assertEqual(
            selected.renderer.style_uri,
            "mapbox://styles/mapbox/satellite-streets-v12",
        )
        self.assertEqual(default.renderer.style_id, "outdoors")
        self.assertNotEqual(selected.bundle_id, default.bundle_id)
        self.assertNotEqual(selected.revision, default.revision)

    def test_unknown_style_id_is_rejected_but_server_allowlist_can_add_one(self):
        with patch.dict(os.environ, {
            "TRAILHEAD_OFFLINE_RENDERER": "rnmapbox",
            "TRAILHEAD_OFFLINE_RNMAPBOX_STYLE_ALLOWLIST": "",
        }, clear=False):
            with self.assertRaises(OfflineBundlePreparationError) as raised:
                load_offline_renderer_config_v2("not_approved")
        self.assertEqual(raised.exception.code, "offline_style_not_allowed")

        allowlist = json.dumps({
            "trailhead_topo": {
                "uri": "mapbox://styles/trailhead/topo-v3",
                "revision": "topo-v3-2026-07",
            },
        })
        with patch.dict(os.environ, {
            "TRAILHEAD_OFFLINE_RENDERER": "rnmapbox",
            "TRAILHEAD_OFFLINE_RNMAPBOX_STYLE_ALLOWLIST": allowlist,
        }, clear=False):
            selected = load_offline_renderer_config_v2("trailhead_topo")
        self.assertEqual(selected.style_id, "trailhead_topo")
        self.assertEqual(selected.style_uri, "mapbox://styles/trailhead/topo-v3")
        self.assertEqual(selected.style_revision, "topo-v3-2026-07")

    def test_preparation_fails_closed_without_real_artifacts(self):
        with self.assertRaises(OfflineBundlePreparationError) as raised:
            prepare_offline_bundle_manifest_v2(
                _request(), snapshot=_snapshot(), renderer=_renderer(), now_epoch=NOW_EPOCH,
            )
        self.assertEqual(raised.exception.code, "offline_artifacts_not_ready")
        self.assertEqual(raised.exception.http_status, 503)

    def test_trail_coverage_uses_geometry_and_rejects_anchor_only_records(self):
        snapshot = OfflineCatalogSnapshotV2(
            revision="c" * 64,
            generated_at=_snapshot().generated_at,
            items=(
                _snapshot().items[0],
                OfflineCatalogItemV2(
                    item_id="trail:crosses-box",
                    kind="trail",
                    lat=37.0,
                    lng=-111.0,
                    source_label="USFS",
                    license_id="US-FEDERAL-PUBLIC-DATA",
                    attribution="U.S. Forest Service",
                    spatial_bounds=(-109.7, 38.5, -109.5, 38.7),
                ),
                OfflineCatalogItemV2(
                    item_id="trail:anchor-only",
                    kind="trail",
                    lat=38.6,
                    lng=-109.6,
                    source_label="USFS",
                    license_id="US-FEDERAL-PUBLIC-DATA",
                    attribution="U.S. Forest Service",
                ),
            ),
        )
        manifest = _prepare(self.root, snapshot=snapshot, trail_count=1)
        trails = next(item for item in manifest.artifacts if item.kind == "trails")
        self.assertEqual(trails.record_count, 1)

    def test_stale_catalog_cannot_issue_a_manifest(self):
        stale = OfflineCatalogSnapshotV2(
            revision="d" * 64,
            generated_at=NOW_EPOCH - 2_592_001,
            items=_snapshot().items,
        )
        with self.assertRaises(OfflineBundlePreparationError) as raised:
            _prepare(self.root, snapshot=stale)
        self.assertEqual(raised.exception.code, "offline_catalog_stale")

    def test_request_rejects_invalid_bounds_and_zoom(self):
        body = _request().model_dump(mode="json")
        body["bounds"] = {"west": -109.4, "south": 38.4, "east": -109.8, "north": 38.8}
        with self.assertRaises(ValidationError):
            OfflineBundlePrepareRequestV2.model_validate(body)
        body = _request().model_dump(mode="json")
        body["min_zoom"] = 15
        body["max_zoom"] = 8
        with self.assertRaises(ValidationError):
            OfflineBundlePrepareRequestV2.model_validate(body)


class OfflineBundleV2MaterializerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def _snapshot(self) -> OfflineCatalogSnapshotV2:
        camp_record = {
            "id": "place:nps:complete-camp",
            "name": "Complete Camp",
            "category": "camp",
            "kind": "campground",
            "lat": 38.58,
            "lng": -109.55,
            "summary": "A durable official campground summary.",
            "site_types": ["Tent", "RV"],
            "camp_types": ["Cabin", "Group"],
            "site_type": "Walk-in",
            "camp_type": "RV",
            "amenities": ["Vault toilets", "Picnic tables"],
            "campsite_count": 24,
            "campsites_count": 24,
            "max_rig_length": "35 ft",
            "max_vehicle_length": "40 ft",
            "max_trailer_length": "30 ft",
            "max_rv_length": "38 ft",
            "rig_suitability": "Check individual sites",
            "vehicle_suitability": "Passenger vehicles and RVs",
            "rig_types": ["Travel trailer", "Motorhome"],
            "vehicle_types": ["Car", "Truck"],
            "official_url": "https://www.nps.gov/example",
            "booking_url": "https://www.recreation.gov/example",
            "reservation_url": "https://www.recreation.gov/example",
            "reservable": True,
            "reservations": {
                "reservation_url": "https://www.recreation.gov/example",
                "reservable": True,
                "required": False,
                "availability": "3 sites left",
            },
            "campsites": [{
                "id": "site-12", "name": "12", "type": "RV", "loop": "A",
                "max_people": "8", "equipment_length": "30 ft", "surface": "Gravel",
                "accessible": True, "hookups": False, "availability": "available",
            }],
            "weather": {"temperature": 82},
            "fire": {"status": "clear"},
            "reports": [{"body": "private current report"}],
            "closures": [],
            "current_availability": "available",
            "reservation_inventory": {"remaining": 3},
        }
        document = _compact_public_document(
            camp_record,
            item_id=camp_record["id"],
            kind="place",
            lat=camp_record["lat"],
            lng=camp_record["lng"],
            source_label="NPS",
            attribution="National Park Service",
        )
        return OfflineCatalogSnapshotV2(
            revision="f" * 64,
            generated_at=NOW_EPOCH,
            items=(
                OfflineCatalogItemV2(
                    item_id=camp_record["id"],
                    kind="place",
                    lat=camp_record["lat"],
                    lng=camp_record["lng"],
                    source_label="NPS",
                    license_id="US-FEDERAL-PUBLIC-DATA",
                    attribution="National Park Service",
                    licensed_thumbnail=True,
                    title=camp_record["name"],
                    subtitle=camp_record["summary"],
                    category="camp",
                    aliases=("camp", "campground", "rv"),
                    document=document,
                    thumbnail_url="https://images.example.test/complete-camp.jpg",
                    thumbnail_license_id="CC-BY-4.0",
                    thumbnail_attribution="Example photographer",
                ),
                OfflineCatalogItemV2(
                    item_id="trail:usfs:complete-trail",
                    kind="trail",
                    lat=38.62,
                    lng=-109.61,
                    source_label="USFS",
                    license_id="US-FEDERAL-PUBLIC-DATA",
                    attribution="U.S. Forest Service",
                    spatial_bounds=(-109.72, 38.51, -109.42, 38.72),
                    title="Complete Trail",
                    subtitle="4.2 miles. Moderate.",
                    category="trail",
                    aliases=("hiking", "moderate"),
                    document={
                        "id": "trail:usfs:complete-trail", "name": "Complete Trail",
                        "distance_mi": 4.2, "difficulty": "Moderate",
                    },
                    geometry={
                        "type": "LineString",
                        "coordinates": [[-109.72, 38.51], [-109.42, 38.72]],
                    },
                ),
            ),
        )

    @staticmethod
    def _thumbnail(_url: str) -> tuple[bytes, str]:
        image = Image.new("RGB", (40, 30), (174, 90, 51))
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue(), "image/png"

    def test_materializer_builds_exact_content_and_omits_unconsumed_media(self):
        with patch.dict(os.environ, {
            "TRAILHEAD_OFFLINE_ARTIFACT_ROOT": str(self.root),
            "TRAILHEAD_OFFLINE_ARTIFACT_STORE": "local",
        }):
            result = materialize_offline_bundle_v2(
                "offprep_materializer_test_001",
                _request(),
                snapshot=self._snapshot(),
                renderer=_renderer(),
                renderer_probe=lambda _request, _renderer: None,
                thumbnail_fetcher=self._thumbnail,
                include_database=False,
            )

        by_kind = {artifact.kind: artifact for artifact in result.manifest.artifacts}
        stored = {artifact.kind: artifact for artifact in result.artifacts}
        self.assertEqual(by_kind["places"].record_count, 1)
        self.assertEqual(by_kind["trails"].record_count, 1)
        self.assertEqual(by_kind["search_index"].record_count, 2)
        self.assertNotIn("thumbnail", by_kind)
        self.assertNotIn("media", by_kind)
        self.assertNotIn("thumbnail", stored)
        self.assertNotIn("media", stored)
        self.assertFalse(result.manifest.capabilities.media)
        self.assertEqual(by_kind["map_style"].storage, "renderer_style_pack")
        self.assertEqual(by_kind["map_tiles"].storage, "renderer_tile_region")
        self.assertEqual(
            by_kind["map_tiles"].record_count,
            _tile_count(_request().bounds, _request().min_zoom, _request().max_zoom),
        )
        self.assertNotIn("CC-BY-4.0", result.manifest.license_ids)
        self.assertNotIn("Example photographer", result.manifest.source_attribution)

        for artifact in result.artifacts:
            path = Path(artifact.storage_path)
            self.assertTrue(path.is_file())
            raw = path.read_bytes()
            self.assertEqual(len(raw), artifact.byte_count)
            self.assertEqual(hashlib.sha256(raw).hexdigest(), artifact.sha256)

        place_payload = json.loads(Path(stored["places"].storage_path).read_text())
        camp = place_payload["places"][0]
        self.assertEqual(
            camp["site_types"], ["Tent", "RV", "Cabin", "Group", "Walk-in"],
        )
        self.assertEqual(camp["camp_types"], ["Cabin", "Group"])
        self.assertEqual(camp["site_type"], "Walk-in")
        self.assertEqual(camp["camp_type"], "RV")
        self.assertEqual(camp["campsite_count"], 24)
        self.assertEqual(camp["campsites_count"], 24)
        self.assertEqual(camp["max_rig_length"], "35 ft")
        self.assertEqual(camp["max_vehicle_length"], "40 ft")
        self.assertEqual(camp["max_trailer_length"], "30 ft")
        self.assertEqual(camp["max_rv_length"], "38 ft")
        self.assertEqual(camp["rig_suitability"], "Check individual sites")
        self.assertEqual(camp["vehicle_suitability"], "Passenger vehicles and RVs")
        self.assertEqual(camp["rig_types"], ["Travel trailer", "Motorhome"])
        self.assertEqual(camp["vehicle_types"], ["Car", "Truck"])
        self.assertEqual(camp["amenities"], ["Vault toilets", "Picnic tables"])
        self.assertEqual(camp["campsites"][0]["equipment_length"], "30 ft")
        self.assertNotIn("availability", camp["campsites"][0])
        self.assertEqual(camp["official_url"], "https://www.nps.gov/example")
        self.assertEqual(camp["booking_url"], "https://www.recreation.gov/example")
        self.assertEqual(camp["reservations"]["reservable"], True)
        self.assertNotIn("availability", camp["reservations"])
        for volatile in (
            "weather", "fire", "reports", "closures", "current_availability",
            "reservation_inventory",
        ):
            self.assertNotIn(volatile, camp)
        self.assertEqual(
            set(place_payload["live_only"]),
            {
                "weather", "fire", "reports", "closures", "reservations",
                "availability", "current_conditions",
            },
        )

        trails = json.loads(Path(stored["trails"].storage_path).read_text())
        self.assertEqual(trails["count"], 1)
        self.assertEqual(trails["features"][0]["geometry"]["type"], "LineString")

        search = sqlite3.connect(stored["search_index"].storage_path)
        try:
            self.assertEqual(search.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(
                search.execute("SELECT COUNT(*) FROM offline_search_documents").fetchone()[0], 2,
            )
            self.assertEqual(
                search.execute(
                    """SELECT d.title FROM offline_search_fts f
                       JOIN offline_search_documents d ON d.rowid=f.rowid
                       WHERE offline_search_fts MATCH 'campground'"""
                ).fetchone()[0],
                "Complete Camp",
            )
            self.assertEqual(
                search.execute("SELECT COUNT(*) FROM offline_search_spatial").fetchone()[0], 2,
            )
        finally:
            search.close()

    def test_rnmapbox_materialization_fails_explicitly_without_provisioning(self):
        with patch.dict(os.environ, {
            "TRAILHEAD_OFFLINE_ARTIFACT_ROOT": str(self.root),
            "TRAILHEAD_RNMAPBOX_PUBLIC_TOKEN": "",
            "MAPBOX_TOKEN": "",
        }, clear=False):
            with patch.object(settings, "mapbox_token", ""):
                with self.assertRaises(OfflineBundlePreparationError) as raised:
                    materialize_offline_bundle_v2(
                        "offprep_materializer_test_002",
                        _request(),
                        snapshot=self._snapshot(),
                        renderer=_renderer(),
                        thumbnail_fetcher=self._thumbnail,
                        include_database=False,
                    )
        self.assertEqual(raised.exception.code, "rnmapbox_token_missing")

    def test_utah_place_packs_preserve_camp_and_service_detail_with_revision_binding(self):
        pack_root = self.root / "place-packs"
        pack_root.mkdir()
        camp_path = pack_root / "ut-camps.json"
        service_path = pack_root / "ut-services.json"
        camp_payload = {
            "schema_version": 1,
            "pack_id": "ut-camps",
            "region_id": "ut",
            "region_name": "Utah",
            "generated_at": NOW_EPOCH,
            "points": [{
                "id": "osm_camp_node_100",
                "name": "Juniper Camp",
                "lat": 38.61,
                "lng": -109.57,
                "type": "camp",
                "category": "camp",
                "source": "osm",
                "subtype": "Primitive campground",
                "address": "County Road 12",
                "official_url": "https://example.gov/juniper",
                "booking_url": "",
                "photo_url": "https://unlicensed.example.test/camp.jpg",
                "reservable": False,
                "tags": ["primitive", "tent"],
                "amenities": ["Vault toilets"],
                "site_types": ["Tent", "Primitive"],
                "camp_types": ["Developed"],
                "activities": ["Hiking", "Stargazing"],
                "campsite_count": 18,
                "campsites_count": 18,
                "campsites": [{
                    "id": "site-a1", "name": "A1", "type": "Tent",
                    "loop": "Juniper", "max_people": "8",
                    "equipment_length": "28 ft", "surface": "Gravel",
                    "accessible": True, "availability": "available",
                }],
                "max_rig_length": "35 ft",
                "max_vehicle_length": "40 ft",
                "max_trailer_length": "30 ft",
                "max_rv_length": "38 ft",
                "rig_suitability": "Check individual sites",
                "vehicle_suitability": "Passenger vehicles and RVs",
                "rig_types": ["Travel trailer"],
                "vehicle_types": ["Car", "Truck"],
                "cost": "$20",
                "ada": True,
                "access_notes": "Two miles of maintained gravel.",
                "bail_out_notes": "Return to County Road 12.",
                "stay_limit": "14 nights",
                "reservation_notes": "Some sites are first come, first served.",
                "source_badge": "OpenStreetMap",
                "source_freshness": "Packaged for offline use; verify current conditions.",
                "last_checked": NOW_EPOCH,
                "weather": {"temperature": 80},
                "current_availability": "available",
            }, {
                "id": "private_camp_1",
                "name": "Unknown Provider Camp",
                "lat": 38.62,
                "lng": -109.58,
                "type": "camp",
                "category": "camp",
                "source": "unlicensed-provider",
                "site_types": ["RV"],
            }],
        }
        service_payload = {
            "schema_version": 1,
            "pack_id": "ut-services",
            "region_id": "ut",
            "region_name": "Utah",
            "generated_at": NOW_EPOCH,
            "points": [{
                # The same stable source/id enriches the camp rather than
                # creating a duplicate search result.
                "id": "osm_camp_node_100",
                "name": "Juniper Camp",
                "lat": 38.61,
                "lng": -109.57,
                "type": "camp",
                "category": "camp",
                "source": "osm",
                "amenities": ["Picnic tables"],
                "site_types": ["RV"],
            }, {
                "id": "osm_fuel_node_200",
                "name": "Desert Fuel",
                "lat": 38.63,
                "lng": -109.59,
                "type": "fuel",
                "category": "fuel",
                "source": "osm",
                "subtype": "Fuel station",
                "address": "100 Main Street",
                "fuel_types": "diesel;gasoline",
                "tags": ["diesel", "fuel"],
            }],
        }
        camp_path.write_text(json.dumps(camp_payload), encoding="utf-8")
        service_path.write_text(json.dumps(service_payload), encoding="utf-8")
        canonical = OfflineCatalogSnapshotV2(
            revision="a" * 64,
            generated_at=NOW_EPOCH,
            items=(OfflineCatalogItemV2(
                item_id="osm_camp_node_100",
                kind="place",
                lat=38.61,
                lng=-109.57,
                source_label="osm",
                license_id="ODbL-1.0",
                attribution="OpenStreetMap contributors",
                title="Juniper Camp",
                category="camp",
                document={
                    "id": "osm_camp_node_100",
                    "kind": "place",
                    "name": "Juniper Camp",
                    "lat": 38.61,
                    "lng": -109.57,
                    "description": "Canonical description retained during enrichment.",
                },
            ),),
        )

        def build(preparation_id: str):
            return materialize_offline_bundle_v2(
                preparation_id,
                _request(),
                snapshot=canonical,
                renderer=_renderer(),
                renderer_probe=lambda _request, _renderer: None,
                include_database=False,
                include_place_packs=True,
                place_pack_root=pack_root,
            )

        with patch.dict(os.environ, {
            "TRAILHEAD_OFFLINE_ARTIFACT_ROOT": str(self.root),
            "TRAILHEAD_OFFLINE_ARTIFACT_STORE": "local",
        }):
            first = build("offprep_ut_place_pack_001")
            stored = {artifact.kind: artifact for artifact in first.artifacts}
            payload = json.loads(Path(stored["places"].storage_path).read_text())
            self.assertEqual(payload["count"], 2)
            self.assertEqual(payload["source_counts"], {"osm": 2})
            self.assertEqual(payload["category_counts"], {"camp": 1, "fuel": 1})
            by_id = {place["id"]: place for place in payload["places"]}
            camp = by_id["osm_camp_node_100"]
            self.assertEqual(
                camp["site_types"],
                ["Tent", "Primitive", "RV", "Developed"],
            )
            self.assertEqual(camp["amenities"], ["Vault toilets", "Picnic tables"])
            self.assertEqual(camp["camp_types"], ["Developed"])
            self.assertEqual(camp["activities"], ["Hiking", "Stargazing"])
            self.assertEqual(camp["campsite_count"], 18)
            self.assertEqual(camp["campsites_count"], 18)
            self.assertEqual(camp["campsites"][0]["id"], "site-a1")
            self.assertNotIn("availability", camp["campsites"][0])
            self.assertEqual(camp["max_rig_length"], "35 ft")
            self.assertEqual(camp["max_vehicle_length"], "40 ft")
            self.assertEqual(camp["max_trailer_length"], "30 ft")
            self.assertEqual(camp["max_rv_length"], "38 ft")
            self.assertEqual(camp["rig_suitability"], "Check individual sites")
            self.assertEqual(camp["vehicle_suitability"], "Passenger vehicles and RVs")
            self.assertEqual(camp["rig_types"], ["Travel trailer"])
            self.assertEqual(camp["vehicle_types"], ["Car", "Truck"])
            self.assertEqual(camp["cost"], "$20")
            self.assertTrue(camp["ada"])
            self.assertEqual(camp["access_notes"], "Two miles of maintained gravel.")
            self.assertEqual(camp["bail_out_notes"], "Return to County Road 12.")
            self.assertEqual(camp["stay_limit"], "14 nights")
            self.assertEqual(
                camp["reservation_notes"],
                "Some sites are first come, first served.",
            )
            self.assertEqual(camp["subtype"], "Primitive campground")
            self.assertEqual(
                camp["description"],
                "Canonical description retained during enrichment.",
            )
            self.assertEqual(camp["source_badge"], "OpenStreetMap")
            self.assertEqual(camp["last_checked"], NOW_EPOCH)
            self.assertNotIn("photo_url", camp)
            self.assertNotIn("weather", camp)
            self.assertNotIn("current_availability", camp)
            self.assertEqual(len(camp["sources"]), 2)
            expected_revisions = {
                hashlib.sha256(camp_path.read_bytes()).hexdigest(),
                hashlib.sha256(service_path.read_bytes()).hexdigest(),
            }
            self.assertEqual(
                {source["revision"] for source in camp["sources"]},
                expected_revisions,
            )
            self.assertEqual(
                by_id["osm_fuel_node_200"]["fuel_types"],
                "diesel;gasoline",
            )
            self.assertNotIn("private_camp_1", by_id)

            first_revision = first.manifest.revision
            camp_payload["points"][0]["site_types"].append("Walk-in")
            camp_path.write_text(json.dumps(camp_payload), encoding="utf-8")
            second = build("offprep_ut_place_pack_002")
            self.assertNotEqual(first_revision, second.manifest.revision)

    def test_all_v1_pack_families_preserve_ut_ca_tx_water_and_outdoor_counts(self):
        pack_root = self.root / "family-packs"
        pack_root.mkdir()
        fixtures = {
            "ut": (-109.6, 38.6, 3, 2),
            "ca": (-122.4, 37.4, 4, 3),
            "tx": (-100.4, 30.4, 5, 4),
        }
        for region, (lng, lat, water_count, outdoor_count) in fixtures.items():
            family_counts = {
                "camps": 1,
                "essentials": 1,
                "services": 1,
                "outdoors": outdoor_count,
                "water": water_count,
                "trek_places": 1,
            }
            for family, count in family_counts.items():
                points = []
                for index in range(count):
                    category = (
                        "water" if family == "water"
                        else "viewpoint" if family == "outdoors"
                        else "camp" if family == "camps"
                        else "trailhead" if family == "trek_places"
                        else "fuel"
                    )
                    points.append({
                        "id": f"osm_{region}_{family}_{index}",
                        "name": f"{region.upper()} {family} {index}",
                        "lat": lat + index * 0.001,
                        "lng": lng + index * 0.001,
                        "type": category,
                        "category": category,
                        "source": "osm",
                    })
                (pack_root / f"{region}-{family}.json").write_text(json.dumps({
                    "schema_version": 1,
                    "pack_id": f"{region}-{family}",
                    "region_id": region,
                    "region_name": region.upper(),
                    "generated_at": NOW_EPOCH,
                    "points": points,
                }), encoding="utf-8")

        self.assertEqual(
            set(OFFLINE_PLACE_PACK_FAMILIES_V2),
            {"camps", "essentials", "services", "outdoors", "water", "trek_places"},
        )
        for region, (lng, lat, water_count, outdoor_count) in fixtures.items():
            items = load_offline_place_pack_items_v2(
                OfflineBoundsV2.model_validate({
                    "west": lng - 0.1,
                    "south": lat - 0.1,
                    "east": lng + 0.1,
                    "north": lat + 0.1,
                }),
                root=pack_root,
            )
            pack_counts: dict[str, int] = {}
            for item in items:
                for source in (item.document or {}).get("sources", []):
                    pack_id = str(source.get("pack_id") or "")
                    pack_counts[pack_id] = pack_counts.get(pack_id, 0) + 1
            self.assertEqual(pack_counts[f"{region}-water"], water_count)
            self.assertEqual(pack_counts[f"{region}-outdoors"], outdoor_count)
            for family in OFFLINE_PLACE_PACK_FAMILIES_V2:
                self.assertIn(f"{region}-{family}", pack_counts)

    def test_pakistan_curated_pack_fails_explicitly_without_redistribution_rights(self):
        pack_root = self.root / "pakistan-packs"
        pack_root.mkdir()
        (pack_root / "pk-camps.json").write_text(json.dumps({
            "schema_version": 1,
            "pack_id": "pk-camps",
            "region_id": "pk",
            "region_name": "Pakistan",
            "generated_at": NOW_EPOCH,
            "points": [{
                "id": "pakistan_curated_camp_1",
                "name": "Curated mountain camp",
                "lat": 35.7,
                "lng": 76.2,
                "type": "camp",
                "category": "camp",
                "source": "pakistan_karakoram_curated",
            }, {
                "id": "osm_camp_1",
                "name": "Licensed OSM camp",
                "lat": 35.71,
                "lng": 76.21,
                "type": "camp",
                "category": "camp",
                "source": "osm",
            }],
        }), encoding="utf-8")
        with self.assertRaises(OfflineBundlePreparationError) as raised:
            load_offline_place_pack_items_v2(
                OfflineBoundsV2(
                    west=75.8, south=35.4, east=76.6, north=36.0,
                ),
                root=pack_root,
            )
        self.assertEqual(
            raised.exception.code,
            "offline_place_inventory_rights_unverified",
        )
        self.assertEqual(raised.exception.http_status, 503)


class OfflineBundleV2ApiTests(unittest.TestCase):
    def setUp(self):
        self.original_db_path = settings.db_path
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        settings.db_path = str(self.root / "offline-v2-api.db")
        store.init_db()
        user_id = store.create_user(
            "offline-v2@example.com",
            "offline_v2",
            server._hash_pw("offline-v2-password"),
            "OFFLINE-V2",
        )
        self.client = TestClient(server.app)
        self.user = store.get_user_by_id(user_id)
        self.user["credits"] = 20
        self.user["plan_type"] = "free"
        self.user["is_admin"] = 0
        self.manifest = _prepare(self.root)
        server.app.dependency_overrides[server._current_user] = lambda: self.user

    def tearDown(self):
        server.app.dependency_overrides.pop(server._current_user, None)
        server.app.dependency_overrides.pop(server._optional_user, None)
        settings.db_path = self.original_db_path
        self.temp.cleanup()

    def test_flag_disabled_returns_not_found_without_authorizing(self):
        with (
            patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "0"}),
            patch.object(server, "prepare_offline_bundle_manifest_v2") as prepare,
            patch.object(server, "authorize_offline_download") as authorize,
        ):
            response = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "feature_unavailable")
        prepare.assert_not_called()
        authorize.assert_not_called()

    def test_active_style_server_revision_partitions_preparation_cache(self):
        request = _request(
            renderer_style_id="satellite_streets",
        ).model_dump(mode="json", exclude_none=True)
        binding = {
            "renderer": "rnmapbox",
            "style_id": "satellite_streets",
            "style_uri": "mapbox://styles/mapbox/satellite-streets-v12",
            "style_revision": "satellite-v12-a",
        }
        first, first_created = store.create_or_get_offline_bundle_preparation_v2(
            self.user["id"], request, cache_binding=binding,
        )
        same, same_created = store.create_or_get_offline_bundle_preparation_v2(
            self.user["id"], request, cache_binding=binding,
        )
        changed, changed_created = store.create_or_get_offline_bundle_preparation_v2(
            self.user["id"],
            request,
            cache_binding={**binding, "style_revision": "satellite-v12-b"},
        )

        self.assertTrue(first_created)
        self.assertFalse(same_created)
        self.assertEqual(first["id"], same["id"])
        self.assertTrue(changed_created)
        self.assertNotEqual(first["id"], changed["id"])

    def test_database_catalog_includes_first_party_explore_and_excludes_unlicensed_sources(self):
        seeded = {}
        for source, source_id, name, offset in (
            ("trailhead_explore", "moab-first-party", "Moab first-party place", 0.00),
            ("nominatim", "moab-nominatim", "Nominatim-only place", 0.01),
            ("unknown_provider", "moab-unknown", "Unknown-provider place", 0.02),
        ):
            place = store.upsert_canonical_place({
                "source": source,
                "source_place_id": source_id,
                "source_label": source,
                "name": name,
                "lat": 38.58 + offset,
                "lng": -109.55 + offset,
                "category": "place",
            })
            seeded[source] = place["trailhead_place_id"]

        items = _database_catalog_items_v2(_request().bounds)
        by_id = {item.item_id: item for item in items}

        self.assertIn(seeded["trailhead_explore"], by_id)
        self.assertEqual(
            by_id[seeded["trailhead_explore"]].license_id,
            "TRAILHEAD-FIRST-PARTY",
        )
        self.assertEqual(by_id[seeded["trailhead_explore"]].attribution, "Trailhead")
        self.assertNotIn(seeded["nominatim"], by_id)
        self.assertNotIn(seeded["unknown_provider"], by_id)

    def test_recovery_leases_only_authorized_stale_owner_work_once(self):
        request = _request().model_dump(mode="json", exclude_none=True)
        preparation, _ = store.create_or_get_offline_bundle_preparation_v2(
            self.user["id"], request,
        )
        store.authorize_offline_download(
            self.user,
            "trailhead_offline_bundle_v2",
            preparation["id"],
            0,
            "Test durable Offline V2 authorization",
        )
        self.assertTrue(store.claim_offline_bundle_preparation_v2(
            preparation["id"], self.user["id"],
        ))
        stale_at = int(time.time()) - 1000
        db = store._conn()
        db.execute(
            "UPDATE offline_bundle_preparations_v2 SET updated_at=? WHERE id=?",
            (stale_at, preparation["id"]),
        )
        db.commit(); db.close()

        wrong_owner = store.claim_recoverable_offline_bundle_preparations_v2(
            int(time.time()) - 60,
            preparation_id=preparation["id"],
            user_id=self.user["id"] + 999,
        )
        still_running = store.get_offline_bundle_preparation_v2(
            preparation["id"], self.user["id"],
        )
        recovered = store.claim_recoverable_offline_bundle_preparations_v2(
            int(time.time()) - 60,
            preparation_id=preparation["id"],
            user_id=self.user["id"],
        )
        duplicate = store.claim_recoverable_offline_bundle_preparations_v2(
            int(time.time()) - 60,
            preparation_id=preparation["id"],
            user_id=self.user["id"],
        )

        self.assertEqual(wrong_owner, [])
        self.assertEqual(still_running["status"], "running")
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0]["id"], preparation["id"])
        self.assertEqual(recovered[0]["request_payload"], request)
        self.assertEqual(duplicate, [])

        unauthorized, _ = store.create_or_get_offline_bundle_preparation_v2(
            self.user["id"], {**request, "max_zoom": 13},
        )
        self.assertEqual(store.claim_recoverable_offline_bundle_preparations_v2(
            int(time.time()),
            preparation_id=unauthorized["id"],
            user_id=self.user["id"],
        ), [])

    def test_status_poll_recovers_stale_job_without_duplicate_runner(self):
        request = _request().model_dump(mode="json", exclude_none=True)
        preparation, _ = store.create_or_get_offline_bundle_preparation_v2(
            self.user["id"], request,
        )
        store.authorize_offline_download(
            self.user,
            "trailhead_offline_bundle_v2",
            preparation["id"],
            0,
            "Test status recovery",
        )
        self.assertTrue(store.claim_offline_bundle_preparation_v2(
            preparation["id"], self.user["id"],
        ))
        db = store._conn()
        db.execute(
            "UPDATE offline_bundle_preparations_v2 SET updated_at=? WHERE id=?",
            (int(time.time()) - 1000, preparation["id"]),
        )
        db.commit(); db.close()

        with (
            patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "1"}),
            patch.object(server, "_run_offline_bundle_preparation_v2") as runner,
        ):
            first = self.client.get(
                f"/api/offline/bundles/preparations/{preparation['id']}",
            )
            second = self.client.get(
                f"/api/offline/bundles/preparations/{preparation['id']}",
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["status"], "running")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(runner.call_count, 1)
        runner.assert_called_once_with(
            preparation["id"], self.user["id"], request, True,
        )

    def test_prepare_endpoint_rejects_unapproved_style_before_authorization(self):
        with (
            patch.dict(os.environ, {
                "OFFLINE_BUNDLE_V2_ENABLED": "1",
                "TRAILHEAD_OFFLINE_RENDERER": "rnmapbox",
                "TRAILHEAD_OFFLINE_RNMAPBOX_STYLE_ALLOWLIST": "",
            }),
            patch.object(server, "authorize_offline_download") as authorize,
        ):
            response = self.client.post(
                "/api/offline/bundles/prepare",
                json={
                    **_request().model_dump(mode="json", exclude_none=True),
                    "renderer_style_id": "not_approved",
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "offline_style_not_allowed")
        authorize.assert_not_called()

    def test_trail_scope_uses_server_route_bounds_and_outdoors_style(self):
        system = _trail_system()
        request = OfflineBundlePrepareRequestV2.model_validate({
            **_request().model_dump(mode="json"),
            "scope": {
                "kind": "trail",
                "trail_id": system.id,
                "geometry_revision": system.geometry_revision,
                "corridor_m": 1200,
            },
        })
        with patch.object(
            server,
            "_trail_system_for_detail_v2",
            new=AsyncMock(return_value=system),
        ):
            resolved, resolved_system = asyncio.run(
                server._resolve_offline_trail_scope_v2(request),
            )

        self.assertEqual(resolved.renderer_style_id, "outdoors")
        self.assertEqual(resolved_system.id, system.id)
        self.assertLess(resolved.bounds.west, system.bounds.west)
        self.assertGreater(resolved.bounds.east, system.bounds.east)
        self.assertNotEqual(resolved.bounds, request.bounds)

    def test_trail_scope_rejects_stale_revision_before_authorization(self):
        system = _trail_system()
        body = {
            **_request().model_dump(mode="json", exclude_none=True),
            "scope": {
                "kind": "trail",
                "trail_id": system.id,
                "geometry_revision": "stale-revision",
                "corridor_m": 1200,
            },
        }
        with (
            patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "1"}),
            patch.object(
                server,
                "_trail_system_for_detail_v2",
                new=AsyncMock(return_value=system),
            ),
            patch.object(server, "authorize_offline_download") as authorize,
        ):
            response = self.client.post("/api/offline/bundles/prepare", json=body)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"]["code"],
            "offline_trail_revision_changed",
        )
        authorize.assert_not_called()

    def test_enabled_endpoint_preserves_free_entitlement_and_returns_no_user_data(self):
        with (
            patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "1"}),
            patch.object(server, "prepare_offline_bundle_manifest_v2", return_value=self.manifest),
            patch.object(
                server,
                "authorize_offline_download",
                return_value={"authorized": True, "charged": 0, "credits": 20},
            ) as authorize,
        ):
            response = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["schema_version"], 2)
        self.assertEqual(payload["bundle_id"], self.manifest.bundle_id)
        self.assertNotIn("user", payload)
        self.assertNotIn("user_id", payload)
        self.assertNotIn("credits", payload)
        self.assertNotIn("authorization", payload)
        authorize.assert_called_once_with(
            self.user,
            "trailhead_offline_bundle_v2",
            ANY,
            0,
            "Prepare Trailhead offline bundle V2",
        )

    def test_enabled_endpoint_fails_closed_when_files_are_not_materialized(self):
        with (
            patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "1"}),
            patch.object(
                server,
                "prepare_offline_bundle_manifest_v2",
                side_effect=OfflineBundlePreparationError(
                    "offline_artifacts_not_ready",
                    "Complete offline bundle files are not available yet. No download was prepared.",
                    http_status=503,
                ),
            ),
            patch.object(server, "authorize_offline_download") as authorize,
        ):
            response = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["status"], "queued")
        authorize.assert_called_once()

    def test_admin_can_preview_when_public_flag_is_disabled(self):
        self.user["is_admin"] = 1
        with (
            patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "0"}),
            patch.object(server, "prepare_offline_bundle_manifest_v2", return_value=self.manifest),
            patch.object(
                server, "authorize_offline_download", return_value={"authorized": True},
            ),
        ):
            response = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )

        self.assertEqual(response.status_code, 200)

    def test_entitlement_denial_does_not_disclose_account_balance(self):
        with (
            patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "1"}),
            patch.object(server, "prepare_offline_bundle_manifest_v2", return_value=self.manifest),
            patch.object(
                server,
                "authorize_offline_download",
                return_value={"authorized": False, "credits": 20, "credits_needed": 500},
            ) as authorize,
        ):
            response = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )
            retried = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(retried.status_code, 403)
        self.assertEqual(authorize.call_count, 2)
        serialized = (response.text + retried.text).lower()
        self.assertNotIn("credits", serialized)
        self.assertNotIn("500", serialized)

    def test_extra_location_or_server_owned_fields_are_rejected(self):
        body = _request().model_dump(mode="json")
        body["current_coordinates"] = {"lat": 38.5, "lng": -109.5}
        with patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "1"}):
            response = self.client.post("/api/offline/bundles/prepare", json=body)

        self.assertEqual(response.status_code, 422)

    def test_v1_authorization_endpoint_remains_available(self):
        response = self.client.post(
            "/api/offline/authorize",
            json={"asset_type": "state_map", "region_id": "ut", "label": "Utah"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["authorized"])
        self.assertEqual(response.json()["charged"], 0)

    def test_product_feature_contract_exposes_v2_gate(self):
        server.app.dependency_overrides[server._optional_user] = lambda: self.user
        with patch.dict(os.environ, {"OFFLINE_BUNDLE_V2_ENABLED": "1"}):
            response = self.client.get("/api/product/features")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["offline_bundle_v2"])

    def test_preparation_materializes_then_serves_exact_ranges_and_rejects_stale_resume(self):
        fixture = OfflineBundleV2MaterializerTests()
        db = store._conn()
        db.execute(
            """INSERT INTO offline_downloads
               (user_id,asset_type,region_id,cost,free_used,created_at)
               VALUES (?,?,?,?,?,?)""",
            (self.user["id"], "state_map", "ut", 0, 0, NOW_EPOCH),
        )
        db.commit(); db.close()

        def materialize(preparation_id, request, **kwargs):
            return materialize_offline_bundle_v2(
                preparation_id,
                request,
                snapshot=fixture._snapshot(),
                renderer=_renderer(),
                renderer_probe=lambda _request, _renderer: None,
                thumbnail_fetcher=fixture._thumbnail,
                include_database=False,
                progress_callback=kwargs.get("progress_callback"),
            )

        with (
            patch.dict(os.environ, {
                "OFFLINE_BUNDLE_V2_ENABLED": "1",
                "TRAILHEAD_OFFLINE_ARTIFACT_ROOT": str(self.root),
                "TRAILHEAD_OFFLINE_ARTIFACT_STORE": "local",
            }),
            patch.object(
                server,
                "prepare_offline_bundle_manifest_v2",
                side_effect=OfflineBundlePreparationError(
                    "offline_artifacts_not_ready",
                    "Complete offline bundle files are not available yet. No download was prepared.",
                    http_status=503,
                ),
            ),
            patch.object(server, "materialize_offline_bundle_v2", side_effect=materialize),
            patch.object(
                server, "authorize_offline_download",
                return_value={"authorized": True, "charged": 0},
            ),
        ):
            queued = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )
            self.assertEqual(queued.status_code, 202)
            preparation_id = queued.json()["id"]
            status = self.client.get(
                f"/api/offline/bundles/preparations/{preparation_id}",
            )
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()["status"], "ready")
            manifest = status.json()["manifest"]
            places = next(
                artifact for artifact in manifest["artifacts"] if artifact["kind"] == "places"
            )
            full = self.client.get(places["uri"])
            self.assertEqual(full.status_code, 200)
            self.assertEqual(len(full.content), places["bytes"])
            self.assertEqual(hashlib.sha256(full.content).hexdigest(), places["sha256"])
            etag = full.headers["etag"]

            partial = self.client.get(
                places["uri"], headers={"Range": "bytes=0-15", "If-Range": etag},
            )
            self.assertEqual(partial.status_code, 206)
            self.assertEqual(partial.content, full.content[:16])
            self.assertEqual(
                partial.headers["content-range"], f"bytes 0-15/{len(full.content)}",
            )

            stale_resume = self.client.get(
                places["uri"],
                headers={"Range": "bytes=16-31", "If-Range": '"stale-revision"'},
            )
            self.assertEqual(stale_resume.status_code, 200)
            self.assertEqual(stale_resume.content, full.content)

            unchanged = self.client.get(
                places["uri"], headers={"If-None-Match": etag},
            )
            self.assertEqual(unchanged.status_code, 304)

        db = store._conn()
        legacy = db.execute(
            """SELECT asset_type,region_id FROM offline_downloads
               WHERE user_id=?""",
            (self.user["id"],),
        ).fetchall()
        db.close()
        self.assertEqual(
            [(row["asset_type"], row["region_id"]) for row in legacy],
            [("state_map", "ut")],
        )


if __name__ == "__main__":
    unittest.main()
