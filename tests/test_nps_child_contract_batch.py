from __future__ import annotations

import hashlib
import json
import re
from argparse import Namespace
from collections import Counter
from pathlib import Path

import pytest

from scripts.promote_explore_public_release import (
    PromotionError,
    _load_dispositions,
)
from scripts.build_nps_child_depth_batch import CONTRACT_BATCH_ID, build


ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b08-nps-child-contract-r1"
)
REBUILD = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b08-nps-child-contract-r1-determinism"
)
BASE_RELEASE = ROOT / "dashboard/explore_releases/explore-b08-child-depth-v1"
IDENTITY_LOCK = (
    ROOT
    / "tests/fixtures/explore_sources/nps_child_contract_r1_identity.json"
)
EXPECTED_HASHES = {
    "audit.json": "01e7953e0ac50b51f047872661dd4cb97fe23c82be772c7dcb50ae070674f639",
    "child_dispositions.json": "4dc8a35e56774df88fdd2ca0aa557b8f76f91be8b73311784251d9a302591518",
    "manifest.json": "89ba6376343c593f978d05061eef47bcd9aac8bae23b0de428286bd562032e6d",
    "nps_child_contract_v1.json": "a4a6db4becb705d43351e820c7a61f8bb335dde4244a19adfcce1c384ad0046a",
    "review.json": "9166f08cd27aa7f141ea4f460795c891328bb978dd85dced47c8b1cdab3bcdc8",
}
EXPECTED_IDENTITY_HASHES = {
    "legacy": "8a6dd528b262654e97a4b98625aeb3b1f4a6d77c96bc1fd27f9d6d8052ee33e4",
    "new": "d94ee87a0ca79e476297e44d7cb2f4224599b28749ffcae9ab90c2ede631bc0c",
    "combined": "fc6ea5fc19cf4ec1b3f794902502e0a30dbc6380ff9fb7cfd5eba9dfa94b6524",
}
EXPECTED_MODULES = {"see": 112, "do": 45, "stay": 49, "visitor": 31}
EXPECTED_DESTINATIONS = {
    "acad": 32,
    "grsm": 39,
    "grte": 34,
    "grba": 31,
    "badl": 18,
    "arch": 19,
    "cany": 25,
    "glca": 39,
}
ENDPOINT_IDENTITY = {
    "places": ("things_to_see", "see"),
    "thingstodo": ("things_to_do", "do"),
    "campgrounds": ("campgrounds", "stay"),
    "visitorcenters": ("visitor_centers", "visitor"),
}
FORBIDDEN_COPY = re.compile(
    r"\b(?:artificial intelligence|provider slug|check local rules|"
    r"description not available|lorem ipsum|generated summary)\b",
    re.IGNORECASE,
)
LOCAL_AUDIT_READY = all(
    path.is_dir() and (path / "manifest.json").is_file()
    for path in (CANDIDATE, REBUILD)
)
requires_local_audit = pytest.mark.skipif(
    not LOCAL_AUDIT_READY,
    reason="ignored local Explore audit artifacts are not present",
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_sha256(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def candidate_files(path: Path) -> dict[str, str]:
    return {
        item.name: sha256(item)
        for item in sorted(path.iterdir())
        if item.is_file()
    }


def test_tracked_identity_lock_reproduces_contract_scope_from_clean_checkout():
    identity_lock = read_json(IDENTITY_LOCK)
    base_manifest = read_json(BASE_RELEASE / "manifest.json")
    base_catalog = read_json(BASE_RELEASE / "explore_catalog_v3.json")
    base_index = read_json(BASE_RELEASE / "explore_serving_index_v2.json")

    assert identity_lock["schema"] == "ExploreNpsChildIdentityLockV1"
    assert identity_lock["schema_version"] == 1
    assert identity_lock["contract_id"] == CONTRACT_BATCH_ID

    release_public_ids = {
        str(row.get("public_id") or "").strip()
        for row in base_manifest.get("child_dispositions") or []
        if isinstance(row, dict) and str(row.get("public_id") or "").strip()
    }
    legacy_places = sorted(
        (
            place
            for place in base_catalog["places"]
            if place.get("parent_hub_id")
            and not (place.get("source_pack") or {}).get("nps_endpoint")
        ),
        key=lambda place: str(place.get("id") or ""),
    )
    legacy_by_release_rule = sorted(
        (
            place
            for place in base_catalog["places"]
            if place.get("canonical_role") == "child"
            and str(place.get("id") or "") not in release_public_ids
        ),
        key=lambda place: str(place.get("id") or ""),
    )
    legacy_ids = [str(place["id"]) for place in legacy_places]
    assert legacy_ids == [str(place["id"]) for place in legacy_by_release_rule]
    assert len(legacy_ids) == 157

    new_identity_rows = []
    candidate_ids = []
    for pair in identity_lock["new_candidates"]:
        assert isinstance(pair, list) and len(pair) == 2
        canonical_id, title = pair
        parts = str(canonical_id).split(":", 4)
        assert len(parts) == 5 and parts[:2] == ["place", "nps-child"]
        park_code, endpoint, source_id = parts[2], parts[3], parts[4]
        source_key, module_target = ENDPOINT_IDENTITY[endpoint]
        assert source_id and str(title).strip()
        candidate_ids.append(str(canonical_id))
        new_identity_rows.append({
            "park_code": park_code,
            "module_target": module_target,
            "source_key": source_key,
            # NPS UUIDs are uppercase in the accepted normalized rails; the
            # durable Trailhead canonical ID deliberately case-folds them.
            "source_id": source_id.upper(),
            "title": str(title),
        })

    assert len(new_identity_rows) == 237
    assert len(candidate_ids) == len(set(candidate_ids))
    assert Counter(row["module_target"] for row in new_identity_rows) == EXPECTED_MODULES
    assert Counter(row["park_code"] for row in new_identity_rows) == EXPECTED_DESTINATIONS
    assert not set(candidate_ids).intersection(
        str(place.get("id") or "") for place in base_catalog["places"]
    )

    title_scopes = Counter(
        (row["park_code"], row["title"].casefold())
        for row in new_identity_rows
    )
    assert [scope for scope, count in title_scopes.items() if count > 1] == [
        ("acad", "acadia gateway center")
    ]

    identity_hashes = {
        "legacy": canonical_sha256(legacy_ids),
        "new": canonical_sha256(new_identity_rows),
        "combined": canonical_sha256({
            "legacy_ids": legacy_ids,
            "new_candidates": new_identity_rows,
        }),
    }
    assert identity_hashes == EXPECTED_IDENTITY_HASHES

    served_ids = {
        str(item.get("id") or "")
        for item in base_index["items"]
        if isinstance(item, dict)
    }
    served_legacy = sum(place_id in served_ids for place_id in legacy_ids)
    assert served_legacy == 145
    assert len(legacy_ids) - served_legacy == 12


@requires_local_audit
def test_contract_and_rebuild_are_byte_identical_and_internal_only():
    assert candidate_files(CANDIDATE) == candidate_files(REBUILD) == EXPECTED_HASHES
    manifest = read_json(CANDIDATE / "manifest.json")
    assert manifest["schema"] == "ExploreNpsChildContractManifestV1"
    assert manifest["stage"] == "internal"
    assert manifest["requests_used"] == 0
    assert manifest["promotion_ready"] is False
    assert manifest["public_promotion_compatible"] is False
    assert manifest["live_catalog_modified"] is False
    assert manifest["live_serving_index_modified"] is False
    assert manifest["identity_hashes"] == EXPECTED_IDENTITY_HASHES
    assert manifest["inputs"]["base_manifest"]["sha256"] == (
        "79b3a7df32c02376a8e7322bd5c6f53ba417694fb01eb5ceb3afe1d5bb2c77c6"
    )
    assert manifest["inputs"]["base_catalog"]["sha256"] == (
        "23f15894e46e381ccbd6df28baa8df0e018844876c68112c5872509211095f06"
    )
    assert manifest["inputs"]["base_index"]["sha256"] == (
        "1773805d38537f74c6656165305a86595bb39d53a3e694c328a82ce4f33061ba"
    )
    assert manifest["inputs"]["normalized_nps_catalog"]["sha256"] == (
        "8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80"
    )
    for artifact in manifest["artifacts"]:
        path = CANDIDATE / artifact["path"]
        assert artifact["sha256"] == sha256(path)
        assert artifact["bytes"] == path.stat().st_size


@requires_local_audit
def test_contract_has_exact_157_plus_237_scope_and_source_authority():
    dispositions = read_json(CANDIDATE / "child_dispositions.json")
    contract = read_json(CANDIDATE / "nps_child_contract_v1.json")
    review = read_json(CANDIDATE / "review.json")
    rows = dispositions["rows"]
    legacy = [row for row in rows if row["contract_kind"] == "legacy_normalization"]
    new = [row for row in rows if row["contract_kind"] == "new_candidate"]

    assert dispositions["count"] == len(rows) == 394
    assert len(legacy) == 157
    assert len(new) == 237
    assert dispositions["identity_hashes"] == EXPECTED_IDENTITY_HASHES
    assert Counter(row["module_target"] for row in new) == EXPECTED_MODULES
    assert Counter(row["parent_hub_id"].rsplit(":", 1)[-1] for row in new) == (
        EXPECTED_DESTINATIONS
    )
    assert len({row["source_identity"] for row in new}) == 237
    assert len({row["candidate_id"] for row in new}) == 237
    assert len({row["proposed_canonical_id"] for row in legacy}) == 157
    assert sum(row["served_in_base_index"] for row in legacy) == 145
    assert sum(not row["served_in_base_index"] for row in legacy) == 12
    assert sum(
        row["module_target"] == "do" and row["parent_hub_id"] == "place:nps:grte"
        for row in new
    ) == 6

    assert contract["selection_rule"]["authority"] == (
        "accepted normalized b09 source_pack rails"
    )
    assert contract["selection_rule"]["raw_cache_role"] == (
        "provenance and media-rights evidence only"
    )
    assert contract["counts"] == {
        "legacy_aliases": 157,
        "new_candidate_dispositions": 237,
        "materialized_places": 236,
        "merged_duplicates": 1,
    }
    assert review["counts"]["module_counts"] == EXPECTED_MODULES
    assert review["counts"]["destination_counts"] == EXPECTED_DESTINATIONS


@requires_local_audit
def test_duplicate_copy_media_and_reader_url_reviews_are_explicit():
    dispositions = read_json(CANDIDATE / "child_dispositions.json")
    contract = read_json(CANDIDATE / "nps_child_contract_v1.json")
    review = read_json(CANDIDATE / "review.json")
    rows = dispositions["rows"]
    places = contract["places"]
    by_id = {place["id"]: place for place in places}

    merged = [row for row in rows if row["contract_action"] == "merge_duplicate_candidate"]
    assert len(merged) == 1
    assert merged[0]["candidate_id"].endswith(
        ":places:bea85a63-0ce1-42b6-b429-88c68fb55a30"
    )
    assert merged[0]["merge_target_id"].endswith(
        ":visitorcenters:99b33fa9-2579-415c-b2c7-2a29879744f8"
    )
    assert review["duplicate_title_review"]["distance_meters"] < 100
    assert len(review["missing_description"]) == 49
    assert len(review["missing_media"]) == 6
    assert len(review["media_rights_excluded"]) == 47
    assert review["counts"]["materialized_source_media"] == 230
    assert review["counts"]["approved_media"] == 183
    assert review["counts"]["visible_copy_overrides"] == 3
    assert {
        row["name"] for row in review["visible_copy_overrides"]
    } == {
        "Antelope Point RV Park",
        "Bullfrog RV & Campground",
        "Wahweap Campground & RV Park",
    }

    for missing in review["missing_description"]:
        place = by_id.get(missing["candidate_id"])
        if place is not None:
            assert place["summary"] == ""
            assert place["description"] == ""
            assert place["card"]["summary"] == ""
    for place in places:
        visible = " ".join(
            str(value or "")
            for value in (
                place.get("name"),
                place.get("summary"),
                place.get("description"),
                place.get("card", {}).get("summary"),
                place.get("source_pack", {}).get("extract"),
            )
        )
        assert not FORBIDDEN_COPY.search(visible)
        assert not re.search(r"https?://|\bwww\.", visible, re.IGNORECASE)
        assert not re.search(
            r"https?://|\bwww\.",
            str(place.get("search_blob") or ""),
            re.IGNORECASE,
        )
        for image in place.get("media") or []:
            assert image["distribution_status"] == "approved"
            assert image["rights_state"] == "source_terms_reviewed"
            assert image["rights_evidence"]["source_cache_sha256"]

    url_reviews = review["reader_url_reviews"]
    assert len(url_reviews) == 13
    assert sum(row["host"] != "nps.gov" for row in url_reviews) == 11
    assert {row["host"] for row in url_reviews} == {
        "nps.gov",
        "www.mainetourism.com",
        "www.fws.gov",
        "antelopepointlakepowell.com",
        "www.pay.gov",
        "www.lakepowell.com",
        "www.blm.gov",
        "www.canyonconservancy.org",
    }
    assert review["legacy_normalized_rail_exceptions"] == [{
        "existing_id": "place:nps-child:yell:thingstodo:fountain-freight-road-bike-trail",
        "name": "Fountain Freight Road Bike Trail",
        "source_identity": "nps:item:65a41109-1b30-444b-9fef-d45b669eeb33",
        "reason": "Raw cached source remains valid but is absent from the normalized parent rail.",
    }]


@requires_local_audit
def test_contract_cannot_be_loaded_as_public_promotion_dispositions():
    with pytest.raises(PromotionError):
        _load_dispositions(CANDIDATE / "child_dispositions.json")


def test_contract_output_is_immutable_and_rejects_non_audit_paths(tmp_path: Path):
    existing_output = (
        tmp_path / "data/explore/audit_candidates/internal/already-built"
    )
    existing_output.mkdir(parents=True)
    common = {
        "batch_id": CONTRACT_BATCH_ID,
        "base_catalog": str(BASE_RELEASE / "explore_catalog_v3.json"),
        "base_index": str(BASE_RELEASE / "explore_serving_index_v2.json"),
        # These existing paths are sufficient because both output guards run
        # before pinned-input parsing. No ignored local source cache is needed.
        "normalized_nps_catalog": str(BASE_RELEASE / "explore_catalog_v3.json"),
        "source_cache": str(ROOT),
    }
    with pytest.raises(FileExistsError, match="already exists"):
        build(Namespace(**common, out_dir=str(existing_output)))
    with pytest.raises(ValueError, match="audit_candidates/internal"):
        build(Namespace(**common, out_dir=str(tmp_path / "dashboard")))


def test_accepted_public_inputs_remain_exactly_unchanged():
    assert sha256(BASE_RELEASE / "manifest.json") == (
        "79b3a7df32c02376a8e7322bd5c6f53ba417694fb01eb5ceb3afe1d5bb2c77c6"
    )
    assert sha256(BASE_RELEASE / "explore_catalog_v3.json") == (
        "23f15894e46e381ccbd6df28baa8df0e018844876c68112c5872509211095f06"
    )
    assert sha256(BASE_RELEASE / "explore_serving_index_v2.json") == (
        "1773805d38537f74c6656165305a86595bb39d53a3e694c328a82ce4f33061ba"
    )
    public_catalog = read_json(BASE_RELEASE / "explore_catalog_v3.json")
    assert sum(
        place.get("canonical_role") == "child"
        for place in public_catalog["places"]
    ) == 608
