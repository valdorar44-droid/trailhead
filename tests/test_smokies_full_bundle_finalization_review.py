from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

from db import originals_smokies_final_readiness as ready


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "scripts/build_smokies_full_bundle_finalization_review.py"
SPEC = importlib.util.spec_from_file_location(
    "build_smokies_full_bundle_finalization_review", BUILDER_PATH
)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


def _write(path: Path, value: object) -> Path:
    path.write_bytes(ready.canonical_bytes(value))
    return path


def _route() -> dict:
    value = json.loads((
        ROOT / "originals/smokies/official_route_evidence_v1.json"
    ).read_text(encoding="utf-8"))
    value["evidence_id"] = ready.PUBLICATION_ROUTE_EVIDENCE_ID
    value["publication_status"] = "ready_for_publication"
    value["publication_blockers"] = []
    value["publication_review_bindings"] = _review_bindings()
    return value


def _review_bindings() -> dict:
    return {
        "technical_field_drive_evidence_sha256": "1" * 64,
        "source_review_evidence_sha256": "2" * 64,
        "vehicle_source_policy_sha256": ready.OPERATIONAL_POLICY_CANONICAL_SHA256,
    }


def _field() -> dict:
    return {
        "schema_version": 1,
        "kind": builder.FIELD_REVIEW_KIND,
        "status": builder.FIELD_REVIEW_STATUS,
        "product_id": builder.PRODUCT_ID,
        "expected_before_draft_revision": 4,
        "expected_before_manifest_sha256": "a" * 64,
        "content_projection_sha256": builder.CONTENT_PROJECTION_SHA256,
        "review": {
            "editorial_status": "approved",
            "field_drive_completed_at": "2026-08-11T19:00:00Z",
            "source_review_completed_at": "2026-08-11T19:30:00Z",
        },
        "offline_map_estimated_bytes": 213_074_000,
        "publication_review_bindings": _review_bindings(),
        "effects": {
            "database_accessed": False,
            "database_mutated": False,
            "network_accessed": False,
            "provider_accessed": False,
            "provider_mutated": False,
            "publication_performed": False,
            "public_release": False,
        },
    }


def test_real_finalization_inputs_and_output_are_absent_and_check_fails_closed(
    tmp_path: Path,
) -> None:
    assert not ready.SMOKIES_PUBLICATION_ROUTE_EVIDENCE.exists()
    assert not ready.FINALIZATION_REVIEW_PATH.exists()
    result = subprocess.run(
        [
            sys.executable,
            str(BUILDER_PATH),
            "--check",
            "--field-review",
            str(tmp_path / "missing-field.json"),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert json.loads(result.stderr)["status"] == "blocked"
    assert not ready.FINALIZATION_REVIEW_PATH.exists()


def test_exact_review_and_publication_route_build_canonical_cas_input(
    tmp_path: Path,
) -> None:
    field = _write(tmp_path / "field.json", _field())
    route_value = _route()
    route = _write(tmp_path / "route.json", route_value)
    artifact = builder.build(
        field_review_path=field, route_evidence_path=route
    )
    assert artifact["kind"] == ready.FINALIZATION_REVIEW_KIND
    assert artifact["review_id"] == ready.FINALIZATION_REVIEW_ID
    assert artifact["status"] == "field_drive_and_source_review_complete"
    assert artifact["route_evidence"]["evidence_id"] == (
        ready.PUBLICATION_ROUTE_EVIDENCE_ID
    )
    assert artifact["effects"]["database_mutated"] is False
    assert ready.canonical_bytes(artifact).endswith(b"\n")


@pytest.mark.parametrize(
    "mutate_field,mutate_route",
    [
        (lambda value: value.update(status="blocked"), None),
        (lambda value: value["review"].update(editorial_status="pending"), None),
        (lambda value: value.update(offline_map_estimated_bytes=0), None),
        (lambda value: value.update(offline_map_estimated_bytes=213_074_001), None),
        (lambda value: value["publication_review_bindings"].update(
            technical_field_drive_evidence_sha256="0" * 64
        ), None),
        (lambda value: value["publication_review_bindings"].update(
            vehicle_source_policy_sha256="0" * 64
        ), None),
        (lambda value: value["effects"].update(database_accessed=True), None),
        (None, lambda value: value.update(publication_status="blocked")),
        (None, lambda value: value.update(publication_blockers=["road"])),
        (None, lambda value: value.update(product_id="other")),
        (None, lambda value: value.update(evidence_id="historical-route-id")),
        (None, lambda value: value.update(unreviewed_extension=True)),
        (None, lambda value: value.pop("source_supplement_sha256")),
        (None, lambda value: value["publication_review_bindings"].update(
            arbitrary_policy_sha256="3" * 64
        )),
        (None, lambda value: value["source_policy"].update(
            geometry_authority="caller_selected"
        )),
        (None, lambda value: value["variants"][0]["geometry"].update(
            coordinates=[]
        )),
        (None, lambda value: value["publication_review_bindings"].update(
            source_review_evidence_sha256="0" * 64
        )),
    ],
)
def test_builder_rejects_blocked_drifted_or_effectful_sources(
    tmp_path: Path,
    mutate_field,
    mutate_route,
) -> None:
    field_value = _field()
    route_value = _route()
    if mutate_field:
        mutate_field(field_value)
    if mutate_route:
        mutate_route(route_value)
    field = _write(tmp_path / "field.json", field_value)
    route = _write(tmp_path / "route.json", route_value)
    with pytest.raises(builder.FinalizationReviewBuildError):
        builder.build(field_review_path=field, route_evidence_path=route)


def test_builder_does_not_mutate_sources_or_historical_route(tmp_path: Path) -> None:
    historical = ROOT / "originals/smokies/official_route_evidence_v1.json"
    historical_before = historical.read_bytes()
    field = _write(tmp_path / "field.json", _field())
    route = _write(tmp_path / "route.json", _route())
    field_before = field.read_bytes()
    route_before = route.read_bytes()
    builder.build(field_review_path=field, route_evidence_path=route)
    assert field.read_bytes() == field_before
    assert route.read_bytes() == route_before
    assert historical.read_bytes() == historical_before
