import copy
import json
from pathlib import Path

import pytest

from db.originals_route_evidence import (
    OriginalRouteEvidenceError,
    canonical_sha256,
    load_registered_route_evidence,
    normalize_route_evidence_binding,
    validate_manifest_route_evidence,
)


ROOT = Path(__file__).resolve().parents[1]


def _ready_contract() -> tuple[dict, dict, dict]:
    geometry = {
        "type": "LineString",
        "coordinates": [[-83.9, 35.6], [-83.8, 35.7]],
    }
    evidence = {
        "schema_version": 1,
        "kind": "trailhead_original_official_route_evidence",
        "product_id": "test_product",
        "publication_status": "ready_for_publication",
        "publication_blockers": [],
        "route_spec_sha256": "a" * 64,
        "source_snapshot_sha256": "b" * 64,
        "source_policy": {
            "geometry_authority": "nps_public_roads",
            "license": "us-pd",
            "mapbox_candidate_geometry_persisted": False,
        },
        "variants": [{
            "chapter_id": "chapter_one",
            "variant_id": "forward",
            "status": "official_geometry_candidate",
            "geometry_ready_for_editorial_cues": True,
            "blocking_issues": [],
            "geometry": geometry,
            "geometry_sha256": canonical_sha256(geometry),
            "distance_m": 1234.5,
        }],
    }
    binding = {
        "schema_version": 1,
        "evidence_id": "test-evidence-v1",
        "evidence_sha256": canonical_sha256(evidence),
        "product_id": "test_product",
        "route_spec_sha256": "a" * 64,
        "source_snapshot_sha256": "b" * 64,
    }
    manifest = {
        "pack_id": "test_product",
        "chapters": [{
            "id": "chapter_one",
            "variants": [{
                "id": "forward",
                "route": {"geometry": geometry, "distance_m": 1234.5},
            }],
        }],
    }
    return manifest, binding, evidence


def test_checked_in_smokies_evidence_is_registered_by_exact_canonical_hash():
    evidence = load_registered_route_evidence("smokies-official-routes-2026-v1")
    checked_in = json.loads((
        ROOT / "originals" / "smokies" / "official_route_evidence_v1.json"
    ).read_text(encoding="utf-8"))
    assert evidence == checked_in
    assert canonical_sha256(evidence) == (
        "95f199551ac949b081f0a8a55d46e0bf261987b211be08835f93387258844159"
    )


def test_checked_in_smokies_multi_agency_source_policy_is_supported_when_ready():
    evidence = copy.deepcopy(
        load_registered_route_evidence("smokies-official-routes-2026-v1")
    )
    evidence["publication_status"] = "ready_for_publication"
    evidence["publication_blockers"] = []
    chapters: dict[str, list[dict]] = {}
    for variant in evidence["variants"]:
        chapters.setdefault(variant["chapter_id"], []).append({
            "id": variant["variant_id"],
            "route": {
                "geometry": copy.deepcopy(variant["geometry"]),
                "distance_m": variant["distance_m"],
            },
        })
    manifest = {
        "pack_id": evidence["product_id"],
        "chapters": [
            {"id": chapter_id, "variants": variants}
            for chapter_id, variants in sorted(chapters.items())
        ],
    }
    binding = {
        "schema_version": 1,
        "evidence_id": "smokies-official-routes-2026-v1",
        "evidence_sha256": canonical_sha256(evidence),
        "product_id": evidence["product_id"],
        "route_spec_sha256": evidence["route_spec_sha256"],
        "source_snapshot_sha256": evidence["source_snapshot_sha256"],
    }
    verified = validate_manifest_route_evidence(
        manifest,
        binding,
        expected_product_id=manifest["pack_id"],
        evidence_document=evidence,
    )
    assert len(verified["variants"]) == 6


def test_ready_route_evidence_binds_exact_geometry_and_distance():
    manifest, binding, evidence = _ready_contract()
    result = validate_manifest_route_evidence(
        manifest,
        binding,
        expected_product_id=manifest["pack_id"],
        evidence_document=evidence,
    )
    assert result["variants"] == [{
        "chapter_id": "chapter_one",
        "variant_id": "forward",
        "geometry_sha256": evidence["variants"][0]["geometry_sha256"],
    }]


def test_route_evidence_rejects_geometry_tampering():
    manifest, binding, evidence = _ready_contract()
    manifest["chapters"][0]["variants"][0]["route"]["geometry"] = {
        "type": "LineString",
        "coordinates": [[-83.9, 35.6], [-83.7, 35.8]],
    }
    with pytest.raises(OriginalRouteEvidenceError, match="does not match official evidence"):
        validate_manifest_route_evidence(
            manifest, binding, evidence_document=evidence,
        )


def test_route_evidence_rejects_blocked_and_partial_variant_sets():
    manifest, binding, evidence = _ready_contract()
    blocked = copy.deepcopy(evidence)
    blocked["variants"][0].update({
        "status": "blocked_source_review",
        "geometry_ready_for_editorial_cues": False,
        "blocking_issues": ["source_gap"],
    })
    binding["evidence_sha256"] = canonical_sha256(blocked)
    with pytest.raises(OriginalRouteEvidenceError, match="source blockers"):
        validate_manifest_route_evidence(
            manifest, binding, evidence_document=blocked,
        )
    manifest["chapters"][0]["variants"].append({
        "id": "reverse",
        "route": manifest["chapters"][0]["variants"][0]["route"],
    })
    binding["evidence_sha256"] = canonical_sha256(evidence)
    with pytest.raises(OriginalRouteEvidenceError, match="exact chapter variants"):
        validate_manifest_route_evidence(
            manifest, binding, evidence_document=evidence,
        )


def test_route_evidence_rejects_root_blockers_and_cross_product_reuse():
    manifest, binding, evidence = _ready_contract()
    blocked = copy.deepcopy(evidence)
    blocked["publication_status"] = "blocked"
    blocked["publication_blockers"] = ["editorial_review"]
    binding["evidence_sha256"] = canonical_sha256(blocked)
    with pytest.raises(OriginalRouteEvidenceError, match="not ready"):
        validate_manifest_route_evidence(
            manifest,
            binding,
            expected_product_id=manifest["pack_id"],
            evidence_document=blocked,
        )

    binding["evidence_sha256"] = canonical_sha256(evidence)
    with pytest.raises(OriginalRouteEvidenceError, match="authored pack"):
        validate_manifest_route_evidence(
            manifest,
            binding,
            expected_product_id="another_product",
            evidence_document=evidence,
        )


def test_route_evidence_binding_is_strict_and_publication_required():
    _, binding, _ = _ready_contract()
    assert normalize_route_evidence_binding(binding, required=True) == binding
    invalid = dict(binding, admin_override=True)
    with pytest.raises(OriginalRouteEvidenceError, match="unsupported fields"):
        normalize_route_evidence_binding(invalid, required=True)
    with pytest.raises(OriginalRouteEvidenceError, match="requires server-owned"):
        normalize_route_evidence_binding(None, required=True)
