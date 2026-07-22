from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

import dashboard.server as server
from dashboard.offline_bundles_v2 import (
    OfflineBundlePrepareRequestV2,
    OfflineBundlePreparationError,
    OfflineCatalogItemV2,
    OfflineCatalogSnapshotV2,
    OfflineMaterializedArtifactV2,
    OfflineRendererConfigV2,
    offline_manifest_sha256_v2,
    prepare_offline_bundle_manifest_v2,
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
) -> OfflineBundlePrepareRequestV2:
    return OfflineBundlePrepareRequestV2.model_validate({
        "bounds": {"west": -109.8, "south": 38.4, "east": -109.4, "north": 38.8},
        "min_zoom": 8,
        "max_zoom": 14,
        "options": options or {},
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
        self.assertEqual(by_kind["thumbnail"].record_count, 1)
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

    def test_catalog_or_option_edit_changes_revision_without_changing_bundle_identity(self):
        base = _prepare(self.root)
        catalog_edit = _prepare(self.root, snapshot=_snapshot("b" * 64))
        option_edit = _prepare(self.root, options={"routing": True})

        self.assertEqual(base.bundle_id, catalog_edit.bundle_id)
        self.assertEqual(base.bundle_id, option_edit.bundle_id)
        self.assertNotEqual(base.revision, catalog_edit.revision)
        self.assertNotEqual(base.revision, option_edit.revision)
        self.assertFalse(base.capabilities.routing)
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


class OfflineBundleV2ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.client = TestClient(server.app)
        self.user = {"id": 71, "credits": 20, "plan_type": "free", "is_admin": 0}
        self.manifest = _prepare(self.root)
        server.app.dependency_overrides[server._current_user] = lambda: self.user

    def tearDown(self):
        server.app.dependency_overrides.pop(server._current_user, None)
        server.app.dependency_overrides.pop(server._optional_user, None)
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
            self.manifest.bundle_id,
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

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "offline_artifacts_not_ready")
        authorize.assert_not_called()

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
            ),
        ):
            response = self.client.post(
                "/api/offline/bundles/prepare",
                json=_request().model_dump(mode="json"),
            )

        self.assertEqual(response.status_code, 403)
        serialized = response.text.lower()
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


if __name__ == "__main__":
    unittest.main()
