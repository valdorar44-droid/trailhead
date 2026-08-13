import asyncio
import copy
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import threading
import time
from pathlib import Path

import pytest

from dashboard import server
from db import store


ROOT = Path(__file__).resolve().parents[1]
M3_COMMIT = "00e8b76daffaebd492c68e2f3416646fb8f327d6"
M3_PACKET_PATH = "originals/smokies/smokies_complete_private_migration_packet_v1.json"
M3_PACKET_BYTES = 5_840_841
M3_PACKET_SHA256 = (
    "2c764008c2180db607ea51085c01b6fef0fd28fb436d5aace8970d3319a62c0c"
)
M3_TRANSCRIPT_MAP_SHA256 = (
    "76d9c82b1518e27889e40fd0e62a5d77c17d3e697ea25e3d8a05d1b7dc5233f3"
)


def _exact_product_contract() -> dict:
    return {
        "pack_scope": "one_premium_four_chapter_product",
        "chapter_ids": [
            chapter_id
            for chapter_id, _ in store.ORIGINAL_V3_RELEASE_TARGET_CHAPTER_VARIANTS
        ],
        "credit_type": "earned_credits",
        "permanent_credit_price": 900,
        "explorer_included": True,
        "standalone_chapter_products_approved": False,
        "standalone_foothills_public_product_approved": False,
        "standalone_roaring_fork_public_product_approved": False,
        "changing_scope_or_price_requires_separate_product_decision": True,
        "route_variant_count": 6,
        "public_catalog_product_count": 1,
        "standalone_product_ids": [],
    }


def _committed_candidate_manifest() -> dict:
    return json.loads((
        ROOT / "originals/smokies/smokies_complete_private_manifest_v3.json"
    ).read_text(encoding="utf-8"))


def _publication_ready_manifest_and_route_evidence() -> tuple[dict, dict]:
    manifest = _committed_candidate_manifest()
    reviewed_at = datetime.now(timezone.utc).replace(
        microsecond=0,
    ).isoformat().replace("+00:00", "Z")
    manifest["review"] = {
        "editorial_status": "approved",
        "field_drive_completed_at": reviewed_at,
        "source_review_completed_at": reviewed_at,
    }
    manifest["offline_map"]["estimated_bytes"] = 750_000_000
    roaring_fork = next(
        chapter for chapter in manifest["chapters"]
        if chapter["id"] == "roaring_fork"
    )
    assert roaring_fork["safety"]["disclaimers"][0] == (
        "This private draft does not replace current NPS information."
    )
    roaring_fork["safety"]["disclaimers"][0] = (
        "This tour does not replace current NPS information."
    )
    assert roaring_fork["access"]["accessibility_notes"] == (
        "Accessibility and stop conditions require a current NPS check; "
        "this draft makes no parking or access guarantee."
    )
    roaring_fork["access"]["accessibility_notes"] = (
        "Accessibility and stop conditions require a current NPS check; "
        "this tour makes no parking or access guarantee."
    )

    route_evidence = json.loads((
        ROOT / "originals/smokies/official_route_evidence_v1.json"
    ).read_text(encoding="utf-8"))
    # Exercise the real route-evidence schema and exact checked geometry while
    # modeling the narrowly reachable future state after its three blockers
    # have been independently closed.
    route_evidence["publication_status"] = "ready_for_publication"
    route_evidence["publication_blockers"] = []
    manifest["route_evidence"] = {
        "schema_version": 1,
        "evidence_id": "smokies-official-routes-2026-v1",
        "evidence_sha256": _sha(route_evidence),
        "product_id": route_evidence["product_id"],
        "route_spec_sha256": route_evidence["route_spec_sha256"],
        "source_snapshot_sha256": route_evidence["source_snapshot_sha256"],
    }
    return manifest, route_evidence


def _sealed_m3_transcript_map() -> dict[str, str]:
    payload = subprocess.check_output(
        ["git", "show", f"{M3_COMMIT}:{M3_PACKET_PATH}"], cwd=ROOT,
    )
    assert len(payload) == M3_PACKET_BYTES
    assert hashlib.sha256(payload).hexdigest() == M3_PACKET_SHA256
    packet = json.loads(payload)
    result = {
        row["asset_id"]: row["transcript_sha256"]
        for group in ("new", "existing_roaring_fork")
        for row in packet["assets"][group]
        if row.get("kind") == "narration"
    }
    assert len(result) == 85
    assert store._original_validation_hash(result) == M3_TRANSCRIPT_MAP_SHA256
    return result


def _publication_verified_assets(manifest: dict) -> dict[str, dict]:
    narration_bindings: dict[str, tuple[str, float]] = {}
    for story in manifest["stories"]:
        narration_bindings[story["audio_asset_id"]] = (
            story["transcript"], float(story["audio_duration_s"]),
        )
        for override in story.get("variant_overrides") or []:
            narration_bindings[override["audio_asset_id"]] = (
                override["transcript"], float(override["audio_duration_s"]),
            )
    sealed_transcripts = _sealed_m3_transcript_map()
    assert len(narration_bindings) == 85
    assert set(sealed_transcripts) == set(narration_bindings)
    profile = manifest["narration_profile"]
    commercial = profile["commercial_license"]
    attested_at = datetime.now(timezone.utc).replace(
        microsecond=0,
    ).isoformat().replace("+00:00", "Z")
    verified: dict[str, dict] = {}
    for asset in manifest["assets"]:
        row = {
            "kind": asset["kind"],
            "public_path": asset["path"],
            "mime_type": asset["mime_type"],
            "byte_count": int(asset["bytes"]),
            "sha256": asset["sha256"],
        }
        if asset["kind"] == "image":
            row["media_metadata_json"] = json.dumps({
                "width": 1920,
                "height": 1080,
            })
        else:
            transcript, duration_s = narration_bindings[asset["id"]]
            row["transcript_sha256"] = sealed_transcripts[asset["id"]]
            row["media_metadata_json"] = json.dumps({
                "format": "mp3",
                "sample_rate_hz": 44_100,
                "bitrate_kbps": 128,
                "channels": 1,
                "duration_s": duration_s,
            })
            row["generator_metadata_json"] = json.dumps({
                "provider": profile["provider"],
                "model_id": profile["model_snapshot"],
                "voice_id": profile["voice_id"],
                "output_format": "mp3_44100_128",
                "provider_native_master": True,
                "lossless_master_claimed": False,
                "transcoded": False,
                "zero_retention": False,
                "license_status": "attested",
                "license_attestation": {
                    "terms_id": commercial["terms_id"],
                    "terms_url": commercial["terms_url"],
                    "terms_version": commercial["terms_version"],
                    "reviewed_at": commercial["reviewed_at"],
                    "attested_by_admin_user_id": 1,
                    "attested_at": attested_at,
                },
            })
        verified[asset["id"]] = row
    return verified


def _catalog_row(*, public_metadata: dict | None = None, price: int = 900) -> dict:
    metadata = public_metadata or {
        "access_policy": {
            "schema_version": 1,
            "explorer_included": True,
            "permanent_credit_price": 900,
        },
        "product_contract": _exact_product_contract(),
    }
    return {
        "id": store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID,
        "content_kind": "original_drive",
        "slug": "great-smoky-mountains-ridges-rivers-living-memory",
        "draft_title": store.ORIGINAL_V3_RELEASE_TARGET_TITLE,
        "draft_summary": "One complete four-chapter Smokies product.",
        "draft_price_credits": price,
        "draft_coverage_region": "north_america",
        "draft_public_metadata": json.dumps(metadata),
        "draft_template_json": json.dumps({"schema_version": 2}),
        "status": "draft",
        "current_published_version": None,
    }


def _sha(value: object) -> str:
    return store._original_validation_hash(value)


@pytest.fixture()
def release_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store.settings, "db_path", str(tmp_path / "release.db"))
    store.init_db()
    admin = store.create_user(
        "release-admin@example.com", "release_admin", "hash", "release-admin-code",
    )
    other_admin = store.create_user(
        "other-admin@example.com", "other_admin", "hash", "other-admin-code",
    )
    db = store._conn()
    db.execute("UPDATE users SET is_admin=1 WHERE id IN (?,?)", (admin, other_admin))
    db.commit()
    db.close()
    return admin, other_admin


def _insert_pack(
    pack_id: str,
    admin: int,
    *,
    revision: int = 7,
    manifest: dict | None = None,
) -> None:
    now = int(time.time())
    title = (
        store.ORIGINAL_V3_RELEASE_TARGET_TITLE
        if pack_id == store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
        else f"Title {pack_id}"
    )
    public_metadata = {
        "access_policy": {
            "schema_version": 1,
            "explorer_included": True,
            "permanent_credit_price": 900,
        },
        "product_contract": _exact_product_contract(),
    }
    manifest = manifest or {"schema_version": 3, "title": title}
    db = store._conn()
    db.execute(
        """INSERT INTO authored_trip_packs
           (id,content_kind,slug,status,draft_title,draft_summary,
            draft_price_credits,draft_coverage_region,draft_public_metadata,
            draft_validation_metadata,draft_template_json,
            draft_original_manifest_json,draft_revision,current_published_version,
            created_by,updated_by,created_at,updated_at)
           VALUES (?, 'original_drive', ?, 'draft', ?, ?, 900, 'north_america',
                   ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)""",
        (
            pack_id,
            pack_id.replace("_", "-"),
            title,
            "One complete four-chapter test bundle.",
            json.dumps(public_metadata),
            json.dumps({check: True for check in store.ORIGINAL_VALIDATION_CHECKS}),
            json.dumps({"schema_version": 2, "trip_id": f"template_{pack_id}"}),
            json.dumps(manifest),
            revision,
            admin,
            admin,
            now,
            now,
        ),
    )
    report_id = f"report_{pack_id}"
    db.execute(
        """INSERT INTO authored_original_validation_reports
           (id,pack_id,draft_revision,manifest_sha256,assets_sha256,input_sha256,
            validator_source_sha256,manifest_json,suite_version,engine_version,
            status,passed,summary_json,scenarios_json,issues_json,started_by,
            started_at,completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'passed',1,'{}','[]','[]',?,?,?)""",
        (
            report_id,
            pack_id,
            revision,
            "1" * 64,
            "2" * 64,
            "3" * 64,
            "4" * 64,
            "{}",
            store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
            store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
            admin,
            now - 60,
            now - 30,
        ),
    )
    db.commit()
    db.close()


def _insert_published_standalone_chapter(
    pack_id: str,
    admin: int,
    *,
    chapter_id: str = "roaring_fork",
    listing_title: str = "Standalone Smokies chapter",
    include_manifest_markers: bool = True,
) -> None:
    manifest = (
        {
            "schema_version": 3,
            "title": listing_title,
            "product_id": store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID,
            "chapter_id": chapter_id,
            "chapters": [{
                "id": chapter_id,
                "variants": [{"id": "one_way"}],
            }],
        }
        if include_manifest_markers
        else {"schema_version": 1, "title": listing_title}
    )
    _insert_pack(pack_id, admin, manifest=manifest)
    now = int(time.time())
    db = store._conn()
    db.execute(
        """INSERT INTO authored_trip_pack_versions
           (pack_id,version,content_kind,slug,title,summary,price_credits,
            coverage_region,public_metadata,validation_metadata,template_json,
            original_manifest_json,published_by,published_at)
           VALUES (?,1,'original_drive',?,?,?,?,?,'{}','{}','{}',?,?,?)""",
        (
            pack_id,
            pack_id.replace("_", "-"),
            listing_title,
            "This listing must block the complete product release.",
            250,
            "north_america",
            json.dumps(manifest),
            admin,
            now,
        ),
    )
    db.execute(
        """UPDATE authored_trip_packs
           SET status='published',current_published_version=1
           WHERE id=?""",
        (pack_id,),
    )
    db.commit()
    db.close()


def _fake_road(now: int) -> dict:
    observed = datetime.fromtimestamp(now, timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    return {
        "schema_version": 1,
        "source": "server_owned_nps_current_road_observation_v1",
        "feed": {
            "source_id": "grsm-current-cautions",
            "observed_at": observed,
            "response_sha256": "5" * 64,
        },
        "route_evidence": {
            "evidence_id": "smokies_route_evidence_v1",
            "evidence_sha256": "6" * 64,
        },
        "observations": [],
    }


def _fake_snapshot_builder(state: dict):
    def build(
        db,
        pack,
        *,
        admin_user_id,
        idempotency_key,
        current_road_evidence,
        now,
    ):
        raw = dict(pack)
        next_version = int(db.execute(
            "SELECT COALESCE(MAX(version),0)+1 FROM authored_trip_pack_versions WHERE pack_id=?",
            (raw["id"],),
        ).fetchone()[0])
        catalog = {
            "title": raw["draft_title"],
            "summary": raw["draft_summary"],
            "revision": int(raw["draft_revision"]),
            "prior_version": raw["current_published_version"],
            "state": state["catalog_state"],
        }
        road_sha = _sha(current_road_evidence)
        road_observed_at = int(datetime.fromisoformat(
            current_road_evidence["feed"]["observed_at"].replace("Z", "+00:00")
        ).timestamp())
        assets = [
            {
                "id": f"asset_{index:03d}",
                "kind": "other",
                "mime_type": "application/octet-stream",
                "bytes": index + 1,
                "sha256": hashlib.sha256(str(index).encode()).hexdigest(),
            }
            for index in range(98)
        ]
        assets_sha = _sha(assets)
        manifest_sha = _sha({
            "manifest": json.loads(raw["draft_original_manifest_json"]),
            "revision": int(raw["draft_revision"]),
            "state": state["manifest_state"],
        })
        report_id = f"report_{raw['id']}"
        snapshot = {
            "schema_version": 1,
            "snapshot_type": "OriginalV3ReleaseSnapshotV1",
            "pack_id": raw["id"],
            "draft_revision": int(raw["draft_revision"]),
            "draft_manifest_sha256": manifest_sha,
            "manifest_sha256": manifest_sha,
            "publication_manifest_sha256": manifest_sha,
            "assets_sha256": assets_sha,
            "asset_count": 98,
            "assets": assets,
            "validation_report": {"id": report_id},
            "validation_report_sha256": "7" * 64,
            "device_evidence": {"platforms": ["android", "ios"]},
            "device_evidence_sha256": "8" * 64,
            "reviews": {check: True for check in store.ORIGINAL_VALIDATION_CHECKS},
            "reviews_sha256": "9" * 64,
            "catalog": catalog,
            "catalog_sha256": _sha(catalog),
            "current_road_evidence": copy.deepcopy(current_road_evidence),
            "current_road_evidence_sha256": road_sha,
            "current_road_observed_at": road_observed_at,
            "current_road_expires_at": road_observed_at + 1800,
            "next_version": next_version,
            "authorized_by_admin_user_id": admin_user_id,
            "idempotency_key_sha256": hashlib.sha256(
                idempotency_key.encode()
            ).hexdigest(),
        }
        context = {
            "pack": raw,
            "validation": {},
            "preview_manifest": {"schema_version": 3},
            "material": {"long_form_validator_source_sha256": "a" * 64},
            "report_row": {
                "id": report_id,
                "input_sha256": "b" * 64,
                "validator_source_sha256": "c" * 64,
                "suite_version": store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
                "engine_version": store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
                "completed_at": now,
            },
            "publication_manifest_json": json.dumps({
                "schema_version": 3,
                "manifest_id": f"manifest_{raw['id']}_v{next_version}",
                "pack_id": raw["id"],
                "version": next_version,
            }),
            "validated_selections": set(),
            "validated_delivery_contracts": set(),
        }
        return snapshot, _sha(snapshot), context

    return build


@pytest.fixture()
def fake_release(monkeypatch):
    state = {"manifest_state": "frozen", "catalog_state": "frozen"}
    monkeypatch.setattr(
        store,
        "_authored_original_v3_release_snapshot_db",
        _fake_snapshot_builder(state),
    )
    monkeypatch.setattr(
        store,
        "_authored_original_v3_release_publication_validation_metadata",
        lambda _context, **kwargs: {
            "public_release": True,
            "release_authorization": kwargs,
        },
    )
    monkeypatch.setattr(
        store,
        "_public_trip_pack_from_row",
        lambda row, include_template=False: {
            "id": row["id"],
            "version": int(row["version"]),
            "status": row["status"],
            "include_template": include_template,
        },
    )
    return state


def _authorize(pack_id: str, admin: int, now: int, key: str = "release-key-0001"):
    return store.create_authored_original_v3_release_authorization(
        pack_id,
        admin,
        idempotency_key=key,
        confirmation=store.ORIGINAL_V3_RELEASE_CREATE_CONFIRMATION,
        current_road_evidence=_fake_road(now),
        now=now,
    )


def _consume(pack_id: str, admin: int, authorization: dict, now: int, key: str = "release-key-0001"):
    return store.consume_authored_original_v3_release_authorization(
        pack_id,
        authorization["authorization_id"],
        admin,
        idempotency_key=key,
        expected_snapshot_sha256=authorization["snapshot_sha256"],
        confirmation=store.ORIGINAL_V3_RELEASE_CONSUME_CONFIRMATION,
        now=now,
    )


def test_schema_and_migration_create_single_use_release_table(release_db):
    admin, _ = release_db
    _insert_pack("original_schema_release", admin)
    db = store._conn()
    columns = {
        row["name"] for row in db.execute(
            "PRAGMA table_info(authored_original_release_authorizations_v1)"
        ).fetchall()
    }
    indexes = {
        row["name"] for row in db.execute(
            "PRAGMA index_list(authored_original_release_authorizations_v1)"
        ).fetchall()
    }
    db.close()
    assert {
        "snapshot_sha256", "validation_report_sha256", "device_evidence_sha256",
        "reviews_sha256", "catalog_sha256", "current_road_evidence_sha256",
        "idempotency_key", "authorized_by", "consumed_by", "response_json",
    }.issubset(columns)
    assert "idx_authored_original_release_authorizations_pack" in indexes


def test_atomic_consume_and_exact_replay(release_db, fake_release):
    admin, _ = release_db
    pack_id = "original_atomic_release"
    _insert_pack(pack_id, admin)
    now = int(time.time())
    authorization = _authorize(pack_id, admin, now)
    assert authorization["status"] == "active"
    assert authorization["snapshot"]["asset_count"] == 98
    assert authorization["expires_at"] == now + 900

    result = _consume(pack_id, admin, authorization, now + 1)
    assert result["published_version"] == 1
    assert result["publication"] == {
        "id": pack_id, "version": 1, "status": "published", "include_template": True,
    }
    replay = _consume(pack_id, admin, authorization, now + 5000)
    assert replay == {**result, "replayed": True}
    db = store._conn()
    assert db.execute(
        "SELECT COUNT(*) FROM authored_trip_pack_versions WHERE pack_id=?",
        (pack_id,),
    ).fetchone()[0] == 1
    row = db.execute(
        "SELECT * FROM authored_original_release_authorizations_v1 WHERE id=?",
        (authorization["authorization_id"],),
    ).fetchone()
    db.close()
    assert row["status"] == "consumed"
    assert int(row["published_version"]) == 1


def test_drift_expiry_wrong_admin_cross_pack_and_key_reuse_fail_closed(
    release_db, fake_release,
):
    admin, other_admin = release_db
    now = int(time.time())
    _insert_pack("original_release_a", admin)
    _insert_pack("original_release_b", admin)
    authorization = _authorize("original_release_a", admin, now, "release-key-shared")

    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="different Original"):
        _consume(
            "original_release_b", admin, authorization, now + 1, "release-key-shared",
        )
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="administrator"):
        _consume(
            "original_release_a", other_admin, authorization, now + 1, "release-key-shared",
        )
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="different authorization"):
        _authorize("original_release_b", admin, now + 1, "release-key-shared")
    with pytest.raises(store.OriginalV3ReleaseAuthorizationExpiredError):
        _consume(
            "original_release_a", admin, authorization, now + 900, "release-key-shared",
        )

    fresh = _authorize("original_release_a", admin, now, "release-key-drift")
    fake_release["catalog_state"] = "changed"
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="drifted"):
        _consume(
            "original_release_a", admin, fresh, now + 1, "release-key-drift",
        )
    db = store._conn()
    assert db.execute(
        "SELECT COUNT(*) FROM authored_trip_pack_versions WHERE pack_id='original_release_a'"
    ).fetchone()[0] == 0
    db.close()


def test_actual_second_smokies_listing_blocks_authorization_create(
    release_db, fake_release,
):
    admin, _ = release_db
    pack_id = store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
    _insert_pack(
        pack_id,
        admin,
        manifest=_committed_candidate_manifest(),
    )
    _insert_published_standalone_chapter(
        "roaring_fork_standalone_listing",
        admin,
    )
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="another published Smokies or standalone chapter",
    ):
        _authorize(pack_id, admin, int(time.time()), "release-key-second-pack")
    db = store._conn()
    assert db.execute(
        "SELECT COUNT(*) FROM authored_original_release_authorizations_v1"
    ).fetchone()[0] == 0
    db.close()


def test_title_only_standalone_listing_cannot_evade_catalog_inventory(
    release_db, fake_release,
):
    admin, _ = release_db
    pack_id = store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
    _insert_pack(
        pack_id,
        admin,
        manifest=_committed_candidate_manifest(),
    )
    _insert_published_standalone_chapter(
        "unrelated_original_identifier",
        admin,
        listing_title="Roaring Fork Motor Nature Trail",
        include_manifest_markers=False,
    )
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="another published Smokies or standalone chapter",
    ):
        _authorize(
            pack_id,
            admin,
            int(time.time()),
            "release-key-title-only-standalone",
        )
    db = store._conn()
    assert db.execute(
        "SELECT COUNT(*) FROM authored_original_release_authorizations_v1"
    ).fetchone()[0] == 0
    db.close()


def test_actual_second_smokies_listing_drift_blocks_authorization_consume(
    release_db, fake_release,
):
    admin, _ = release_db
    pack_id = store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
    _insert_pack(
        pack_id,
        admin,
        manifest=_committed_candidate_manifest(),
    )
    now = int(time.time())
    authorization = _authorize(
        pack_id,
        admin,
        now,
        "release-key-listing-drift",
    )
    _insert_published_standalone_chapter(
        "foothills_parkway_standalone_listing",
        admin,
        chapter_id="foothills_parkway",
    )
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="another published Smokies or standalone chapter",
    ):
        _consume(
            pack_id,
            admin,
            authorization,
            now + 1,
            "release-key-listing-drift",
        )
    db = store._conn()
    assert db.execute(
        "SELECT COUNT(*) FROM authored_trip_pack_versions WHERE pack_id=?",
        (pack_id,),
    ).fetchone()[0] == 0
    assert db.execute(
        """SELECT status FROM authored_original_release_authorizations_v1
           WHERE id=?""",
        (authorization["authorization_id"],),
    ).fetchone()[0] == "active"
    db.close()


def test_road_expiry_shortens_gate_and_next_version_drift_blocks_consume(
    release_db, fake_release,
):
    admin, _ = release_db
    pack_id = "original_release_version_drift"
    _insert_pack(pack_id, admin)
    now = int(time.time())
    authorization = store.create_authored_original_v3_release_authorization(
        pack_id,
        admin,
        idempotency_key="release-key-short-road",
        confirmation=store.ORIGINAL_V3_RELEASE_CREATE_CONFIRMATION,
        current_road_evidence=_fake_road(now - 1700),
        now=now,
    )
    assert authorization["expires_at"] == now + 100
    db = store._conn()
    db.execute(
        """INSERT INTO authored_trip_pack_versions
           (pack_id,version,content_kind,slug,title,summary,price_credits,
            coverage_region,public_metadata,validation_metadata,template_json,
            original_manifest_json,published_by,published_at)
           VALUES (?,1,'original_drive',?,?,?,?,?,'{}','{}','{}','{}',?,?)""",
        (
            pack_id,
            pack_id.replace("_", "-"),
            "Competing version",
            "Competing immutable version.",
            900,
            "north_america",
            admin,
            now,
        ),
    )
    db.commit()
    db.close()
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="drifted"):
        _consume(
            pack_id,
            admin,
            authorization,
            now + 1,
            "release-key-short-road",
        )


def test_concurrent_create_serializes_to_one_authorization(
    release_db, fake_release,
):
    admin, _ = release_db
    pack_id = "original_release_race"
    _insert_pack(pack_id, admin)
    now = int(time.time())
    barrier = threading.Barrier(2)
    results = []
    failures = []

    def worker():
        try:
            barrier.wait(timeout=5)
            results.append(_authorize(pack_id, admin, now, "release-key-race"))
        except Exception as exc:  # pragma: no cover - asserted below
            failures.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    assert failures == []
    assert len(results) == 2
    assert {item["authorization_id"] for item in results} == {
        results[0]["authorization_id"]
    }
    assert sorted(item["replayed"] for item in results) == [False, True]


def test_consume_failure_rolls_back_version_catalog_and_authorization(
    release_db, fake_release,
):
    admin, _ = release_db
    pack_id = "original_release_rollback"
    _insert_pack(pack_id, admin)
    now = int(time.time())
    authorization = _authorize(pack_id, admin, now, "release-key-rollback")
    db = store._conn()
    db.execute(
        """CREATE TRIGGER fail_release_consume
           BEFORE UPDATE ON authored_original_release_authorizations_v1
           WHEN NEW.status='consumed'
           BEGIN SELECT RAISE(ABORT, 'test rollback'); END"""
    )
    db.commit()
    db.close()
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="immutable"):
        _consume(
            pack_id, admin, authorization, now + 1, "release-key-rollback",
        )
    db = store._conn()
    pack = db.execute(
        "SELECT status,current_published_version FROM authored_trip_packs WHERE id=?",
        (pack_id,),
    ).fetchone()
    auth = db.execute(
        "SELECT status,consumed_at FROM authored_original_release_authorizations_v1 WHERE id=?",
        (authorization["authorization_id"],),
    ).fetchone()
    version_count = db.execute(
        "SELECT COUNT(*) FROM authored_trip_pack_versions WHERE pack_id=?", (pack_id,),
    ).fetchone()[0]
    db.close()
    assert dict(pack) == {"status": "draft", "current_published_version": None}
    assert dict(auth) == {"status": "active", "consumed_at": None}
    assert version_count == 0


def test_generic_v3_publish_is_rejected_before_legacy_validation(release_db):
    admin, _ = release_db
    pack_id = "original_v3_bypass"
    _insert_pack(pack_id, admin)
    with pytest.raises(store.OriginalV3ReleaseAuthorizationRequiredError):
        store.publish_authored_trip_pack(
            pack_id, admin, required_content_kind="original_drive",
        )


def test_exact_committed_candidate_and_product_contract_sources_are_bound():
    candidate_path = (
        ROOT / "originals/smokies/smokies_complete_private_candidate_v1.json"
    )
    manifest_path = (
        ROOT / "originals/smokies/smokies_complete_private_manifest_v3.json"
    )
    candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert candidate["candidate_id"] == store.ORIGINAL_V3_RELEASE_TARGET_CANDIDATE_ID
    assert candidate["product_id"] == store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
    assert candidate["product_contract"] == {
        **_exact_product_contract(),
        "source_path": candidate["product_contract"]["source_path"],
        "source_sha256": candidate["product_contract"]["source_sha256"],
        "approval_overlay_path": candidate["product_contract"][
            "approval_overlay_path"
        ],
        "approval_overlay_sha256": candidate["product_contract"][
            "approval_overlay_sha256"
        ],
    }
    assert hashlib.sha256(candidate_path.read_bytes()).hexdigest() == (
        store.ORIGINAL_V3_RELEASE_TARGET_CANDIDATE_ARTIFACT_SHA256
    )
    assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == (
        store.ORIGINAL_V3_RELEASE_TARGET_MANIFEST_ARTIFACT_SHA256
    )
    contract = store._original_v3_release_manifest_contract(
        manifest,
        pack_id=store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID,
    )
    identity = store._original_v3_release_private_candidate_identity(manifest)
    assert contract["chapter_count"] == 4
    assert contract["base_entry_count"] == 77
    assert identity["candidate_id"] == candidate["candidate_id"]
    assert identity["private_manifest_object_sha256"] == _sha(manifest)
    assert identity["content_projection_sha256"] == (
        store.ORIGINAL_V3_RELEASE_TARGET_CONTENT_PROJECTION_SHA256
    )
    assert identity["final_draft_manifest_sha256"] == _sha(manifest)

    matured = copy.deepcopy(manifest)
    matured["route_evidence"] = {
        "schema_version": 1,
        "evidence_id": "smokies-official-routes-2026-v1",
        "evidence_sha256": "1" * 64,
        "product_id": store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID,
        "route_spec_sha256": "2" * 64,
        "source_snapshot_sha256": "3" * 64,
    }
    matured["review"] = {
        "editorial_status": "approved",
        "field_drive_completed_at": "2026-08-11T01:00:00Z",
        "source_review_completed_at": "2026-08-11T02:00:00Z",
    }
    matured["offline_map"]["estimated_bytes"] = 123456789
    matured["narration_profile"]["commercial_license"][
        "verified_at"
    ] = "2026-08-11T03:00:00Z"
    for chapter in matured["chapters"]:
        for source in chapter["operational_sources"]:
            source["reviewed_at"] = "2026-08-11"
        chapter["operational_readiness"]["candidate_id"] = (
            "smokies_operational_readiness_refresh_v2"
        )
        chapter["operational_readiness"]["candidate_sha256"] = "4" * 64
        if chapter["id"] == "roaring_fork":
            chapter["safety"]["disclaimers"][0] = (
                "This tour does not replace current NPS information."
            )
            chapter["access"]["accessibility_notes"] = (
                "Accessibility and stop conditions require a current NPS check; "
                "this tour makes no parking or access guarantee."
            )
    matured["assets"][0]["path"] += "?storage_revision=2"
    matured_identity = store._original_v3_release_private_candidate_identity(
        matured
    )
    assert matured_identity["content_projection_sha256"] == (
        identity["content_projection_sha256"]
    )
    assert matured_identity["final_draft_manifest_sha256"] != (
        identity["final_draft_manifest_sha256"]
    )

    changed = copy.deepcopy(manifest)
    changed["stories"][0]["title"] += " drift"
    assert store._original_v3_release_manifest_contract(
        changed,
        pack_id=store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID,
    ) == contract
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="content drifted",
    ):
        store._original_v3_release_private_candidate_identity(changed)
    review_override = copy.deepcopy(manifest)
    review_override["review"]["route_network_override"] = {
        "status": "approved",
    }
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="review may mature only",
    ):
        store._original_v3_release_private_candidate_identity(review_override)
    disclaimer_drift = copy.deepcopy(manifest)
    next(
        chapter for chapter in disclaimer_drift["chapters"]
        if chapter["id"] == "roaring_fork"
    )["safety"]["disclaimers"][0] = "This changed safety copy is not approved."
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="exact private-to-public transition",
    ):
        store._original_v3_release_private_candidate_identity(disclaimer_drift)
    access_drift = copy.deepcopy(manifest)
    next(
        chapter for chapter in access_drift["chapters"]
        if chapter["id"] == "roaring_fork"
    )["access"]["accessibility_notes"] = "Different access copy."
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="access note drifted outside",
    ):
        store._original_v3_release_private_candidate_identity(access_drift)
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="not configured",
    ):
        store._original_v3_release_manifest_contract(
            manifest,
            pack_id="some_other_v3_original",
        )


def test_exact_candidate_has_a_real_reachable_publication_manifest():
    manifest, route_evidence = _publication_ready_manifest_and_route_evidence()
    selections = {
        f"{chapter['validation_selection']['selection_id']}:{variant_id}"
        for chapter in manifest["chapters"]
        for variant_id in chapter["validation_selection"]["required_variant_ids"]
    }
    delivery_contracts = {
        (
            f"{chapter['validation_selection']['selection_id']}:"
            f"{variant['id']}:{variant['delivery_contract_sha256']}"
        )
        for chapter in manifest["chapters"]
        for variant in chapter["variants"]
    }
    normalized, encoded = store._normalize_original_manifest(
        store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID,
        store.ORIGINAL_V3_RELEASE_TARGET_TITLE,
        manifest,
        version=1,
        publishing=True,
        verified_assets=_publication_verified_assets(manifest),
        validated_selections=selections,
        validated_delivery_contracts=delivery_contracts,
        route_evidence_document=route_evidence,
    )
    assert normalized["schema_version"] == 3
    assert normalized["pack_id"] == store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
    assert normalized["version"] == 1
    assert normalized["review"]["editorial_status"] == "approved"
    assert normalized["offline_map"]["estimated_bytes"] == 750_000_000
    assert normalized["route_evidence"] == manifest["route_evidence"]
    assert json.loads(encoded) == normalized
    assert store._original_v3_release_private_candidate_identity(normalized)[
        "content_projection_sha256"
    ] == store.ORIGINAL_V3_RELEASE_TARGET_CONTENT_PROJECTION_SHA256


def test_final_readiness_contract_requires_every_matured_public_value():
    manifest, _ = _publication_ready_manifest_and_route_evidence()
    contract = store._original_v3_release_final_readiness_contract(manifest)
    assert contract["editorial_status"] == "approved"
    assert contract["offline_map_estimated_bytes"] == 750_000_000
    assert len(contract["operational_bindings"]) == 4
    assert contract["route_evidence_sha256"] == _sha(
        manifest["route_evidence"]
    )

    stale_candidate = _committed_candidate_manifest()
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="not approved",
    ):
        store._original_v3_release_final_readiness_contract(stale_candidate)

    failures = []
    missing_timestamp = copy.deepcopy(manifest)
    missing_timestamp["review"]["field_drive_completed_at"] = None
    failures.append((missing_timestamp, "both review completion"))
    zero_offline = copy.deepcopy(manifest)
    zero_offline["offline_map"]["estimated_bytes"] = 0
    failures.append((zero_offline, "positive byte count"))
    missing_route = copy.deepcopy(manifest)
    missing_route.pop("route_evidence")
    failures.append((missing_route, "route-evidence binding"))
    private_disclaimer = copy.deepcopy(manifest)
    next(
        chapter for chapter in private_disclaimer["chapters"]
        if chapter["id"] == "roaring_fork"
    )["safety"]["disclaimers"][0] = (
        "This private draft does not replace current NPS information."
    )
    failures.append((private_disclaimer, "private-state copy"))
    private_access = copy.deepcopy(manifest)
    next(
        chapter for chapter in private_access["chapters"]
        if chapter["id"] == "roaring_fork"
    )["access"]["accessibility_notes"] = (
        "Accessibility and stop conditions require a current NPS check; "
        "this draft makes no parking or access guarantee."
    )
    failures.append((private_access, "private-state copy"))
    missing_profile_verification = copy.deepcopy(manifest)
    missing_profile_verification["narration_profile"]["commercial_license"][
        "verified_at"
    ] = None
    failures.append((missing_profile_verification, "profile verification"))
    missing_operational = copy.deepcopy(manifest)
    missing_operational["chapters"][0].pop("operational_readiness")
    failures.append((missing_operational, "operational binding"))
    for changed, message in failures:
        with pytest.raises(
            store.OriginalV3ReleaseAuthorizationConflictError,
            match=message,
        ):
            store._original_v3_release_final_readiness_contract(changed)


def test_catalog_contract_rejects_price_access_and_standalone_drift(release_db):
    db = store._conn()
    catalog, digest = store._original_v3_release_catalog_snapshot(
        db, _catalog_row()
    )
    assert catalog["price_credits"] == 900
    assert catalog["access_policy"]["explorer_included"] is True
    assert catalog["product_contract"]["public_catalog_product_count"] == 1
    assert catalog["product_contract"]["standalone_product_ids"] == []
    assert digest == _sha(catalog)

    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="900-credit price",
    ):
        store._original_v3_release_catalog_snapshot(db, _catalog_row(price=500))

    excluded = json.loads(_catalog_row()["draft_public_metadata"])
    excluded["access_policy"]["explorer_included"] = False
    excluded["product_contract"]["explorer_included"] = False
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="Explorer-included",
    ):
        store._original_v3_release_catalog_snapshot(
            db, _catalog_row(public_metadata=excluded)
        )

    standalone = json.loads(_catalog_row()["draft_public_metadata"])
    standalone["product_contract"]["public_catalog_product_count"] = 2
    standalone["product_contract"]["standalone_product_ids"] = [
        "roaring_fork"
    ]
    standalone["product_contract"][
        "standalone_roaring_fork_public_product_approved"
    ] = True
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="product contract drifted",
    ):
        store._original_v3_release_catalog_snapshot(
            db, _catalog_row(public_metadata=standalone)
        )
    db.close()


def test_manifest_contract_rejects_chapter_split_override_asset_and_region_drift():
    manifest = _committed_candidate_manifest()
    pack_id = store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
    expected = store._original_v3_release_manifest_contract(
        manifest,
        pack_id=pack_id,
    )
    assert (
        expected["chapter_count"],
        expected["variant_count"],
        expected["base_entry_count"],
        expected["directional_replacement_count"],
        expected["narration_asset_count"],
        expected["image_asset_count"],
        expected["content_asset_count"],
        expected["offline_region_count"],
    ) == (4, 6, 77, 8, 85, 13, 98, 1)

    missing_chapter = copy.deepcopy(manifest)
    missing_chapter["chapters"].pop()
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="four chapters",
    ):
        store._original_v3_release_manifest_contract(
            missing_chapter,
            pack_id=pack_id,
        )

    variant_drift = copy.deepcopy(manifest)
    variant_drift["chapters"][0]["variants"][0]["id"] = "wrong_direction"
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="variant membership",
    ):
        store._original_v3_release_manifest_contract(
            variant_drift,
            pack_id=pack_id,
        )

    split_drift = copy.deepcopy(manifest)
    moved_story_id = "mc_story_18"
    for variant in split_drift["chapters"][0]["variants"]:
        for field in ("cue_refs", "selectable_refs"):
            variant[field] = [
                item for item in variant[field]
                if item["story_id"] != moved_story_id
            ]
    cades_variant = split_drift["chapters"][1]["variants"][0]
    cades_variant["selectable_refs"].append({
        "story_id": moved_story_id,
        "sequence": 999,
        "delivery": {"mode": "completion_deeper"},
    })
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="per-variant base-entry coverage",
    ):
        store._original_v3_release_manifest_contract(
            split_drift,
            pack_id=pack_id,
        )

    override_drift = copy.deepcopy(manifest)
    override_story = next(
        story for story in override_drift["stories"]
        if story.get("variant_overrides")
    )
    override_story["variant_overrides"].pop()
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="eight directional replacements",
    ):
        store._original_v3_release_manifest_contract(
            override_drift,
            pack_id=pack_id,
        )

    asset_drift = copy.deepcopy(manifest)
    next(
        asset for asset in asset_drift["assets"]
        if asset["kind"] == "narration"
    )["kind"] = "other"
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="85 narration and 13 used image assets",
    ):
        store._original_v3_release_manifest_contract(
            asset_drift,
            pack_id=pack_id,
        )

    region_drift = copy.deepcopy(manifest)
    region_drift["offline_map"]["region_id"] = "chapter_only_region"
    with pytest.raises(
        store.OriginalV3ReleaseAuthorizationConflictError,
        match="union offline-map region",
    ):
        store._original_v3_release_manifest_contract(
            region_drift,
            pack_id=pack_id,
        )


def _road_manifest() -> dict:
    chapters = []
    membership = store.ORIGINAL_V3_RELEASE_TARGET_CHAPTER_VARIANTS
    for chapter_id, variants in membership:
        chapters.append({
            "id": chapter_id,
            "operational_readiness": {
                "candidate_id": "candidate_smokies_v1",
                "candidate_sha256": "a" * 64,
            },
            "variants": [{"id": variant_id} for variant_id in variants],
        })
    return {
        "schema_version": 3,
        "title": store.ORIGINAL_V3_RELEASE_TARGET_TITLE,
        "route_evidence": {
            "evidence_id": "route_evidence_smokies_v1",
            "evidence_sha256": "b" * 64,
        },
        "chapters": chapters,
    }


def _road_evidence(manifest: dict, now: int) -> dict:
    observed_at = datetime.fromtimestamp(now, timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    observations = []
    for target in store._original_v3_release_road_targets(manifest):
        observations.append({
            "chapter_id": target["chapter_id"],
            "variant_id": target["variant_id"],
            "observation": {
                "candidate_id": target["candidate_id"],
                "candidate_sha256": target["candidate_sha256"],
                "source_id": "grsm-current-cautions",
                "observed_at": observed_at,
                "road_states": {f"road_{target['chapter_id']}": "open"},
            },
        })
    return {
        "schema_version": 1,
        "source": "server_owned_nps_current_road_observation_v1",
        "feed": {
            "source_id": "grsm-current-cautions",
            "observed_at": observed_at,
            "response_sha256": "c" * 64,
        },
        "route_evidence": copy.deepcopy(manifest["route_evidence"]),
        "observations": observations,
    }


def test_current_road_contract_requires_six_open_fresh_exact_variants():
    now = int(time.time())
    manifest = _road_manifest()
    evidence = _road_evidence(manifest, now - 60)
    normalized, digest, observed_at, expires_at = (
        store._normalize_original_v3_release_road_evidence(
            evidence, manifest=manifest, now=now,
        )
    )
    assert normalized == evidence
    assert digest == _sha(evidence)
    assert expires_at - observed_at == 1800

    closed = copy.deepcopy(evidence)
    next(iter(closed["observations"][0]["observation"]["road_states"]))
    road_id = next(iter(closed["observations"][0]["observation"]["road_states"]))
    closed["observations"][0]["observation"]["road_states"][road_id] = "closed"
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="not fully open"):
        store._normalize_original_v3_release_road_evidence(
            closed, manifest=manifest, now=now,
        )
    with pytest.raises(store.OriginalV3ReleaseAuthorizationExpiredError):
        store._normalize_original_v3_release_road_evidence(
            _road_evidence(manifest, now - 1800), manifest=manifest, now=now,
        )


def test_dual_platform_evidence_binds_exact_draft_assets_and_current_admin(release_db):
    admin, _ = release_db
    accepted_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
    evidence = {
        "schema_version": 1,
        "evidence_id": "smokies_dual_platform_preview_v1",
        "pack_id": "original_device_binding",
        "draft_revision": 12,
        "manifest_sha256": "1" * 64,
        "assets_sha256": "2" * 64,
        "accepted_at": accepted_at,
        "accepted_by_admin_user_id": admin,
        "platforms": [
            {
                "platform": "android",
                "build_identity_sha256": "3" * 64,
                "preview_evidence_sha256": "4" * 64,
                "complete": True,
            },
            {
                "platform": "ios",
                "build_identity_sha256": "5" * 64,
                "preview_evidence_sha256": "6" * 64,
                "complete": True,
            },
        ],
    }
    digest = _sha(evidence)
    validation = {
        "dual_platform_private_preview_complete": True,
        "dual_platform_private_preview_evidence": evidence,
        "dual_platform_private_preview_evidence_sha256": digest,
    }
    db = store._conn()
    normalized, actual_digest = store._original_v3_release_device_evidence_db(
        db,
        validation,
        pack_id="original_device_binding",
        draft_revision=12,
        manifest_sha256="1" * 64,
        assets_sha256="2" * 64,
    )
    db.close()
    assert normalized == evidence
    assert actual_digest == digest
    changed = copy.deepcopy(validation)
    changed["dual_platform_private_preview_evidence"]["assets_sha256"] = "f" * 64
    db = store._conn()
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="snapshot drifted"):
        store._original_v3_release_device_evidence_db(
            db,
            changed,
            pack_id="original_device_binding",
            draft_revision=12,
            manifest_sha256="1" * 64,
            assets_sha256="2" * 64,
        )
    db.close()


def test_report_binding_requires_exact_78_of_78_and_six_delivery_contracts():
    selection_items = [
        {
            "key": f"chapter_{index}:variant_{index}",
            "delivery_contract_sha256": f"{index + 1:x}" * 64,
        }
        for index in range(6)
    ]
    material = {
        "draft_revision": 4,
        "manifest_sha256": "1" * 64,
        "assets_sha256": "2" * 64,
        "input_sha256": "3" * 64,
        "validator_source_sha256": "4" * 64,
        "validation_selections": selection_items,
    }
    validated = [item["key"] for item in selection_items]
    contracts = [
        f"{item['key']}:{item['delivery_contract_sha256']}"
        for item in selection_items
    ]
    row = {
        "id": "report_exact_78",
        "pack_id": "original_report_binding",
        "draft_revision": 4,
        "manifest_sha256": "1" * 64,
        "assets_sha256": "2" * 64,
        "input_sha256": "3" * 64,
        "validator_source_sha256": "4" * 64,
        "manifest_json": "{}",
        "suite_version": store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
        "engine_version": store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
        "status": "passed",
        "passed": 1,
        "summary_json": json.dumps({
            "required": 78,
            "passed": 78,
            "failed": 0,
            "selection_count": 6,
            "selections_passed": 6,
            "selections_failed": 0,
            "validated_selections": validated,
            "validated_delivery_contracts": contracts,
        }),
        "scenarios_json": json.dumps([
            {
                "selection_key": item["key"],
                "passed": True,
                "issues": [],
                "summary": {"required": 13, "passed": 13, "failed": 0},
                "delivery_validation": {
                    "passed": True,
                    "delivery_contract_sha256": item[
                        "delivery_contract_sha256"
                    ],
                },
                "scenarios": [
                    {
                        "id": scenario_id,
                        "required": True,
                        "passed": True,
                        "issues": [],
                    }
                    for scenario_id in store.ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS
                ],
            }
            for item in selection_items
        ]),
        "issues_json": "[]",
        "started_by": 1,
        "started_at": 10,
        "completed_at": 20,
    }
    report, digest = store._original_v3_release_report_snapshot(row, material)
    assert report["summary"]["passed"] == 78
    assert digest == _sha(report)
    changed = dict(row)
    summary = json.loads(row["summary_json"])
    summary["passed"] = 77
    changed["summary_json"] = json.dumps(summary)
    with pytest.raises(store.OriginalV3ReleaseAuthorizationConflictError, match="78-scenario"):
        store._original_v3_release_report_snapshot(changed, material)


def test_full_snapshot_builder_binds_all_required_domains(
    release_db, monkeypatch,
):
    admin, _ = release_db
    pack_id = store.ORIGINAL_V3_RELEASE_TARGET_PACK_ID
    revision = 7
    raw_manifest, _ = _publication_ready_manifest_and_route_evidence()
    _insert_pack(
        pack_id,
        admin,
        revision=revision,
        manifest=raw_manifest,
    )
    now = int(time.time())
    manifest = copy.deepcopy(raw_manifest)
    manifest["route_evidence"] = {
        "evidence_id": "route_evidence_smokies_v1",
        "evidence_sha256": "b" * 64,
    }
    verified = {item["id"]: dict(item) for item in manifest["assets"]}
    material = {
        "draft_revision": revision,
        "manifest_sha256": _sha(manifest),
        "assets_sha256": _sha(manifest["assets"]),
        "input_sha256": "3" * 64,
        "validator_source_sha256": "4" * 64,
        "long_form_validator_source_sha256": "5" * 64,
        "validation_selections": [
            {
                "key": f"selection_{index}",
                "delivery_contract_sha256": f"{index + 1:x}" * 64,
            }
            for index in range(6)
        ],
    }
    expected_keys = [item["key"] for item in material["validation_selections"]]
    expected_contracts = [
        f"{item['key']}:{item['delivery_contract_sha256']}"
        for item in material["validation_selections"]
    ]
    report = {
        "id": f"report_{pack_id}",
        "pack_id": pack_id,
        "draft_revision": revision,
        "manifest_sha256": material["manifest_sha256"],
        "assets_sha256": material["assets_sha256"],
        "input_sha256": material["input_sha256"],
        "validator_source_sha256": material["validator_source_sha256"],
        "manifest_json": json.dumps(manifest),
        "suite_version": store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
        "engine_version": store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
        "status": "passed",
        "passed": 1,
        "summary_json": json.dumps({
            "required": 78,
            "passed": 78,
            "failed": 0,
            "selection_count": 6,
            "selections_passed": 6,
            "selections_failed": 0,
            "validated_selections": expected_keys,
            "validated_delivery_contracts": expected_contracts,
        }),
        "scenarios_json": json.dumps([
            {
                "selection_key": item["key"],
                "passed": True,
                "issues": [],
                "summary": {"required": 13, "passed": 13, "failed": 0},
                "delivery_validation": {
                    "passed": True,
                    "delivery_contract_sha256": item[
                        "delivery_contract_sha256"
                    ],
                },
                "scenarios": [
                    {
                        "id": scenario_id,
                        "required": True,
                        "passed": True,
                        "issues": [],
                    }
                    for scenario_id in store.ORIGINAL_VIRTUAL_VALIDATION_REQUIRED_SCENARIOS
                ],
            }
            for item in material["validation_selections"]
        ]),
        "issues_json": "[]",
        "started_by": admin,
        "started_at": now - 60,
        "completed_at": now - 30,
    }
    evidence = {
        "schema_version": 1,
        "evidence_id": "smokies_dual_platform_snapshot_v1",
        "pack_id": pack_id,
        "draft_revision": revision,
        "manifest_sha256": material["manifest_sha256"],
        "assets_sha256": material["assets_sha256"],
        "accepted_at": datetime.fromtimestamp(
            now - 10, timezone.utc,
        ).isoformat().replace("+00:00", "Z"),
        "accepted_by_admin_user_id": admin,
        "platforms": [
            {
                "platform": "android",
                "build_identity_sha256": "6" * 64,
                "preview_evidence_sha256": "7" * 64,
                "complete": True,
            },
            {
                "platform": "ios",
                "build_identity_sha256": "8" * 64,
                "preview_evidence_sha256": "9" * 64,
                "complete": True,
            },
        ],
    }
    validation = {
        **{check: True for check in store.ORIGINAL_VALIDATION_CHECKS},
        "dual_platform_private_preview_complete": True,
        "dual_platform_private_preview_evidence": evidence,
        "dual_platform_private_preview_evidence_sha256": _sha(evidence),
        "trusted_publication_validation_complete": False,
        "public_release": False,
    }
    db = store._conn()
    db.execute(
        "UPDATE authored_trip_packs SET draft_validation_metadata=? WHERE id=?",
        (json.dumps(validation), pack_id),
    )
    db.execute(
        """UPDATE authored_original_validation_reports
           SET manifest_sha256=?,assets_sha256=?,input_sha256=?,
               validator_source_sha256=?,manifest_json=?,summary_json=?,
               scenarios_json=?,issues_json=?,started_at=?,completed_at=?
           WHERE id=?""",
        (
            report["manifest_sha256"],
            report["assets_sha256"],
            report["input_sha256"],
            report["validator_source_sha256"],
            report["manifest_json"],
            report["summary_json"],
            report["scenarios_json"],
            report["issues_json"],
            report["started_at"],
            report["completed_at"],
            report["id"],
        ),
    )
    db.commit()
    pack = db.execute(
        "SELECT * FROM authored_trip_packs WHERE id=?", (pack_id,),
    ).fetchone()

    monkeypatch.setattr(store, "_verified_original_asset_map_db", lambda *_: verified)
    monkeypatch.setattr(
        store,
        "_authored_original_validation_manifest_from_row",
        lambda *_args, **_kwargs: copy.deepcopy(manifest),
    )
    monkeypatch.setattr(
        store, "_original_validation_material", lambda *_args: copy.deepcopy(material),
    )
    monkeypatch.setattr(
        store, "_current_original_validation_report_db", lambda *_args: report,
    )
    monkeypatch.setattr(
        store,
        "_normalize_original_manifest",
        lambda *_args, version=None, **_kwargs: (
            {**copy.deepcopy(manifest), "version": version},
            json.dumps({**copy.deepcopy(manifest), "version": version}),
        ),
    )
    snapshot, snapshot_sha256, context = (
        store._authored_original_v3_release_snapshot_db(
            db,
            pack,
            admin_user_id=admin,
            idempotency_key="release-full-snapshot-key",
            current_road_evidence=_road_evidence(manifest, now - 30),
            now=now,
        )
    )
    db.close()
    assert snapshot["asset_count"] == 98
    assert len(snapshot["assets"]) == 98
    assert snapshot["validation_report"]["summary"]["passed"] == 78
    assert [
        item["platform"] for item in snapshot["device_evidence"]["platforms"]
    ] == ["android", "ios"]
    assert len(snapshot["current_road_evidence"]["observations"]) == 6
    assert snapshot["catalog"]["price_credits"] == 900
    assert snapshot["next_version"] == 1
    assert snapshot["private_candidate"]["final_draft_manifest_sha256"] == (
        snapshot["draft_manifest_sha256"]
    )
    assert snapshot_sha256 == _sha(snapshot)
    assert context["validated_selections"] == set(expected_keys)


def test_published_release_metadata_redacts_private_admin_and_device_evidence():
    context = {
        "validation": {
            "dual_platform_private_preview_complete": True,
            "dual_platform_private_preview_evidence": {
                "accepted_by_admin_user_id": 42,
            },
            "dual_platform_private_preview_evidence_sha256": "1" * 64,
        },
        "report_row": {
            "id": "report_redaction",
            "input_sha256": "2" * 64,
            "validator_source_sha256": "3" * 64,
            "suite_version": store.ORIGINAL_VIRTUAL_VALIDATION_SUITE_VERSION,
            "engine_version": store.ORIGINAL_VIRTUAL_VALIDATION_ENGINE_VERSION,
            "completed_at": 100,
        },
        "material": {"long_form_validator_source_sha256": "4" * 64},
        "validated_selections": {"selection"},
        "validated_delivery_contracts": {"selection:" + "5" * 64},
        "preview_manifest": {"schema_version": 1},
        "pack": {"id": "redaction_test", "draft_original_manifest_json": "{}"},
    }
    published = store._authored_original_v3_release_publication_validation_metadata(
        context,
        authorization_id="original_v3_release_private_id",
        snapshot_sha256="6" * 64,
        authorized_by_admin_user_id=42,
        consumed_at=200,
    )
    encoded = json.dumps(published, sort_keys=True)
    assert "accepted_by_admin_user_id" not in encoded
    assert "authorized_by_admin_user_id" not in encoded
    assert "original_v3_release_private_id" not in encoded
    assert published["dual_platform_private_preview_evidence_redacted"] is True
    assert published["release_authorization"]["snapshot_sha256"] == "6" * 64


def test_server_release_road_reader_force_refreshes_one_feed_for_all_variants(monkeypatch):
    manifest = _road_manifest()
    targets = store._original_v3_release_road_targets(manifest)
    calls = []
    observed_at = datetime.now(timezone.utc).replace(microsecond=0)

    class Reader:
        def get(self, *, now, force_refresh=False):
            calls.append((now, force_refresh))
            return type("Feed", (), {
                "observed_at": observed_at,
                "response_sha256": "c" * 64,
            })()

    monkeypatch.setattr(
        server,
        "get_authored_original_v3_release_road_targets",
        lambda _pack_id: {
            "route_evidence": manifest["route_evidence"],
            "targets": targets,
        },
    )
    monkeypatch.setattr(server, "load_registered_route_evidence", lambda _id: {"route": True})
    monkeypatch.setattr(server, "load_operational_candidate", lambda: {"candidate": True})
    monkeypatch.setattr(server, "default_current_road_reader", Reader())
    monkeypatch.setattr(
        server,
        "build_operational_observation",
        lambda **kwargs: {
            "candidate_id": kwargs["chapter_id"],
            "candidate_sha256": "a" * 64,
            "source_id": "grsm-current-cautions",
            "observed_at": observed_at.isoformat().replace("+00:00", "Z"),
            "road_states": {"road": "open"},
        },
    )
    result = server._trusted_original_v3_release_road_evidence(
        pack_id="original_server_road", now=observed_at,
    )
    assert calls == [(observed_at, True)]
    assert len(result["observations"]) == 6
    assert result["feed"]["response_sha256"] == "c" * 64


def test_api_keeps_authorize_and_consume_as_separate_confirmations(monkeypatch):
    now = int(time.time())
    road = _fake_road(now)
    authorization = {
        "authorization_id": "original_v3_release_test",
        "snapshot_sha256": "d" * 64,
    }
    calls = []
    monkeypatch.setattr(
        server,
        "get_authored_original_v3_release_authorization_by_key",
        lambda *args, **kwargs: calls.append(("lookup", args, kwargs)) or None,
    )
    monkeypatch.setattr(
        server,
        "_trusted_original_v3_release_road_evidence",
        lambda **kwargs: calls.append(("road", kwargs)) or road,
    )
    monkeypatch.setattr(
        server,
        "create_authored_original_v3_release_authorization",
        lambda *args, **kwargs: calls.append(("create", args, kwargs)) or authorization,
    )
    monkeypatch.setattr(
        server,
        "consume_authored_original_v3_release_authorization",
        lambda *args, **kwargs: calls.append(("consume", args, kwargs)) or {"published_version": 1},
    )
    create_body = server.OriginalV3ReleaseAuthorizationRequest(
        confirmation=store.ORIGINAL_V3_RELEASE_CREATE_CONFIRMATION,
    )
    created = asyncio.run(
        server.api_admin_create_original_v3_release_authorization(
            "original_api_release", create_body, "release-api-key", {"id": 12},
        )
    )
    consume_body = server.OriginalV3ReleaseConsumeRequest(
        confirmation=store.ORIGINAL_V3_RELEASE_CONSUME_CONFIRMATION,
        expected_snapshot_sha256="d" * 64,
    )
    consumed = asyncio.run(
        server.api_admin_consume_original_v3_release_authorization(
            "original_api_release",
            authorization["authorization_id"],
            consume_body,
            "release-api-key",
            {"id": 12},
        )
    )
    assert created == authorization
    assert consumed == {"published_version": 1}
    assert [item[0] for item in calls] == ["lookup", "road", "create", "consume"]
    assert calls[2][2]["current_road_evidence"] == road
    assert "current_road_evidence" not in calls[3][2]


def test_api_create_replay_does_not_refresh_road_source(monkeypatch):
    replay = {
        "authorization_id": "original_v3_release_existing",
        "snapshot_sha256": "e" * 64,
        "replayed": True,
    }
    monkeypatch.setattr(
        server,
        "get_authored_original_v3_release_authorization_by_key",
        lambda *args, **kwargs: replay,
    )
    monkeypatch.setattr(
        server,
        "_trusted_original_v3_release_road_evidence",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("road source refreshed")),
    )
    result = asyncio.run(
        server.api_admin_create_original_v3_release_authorization(
            "original_api_replay",
            server.OriginalV3ReleaseAuthorizationRequest(
                confirmation=store.ORIGINAL_V3_RELEASE_CREATE_CONFIRMATION,
            ),
            "release-api-replay",
            {"id": 12},
        )
    )
    assert result == replay
