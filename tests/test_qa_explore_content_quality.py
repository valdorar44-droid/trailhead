from __future__ import annotations

import json

from scripts.qa_explore_content_quality import audit_catalog


def test_audit_accepts_sourced_child_when_weak_copy_is_omitted(tmp_path):
    catalog = tmp_path / "candidate.json"
    catalog.write_text(json.dumps({
        "schema_version": 3,
        "places": [{
            "id": "place:usfs:forest",
            "name": "Example National Forest",
            "category": "forest",
            "lat": 37.2,
            "lng": -119.2,
            "description": "Official recreation information for this national forest.",
            "sources": [{"source": "usfs", "url": "https://www.fs.usda.gov/"}],
            "source_pack": {
                "official_url": "https://www.fs.usda.gov/",
                "trails": [{
                    "source_id": "trail:usfs:example",
                    "title": "Example Trail",
                    "description": "Example Trail",
                    "lat": 37.21,
                    "lng": -119.21,
                    "url": "https://www.fs.usda.gov/",
                }],
                "events": [{
                    "source_id": "event:nps:holiday",
                    "title": "Park Open - New Year's Day",
                    "description": "The park will be open normal operating hours on New Year's Day.",
                    "kind": "event",
                    "category": "Regular Program",
                    "url": "https://www.nps.gov/",
                }],
            },
        }],
    }))

    failures, _warnings = audit_catalog(catalog, sample_limit=5)

    assert failures == []


def test_audit_accepts_facts_only_place_without_generic_description(tmp_path):
    catalog = tmp_path / "facts-only.json"
    catalog.write_text(json.dumps({
        "schema_version": 3,
        "places": [{
            "id": "place:usfs:visitor-center",
            "name": "Bass Lake Recreation Office Info Site",
            "category": "visitor_center",
            "lat": 37.2,
            "lng": -119.2,
            "description": "Bass Lake Recreation Office Info Site/fee Station",
            "sources": [{"source": "usfs", "url": "https://www.fs.usda.gov/"}],
            "source_pack": {
                "official_url": "https://www.fs.usda.gov/",
                "operating_season": ["All year"],
                "people_capacity": 35,
                "restrooms": "Vault toilets",
            },
        }],
    }))

    failures, _warnings = audit_catalog(catalog, sample_limit=5)

    assert failures == []
