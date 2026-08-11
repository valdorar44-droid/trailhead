import hashlib
from pathlib import Path

from db.originals_validation import (
    LEGACY_LONG_FORM_READINESS_PATH,
    LONG_FORM_READINESS_PATH,
    ORIGINAL_LONG_FORM_CHECKED_DELIVERY_EVIDENCE,
    REPO_ROOT,
    trusted_originals_long_form_validator_source_paths,
)
from scripts import build_smokies_long_form_delivery_readiness as builder


ROARING_FORK_KEY = (
    "great_smoky_mountains_ridges_rivers_living_memory",
    "roaring_fork",
    "one_way",
)


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


def test_build_current_binds_the_exact_v2_trusted_source_set():
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
    assert LONG_FORM_READINESS_PATH.as_posix() not in expected_paths
    for relative, expected_sha256 in payload["source_sha256_by_path"].items():
        assert hashlib.sha256((REPO_ROOT / relative).read_bytes()).hexdigest() == (
            expected_sha256
        )


def test_typescript_and_python_v2_readiness_registries_are_aligned():
    source = (
        REPO_ROOT / "mobile/scripts/validate-original-long-form.ts"
    ).read_text(encoding="utf-8")
    key = ":".join(ROARING_FORK_KEY)
    start = source.index(f"'{key}'")
    registry_block = source[start:start + 500]

    assert (
        f"evidence_id: '{builder.CURRENT_LONG_FORM_READINESS_EVIDENCE_ID}'"
        in registry_block
    )
    assert (
        f"readiness_path: '{LONG_FORM_READINESS_PATH.as_posix()}'"
        in registry_block
    )


def test_main_writes_v2_without_touching_v1(monkeypatch, tmp_path, capsys):
    destination = Path("originals/smokies/roaring_fork_delivery_readiness_v2.json")
    legacy = tmp_path / LEGACY_LONG_FORM_READINESS_PATH
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
    assert capsys.readouterr().out.strip() == destination.as_posix()
