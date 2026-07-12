from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from scripts.data.audit_explore_filter_coverage import (
    DEFAULT_ARTIFACT,
    DEFAULT_CONTRACT,
    DEFAULT_DISPLAY,
    DEFAULT_SERVER,
    ExploreFilterCoverageError,
    audit_files,
    audit_payload,
    usable_items,
    visible_filter_keys,
)
from scripts.data.build_canonical_serving_indexes import explore_filter_coverage


class ExploreFilterCoverageContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads(DEFAULT_ARTIFACT.read_text())
        cls.contract = json.loads(DEFAULT_CONTRACT.read_text())
        cls.visible_keys = visible_filter_keys(DEFAULT_DISPLAY.read_text())
        cls.server_source = DEFAULT_SERVER.read_text()

    def test_tracked_artifact_covers_every_visible_filter(self):
        report = audit_files(DEFAULT_ARTIFACT, DEFAULT_CONTRACT, DEFAULT_DISPLAY, DEFAULT_SERVER)

        self.assertGreater(report["indexed_counts"]["springs"], 0)
        self.assertEqual(set(report["dynamic_filters"]), {"fuel", "guided", "resupply"})
        self.assertEqual(report["dynamic_filters"]["fuel"]["endpoint"], "/api/places/nearby")
        self.assertEqual(report["dynamic_filters"]["guided"]["endpoint"], "/api/explore/experiences")

    def test_uncovered_visible_filter_fails_the_contract(self):
        payload = copy.deepcopy(self.payload)
        payload["items"] = [item for item in payload["items"] if item.get("category") != "hot_spring"]
        payload["filter_counts"], payload["missing_filters"] = explore_filter_coverage(usable_items(payload))

        with self.assertRaisesRegex(ExploreFilterCoverageError, "springs.*zero usable"):
            audit_payload(
                payload,
                visible_keys=self.visible_keys,
                contract=self.contract,
                server_source=self.server_source,
            )

    def test_dynamic_allowlist_requires_a_real_declared_endpoint(self):
        contract = copy.deepcopy(self.contract)
        contract["dynamic_filters"]["fuel"]["endpoint"] = "/api/not-a-real-route"

        with self.assertRaisesRegex(ExploreFilterCoverageError, "fuel.*undeclared live endpoint"):
            audit_payload(
                self.payload,
                visible_keys=self.visible_keys,
                contract=contract,
                server_source=self.server_source,
            )

    def test_fixture_like_service_nodes_are_not_promoted(self):
        served_ids = {item.get("id") for item in self.payload["items"]}

        self.assertNotIn("place:osm:node-2004", served_ids)
        self.assertNotIn("place:osm:node-2006", served_ids)


if __name__ == "__main__":
    unittest.main()
