from __future__ import annotations

import hashlib
import json
import re
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from scripts.build_nps_child_depth_batch import (
    BATCH_4_EXPECTED_CATEGORY_COUNTS,
    BATCH_4_EXPECTED_DESTINATION_COUNTS,
    BATCH_4_EXPECTED_FIXTURE_HASHES,
    BATCH_4_EXPECTED_LINK_ACTIONS,
    BATCH_4_EXPECTED_MEDIA_COUNTS,
    BATCH_4_EXPECTED_MODULE_COUNTS,
    BATCH_4_EXPECTED_PARENT_FALLBACKS,
    BATCH_4_EXPECTED_TEXT_ONLY_IDS,
    BATCH_4_ID,
    BATCH_4_SHARED_COORDINATE_REVIEWS,
    ROOT,
    _require_sha256,
)


CANDIDATE = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b09-nps-child-depth-b4-r2"
)
REBUILD = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b09-nps-child-depth-b4-r2-rebuild"
)
EXPECTED_ARTIFACT_HASHES = {
    "audit.json": "1e29aa4f1b9e149aaf2d1b0ad61793ce636c1242525f8f560c80b56a592d07e2",
    "manifest.json": "a2c8c0b91f36f88ccf80c08f76ca5b7357fa0f445622a9939c4da55d71a52f4f",
    "nps_child_depth_v1.json": "bff4dbe3fae5a984083c366aa7711e2766bad2c220c71f49367f2d4a1aea247f",
    "review.json": "60ccad3f4bf56f0664a53e4e1c54b175fc664f9dcbc75f629994fedc7cf48e99",
}
EXPECTED_CLASSIFICATIONS = {
    "place:nps-child:hosp:places:a6b52836-b617-442d-9989-b8d800fd1b6a": ("historic_site", "see"),
    "place:nps-child:hosp:places:b265fcd3-ebc5-4591-aa37-83d87d53810d": ("hot_spring", "see"),
    "place:nps-child:hosp:places:85ed0ad4-51e0-4abd-a779-03d1ee687432": ("hot_spring", "see"),
    "place:nps-child:hosp:places:84810559-561e-48c1-9586-b8c6ddc3436f": ("hot_spring", "see"),
    "place:nps-child:hosp:places:8dfd3a3b-3983-4431-813e-bbe26ead7850": ("hot_spring", "see"),
    "place:nps-child:hosp:places:a0aba175-0403-4fbe-9d5c-3979fccecfa1": ("viewpoint", "see"),
    "place:nps-child:hosp:places:4459aac0-dd80-4974-9ec9-9ff090c0c4d9": ("place", "see"),
    "place:nps-child:hosp:places:1fc9879f-2f96-4faa-8ed0-e68691f502af": ("historic_site", "see"),
    "place:nps-child:hosp:places:491647e9-c5f5-4f1a-b6f8-9388830a4139": ("place", "see"),
    "place:nps-child:hove:places:c955bfee-8c04-4499-8433-fad3a665ed13": ("viewpoint", "see"),
    "place:nps-child:indu:places:1557d73e-4ad4-487e-9eb1-4f9b29c48ab6": ("historic_site", "see"),
    "place:nps-child:indu:places:3714878f-a334-4317-b529-cac78ab7ceea": ("trail", "trails"),
    "place:nps-child:indu:places:d31f52b6-a23a-4308-a9d9-17e6f85910c9": ("historic_site", "see"),
    "place:nps-child:indu:places:a438b359-fab9-4d1a-aa38-8e9958436a40": ("trailhead", "trails"),
    "place:nps-child:indu:places:1e256355-708c-47c4-8988-6543e4c267b4": ("trailhead", "trails"),
    "place:nps-child:joda:places:454636a0-765d-45fd-96bb-530c1fd56040": ("historic_site", "see"),
    "place:nps-child:joda:places:601a772e-441c-4b77-a60b-9b9882bfc9ea": ("historic_site", "see"),
    "place:nps-child:joda:places:ad26286d-5f16-4273-adeb-72c201ef13d0": ("historic_site", "see"),
}
FORBIDDEN_READER_COPY = re.compile(
    r"\b(?:artificial intelligence|provider slug|check local rules|"
    r"verify current|description not available|lorem ipsum|generated summary)\b",
    re.IGNORECASE,
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def is_https_nps_url(value: object) -> bool:
    parsed = urlsplit(str(value or "").strip())
    host = (parsed.hostname or "").casefold().rstrip(".")
    return (
        parsed.scheme == "https"
        and bool(parsed.path)
        and (host == "nps.gov" or host.endswith(".nps.gov"))
    )


def test_candidate_and_rebuild_are_byte_identical_and_pinned():
    candidate_hashes = {
        path.name: sha256(path)
        for path in sorted(CANDIDATE.iterdir())
        if path.is_file()
    }
    rebuild_hashes = {
        path.name: sha256(path)
        for path in sorted(REBUILD.iterdir())
        if path.is_file()
    }
    assert candidate_hashes == rebuild_hashes == EXPECTED_ARTIFACT_HASHES

    manifest = read_json(CANDIDATE / "manifest.json")
    assert manifest["batch_id"] == BATCH_4_ID
    assert manifest["requests_used"] == 0
    assert manifest["promotion_ready"] is False
    assert manifest["live_catalog_modified"] is False
    assert manifest["live_serving_index_modified"] is False
    assert manifest["inputs"]["base_catalog"]["sha256"] == (
        "462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080"
    )
    assert manifest["inputs"]["normalized_nps_catalog"]["sha256"] == (
        "8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80"
    )
    assert {
        code: source["sha256"]
        for code, source in manifest["inputs"]["fixtures"].items()
    } == BATCH_4_EXPECTED_FIXTURE_HASHES
    for artifact in manifest["artifacts"]:
        path = CANDIDATE / artifact["path"]
        assert artifact["sha256"] == sha256(path)
        assert artifact["bytes"] == path.stat().st_size


def test_candidate_has_expected_grain_modules_links_and_media_rights():
    sidecar = read_json(CANDIDATE / "nps_child_depth_v1.json")
    audit = read_json(CANDIDATE / "audit.json")
    review = read_json(CANDIDATE / "review.json")
    places = sidecar["places"]

    assert sidecar["stage"] == "internal"
    assert sidecar["batch_id"] == BATCH_4_ID
    assert sidecar["count"] == len(places) == 97
    assert audit["passed"] is True
    assert audit["errors"] == []
    assert audit["destination_counts"] == BATCH_4_EXPECTED_DESTINATION_COUNTS
    assert audit["module_counts"] == BATCH_4_EXPECTED_MODULE_COUNTS
    assert audit["media_count"] == BATCH_4_EXPECTED_MEDIA_COUNTS["approved_images"]
    assert review["reader_link_actions"] == BATCH_4_EXPECTED_LINK_ACTIONS
    assert review["media_policy"] == {
        **BATCH_4_EXPECTED_MEDIA_COUNTS,
        "policy": "exact cached NPS media with NPS-prefixed credit only",
    }

    ids = [place["id"] for place in places]
    assert len(ids) == len(set(ids))
    assert Counter(place["module_target"] for place in places) == (
        BATCH_4_EXPECTED_MODULE_COUNTS
    )
    assert Counter(place["category"] for place in places) == (
        BATCH_4_EXPECTED_CATEGORY_COUNTS
    )
    by_id = {place["id"]: place for place in places}
    assert {
        place_id: (by_id[place_id]["category"], by_id[place_id]["module_target"])
        for place_id in EXPECTED_CLASSIFICATIONS
    } == EXPECTED_CLASSIFICATIONS
    assert {
        place["id"] for place in places if not (place.get("media") or [])
    } == BATCH_4_EXPECTED_TEXT_ONLY_IDS
    for place in places:
        assert place["canonical_role"] == "child"
        assert place["parent_hub_id"].removeprefix("place:nps:") in (
            BATCH_4_EXPECTED_DESTINATION_COUNTS
        )
        assert -90 <= float(place["lat"]) <= 90
        assert -180 <= float(place["lng"]) <= 180
        pack = place["source_pack"]
        assert pack["primary"] == "National Park Service"
        assert pack["license"] == "National Park Service public data"
        assert is_https_nps_url(pack["official_url"])
        assert pack["nps_item_id"]
        visible_copy = " ".join(
            str(value or "")
            for value in (
                place.get("name"),
                place.get("summary"),
                place.get("description"),
                (place.get("card") or {}).get("summary"),
                pack.get("extract"),
            )
        )
        assert not FORBIDDEN_READER_COPY.search(visible_copy)
        assert "http://" not in visible_copy.casefold()
        assert "https://" not in visible_copy.casefold()
        for image in [*(place.get("media") or []), *(pack.get("photos") or [])]:
            assert is_https_nps_url(image["url"])
            assert image["license"] == "National Park Service public data"
            assert image["distribution_status"] == "approved"
            assert image["rights_state"] == "source_terms_reviewed"
            assert image["credit"].casefold().startswith(
                ("nps", "national park service")
            )
            assert image["rights_evidence"]["source_cache_sha256"]


def test_reviewed_copy_repairs_are_reader_clean():
    places = read_json(CANDIDATE / "nps_child_depth_v1.json")["places"]
    by_id = {place["id"]: place for place in places}
    repaired_ids = {
        "place:nps-child:jeca:places:0f7d5a9f-4314-40d3-b90d-0717091ccb44",
        "place:nps-child:joda:places:454636a0-765d-45fd-96bb-530c1fd56040",
        "place:nps-child:joda:places:f7c3ca79-21e3-4fe3-85fe-0b9ab75609af",
        "place:nps-child:joda:places:3d1494a4-e076-4068-930f-a3fa1b6af1f2",
        "place:nps-child:joda:places:ebc06523-8699-4840-928a-6a84fb179391",
        "place:nps-child:joda:places:ad26286d-5f16-4273-adeb-72c201ef13d0",
    }
    for place_id in repaired_ids:
        assert ".. . " not in by_id[place_id]["description"]
    square_tower = by_id[
        "place:nps-child:hove:places:d8a6cfaf-0aba-4041-b226-27d77f93f7ed"
    ]
    visible = " ".join((square_tower["summary"], square_tower["description"]))
    assert "This tall, this tower" not in visible
    assert "craftmanship" not in visible
    assert "This tall tower" in visible
    assert "craftsmanship" in visible


def test_reviewed_parent_fallback_https_and_coordinate_decisions_are_fixed():
    sidecar = read_json(CANDIDATE / "nps_child_depth_v1.json")
    review = read_json(CANDIDATE / "review.json")
    by_id = {place["id"]: place for place in sidecar["places"]}

    actual_fallbacks = {
        item["place_id"]: item["official_url"]
        for item in review["parent_page_source_fallbacks"]
    }
    assert actual_fallbacks == BATCH_4_EXPECTED_PARENT_FALLBACKS
    for place_id, expected_url in BATCH_4_EXPECTED_PARENT_FALLBACKS.items():
        assert by_id[place_id]["source_pack"]["official_url"] == expected_url

    assert by_id[
        "place:nps-child:indu:visitorcenters:1a1935e8-7043-44a9-89d1-017c6b929321"
    ]["source_pack"]["official_url"] == (
        "https://www.nps.gov/indu/planyourvisit/idnlvc.htm"
    )
    assert by_id[
        "place:nps-child:indu:visitorcenters:af24dad9-0425-4259-a050-d3eacad69ef1"
    ]["source_pack"]["official_url"] == (
        "https://www.nps.gov/indu/planyourvisit/deec.htm"
    )

    actual_reviews = {
        tuple(item["place_ids"]): item["decision"]
        for item in review["shared_coordinate_review"]
    }
    assert actual_reviews == {
        place_ids: "keep_distinct"
        for place_ids in BATCH_4_SHARED_COORDINATE_REVIEWS
    }


def test_candidate_is_mounted_once_and_does_not_overlap_public_dispositions():
    candidate_ids_in_order = [
        place["id"]
        for place in read_json(CANDIDATE / "nps_child_depth_v1.json")["places"]
    ]
    candidate_ids = set(candidate_ids_in_order)
    preview = read_json(ROOT / "dashboard/explore_internal_preview_v1.json")
    preview_ids_in_order = [
        str(place.get("id") or "")
        for place in (preview.get("children") or preview.get("places") or [])
    ]
    batch_ids = [
        str(binding.get("batch_id") or "")
        for binding in preview["candidate"]["nps_child_depth_batches"]
    ]
    dispositions = read_json(
        ROOT
        / "config/explore_public_releases/b08-child-depth-v1/child_dispositions.json"
    )
    rows = dispositions.get("child_dispositions") or dispositions
    disposition_ids = {
        str(row.get("public_id") or row.get("id") or "")
        for row in rows
    }

    assert batch_ids == [
        "post-b08-nps-child-depth-b1",
        "post-b08-nps-child-depth-b2",
        "post-b08-nps-child-depth-b3",
        BATCH_4_ID,
    ]
    assert preview_ids_in_order[457:554] == candidate_ids_in_order
    assert all(preview_ids_in_order.count(place_id) == 1 for place_id in candidate_ids)
    assert candidate_ids.isdisjoint(disposition_ids)


def test_input_hash_guard_is_clean_checkout_safe_and_fails_closed():
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp) / "pinned.json"
        source.write_text('{"revision":1}\n')
        expected = sha256(source)
        _require_sha256(source, expected, "synthetic pinned input")
        source.write_text('{"revision":2}\n')
        with pytest.raises(ValueError, match="synthetic pinned input hash mismatch"):
            _require_sha256(source, expected, "synthetic pinned input")
