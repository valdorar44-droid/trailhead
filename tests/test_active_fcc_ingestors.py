import unittest

from ingestors import active, fcc, ridb


class ActiveIngestorTests(unittest.TestCase):
    def test_active_campground_xml_normalizes_photo_and_handoff(self):
        xml = """
        <resultset>
          <result facilityID="123" facilityName="Aspen Group Camp" latitude="39.1" longitude="-105.2" facilityPhoto="/photos/details/aspen.jpg">
            <description>Group tent sites with pets allowed and electric hookups.</description>
          </result>
        </resultset>
        """

        records = active.parse_campground_xml(xml)
        normalized = active.normalize_campground(records[0], 39.0, -105.0)

        self.assertEqual(normalized["id"], "active_camp:123")
        self.assertEqual(normalized["name"], "Aspen Group Camp")
        self.assertEqual(normalized["photo_url"], "http://www.reserveamerica.com/photos/details/aspen.jpg")
        self.assertEqual(normalized["photo_status"], "facility")
        self.assertIn("group", normalized["tags"])
        self.assertIn("ACTIVE", normalized["source_badge"])
        self.assertIn("Checkout", normalized["reservation_notes"])

    def test_active_activity_json_normalizes_event_fields(self):
        long_description = "This is a 3-day field science event. " * 40
        payload = {
            "results": [
                {
                    "assetGuid": "a1",
                    "assetName": "Guided Night Hike",
                    "latitude": "40.0",
                    "longitude": "-111.0",
                    "activityStartDate": "2026-07-01T19:00:00",
                    "registrationUrlAdr": "https://active.example/register",
                    "price": "$15",
                    "description": long_description,
                    "programDescription": "Bring water, layers, and lunch each day.",
                }
            ]
        }

        records = active.parse_activity_json(payload)
        normalized = active.normalize_activity(records[0], 40.1, -111.1)

        self.assertEqual(normalized["id"], "active_activity:a1")
        self.assertEqual(normalized["type"], "event")
        self.assertEqual(normalized["price"], "$15")
        self.assertEqual(normalized["registration_url"], "https://active.example/register")
        self.assertEqual(normalized["source_label"], "ACTIVE")
        self.assertTrue(normalized["description"].startswith("This is a 3-day"))
        self.assertIn("Bring water", normalized["details"])
        self.assertLessEqual(len(normalized["summary"]), 420)

    def test_ridb_historic_provider_notice_is_demoted_from_description(self):
        description, notices = ridb.split_historic_provider_notices(
            "ATTENTION: Campground closed first week of December 2020 for maintenance. Current sites are along the Colorado River.",
            current_year=2026,
        )

        self.assertNotIn("2020", description)
        self.assertIn("Colorado River", description)
        self.assertEqual(notices[0]["label"], "Historic provider notice")
        self.assertIn("2020", notices[0]["text"])


class FccIngestorTests(unittest.IsolatedAsyncioTestCase):
    def test_mobile_coverage_normalization_labels_provider_and_technology(self):
        record = fcc.normalize_mobile_coverage_record(
            {
                "provider": "tmobile",
                "technology": "500",
                "availability": "available",
                "download_mbps": "43.25",
                "tests": "12",
                "date": "2025-06-30",
            },
            source="fcc_bdc",
        )

        self.assertEqual(record["provider"], "T-Mobile")
        self.assertEqual(record["technology"], "5G-NR")
        self.assertEqual(record["availability_class"], "modeled_available")
        self.assertEqual(record["download_mbps"], 43.25)
        self.assertEqual(record["sample_count"], 12)
        self.assertEqual(record["source_label"], "FCC modeled")

    async def test_mobile_coverage_metadata_only_is_not_available(self):
        original_runtime_cached_call = fcc.runtime_cached_call

        async def fake_runtime_cached_call(*args, **kwargs):
            return []

        fcc.runtime_cached_call = fake_runtime_cached_call
        try:
            result = await fcc.get_mobile_coverage(12.345, -98.765)
        finally:
            fcc.runtime_cached_call = original_runtime_cached_call

        self.assertFalse(result["available"])
        self.assertEqual(result["records"], [])
        self.assertEqual(result["modeled_source"]["status"], "metadata_only")


if __name__ == "__main__":
    unittest.main()
