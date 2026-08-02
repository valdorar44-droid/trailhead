from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b2-r7"
)
REBUILD = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b2-r7-rebuild"
)
BATCH_ID = "post-b08-nps-child-depth-b2"
EXPECTED_DESTINATIONS = {
    "gumo": 36,
    "olym": 35,
    "deva": 34,
    "jotr": 33,
    "romo": 32,
}
EXPECTED_MODULES = {
    "stay": 52,
    "visitor": 22,
    "trails": 42,
    "do": 16,
    "see": 38,
}
EXPECTED_FIXTURE_HASHES = {
    "gumo": "0545405d071cdb64d4b321aab32a97a127d9b6f2ded0a80dc298c074dd6a1500",
    "olym": "80ab3ccfe7f757dce14b2924da7d76882ddaba7853b139f536ed307b244228cb",
    "deva": "6d99181f8c429af29ff0b256746dd5e5ac07e55b798f3fdeb00593c6eb96d6ef",
    "jotr": "fc78aec27742fb22f02433eda04c4314ca30a5f879a4a2cabb990649c9b22d20",
    "romo": "7f3014c31bcb489df826df5c7111917350a4f7d438ef9053891bbeeb28d53ebd",
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


def test_candidate_and_rebuild_are_byte_identical_and_non_promotable():
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
    assert candidate_hashes == rebuild_hashes
    assert set(candidate_hashes) == {
        "audit.json",
        "manifest.json",
        "nps_child_depth_v1.json",
        "review.json",
    }

    manifest = read_json(CANDIDATE / "manifest.json")
    assert manifest["batch_id"] == BATCH_ID
    assert manifest["requests_used"] == 0
    assert manifest["promotion_ready"] is False
    assert manifest["live_catalog_modified"] is False
    assert manifest["live_serving_index_modified"] is False
    assert manifest["inputs"]["base_catalog"]["sha256"] == (
        "462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080"
    )
    assert {
        code: source["sha256"]
        for code, source in manifest["inputs"]["fixtures"].items()
    } == EXPECTED_FIXTURE_HASHES
    for artifact in manifest["artifacts"]:
        path = CANDIDATE / artifact["path"]
        assert artifact["sha256"] == sha256(path)
        assert artifact["bytes"] == path.stat().st_size


def test_candidate_has_expected_grain_modules_freshness_and_media_policy():
    sidecar = read_json(CANDIDATE / "nps_child_depth_v1.json")
    audit = read_json(CANDIDATE / "audit.json")
    review = read_json(CANDIDATE / "review.json")
    places = sidecar["places"]

    assert sidecar["stage"] == "internal"
    assert sidecar["batch_id"] == BATCH_ID
    assert sidecar["count"] == len(places) == 170
    assert audit["passed"] is True
    assert audit["errors"] == []
    assert audit["destination_counts"] == EXPECTED_DESTINATIONS
    assert audit["module_counts"] == EXPECTED_MODULES
    assert audit["media_count"] == 150
    assert review["media_policy"] == {
        "candidate_images": 167,
        "approved_images": 150,
        "stripped_images": 17,
        "policy": "exact cached NPS media with NPS-prefixed credit only",
    }
    assert review["rendered_rail_dedupe"]["dropped_count"] == 1
    assert review["rendered_rail_dedupe"]["records"] == [{
        "parent_hub_id": "place:nps:romo",
        "module_target": "visitor",
        "title": "Beaver Meadows Visitor Center",
        "lat": 40.36623,
        "lng": -105.56097,
        "kept_id": (
            "place:nps-child:romo:visitorcenters:"
            "1fba44b1-ad80-485d-81b9-940fc3c64e0b"
        ),
        "kept_endpoint": "visitorcenters",
        "dropped": [{
            "id": (
                "place:nps-child:romo:places:"
                "1b6cd12f-e6b5-4ea7-b985-3afa22b9ddcc"
            ),
            "endpoint": "places",
        }],
    }]
    assert review["requests_used"] == 0
    assert review["promotion_ready"] is False
    assert all(
        0 <= review["generated_at"] - destination["source_fetched_at"] <= 3 * 86400
        for destination in review["destinations"]
    )

    ids = [place["id"] for place in places]
    title_scopes = [
        (
            place["parent_hub_id"],
            place["source_pack"]["nps_endpoint"],
            " ".join(str(place["name"]).casefold().split()),
        )
        for place in places
    ]
    assert len(ids) == len(set(ids))
    assert len(title_scopes) == len(set(title_scopes))
    assert Counter(place["module_target"] for place in places) == EXPECTED_MODULES

    by_id = {place["id"]: place for place in places}
    assert (
        "place:nps-child:romo:places:1b6cd12f-e6b5-4ea7-b985-3afa22b9ddcc"
        not in by_id
    )
    beach_access = by_id[
        "place:nps-child:olym:places:ca40f87e-3d4b-4ac8-9284-2db8be0e3f9b"
    ]
    assert (beach_access["category"], beach_access["module_target"]) == (
        "trailhead",
        "trails",
    )
    assert "Trailhead" in beach_access["card"]["quick_facts"]
    artists_drive = by_id[
        "place:nps-child:deva:thingstodo:7fe0c782-22f1-40a0-a6b9-9d9a9ce0526a"
    ]
    assert (artists_drive["category"], artists_drive["module_target"]) == (
        "activity",
        "do",
    )
    trail_ridge_road = by_id[
        "place:nps-child:romo:thingstodo:aa3a1f19-2ded-4f4a-8572-55300cfb0685"
    ]
    assert (trail_ridge_road["category"], trail_ridge_road["module_target"]) == (
        "activity",
        "do",
    )

    all_reader_copy = " ".join(
        " ".join(
            str(value or "")
            for value in (
                place.get("name"),
                place.get("summary"),
                place.get("description"),
                (place.get("card") or {}).get("summary"),
                (place.get("card") or {}).get("highlight"),
                (place.get("source_pack") or {}).get("extract"),
            )
        )
        for place in places
    ).casefold()
    for rejected in (
        "kalaloch campround",
        "a.6-mile",
        "a.2-mile",
        "help your plan your trips",
        "what to expect?.",
        "nps.gov/olym/planyourvisit/wic.htm",
        "recreation.gov mobile app",
        "one way(16",
    ):
        assert rejected not in all_reader_copy

    category_contract = {
        "stay": {"campground"},
        "visitor": {"visitor_center"},
        "trails": {"trail", "trailhead"},
        "do": {"activity"},
    }
    for place in places:
        parent_code = place["parent_hub_id"].removeprefix("place:nps:")
        assert parent_code in EXPECTED_DESTINATIONS
        assert place["id"].startswith(f"place:nps-child:{parent_code}:")
        assert place["canonical_role"] == "child"
        assert place["module_target"] in EXPECTED_MODULES
        if place["module_target"] in category_contract:
            assert place["category"] in category_contract[place["module_target"]]
        assert -90 <= float(place["lat"]) <= 90
        assert -180 <= float(place["lng"]) <= 180

        pack = place["source_pack"]
        assert pack["primary"] == "National Park Service"
        assert pack["license"] == "National Park Service public data"
        assert is_https_nps_url(pack["official_url"])
        assert pack["nps_item_id"]
        assert pack["nps_endpoint"] in {
            "campgrounds",
            "visitorcenters",
            "thingstodo",
            "places",
        }
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

        media = place.get("media") or []
        pack_photos = pack.get("photos") or []
        assert [item["url"] for item in media] == [
            item["url"] for item in pack_photos
        ]
        for image in [*media, *pack_photos]:
            assert is_https_nps_url(image["url"])
            assert image["license"] == "National Park Service public data"
            assert image["distribution_status"] == "approved"
            assert image["rights_state"] == "source_terms_reviewed"
            assert image["credit"].casefold().startswith(("nps", "national park service"))
            assert image["rights_evidence"]["source_cache_sha256"]
