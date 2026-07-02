from __future__ import annotations

import csv
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from config.settings import settings
from db import store
from scripts.import_dispersed_site_leads import build_import
from scripts.publish_recent_dispersed_site_leads import build_report as build_publish_report


CSV_FIELDS = [
    "Location", "Name", "Category", "Description", "Latitude", "Longitude",
    "Elevation", "Date verified", "Open", "Water", "Wifi", "Road surface", "Cost",
]


class DispersedSiteLeadImportTests(unittest.TestCase):
    def write_csv(self, rows: list[dict[str, str]]) -> Path:
        temp = tempfile.NamedTemporaryFile("w", newline="", suffix=".csv", delete=False)
        path = Path(temp.name)
        with temp:
            writer = csv.DictWriter(temp, fieldnames=CSV_FIELDS)
            writer.writeheader()
            for row in rows:
                writer.writerow({field: row.get(field, "") for field in CSV_FIELDS})
        return path

    def test_import_strips_source_content_flags_dates_and_dedupes(self):
        path = self.write_csv([
            {
                "Location": "Borrego Salton Seaway",
                "Name": "Copied name must not store",
                "Category": "Wild Camping",
                "Description": "Copied description must not store",
                "Latitude": "33.28057",
                "Longitude": "-116.14689",
                "Date verified": "2026-02-15 00:00:00 UTC",
                "Open": "open_yes",
                "Water": "No",
                "Cost": "Unknown",
            },
            {
                "Name": "Near duplicate",
                "Category": "Wild Camping",
                "Description": "Also copied",
                "Latitude": "33.28058",
                "Longitude": "-116.14690",
                "Date verified": "2026-02-16 00:00:00 UTC",
                "Open": "open_yes",
            },
            {
                "Name": "Future date",
                "Category": "Informal Campsite",
                "Latitude": "39.33057",
                "Longitude": "-116.85463",
                "Date verified": "2026-07-05 00:00:00 UTC",
                "Open": "open_yes",
            },
            {
                "Name": "Too old",
                "Category": "Informal Campsite",
                "Latitude": "39.33057",
                "Longitude": "-116.85463",
                "Date verified": "2024-01-01 00:00:00 UTC",
                "Open": "open_yes",
            },
        ])

        try:
            report = build_import(path, today=date(2026, 7, 1), max_age_days=366, dedupe_radius_m=50)
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(report["rows_read"], 4)
        self.assertEqual(report["candidate_rows"], 3)
        self.assertEqual(report["accepted_leads"], 2)
        self.assertEqual(report["duplicates_skipped"], 1)
        self.assertEqual(report["skipped"], {"stale_verified_date": 1})
        self.assertEqual(report["categories"], {"wild_camp": 1, "informal_camp": 1})
        self.assertEqual(report["latest_verified_at"], "2026-07-01")
        self.assertIn("Name", report["stripped_content_columns"])
        self.assertIn("Description", report["stripped_content_columns"])

        for lead in report["leads"]:
            serialized = repr(lead)
            self.assertNotIn("Copied name", serialized)
            self.assertNotIn("Copied description", serialized)
            self.assertNotIn("Borrego Salton Seaway", serialized)
            self.assertNotIn("Water", serialized)
            self.assertNotIn("Cost", serialized)

        future = [lead for lead in report["leads"] if lead["category"] == "informal_camp"][0]
        self.assertEqual(future["status"], "needs_field_check")
        self.assertIn("future_verified_date", future["review_flags"])

    def test_store_helper_rejects_unsanitized_fields(self):
        old_path = settings.db_path
        with tempfile.TemporaryDirectory() as td:
            try:
                settings.db_path = str(Path(td) / "trailhead-test.db")
                store.init_db()
                lead = {
                    "lead_key": "dsl_test_safe",
                    "source": "ioverlander_private_lead",
                    "source_batch": "test_batch",
                    "source_record_hash": "a" * 64,
                    "lat": 38.1,
                    "lng": -109.2,
                    "rounded_lat": 38.1,
                    "rounded_lng": -109.2,
                    "category": "wild_camp",
                    "status": "lead",
                    "confidence": 25,
                    "source_verified_at": "2026-06-01",
                    "review_flags": ["source_content_stripped"],
                    "provenance": {
                        "source_kind": "private_lead",
                        "source_label": "private coordinate lead",
                        "license_state": "permission_required_before_publication",
                        "raw_fields_stripped": True,
                    },
                }
                unsafe = dict(lead)
                unsafe["lead_key"] = "dsl_test_unsafe"
                unsafe["Description"] = "must fail"

                result = store.upsert_dispersed_site_leads([lead, unsafe], "test_batch")
                self.assertEqual(result["saved"], 1)
                self.assertEqual(result["skipped"], 1)

                db = sqlite3.connect(settings.db_path)
                try:
                    row = db.execute("SELECT * FROM dispersed_site_leads WHERE lead_key='dsl_test_safe'").fetchone()
                    self.assertIsNotNone(row)
                    columns = [item[1] for item in db.execute("PRAGMA table_info(dispersed_site_leads)").fetchall()]
                    self.assertNotIn("Description", columns)
                    self.assertNotIn("name", columns)
                    self.assertNotIn("description", columns)
                finally:
                    db.close()
            finally:
                settings.db_path = old_path

    def test_map_contributor_permission_and_lead_review(self):
        old_path = settings.db_path
        with tempfile.TemporaryDirectory() as td:
            try:
                settings.db_path = str(Path(td) / "trailhead-test.db")
                store.init_db()
                db = sqlite3.connect(settings.db_path)
                try:
                    db.execute(
                        """INSERT INTO users (id,email,username,password_hash,credits,email_verified,created_at)
                           VALUES (?,?,?,?,?,?,?)""",
                        (7, "mapper@example.com", "mapper", "x", 0, 1, 1),
                    )
                    db.commit()
                finally:
                    db.close()

                app = store.submit_map_contributor_application(
                    7,
                    "mapper",
                    "I verify camps with land manager sources and field checks.",
                    "Moab, Big Sur",
                    "I would check access signs and recent conditions.",
                )
                self.assertFalse(store.has_approved_map_contributor(7))
                self.assertTrue(store.update_map_contributor_application_status(app["id"], "approved"))
                self.assertTrue(store.has_approved_map_contributor(7))
                profile = store.get_contributor_profile(7, 7)
                self.assertTrue(profile["map_contributor"]["approved"])
                self.assertTrue(any(badge["id"] == "map_contributor" for badge in profile["badges"]))

                store.upsert_dispersed_site_leads([
                    {
                        "lead_key": "dsl_review_me",
                        "source": "ioverlander_private_lead",
                        "source_batch": "review_batch",
                        "source_record_hash": "b" * 64,
                        "lat": 38.5,
                        "lng": -109.5,
                        "rounded_lat": 38.5,
                        "rounded_lng": -109.5,
                        "category": "wild_camp",
                        "status": "lead",
                        "confidence": 25,
                        "source_verified_at": "2026-06-01",
                        "review_flags": ["source_content_stripped"],
                        "provenance": {"source_kind": "private_lead", "raw_fields_stripped": True},
                    }
                ], "review_batch")
                nearby = store.list_dispersed_site_leads_near(38.5, -109.5, radius_mi=5)
                self.assertEqual(len(nearby), 1)
                self.assertEqual(nearby[0]["lead_key"], "dsl_review_me")
                reviewed = store.update_dispersed_site_lead_status("dsl_review_me", "community_verified", reviewer_id=7)
                self.assertEqual(reviewed["status"], "community_verified")
                self.assertIsNone(reviewed.get("canonical_camp_id"))

                self.assertTrue(store.update_map_contributor_application_status(app["id"], "dismissed"))
                self.assertFalse(store.has_approved_map_contributor(7))
            finally:
                settings.db_path = old_path

    def test_admin_publish_promotes_to_public_dispersed_camp(self):
        old_path = settings.db_path
        with tempfile.TemporaryDirectory() as td:
            try:
                settings.db_path = str(Path(td) / "trailhead-test.db")
                store.init_db()
                db = sqlite3.connect(settings.db_path)
                try:
                    db.execute(
                        """INSERT INTO users (id,email,username,password_hash,credits,email_verified,created_at)
                           VALUES (?,?,?,?,?,?,?)""",
                        (7, "mapper@example.com", "mapper", "x", 0, 1, 1),
                    )
                    db.commit()
                finally:
                    db.close()
                store.upsert_dispersed_site_leads([
                    {
                        "lead_key": "dsl_publish_me",
                        "source": "ioverlander_private_lead",
                        "source_batch": "publish_batch",
                        "source_record_hash": "c" * 64,
                        "lat": 38.5001,
                        "lng": -109.5001,
                        "rounded_lat": 38.5001,
                        "rounded_lng": -109.5001,
                        "category": "wild_camp",
                        "status": "lead",
                        "confidence": 25,
                        "source_verified_at": "2026-06-01",
                        "review_flags": ["source_content_stripped"],
                        "provenance": {"source_kind": "private_lead", "raw_fields_stripped": True},
                    }
                ], "publish_batch")
                checked = store.update_dispersed_site_lead_status("dsl_publish_me", "community_verified", reviewer_id=7)
                self.assertEqual(checked["status"], "community_verified")
                self.assertIsNone(checked.get("canonical_camp_id"))

                saved = store.update_dispersed_site_lead_profile("dsl_publish_me", {
                    "name": "Quiet desert pullout",
                    "description": "Flat tent site with a short dirt approach.",
                    "amenities": ["Fire ring", "0", "Unknown"],
                    "site_types": ["Tent"],
                }, reviewer_id=7)
                self.assertEqual(saved["profile_data"]["name"], "Quiet desert pullout")
                self.assertEqual(saved["profile_data"]["amenities"], ["Fire ring"])
                private_photo = store.add_dispersed_site_lead_photo(
                    "dsl_publish_me",
                    7,
                    "mapper",
                    "ZmFrZSBwaG90bw==",
                    caption="Flat tent site",
                )
                self.assertIsNotNone(private_photo)

                published = store.publish_dispersed_site_lead("dsl_publish_me", admin_id=1)
                self.assertEqual(published["status"], "published")
                camp_id = published["canonical_camp_id"]
                self.assertTrue(str(camp_id).startswith("thp_"))

                place = store.get_place(camp_id)
                self.assertIsNotNone(place)
                self.assertEqual(place["source"], "trailhead")
                self.assertEqual(place["category"], "camp")
                self.assertEqual(place["subtype"], "Dispersed")
                self.assertEqual(place["trailhead_dataset"], "dispersed_camp")
                self.assertTrue(place["trailhead_public"])
                self.assertEqual(place["name"], "Quiet desert pullout")
                self.assertEqual(place["verified_source"], "Recent dispersed spot")
                self.assertEqual(place["source_badge"], "Trailhead")
                self.assertTrue(str(place["source_freshness"]).startswith("Verified"))
                self.assertNotIn("ioverlander", str(place).lower())
                self.assertEqual(len(place["photos"]), 1)
                self.assertEqual(place["photos"][0]["caption"], "Flat tent site")

                nearby = store.list_cached_places_near_samples(
                    [{"lat": 38.5, "lng": -109.5}],
                    radius_mi=5,
                    categories=["camp"],
                    limit=10,
                )
                self.assertTrue(any(item["trailhead_place_id"] == camp_id for item in nearby))

                store.upsert_dispersed_site_leads([
                    {
                        "lead_key": "dsl_publish_duplicate",
                        "source": "ioverlander_private_lead",
                        "source_batch": "publish_batch",
                        "source_record_hash": "d" * 64,
                        "lat": 38.50012,
                        "lng": -109.50012,
                        "rounded_lat": 38.50012,
                        "rounded_lng": -109.50012,
                        "category": "informal_camp",
                        "status": "lead",
                        "confidence": 25,
                        "source_verified_at": "2026-06-02",
                        "review_flags": ["source_content_stripped"],
                        "provenance": {"source_kind": "private_lead", "raw_fields_stripped": True},
                    }
                ], "publish_batch")
                duplicate = store.publish_dispersed_site_lead("dsl_publish_duplicate", admin_id=1)
                self.assertEqual(duplicate["canonical_camp_id"], camp_id)
            finally:
                settings.db_path = old_path

    def test_bulk_publish_recent_leads_creates_public_minimal_cards(self):
        old_path = settings.db_path
        with tempfile.TemporaryDirectory() as td:
            try:
                settings.db_path = str(Path(td) / "trailhead-test.db")
                store.init_db()
                today = date.today().isoformat()
                store.upsert_dispersed_site_leads([
                    {
                        "lead_key": "dsl_recent_public",
                        "source": "ioverlander_private_lead",
                        "source_batch": "auto_publish_batch",
                        "source_record_hash": "e" * 64,
                        "lat": 38.5001,
                        "lng": -109.5001,
                        "rounded_lat": 38.5001,
                        "rounded_lng": -109.5001,
                        "category": "wild_camp",
                        "status": "lead",
                        "confidence": 25,
                        "source_verified_at": today,
                        "review_flags": ["source_content_stripped"],
                        "provenance": {"source_kind": "private_lead", "raw_fields_stripped": True},
                    },
                    {
                        "lead_key": "dsl_stale_private",
                        "source": "ioverlander_private_lead",
                        "source_batch": "auto_publish_batch",
                        "source_record_hash": "f" * 64,
                        "lat": 38.8,
                        "lng": -109.8,
                        "rounded_lat": 38.8,
                        "rounded_lng": -109.8,
                        "category": "informal_camp",
                        "status": "lead",
                        "confidence": 25,
                        "source_verified_at": "2020-01-01",
                        "review_flags": ["source_content_stripped"],
                        "provenance": {"source_kind": "private_lead", "raw_fields_stripped": True},
                    },
                ], "auto_publish_batch")
                dry = build_publish_report(SimpleNamespace(
                    max_age_days=30,
                    source_batch="auto_publish_batch",
                    limit=0,
                    commit=False,
                    repair_published=False,
                    coordinate_only_confirmed=False,
                    admin_id=None,
                    keep_going=False,
                ))
                self.assertEqual(dry["eligible"], 1)
                self.assertEqual(store.get_dispersed_site_lead("dsl_recent_public")["status"], "lead")

                committed = build_publish_report(SimpleNamespace(
                    max_age_days=30,
                    source_batch="auto_publish_batch",
                    limit=0,
                    commit=True,
                    repair_published=False,
                    coordinate_only_confirmed=True,
                    admin_id=None,
                    keep_going=False,
                ))
                self.assertEqual(committed["published"], 1)
                recent = store.get_dispersed_site_lead("dsl_recent_public")
                stale = store.get_dispersed_site_lead("dsl_stale_private")
                self.assertEqual(recent["status"], "published")
                self.assertEqual(stale["status"], "lead")
                place = store.get_place(recent["canonical_camp_id"])
                self.assertEqual(place["name"], "Dispersed tent site")
                self.assertEqual(place["description"], store.DISPERSED_PUBLIC_DEFAULT_DESCRIPTION)
                self.assertEqual(place["source_freshness"], "Verified this month")
                self.assertNotIn("ioverlander", str(place).lower())
            finally:
                settings.db_path = old_path

    def test_private_review_leads_surface_as_camps_only_for_map_contributors(self):
        old_path = settings.db_path
        with tempfile.TemporaryDirectory() as td:
            try:
                settings.db_path = str(Path(td) / "trailhead-test.db")
                store.init_db()
                db = sqlite3.connect(settings.db_path)
                try:
                    db.execute(
                        """INSERT INTO users (id,email,username,password_hash,credits,email_verified,created_at)
                           VALUES (?,?,?,?,?,?,?)""",
                        (7, "mapper@example.com", "mapper", "x", 0, 1, 1),
                    )
                    db.commit()
                finally:
                    db.close()
                app = store.submit_map_contributor_application(
                    7,
                    "mapper",
                    "I verify camps with land manager sources and field checks.",
                    "Moab",
                    "I would check signs and access before saving details.",
                )
                self.assertTrue(store.update_map_contributor_application_status(app["id"], "approved"))
                store.upsert_dispersed_site_leads([
                    {
                        "lead_key": "dsl_hidden_review_camp",
                        "source": "ioverlander_private_lead",
                        "source_batch": "review_batch",
                        "source_record_hash": "e" * 64,
                        "lat": 38.5001,
                        "lng": -109.5001,
                        "rounded_lat": 38.5001,
                        "rounded_lng": -109.5001,
                        "category": "wild_camp",
                        "status": "lead",
                        "confidence": 25,
                        "source_verified_at": "2026-06-01",
                        "review_flags": ["source_content_stripped"],
                        "provenance": {"source_kind": "private_lead", "raw_fields_stripped": True},
                    }
                ], "review_batch")

                from dashboard import server as api_server

                public_camps = api_server._private_review_dispersed_camps(38.5, -109.5, 5, None)
                self.assertEqual(public_camps, [])

                contributor_camps = api_server._private_review_dispersed_camps(
                    38.5,
                    -109.5,
                    5,
                    {"id": 7, "is_admin": 0},
                )
                self.assertEqual(len(contributor_camps), 1)
                camp = contributor_camps[0]
                self.assertEqual(camp["id"], "dispersed_lead:dsl_hidden_review_camp")
                self.assertEqual(camp["private_lead_key"], "dsl_hidden_review_camp")
                self.assertEqual(camp["land_type"], "Dispersed")
                self.assertEqual(camp["source"], "trailhead")
                self.assertNotIn("ioverlander", repr(camp).lower())
            finally:
                settings.db_path = old_path


if __name__ == "__main__":
    unittest.main()
