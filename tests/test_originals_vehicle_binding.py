from __future__ import annotations

import copy
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from config.settings import settings
from dashboard import server
from db import store
from db.originals_operational import (
    load_operational_candidate,
    manifest_operational_fields,
    operational_candidate_sha256,
)
from db.originals_vehicle_binding import (
    OriginalVehicleBindingError,
    derive_original_vehicle_class,
    normalize_original_vehicle_binding_input,
)


NOW_ISO = "2026-08-04T15:58:00+00:00"
NOW = datetime(2026, 8, 4, 16, 0, tzinfo=timezone.utc)


@pytest.fixture()
def vehicle_db(tmp_path):
    previous = settings.db_path
    settings.db_path = str(tmp_path / "original-vehicle-bindings.db")
    store.init_db()
    first = store.create_user("vehicle-one@example.com", "vehicle_one", "hash", "vehicle-one")
    second = store.create_user("vehicle-two@example.com", "vehicle_two", "hash", "vehicle-two")
    try:
        yield {"first": first, "second": second}
    finally:
        settings.db_path = previous


@pytest.mark.parametrize(
    ("profile", "expected"),
    [
        ({"vehicle_kind": "passenger", "vehicle_length_ft": None, "is_towing": False}, "passenger"),
        ({"vehicle_kind": "motorcycle", "vehicle_length_ft": None, "is_towing": False}, "motorcycle"),
        ({"vehicle_kind": "motorhome", "vehicle_length_ft": 31, "is_towing": False}, "motorhome"),
        ({"vehicle_kind": "bus", "vehicle_length_ft": 36, "is_towing": False}, "bus"),
        ({"vehicle_kind": "commercial_service", "vehicle_length_ft": None, "is_towing": False}, "commercial_service"),
        ({"vehicle_kind": "van_camper", "vehicle_length_ft": 25, "is_towing": False}, "passenger"),
        ({"vehicle_kind": "van_camper", "vehicle_length_ft": 25.01, "is_towing": False}, "van_over_25_ft"),
        ({"vehicle_kind": "van_camper", "vehicle_length_ft": None, "is_towing": False}, None),
        ({"vehicle_kind": "other", "vehicle_length_ft": 18, "is_towing": False}, None),
        ({"vehicle_kind": "motorcycle", "vehicle_length_ft": None, "is_towing": True}, "towing_trailer"),
    ],
)
def test_vehicle_class_derivation_is_conservative(profile, expected):
    assert derive_original_vehicle_class(profile) == expected


def test_vehicle_binding_rejects_private_and_malformed_fields():
    with pytest.raises(OriginalVehicleBindingError, match="unsupported fields"):
        normalize_original_vehicle_binding_input({
            "vehicle_kind": "passenger",
            "vehicle_length_ft": 18,
            "is_towing": False,
            "make": "Private",
        })
    with pytest.raises(OriginalVehicleBindingError, match="number"):
        normalize_original_vehicle_binding_input({
            "vehicle_kind": "van_camper",
            "vehicle_length_ft": "twenty-six",
            "is_towing": False,
        })


def test_binding_is_idempotent_rotates_and_is_owner_scoped(vehicle_db):
    first = vehicle_db["first"]
    second = vehicle_db["second"]
    passenger = {"vehicle_kind": "passenger", "vehicle_length_ft": 18, "is_towing": False}
    created = store.upsert_user_original_vehicle_binding(first, passenger)
    repeated = store.upsert_user_original_vehicle_binding(first, copy.deepcopy(passenger))
    assert repeated["binding_id"] == created["binding_id"]
    assert repeated["revision"] == 1
    assert repeated["vehicle_class"] == "passenger"
    assert store.get_user_original_vehicle_binding(second) is None
    assert store.resolve_user_original_vehicle_binding(second, created["binding_id"])["status"] == "vehicle_setup_required"

    changed = store.upsert_user_original_vehicle_binding(first, {
        **passenger,
        "is_towing": True,
    })
    assert changed["binding_id"] != created["binding_id"]
    assert changed["revision"] == 2
    assert changed["vehicle_class"] == "towing_trailer"
    assert store.resolve_user_original_vehicle_binding(first, created["binding_id"])["status"] == "vehicle_setup_changed"
    assert store.resolve_user_original_vehicle_binding(first, changed["binding_id"])["vehicle_class"] == "towing_trailer"

    db = store._conn()
    row = db.execute(
        "SELECT * FROM user_original_vehicle_bindings_v1 WHERE user_id=?",
        (first,),
    ).fetchone()
    columns = set(row.keys())
    db.close()
    assert {"make", "model", "nickname", "year"}.isdisjoint(columns)


def test_ambiguous_binding_fails_closed_and_delete_cleans_up(vehicle_db):
    user_id = vehicle_db["first"]
    binding = store.upsert_user_original_vehicle_binding(user_id, {
        "vehicle_kind": "van_camper",
        "vehicle_length_ft": None,
        "is_towing": False,
    })
    assert binding["complete"] is False
    assert store.resolve_user_original_vehicle_binding(user_id, binding["binding_id"])["status"] == "vehicle_setup_incomplete"
    assert store.delete_user_original_vehicle_binding(user_id) is True
    assert store.delete_user_original_vehicle_binding(user_id) is False
    assert store.get_user_original_vehicle_binding(user_id) is None


def test_account_deletion_removes_vehicle_binding(vehicle_db):
    user_id = vehicle_db["first"]
    store.upsert_user_original_vehicle_binding(user_id, {
        "vehicle_kind": "passenger",
        "vehicle_length_ft": None,
        "is_towing": False,
    })
    store.delete_user(user_id)
    assert store.get_user_original_vehicle_binding(user_id) is None


def _v2_manifest() -> tuple[dict, dict]:
    candidate = load_operational_candidate()
    operational = manifest_operational_fields(candidate, "foothills_parkway")
    return candidate, {
        "schema_version": 2,
        "manifest_id": "original_smokies_v1",
        "pack_id": "original_smokies",
        "version": 1,
        "chapters": [{
            "id": "foothills_parkway",
            "default_variant_id": "west_to_east",
            "variants": [{"id": "west_to_east"}],
            **operational,
        }],
    }


def _open_observation(candidate: dict) -> dict:
    chapter = next(row for row in candidate["chapters"] if row["chapter_id"] == "foothills_parkway")
    return {
        "candidate_id": candidate["candidate_id"],
        "candidate_sha256": operational_candidate_sha256(candidate),
        "source_id": candidate["shared_rules"]["current_conditions_source_id"],
        "observed_at": NOW_ISO,
        "road_states": {road_id: "open" for road_id in chapter["required_road_ids"]},
    }


def test_v1_original_start_policy_does_not_require_vehicle_binding(monkeypatch):
    manifest = {
        "schema_version": 1,
        "manifest_id": "original_moab_v1",
        "pack_id": "original_moab",
        "version": 1,
    }
    monkeypatch.setattr(
        store,
        "get_published_original_manifest",
        lambda *_args, **_kwargs: copy.deepcopy(manifest),
    )

    result = store.get_published_original_start_readiness(
        "original_moab",
        1,
        chapter_id=None,
        variant_id=None,
    )

    assert result["status"] == "available"
    assert result["can_start"] is True
    assert result["reason_code"] == "legacy_v1_start_policy"


def test_start_readiness_uses_only_current_account_binding(vehicle_db, monkeypatch):
    candidate, manifest = _v2_manifest()
    monkeypatch.setattr(store, "get_published_original_manifest", lambda *_args, **_kwargs: copy.deepcopy(manifest))
    binding = store.upsert_user_original_vehicle_binding(vehicle_db["first"], {
        "vehicle_kind": "passenger",
        "vehicle_length_ft": None,
        "is_towing": False,
    })
    result = store.get_published_original_start_readiness(
        "original_smokies",
        1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user_id=vehicle_db["first"],
        vehicle_binding_id=binding["binding_id"],
        now=NOW,
        observation=_open_observation(candidate),
    )
    assert result["status"] == "available"

    wrong_owner = store.get_published_original_start_readiness(
        "original_smokies",
        1,
        chapter_id="foothills_parkway",
        variant_id="west_to_east",
        user_id=vehicle_db["second"],
        vehicle_binding_id=binding["binding_id"],
        now=NOW,
        observation=_open_observation(candidate),
    )
    assert wrong_owner["status"] == "check_required"
    assert wrong_owner["reason_code"] == "vehicle_setup_required"


def test_authenticated_vehicle_binding_endpoints_and_legacy_class_is_ignored(vehicle_db, monkeypatch):
    current = {"id": vehicle_db["first"], "is_admin": False}
    previous = server.app.dependency_overrides.get(server._current_user)
    server.app.dependency_overrides[server._current_user] = lambda: current
    monkeypatch.setattr(server, "_require_originals_feature", lambda _user: None)
    client = TestClient(server.app)
    try:
        empty = client.get("/api/account/originals/vehicle-binding")
        assert empty.status_code == 200
        assert empty.json() == {"binding": None}

        created = client.put("/api/account/originals/vehicle-binding", json={
            "vehicle_kind": "passenger",
            "vehicle_length_ft": 19,
            "is_towing": False,
        })
        assert created.status_code == 200
        assert created.json()["vehicle_class"] == "passenger"
        assert "make" not in created.json()

        rejected = client.put("/api/account/originals/vehicle-binding", json={
            "vehicle_kind": "passenger",
            "vehicle_length_ft": 19,
            "is_towing": False,
            "make": "Must not leave the device",
        })
        assert rejected.status_code == 422

        captured = {}
        monkeypatch.setattr(
            server,
            "get_published_original_start_readiness",
            lambda *args, **kwargs: captured.update(kwargs) or {
                "schema_version": 1,
                "pack_id": "smokies",
                "version": 1,
                "manifest_id": "manifest",
                "status": "check_required",
                "can_start": False,
                "reason_code": "current_conditions_unavailable",
                "message": "Check again before starting.",
                "notices": [],
            },
        )
        start = client.post(
            "/api/originals/smokies/versions/1/start-readiness",
            json={
                "chapter_id": "foothills_parkway",
                "variant_id": "west_to_east",
                "vehicle_binding_id": created.json()["binding_id"],
                "vehicle_class": "commercial_service",
            },
        )
        assert start.status_code == 200
        assert captured["vehicle_binding_id"] == created.json()["binding_id"]
        assert "vehicle_class" not in captured

        deleted = client.delete("/api/account/originals/vehicle-binding")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}
    finally:
        if previous is None:
            server.app.dependency_overrides.pop(server._current_user, None)
        else:
            server.app.dependency_overrides[server._current_user] = previous
