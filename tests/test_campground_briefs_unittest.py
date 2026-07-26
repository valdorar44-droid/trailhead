"""Unittest discovery bridge for the CampgroundBriefV3 focused contract."""
from __future__ import annotations

import unittest

from tests import test_campground_briefs as contract


class CampgroundBriefV3Tests(unittest.TestCase):
    def test_developed_recreation_brief(self):
        contract.test_developed_recreation_brief_is_free_factual_and_complete()

    def test_dispersed_brief(self):
        contract.test_dispersed_brief_uses_only_listed_access_and_stay_facts()

    def test_nps_brief(self):
        contract.test_nps_brief_preserves_official_source_and_operational_note()

    def test_rv_private_brief(self):
        contract.test_rv_private_brief_keeps_rig_hookup_and_contact_evidence()

    def test_sparse_brief(self):
        contract.test_sparse_brief_is_useful_without_generic_prose_or_invented_facts()

    def test_revision_binding(self):
        contract.test_revision_is_bound_to_source_facts_not_input_list_order()

    def test_free_endpoint(self):
        contract.test_endpoint_resolves_detail_server_side_and_tolerates_service_timeout()


if __name__ == "__main__":
    unittest.main()
