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


if __name__ == "__main__":
    unittest.main()
