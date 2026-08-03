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
    BATCH_5_EXACT_OMISSIONS,
    BATCH_5_EXPECTED_BOOKING_COUNT,
    BATCH_5_EXPECTED_CAMPGROUND_MEDIA_COUNT,
    BATCH_5_EXPECTED_CANONICAL_CAMP_INDEX_HASH,
    BATCH_5_EXPECTED_CANONICAL_CAMPGROUND_COUNT,
    BATCH_5_EXPECTED_CATEGORY_COUNTS,
    BATCH_5_EXPECTED_DESTINATION_COUNTS,
    BATCH_5_EXPECTED_FIXTURE_HASHES,
    BATCH_5_EXPECTED_LINK_ACTIONS,
    BATCH_5_EXPECTED_MEDIA_COUNTS,
    BATCH_5_EXPECTED_MODULE_COUNTS,
    BATCH_5_EXPECTED_OFFICIAL_URL_COUNT,
    BATCH_5_EXPECTED_ORDERED_ID_HASH,
    BATCH_5_EXPECTED_PARENT_FALLBACKS,
    BATCH_5_EXPECTED_TEXT_ONLY_IDS,
    BATCH_5_ID,
    ROOT,
    _require_sha256,
)


CANDIDATE = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b09-nps-child-depth-b5-r1"
)
REBUILD = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b09-nps-child-depth-b5-r1-rebuild"
)
EXPECTED_ARTIFACT_HASHES = {
    "audit.json": "d86d58c6b0f236297d3f606a1a053e61f25fe82c2ac69f0e4a339f4a84b70296",
    "manifest.json": "d9f7ed993c23051fb53e9bf47392c057fda8fed2833f4923e2a3aeea23054150",
    "nps_child_depth_v1.json": "e3c4d0763d3a2be8d84d462dc3f892a444cb98781eea0d4227dc1b1b3b2fa0da",
    "review.json": "8029b3434db17daf361d353a5c1c5148977921b7faffce8cf400c90ddfb052be",
}
EXPECTED_CLASSIFICATIONS = {
    "place:nps-child:care:places:1e1eae1a-c9cc-47d3-b317-c05c7e4d2abd": (
        "historic_site",
        "see",
    ),
    "place:nps-child:care:places:c052fb2d-afe5-443d-a936-ed78254e09b8": (
        "place",
        "see",
    ),
    "place:nps-child:care:places:51a87cd1-7811-439d-bc9d-0a3f9eea1516": (
        "place",
        "see",
    ),
    "place:nps-child:care:places:366f19d7-8798-46a1-be26-1b2854f9342a": (
        "historic_site",
        "see",
    ),
    "place:nps-child:grsa:thingstodo:03f03bbe-0241-4fee-8d61-d37def7f1e7e": (
        "activity",
        "do",
    ),
    "place:nps-child:grsa:places:27f7b028-5769-4e8b-a99d-8104e2aa7714": (
        "place",
        "see",
    ),
    "place:nps-child:crla:places:1c9c5103-fef8-42c3-ad68-e9304c1a7957": (
        "trail",
        "trails",
    ),
    "place:nps-child:crla:places:564e673f-25d4-4792-8456-3c41e12a44e5": (
        "lodging",
        "stay",
    ),
    "place:nps-child:crla:places:f96cecc2-b803-4d23-bffa-3e471a2e3afd": (
        "place",
        "visitor",
    ),
    "place:nps-child:crla:places:3bb07ae5-93fe-4f5d-b34b-63526f51122e": (
        "place",
        "see",
    ),
    "place:nps-child:crla:places:ac7f2003-372d-401f-9006-d587f4653b98": (
        "viewpoint",
        "see",
    ),
    "place:nps-child:crla:places:96b29dbf-05c0-4933-9a23-908a5a1e6200": (
        "trail",
        "trails",
    ),
    "place:nps-child:amis:places:93cb38f8-0d17-4326-901b-362dddbf6609": (
        "place",
        "see",
    ),
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


def visible_copy(place: dict) -> str:
    card = place.get("card") or {}
    pack = place.get("source_pack") or {}
    return " ".join(
        str(value or "")
        for value in (
            place.get("name"),
            place.get("summary"),
            place.get("description"),
            card.get("summary"),
            card.get("highlight"),
            pack.get("extract"),
        )
    )


def test_candidate_and_rebuild_are_byte_identical_and_inputs_are_pinned():
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
    assert manifest["batch_id"] == BATCH_5_ID
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
    assert manifest["inputs"]["canonical_camp_index"]["sha256"] == (
        BATCH_5_EXPECTED_CANONICAL_CAMP_INDEX_HASH
    )
    assert {
        code: source["sha256"]
        for code, source in manifest["inputs"]["fixtures"].items()
    } == BATCH_5_EXPECTED_FIXTURE_HASHES
    for artifact in manifest["artifacts"]:
        path = CANDIDATE / artifact["path"]
        assert artifact["sha256"] == sha256(path)
        assert artifact["bytes"] == path.stat().st_size


def test_candidate_has_fixed_grain_modules_links_media_and_clean_copy():
    sidecar = read_json(CANDIDATE / "nps_child_depth_v1.json")
    audit = read_json(CANDIDATE / "audit.json")
    review = read_json(CANDIDATE / "review.json")
    places = sidecar["places"]

    assert sidecar["stage"] == "internal"
    assert sidecar["batch_id"] == BATCH_5_ID
    assert sidecar["count"] == len(places) == 70
    assert audit["passed"] is True
    assert audit["errors"] == []
    assert audit["destination_counts"] == BATCH_5_EXPECTED_DESTINATION_COUNTS
    assert audit["module_counts"] == BATCH_5_EXPECTED_MODULE_COUNTS
    assert audit["media_count"] == BATCH_5_EXPECTED_MEDIA_COUNTS["approved_images"]
    assert review["reader_link_actions"] == BATCH_5_EXPECTED_LINK_ACTIONS
    assert review["media_policy"] == {
        **BATCH_5_EXPECTED_MEDIA_COUNTS,
        "policy": "exact cached NPS media with NPS-prefixed credit only",
    }

    ids = [place["id"] for place in places]
    assert len(ids) == len(set(ids))
    assert hashlib.sha256(("\n".join(ids) + "\n").encode()).hexdigest() == (
        BATCH_5_EXPECTED_ORDERED_ID_HASH
    )
    assert Counter(place["module_target"] for place in places) == (
        BATCH_5_EXPECTED_MODULE_COUNTS
    )
    assert Counter(place["category"] for place in places) == (
        BATCH_5_EXPECTED_CATEGORY_COUNTS
    )
    assert {place["id"] for place in places if not (place.get("media") or [])} == (
        BATCH_5_EXPECTED_TEXT_ONLY_IDS
    )

    by_id = {place["id"]: place for place in places}
    assert {
        place_id: (by_id[place_id]["category"], by_id[place_id]["module_target"])
        for place_id in EXPECTED_CLASSIFICATIONS
    } == EXPECTED_CLASSIFICATIONS
    assert set(BATCH_5_EXPECTED_PARENT_FALLBACKS) <= set(by_id)
    assert {
        row["place_id"]: row["official_url"]
        for row in review["parent_page_source_fallbacks"]
    } == BATCH_5_EXPECTED_PARENT_FALLBACKS
    assert all(
        0 <= int(sidecar["generated_at"]) - int(row["source_fetched_at"]) <= 259_200
        for row in review["destinations"]
    )
    assert review["rendered_rail_dedupe"]["dropped_count"] == 0
    assert review["semantic_dedupe"]["dropped_count"] == 0
    assert review["shared_coordinate_review"] == []

    for place in places:
        assert place["canonical_role"] == "child"
        assert place["parent_hub_id"].removeprefix("place:nps:") in (
            BATCH_5_EXPECTED_DESTINATION_COUNTS
        )
        assert -90 <= float(place["lat"]) <= 90
        assert -180 <= float(place["lng"]) <= 180
        pack = place["source_pack"]
        assert pack["primary"] == "National Park Service"
        assert pack["license"] == "National Park Service public data"
        assert is_https_nps_url(pack["official_url"])
        assert pack["nps_item_id"]
        text = visible_copy(place)
        assert not FORBIDDEN_READER_COPY.search(text)
        assert "http://" not in text.casefold()
        assert "https://" not in text.casefold()
        assert "_Transparent Border_" not in text
        assert "rarely fills" not in text.casefold()
        for image in [*(place.get("media") or []), *(pack.get("photos") or [])]:
            assert is_https_nps_url(image["url"])
            assert image["license"] == "National Park Service public data"
            assert image["distribution_status"] == "approved"
            assert image["rights_state"] == "source_terms_reviewed"
            assert image["credit"].casefold().startswith(
                ("nps", "national park service")
            )
            assert image["rights_evidence"]["source_cache_sha256"]


def test_canonical_campground_shadows_preserve_identity_booking_and_media():
    places = read_json(CANDIDATE / "nps_child_depth_v1.json")["places"]
    review = read_json(CANDIDATE / "review.json")
    camps = [
        place
        for place in places
        if place["id"].startswith("place:nps:campgrounds:")
    ]
    assert len(camps) == BATCH_5_EXPECTED_CANONICAL_CAMPGROUND_COUNT
    assert not any(":campgrounds:" in place["id"] and "nps-child" in place["id"] for place in places)
    assert sum(bool(place.get("reservation_url")) for place in camps) == (
        BATCH_5_EXPECTED_BOOKING_COUNT
    )
    assert sum(bool(place.get("official_url")) for place in camps) == (
        BATCH_5_EXPECTED_OFFICIAL_URL_COUNT
    )
    assert sum(bool(place.get("media")) for place in camps) == (
        BATCH_5_EXPECTED_CAMPGROUND_MEDIA_COUNT
    )

    for camp in camps:
        reference = camp["canonical_reference"]
        suffix = camp["id"].removeprefix("place:nps:campgrounds:")
        assert reference["canonical_id"] == camp["id"]
        assert reference["source_child_id"].endswith(f":campgrounds:{suffix}")
        assert camp["module_target"] == "stay"
        if camp.get("reservation_url"):
            parsed = urlsplit(camp["reservation_url"])
            assert parsed.scheme == "https"
            assert (parsed.hostname or "").casefold().endswith("recreation.gov")
            assert camp["reservable"] is True
            assert camp["reservations"]["url"] == camp["reservation_url"]
            assert camp["source_pack"]["booking_url"] == camp["reservation_url"]

    by_id = {camp["id"]: camp for camp in camps}
    shadow_rows = review["canonical_campground_shadows"]
    assert len(shadow_rows) == len(camps)
    assert {row["canonical_id"] for row in shadow_rows} == set(by_id)
    for row in shadow_rows:
        camp = by_id[row["canonical_id"]]
        assert row["source_child_id"] == camp["canonical_reference"]["source_child_id"]
        assert row["parent_hub_id"] == camp["parent_hub_id"]
        assert row["module_target"] == "stay"
        assert row["official_url"] == (
            camp.get("official_url") or camp["source_pack"].get("official_url")
        )
        assert row["reservation_url"] == str(camp.get("reservation_url") or "")
        assert row["reservable"] is (camp.get("reservable") is True)
        assert row["media_count"] == len(camp.get("media") or [])

    permit_urls = [
        camp["reservation_url"]
        for camp in camps
        if "/permits/" in str(camp.get("reservation_url") or "")
    ]
    assert permit_urls == ["https://www.recreation.gov/permits/4675316"]


def test_proof_activity_copy_and_exact_omission_are_reader_safe():
    places = read_json(CANDIDATE / "nps_child_depth_v1.json")["places"]
    review = read_json(CANDIDATE / "review.json")
    by_id = {place["id"]: place for place in places}
    proof_id = (
        "place:nps-child:grsa:thingstodo:"
        "df98997d-01fc-4016-a90c-53dbc7faae4d"
    )
    proof = by_id[proof_id]
    assert proof["name"] == "Sandboarding and Sand Sledding"
    assert (proof["category"], proof["module_target"]) == ("activity", "do")
    assert proof["source_pack"]["official_url"] == (
        "https://www.nps.gov/thingstodo/sandboarding-and-sand-sledding.htm"
    )
    assert proof["media"]
    assert "Purpose-built sandboards or sand sleds work best on dry sand" in (
        proof["summary"]
    )
    assert "go off-site" not in visible_copy(proof).casefold()

    omitted_id = next(iter(BATCH_5_EXACT_OMISSIONS))
    assert omitted_id not in by_id
    assert {
        row["place_id"]: row["reason"]
        for row in review["exact_omissions"]
    } == BATCH_5_EXACT_OMISSIONS

    all_copy = " ".join(visible_copy(place) for place in places)
    for rejected in (
        "www.recreation.gov",
        "Recreation.gov Mobile App",
        "skilIs",
        "Wizard Island. and",
        "is offers three meals",
        "_Transparent Border_",
    ):
        assert rejected not in all_copy


def test_input_hash_guard_fails_closed():
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp) / "pinned.json"
        source.write_text('{"revision":1}\n')
        expected = sha256(source)
        _require_sha256(source, expected, "synthetic pinned input")
        source.write_text('{"revision":2}\n')
        with pytest.raises(ValueError, match="synthetic pinned input hash mismatch"):
            _require_sha256(source, expected, "synthetic pinned input")
