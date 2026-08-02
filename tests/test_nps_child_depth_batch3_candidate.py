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
    / "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b3-r5"
)
REBUILD = (
    ROOT
    / "data/explore/audit_candidates/internal/post-b08-nps-child-depth-b3-r5-rebuild"
)
BATCH_ID = "post-b08-nps-child-depth-b3"
EXPECTED_DESTINATIONS = {
    "bibe": 30,
    "ever": 27,
    "cuva": 21,
    "havo": 25,
    "buff": 28,
}
EXPECTED_MODULES = {
    "stay": 20,
    "visitor": 17,
    "do": 13,
    "trails": 52,
    "see": 29,
}
EXPECTED_FIXTURE_HASHES = {
    "bibe": "fe9aac8ce5049f1cc1a00551cc10ccf5bc2ac9253839045e05f68dd05e42a66d",
    "ever": "f2b8fe33083fb19c30cecf45010567635d458df37eeca49cd5ee3db7046bc783",
    "cuva": "575005f160ad7d4417477d88f6ff19f7f3596c01b83bf142f3ce5021bfe6c6bc",
    "havo": "818a748b14a25b7aa4efeb35624b61076d4bcbba79c7bd15b354bb06b7a62985",
    "buff": "91e27db7598fa1202e03e2152215545ef0f614afccc13c748f95802891499baf",
}
EXPECTED_PARENT_FALLBACKS = {
    "place:nps-child:ever:campgrounds:4f5128ad-453f-4b40-91f0-388fd662d110": (
        "https://www.nps.gov/ever/index.htm"
    ),
    "place:nps-child:cuva:visitorcenters:aed09a89-ca84-4cae-9949-9591688b05fc": (
        "https://www.nps.gov/cuva/index.htm"
    ),
    "place:nps-child:cuva:visitorcenters:18c3cbc0-556a-4e4f-8486-16723df55255": (
        "https://www.nps.gov/cuva/index.htm"
    ),
    "place:nps-child:cuva:visitorcenters:e92ea080-1dab-47c5-b8c5-4a21533a6fe0": (
        "https://www.nps.gov/cuva/index.htm"
    ),
    "place:nps-child:havo:visitorcenters:7fb37395-4782-401e-997d-88b13870f7c9": (
        "https://www.nps.gov/havo/index.htm"
    ),
    "place:nps-child:buff:campgrounds:739ce881-991f-42ce-885b-3f0410d82ed5": (
        "https://www.nps.gov/buff/index.htm"
    ),
    "place:nps-child:buff:campgrounds:b94fe8b9-2ef1-4464-a2e1-5803c9ae7648": (
        "https://www.nps.gov/buff/index.htm"
    ),
    "place:nps-child:buff:visitorcenters:9e702f42-1153-4c94-8c88-e2d802a13df1": (
        "https://www.nps.gov/buff/index.htm"
    ),
    "place:nps-child:buff:visitorcenters:230e3359-63ab-474b-a11c-d2726f1a1fc9": (
        "https://www.nps.gov/buff/index.htm"
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
    assert candidate_hashes == {
        "audit.json": "d811752e6975efd16a4327567340b9c8dcfff2c87130fb3729d982d77dad47a6",
        "manifest.json": "565cd7db018ae5f0f7b550b50fd4fade8dd821ae823b91c1719056c63d2fdad4",
        "nps_child_depth_v1.json": "db4f0b94bcde127a903f4db9c1ef91b43d98149c72e016c2b47b8a0ce051ced5",
        "review.json": "7ae2871be90b5e628e4a719202c45e700eaeb842e8451cbe20cc4893c687d348",
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


def test_candidate_has_expected_grain_modules_sources_and_media_policy():
    sidecar = read_json(CANDIDATE / "nps_child_depth_v1.json")
    audit = read_json(CANDIDATE / "audit.json")
    review = read_json(CANDIDATE / "review.json")
    places = sidecar["places"]

    assert sidecar["stage"] == "internal"
    assert sidecar["batch_id"] == BATCH_ID
    assert sidecar["count"] == len(places) == 131
    assert audit["passed"] is True
    assert audit["errors"] == []
    assert audit["destination_counts"] == EXPECTED_DESTINATIONS
    assert audit["module_counts"] == EXPECTED_MODULES
    assert audit["media_count"] == 111
    assert review["media_policy"] == {
        "candidate_images": 131,
        "approved_images": 111,
        "stripped_images": 20,
        "policy": "exact cached NPS media with NPS-prefixed credit only",
    }
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
            assert image["credit"].casefold().startswith(
                ("nps", "national park service")
            )
            assert image["rights_evidence"]["source_cache_sha256"]


def test_reviewed_identity_classification_copy_and_fallback_decisions_are_fixed():
    sidecar = read_json(CANDIDATE / "nps_child_depth_v1.json")
    review = read_json(CANDIDATE / "review.json")
    by_id = {place["id"]: place for place in sidecar["places"]}

    kept_devastation = (
        "place:nps-child:havo:places:7696444d-7626-4fa5-b2c0-d0ab15951dda"
    )
    dropped_devastation = (
        "place:nps-child:havo:thingstodo:c59589f9-5f4b-4629-8655-58384e69bc60"
    )
    assert kept_devastation in by_id
    assert dropped_devastation not in by_id
    assert by_id[kept_devastation]["category"] == "trailhead"
    assert len(by_id[kept_devastation]["media"]) == 1
    semantic = review["semantic_dedupe"]
    assert semantic["dropped_count"] == 1
    assert semantic["records"][0]["kept_id"] == kept_devastation
    assert semantic["records"][0]["dropped"] == [{
        "id": dropped_devastation,
        "endpoint": "thingstodo",
        "media_count": 1,
    }]

    expected_classifications = {
        "place:nps-child:ever:places:e3910ef1-d4c4-4c0f-83ab-0b7b779d8800": (
            "campground", "stay"
        ),
        "place:nps-child:cuva:places:517b46dd-0301-433b-ac54-8a0068930f29": (
            "historic_site", "see"
        ),
        "place:nps-child:havo:thingstodo:4fd7dae2-2a35-406e-8017-99a698cdaade": (
            "activity", "do"
        ),
        "place:nps-child:buff:places:2b86b851-d041-4772-88f8-3683c4771012": (
            "historic_site", "see"
        ),
    }
    for place_id, expected in expected_classifications.items():
        assert (by_id[place_id]["category"], by_id[place_id]["module_target"]) == expected
        quick_facts = {
            str(value).casefold()
            for value in (by_id[place_id].get("card") or {}).get("quick_facts") or []
        }
        assert "lake" not in quick_facts

    reader_copy = " ".join(
        " ".join(
            str(place.get(key) or "")
            for key in ("name", "summary", "description")
        )
        for place in sidecar["places"]
    )
    for rejected in (
        "accessible.2 miles trail",
        "accessible .2 miles trail",
        "This.25 mile to 1.5 mile trail",
        "This .25 mile to 1.5 mile trail",
        "www.recreation.gov",
        "historic, mining, landscape",
        "begin your. Backcountry",
        "hisotry",
        "opportunitys",
        "1200meters",
        "This trial is 7.5 miles",
        "years.Today",
    ):
        assert rejected not in reader_copy

    fallbacks = review["parent_page_source_fallbacks"]
    assert len(fallbacks) == 9
    assert review["reader_link_actions"]["used_parent_nps_url"] == 9
    assert {
        item["place_id"]: item["official_url"]
        for item in fallbacks
    } == EXPECTED_PARENT_FALLBACKS
    assert all(item["reason"].startswith("The cached official child record") for item in fallbacks)

    coordinate_review = review["shared_coordinate_review"]
    assert len(coordinate_review) == 5
    assert all(item["decision"] == "keep_distinct" for item in coordinate_review)
    assert all(len(item["place_ids"]) == 2 for item in coordinate_review)
    assert len({tuple(item["place_ids"]) for item in coordinate_review}) == 5
