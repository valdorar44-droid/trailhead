from __future__ import annotations

import json

from scripts.build_explore_agency_pilots import _reused_generated_at


def test_cached_agency_rebuild_reuses_source_manifest_revision(tmp_path):
    source_dir = tmp_path / "candidate" / "source"
    source_dir.mkdir(parents=True)
    (source_dir.parent / "manifest.json").write_text(json.dumps({"generated_at": 1785553072}))

    assert _reused_generated_at(source_dir) == 1785553072


def test_cached_agency_rebuild_ignores_invalid_source_manifest(tmp_path):
    source_dir = tmp_path / "candidate" / "source"
    source_dir.mkdir(parents=True)
    (source_dir.parent / "manifest.json").write_text("not json")

    assert _reused_generated_at(source_dir) is None
