import hashlib
import json
from pathlib import Path
import subprocess

from db.originals_validation import (
    LEGACY_LONG_FORM_READINESS_PATH,
    LONG_FORM_READINESS_PATH,
    ORIGINAL_LONG_FORM_CHECKED_DELIVERY_EVIDENCE,
    REPO_ROOT,
    V2_LONG_FORM_READINESS_PATH,
    trusted_originals_long_form_validator_source_paths,
)
from scripts import build_smokies_long_form_delivery_readiness as builder


ROARING_FORK_KEY = (
    "great_smoky_mountains_ridges_rivers_living_memory",
    "roaring_fork",
    "one_way",
)
HISTORICAL_SOURCE_COMMIT = "102fff55328f4d15ec5757f82f87d235508ebb2b"


def test_build_preserves_the_hash_pinned_v1_characterization_contract():
    path = REPO_ROOT / LEGACY_LONG_FORM_READINESS_PATH
    raw = path.read_bytes()

    assert hashlib.sha256(raw).hexdigest() == (
        builder.LEGACY_LONG_FORM_READINESS_SHA256
    )
    assert builder.build()["evidence_id"] == (
        builder.LEGACY_LONG_FORM_READINESS_EVIDENCE_ID
    )
    assert builder.serialize(builder.build()).encode("utf-8") == raw


def test_build_v2_preserves_the_hash_pinned_trusted_validation_contract():
    path = REPO_ROOT / V2_LONG_FORM_READINESS_PATH
    raw = path.read_bytes()

    assert hashlib.sha256(raw).hexdigest() == builder.V2_LONG_FORM_READINESS_SHA256
    assert builder.build_v2()["evidence_id"] == (
        builder.V2_LONG_FORM_READINESS_EVIDENCE_ID
    )
    assert builder.serialize(builder.build_v2()).encode("utf-8") == raw


def test_build_current_binds_the_exact_v3_trusted_source_set():
    payload = builder.build_current()
    registry = ORIGINAL_LONG_FORM_CHECKED_DELIVERY_EVIDENCE[ROARING_FORK_KEY]
    expected_paths = {
        relative.as_posix()
        for relative in trusted_originals_long_form_validator_source_paths()
        if relative != LONG_FORM_READINESS_PATH
    }

    assert registry == {
        "evidence_id": builder.CURRENT_LONG_FORM_READINESS_EVIDENCE_ID,
        "artifact_path": builder.LONG_FORM_PREFLIGHT_PATH,
        "readiness_path": LONG_FORM_READINESS_PATH,
    }
    assert payload["evidence_id"] == registry["evidence_id"]
    assert set(payload["source_sha256_by_path"]) == expected_paths
    assert LEGACY_LONG_FORM_READINESS_PATH.as_posix() in expected_paths
    assert V2_LONG_FORM_READINESS_PATH.as_posix() in expected_paths
    assert LONG_FORM_READINESS_PATH.as_posix() not in expected_paths
    assert {
        "dashboard/server.py",
        "db/originals_cultural_review.py",
        "originals/smokies/smokies_public_record_scope_determination_v1.json",
    }.issubset(expected_paths)
    for relative, expected_sha256 in payload["source_sha256_by_path"].items():
        assert hashlib.sha256((REPO_ROOT / relative).read_bytes()).hexdigest() == (
            expected_sha256
        )


def test_checked_v3_artifact_is_the_byte_exact_historical_snapshot():
    raw = (REPO_ROOT / LONG_FORM_READINESS_PATH).read_bytes()
    checked = json.loads(raw)

    assert hashlib.sha256(raw).hexdigest() == (
        "423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01"
    )
    assert builder.serialize(builder.build_current()).encode("utf-8") != raw
    for relative, expected_sha256 in checked["source_sha256_by_path"].items():
        historical = subprocess.run(
            ["git", "cat-file", "blob", f"{HISTORICAL_SOURCE_COMMIT}:{relative}"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        ).stdout
        assert hashlib.sha256(historical).hexdigest() == expected_sha256


def test_v3_preserves_the_exact_v2_preflight_and_delivery_semantics():
    payload = builder.build_current()
    v2 = builder.build_v2()
    preflight = json.loads(
        (REPO_ROOT / builder.LONG_FORM_PREFLIGHT_PATH).read_text(encoding="utf-8")
    )

    assert payload["preflight_sha256"] == v2["preflight_sha256"]
    assert payload["delivery_semantics_sha256"] == v2["delivery_semantics_sha256"]
    assert payload["stopped_availability_radius_m_by_id"] == (
        v2["stopped_availability_radius_m_by_id"]
    )
    assert payload["gates"] == v2["gates"]
    assert preflight["delivery_summary"]["entry_count"] == 13
    assert len(preflight["entries"]) == 13


def test_typescript_and_python_v3_readiness_registries_are_aligned():
    source = (
        REPO_ROOT / "mobile/lib/originals/longFormValidationEvidence.ts"
    ).read_text(encoding="utf-8")
    registry_block = source[source.index("kind: 'roaring_fork'"):]

    assert (
        "preflight_sha256: 'b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3'"
        in registry_block[:800]
    )
    assert (
        f"readiness_path: '{LONG_FORM_READINESS_PATH.as_posix()}'"
        in registry_block[:800]
    )
    assert (
        "readiness_sha256: '423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01'"
        in registry_block[:800]
    )


def test_main_writes_v3_without_touching_v1_or_v2(monkeypatch, tmp_path, capsys):
    destination = Path("originals/smokies/roaring_fork_delivery_readiness_v3.json")
    legacy = tmp_path / LEGACY_LONG_FORM_READINESS_PATH
    v2 = tmp_path / V2_LONG_FORM_READINESS_PATH
    expected = {"evidence_id": builder.CURRENT_LONG_FORM_READINESS_EVIDENCE_ID}
    (tmp_path / destination.parent).mkdir(parents=True)

    monkeypatch.setattr(builder, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(builder, "LONG_FORM_READINESS_PATH", destination)
    monkeypatch.setattr(builder, "build_current", lambda: expected)

    builder.main()

    assert (tmp_path / destination).read_text(encoding="utf-8") == (
        builder.serialize(expected)
    )
    assert not legacy.exists()
    assert not v2.exists()
    assert capsys.readouterr().out.strip() == destination.as_posix()
