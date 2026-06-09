import unittest

from ingestors import ridb


class RidbCampsiteMediaTests(unittest.TestCase):
    def test_campsite_record_normalizes_site_level_attributes_and_media(self):
        site = {
            "CampsiteID": "456",
            "CampsiteName": "Group Site A",
            "CampsiteType": "GROUP STANDARD AREA",
            "MaxNumPeople": "40",
        }
        attrs = [
            {"AttributeName": "Driveway Surface", "AttributeValue": "Paved"},
            {"AttributeName": "Max Vehicle Length", "AttributeValue": "35"},
            {"AttributeName": "Shade", "AttributeValue": "Yes"},
            {"AttributeName": "Fire Ring", "AttributeValue": "Y"},
            {"AttributeName": "Pets Allowed", "AttributeValue": "Yes"},
            {"AttributeName": "Accessible", "AttributeValue": "Yes"},
            {"AttributeName": "Electric Hookup", "AttributeValue": "No"},
        ]
        media = [
            {"MediaType": "Image", "URL": "https://cdn.example/site-a.jpg"},
            {"MediaType": "Document", "URL": "https://cdn.example/rules.pdf"},
        ]

        normalized = ridb._normalize_campsite_record(site, attrs, media)

        self.assertEqual(normalized["id"], "456")
        self.assertEqual(normalized["map_card_id"], "")
        self.assertEqual(normalized["name"], "Group Site A")
        self.assertEqual(normalized["max_people"], "40")
        self.assertEqual(normalized["equipment_length"], "35")
        self.assertEqual(normalized["surface"], "Paved")
        self.assertTrue(normalized["accessible"])
        self.assertTrue(normalized["shade"])
        self.assertTrue(normalized["fire"])
        self.assertTrue(normalized["pets"])
        self.assertFalse(normalized["hookups"])
        self.assertEqual(normalized["photo_url"], "https://cdn.example/site-a.jpg")
        self.assertEqual(normalized["photos"], ["https://cdn.example/site-a.jpg"])
        self.assertIn("ADA", normalized["amenities"])
        self.assertIn("Fire rings", normalized["amenities"])

    def test_photo_dedupe_keeps_campsite_media_before_facility_media(self):
        site_photos = ["https://cdn.example/group.jpg", "https://cdn.example/facility.jpg"]
        facility_photos = ["https://cdn.example/facility.jpg", "https://cdn.example/overview.jpg"]

        photos = ridb._dedupe([*site_photos, *facility_photos])

        self.assertEqual(photos, [
            "https://cdn.example/group.jpg",
            "https://cdn.example/facility.jpg",
            "https://cdn.example/overview.jpg",
        ])

    def test_price_summary_prefers_historical_reservation_nightly_fees(self):
        facility = {"FacilityID": "100", "Reservable": True, "FacilityUseFeeDescription": "$20-$40 per night"}
        reservations = [
            {"FacilityID": "100", "UseFee": "60", "Nights": "2", "StartDate": "2024-06-01"},
            {"FacilityID": "100", "TotalPaid": "120", "Nights": "3", "StartDate": "2025-07-01"},
            {"FacilityID": "999", "UseFee": "999", "Nights": "1", "StartDate": "2025-07-01"},
        ]

        summary = ridb.build_price_summary(facility, reservations)

        self.assertEqual(summary["min"], 30)
        self.assertEqual(summary["max"], 40)
        self.assertEqual(summary["sample_count"], 2)
        self.assertEqual(summary["last_year"], 2025)
        self.assertIn("historical", summary["source"].lower())

    def test_adventure_normalization_uses_media_and_official_handoff(self):
        permit = {
            "PermitEntranceID": "pe-1",
            "PermitEntranceName": "Backcountry Zone",
            "PermitEntranceDescription": "Lottery required",
            "FacilityID": "100",
            "Latitude": "38.1",
            "Longitude": "-109.2",
            "ENTITYMEDIA": [{"MediaType": "Image", "URL": "https://cdn.example/permit.jpg"}],
            "ZONES": [{"Zone": "Needles"}],
        }

        normalized = ridb._normalize_adventure(permit, "permit", "100")

        self.assertEqual(normalized["id"], "ridb_permit:pe-1")
        self.assertEqual(normalized["type"], "permit")
        self.assertEqual(normalized["photo_url"], "https://cdn.example/permit.jpg")
        self.assertIn("Needles", normalized["zones"])
        self.assertIn("Checkout", normalized["reservation_notes"])


if __name__ == "__main__":
    unittest.main()
