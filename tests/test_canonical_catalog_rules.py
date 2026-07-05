from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.data.canonical_catalog_rules import (
    PUBLIC_COPY_FORBIDDEN_RE,
    classify_camp_kind,
    is_non_overnight_camp_label,
    is_primary_rv_label,
    normalize_official_search_category,
    repair_public_title,
)
from scripts.data.normalize_official_cache import build_official_search
from scripts.data.build_canonical_serving_indexes import (
    build_explore_index,
    build_trail_index,
    camp_record,
    clean_source_summary,
    dedupe_explore_records,
    dedupe_records,
    dedupe_trail_records,
    first_sentence,
    public_trail_activity,
    public_trail_difficulty,
    public_trail_fact_labels,
    public_trail_quality_score,
    public_trail_route_shape,
    public_trail_surface,
    public_trail_summary,
    public_trail_title,
    public_trail_uses,
    trail_review_only,
)
from scripts.explore_sources.base.content_quality import clean_description
from scripts.explore_sources.base.normalize import compact_text


class CanonicalCatalogRulesTests(unittest.TestCase):
    def test_trail_surface_values_do_not_become_search_categories(self):
        self.assertEqual(normalize_official_search_category("trail", "NATIVE MATERIAL"), "trail")
        self.assertEqual(normalize_official_search_category("trail", "SNOW"), "trail")
        self.assertEqual(normalize_official_search_category("trail", "N/A"), "trail")

    def test_official_search_indexes_trails_as_trails(self):
        db = sqlite3.connect(":memory:")
        try:
            db.execute("CREATE TABLE place (id TEXT, canonical_name TEXT, category TEXT, managing_agency TEXT)")
            db.execute("CREATE TABLE trail (id TEXT, name TEXT, surface TEXT, managing_agency TEXT)")
            db.execute("CREATE TABLE land_unit (id TEXT, name TEXT, designation TEXT, agency TEXT)")
            db.execute("INSERT INTO trail VALUES ('trail:usfs:1', 'Pine Ridge Trail', 'NATIVE MATERIAL', 'USFS')")
            db.execute("INSERT INTO place VALUES ('place:nps:1', 'North Campground', 'campground', 'NPS')")
            db.execute("INSERT INTO land_unit VALUES ('land:nps:test', 'Test National Park', 'National Park', 'NPS')")
            rows = build_official_search(db)
            self.assertEqual(rows, 3)
            trail = db.execute("SELECT category, terms FROM official_search WHERE id='trail:usfs:1'").fetchone()
            self.assertEqual(trail[0], "trail")
            self.assertIn("native material", trail[1])
        finally:
            db.close()

    def test_mixed_campground_is_not_primary_rv(self):
        camp = {
            "name": "King's Bottom Campground",
            "land_type": "BLM",
            "site_types": ["Tent", "RV"],
            "tags": ["camp", "rv"],
        }
        self.assertFalse(is_primary_rv_label(camp["name"], camp["land_type"]))
        self.assertEqual(classify_camp_kind(camp), "campground")

    def test_true_rv_park_is_primary_rv(self):
        camp = {"name": "Portal RV Resort - Moab", "land_type": "private", "type": "camp"}
        self.assertTrue(is_primary_rv_label(camp["name"], camp["land_type"], camp["type"]))
        self.assertEqual(classify_camp_kind(camp), "rv_park")
        self.assertTrue(is_primary_rv_label("Brandy Creek RV"))

    def test_day_use_and_test_facilities_do_not_become_camp_pins(self):
        self.assertTrue(is_non_overnight_camp_label("Moab Day Use Sites", "rv_park"))
        self.assertTrue(is_non_overnight_camp_label("BAH 2 - Venue Test Facility 2", "rv_park"))
        self.assertTrue(is_non_overnight_camp_label("West Potomac Park Softball Fields", "rv_park"))
        self.assertIsNone(camp_record({
            "id": "place:ridb:vr1400193",
            "canonical_name": "Moab Day Use Sites",
            "category": "rv_park",
            "summary": "Day use area",
            "geom": {"type": "Point", "coordinates": [-109.55849, 38.60467]},
        }, source="Recreation.gov"))
        self.assertIsNone(camp_record({
            "id": "place:ridb:vr2867",
            "canonical_name": "West Potomac Park Softball Fields",
            "category": "rv_park",
            "summary": "Reservable athletic field.",
            "geom": {"type": "Point", "coordinates": [-77.042579, 38.8814038]},
        }, source="Recreation.gov"))

    def test_serving_index_dedupe_prefers_better_source(self):
        lower = {
            "id": "osm:1",
            "name": "North Campground",
            "lat": 38.1234,
            "lng": -109.1234,
            "category": "camp",
            "kind": "campground",
            "source_rank": 40,
        }
        better = {**lower, "id": "nps:1", "source_rank": 8}
        out = dedupe_records([lower, better])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], "nps:1")

    def test_explore_serving_dedupe_prefers_current_rich_card(self):
        generic = {
            "id": "place:ridb:old",
            "title": "(OLD) Mt. Whitney (OLD)",
            "lat": 36.5786,
            "lng": -118.2922,
            "category": "campground",
            "group": "camping",
            "description": "Mt. Whitney is a managed recreation stop.",
            "verified": True,
        }
        current = {
            **generic,
            "id": "place:ridb:current",
            "title": "Mt. Whitney",
            "description": "Permit area for the Mount Whitney zone. Check current trail quotas and seasonal access before you go.",
        }
        out = dedupe_explore_records([generic, current])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], "place:ridb:current")

    def test_explore_serving_dedupe_collapses_campground_name_variants(self):
        short = {
            "id": "place:ridb:short",
            "title": "Long Branch",
            "lat": 34.126564,
            "lng": -89.844405,
            "category": "campground",
            "group": "camping",
            "description": "Long Branch has overnight options around the area.",
        }
        rich = {
            **short,
            "id": "place:ridb:rich",
            "title": "Long Branch Campground",
            "lng": -89.844471,
            "description": "Quiet campground on Enid Lake with tent sites, picnic tables, beach access, and a boat ramp.",
        }
        out = dedupe_explore_records([short, rich])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], "place:ridb:rich")

    def test_build_explore_index_writes_one_public_card_per_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.json"
            path.write_text(json.dumps({
                "places": [
                    {
                        "id": "place:ridb:older",
                        "name": "(OLD) Grand Teton National Park - Backcountry Permits (OLD)",
                        "category": "campground",
                        "verified": True,
                        "summary": {
                            "title": "(OLD) Grand Teton National Park - Backcountry Permits (OLD)",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 43.6530556,
                            "lng": -110.7191667,
                            "short_description": "Grand Teton permits are a managed recreation stop.",
                        },
                    },
                    {
                        "id": "place:ridb:current",
                        "name": "Grand Teton National Park Backcountry Permits",
                        "category": "campground",
                        "verified": True,
                        "summary": {
                            "title": "Grand Teton National Park Backcountry Permits",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 43.6530556,
                            "lng": -110.7191667,
                            "short_description": "Backcountry permit office for overnight trips in Grand Teton National Park.",
                        },
                    },
                ],
            }))
            index = build_explore_index(path)
            self.assertEqual(index["count"], 1)
            self.assertEqual(index["items"][0]["id"], "place:ridb:current")
            self.assertNotIn("OLD", index["items"][0]["title"])

    def test_build_explore_index_preserves_mount_abbreviation_sentence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.json"
            path.write_text(json.dumps({
                "places": [
                    {
                        "id": "place:ridb:mount",
                        "name": "Mt. Whitney",
                        "category": "campground",
                        "summary": {
                            "title": "Mt. Whitney",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 36.5786,
                            "lng": -118.2922,
                            "short_description": "Mt. Whitney Trail Camp sits high on the main route to the summit.",
                        },
                    },
                ],
            }))
            item = build_explore_index(path)["items"][0]
            self.assertTrue(item["description"].startswith("Mt. Whitney"))
            self.assertNotEqual(item["description"], "Mt.")

    def test_build_explore_index_replaces_generic_placeholder_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.json"
            path.write_text(json.dumps({
                "places": [
                    {
                        "id": "place:ridb:damsite",
                        "name": "Damsite",
                        "category": "campground",
                        "summary": {
                            "title": "Damsite",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 37.9047222,
                            "lng": -93.3077778,
                            "short_description": "Damsite has overnight options around the area.",
                        },
                    },
                    {
                        "id": "place:ridb:state-park",
                        "name": "State Park",
                        "category": "campground",
                        "summary": {
                            "title": "State Park",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 39.619306,
                            "lng": -83.22333,
                            "short_description": "State Park has overnight options around the area.",
                        },
                    },
                ],
            }))
            index = build_explore_index(path)
            titles = [item["title"] for item in index["items"]]
            self.assertIn("Damsite", titles)
            self.assertNotIn("State Park", titles)
            damsite = next(item for item in index["items"] if item["title"] == "Damsite")
            self.assertEqual(damsite["description"], "Damsite. Check fees, stay limits, fire rules, and seasonal access.")
            self.assertNotRegex(json.dumps(index), r"has overnight options around the area|managed recreation stop")

    def test_explore_description_keeps_initials_and_skips_empty_leads(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.json"
            path.write_text(json.dumps({
                "places": [
                    {
                        "id": "place:ridb:fallini",
                        "name": "Joe T. Fallini Recreation Site",
                        "category": "campground",
                        "summary": {
                            "title": "Joe T. Fallini Recreation Site",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 42.952,
                            "lng": -114.146,
                            "short_description": "The Joseph T. Fallini Recreation Site sits on the shore of Mackay Reservoir with campsites and water access.",
                        },
                    },
                    {
                        "id": "place:ridb:damsite",
                        "name": "Damsite",
                        "category": "campground",
                        "summary": {
                            "title": "Damsite",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 37.9047222,
                            "lng": -93.3077778,
                            "short_description": "Attention Campers! Damsite has shaded sites near the lake and boat access.",
                        },
                    },
                ],
            }))
            by_title = {item["title"]: item for item in build_explore_index(path)["items"]}
            self.assertEqual(
                by_title["Joe T. Fallini Recreation Site"]["description"],
                "The Joseph T. Fallini Recreation Site sits on the shore of Mackay Reservoir with campsites and water access.",
            )
            self.assertEqual(
                by_title["Damsite"]["description"],
                "Damsite has shaded sites near the lake and boat access.",
            )

    def test_build_explore_index_keeps_timed_entry_out_of_camping(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.json"
            path.write_text(json.dumps({
                "places": [
                    {
                        "id": "place:ridb:denali",
                        "name": "Denali Park Road Timed Entry (2021)",
                        "category": "campground",
                        "summary": {
                            "title": "Denali Park Road Timed Entry (2021)",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 63.728443,
                            "lng": -148.886572,
                            "short_description": "Permit reservations are required for private vehicles past Mile 15.",
                        },
                    },
                ],
            }))
            item = build_explore_index(path)["items"][0]
            self.assertEqual(item["category"], "permit_required")
            self.assertEqual(item["group"], "things")
            self.assertEqual(item["title"], "Denali Park Road Timed Entry")

    def test_build_explore_index_routes_non_camp_ridb_records_out_of_camping(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "explore.json"
            path.write_text(json.dumps({
                "places": [
                    {
                        "id": "place:ridb:museum",
                        "name": "Boott Cotton Mills Museum",
                        "category": "campground",
                        "summary": {
                            "title": "Boott Cotton Mills Museum",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 42.646,
                            "lng": -71.309,
                            "short_description": "Don't miss the roar of 85 operating power looms!",
                        },
                    },
                    {
                        "id": "place:ridb:nature-center",
                        "name": "Bear Gulch Nature Center",
                        "category": "campground",
                        "summary": {
                            "title": "Bear Gulch Nature Center",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 36.48,
                            "lng": -121.18,
                            "short_description": "Rangers answer questions and help visitors learn about condors.",
                        },
                    },
                    {
                        "id": "place:ridb:boat-ramp",
                        "name": "Burns Run East Boat Ramp",
                        "category": "campground",
                        "summary": {
                            "title": "Burns Run East Boat Ramp",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 33.95,
                            "lng": -96.61,
                            "short_description": "Concrete boat ramp with lake access.",
                        },
                    },
                    {
                        "id": "place:ridb:trail",
                        "name": "Ute - Elk #2028",
                        "category": "campground",
                        "summary": {
                            "title": "Ute - Elk #2028",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 39.55,
                            "lng": -106.52,
                            "short_description": "The Ute - Elk trail is 3.5 miles long.",
                        },
                    },
                    {
                        "id": "place:ridb:shooting",
                        "name": "Shepard Branch Shooting Range",
                        "category": "campground",
                        "summary": {
                            "title": "Shepard Branch Shooting Range",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 33.34,
                            "lng": -86.03,
                            "short_description": "Public shooting range with posted hours.",
                        },
                    },
                    {
                        "id": "place:ridb:rifle",
                        "name": "Conecuh Shooting / Rifle Range",
                        "category": "campground",
                        "summary": {
                            "title": "Conecuh Shooting / Rifle Range",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 31.05,
                            "lng": -86.6,
                            "short_description": "Public range for posted firearm practice.",
                        },
                    },
                    {
                        "id": "place:ridb:boat-area",
                        "name": "Lake Andrusia Boat Site",
                        "category": "campground",
                        "summary": {
                            "title": "Lake Andrusia Boat Site",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 47.5,
                            "lng": -94.7,
                            "short_description": "Concrete boat ramp with lake access.",
                        },
                    },
                    {
                        "id": "place:ridb:overlook",
                        "name": "Rainie Falls Overlook",
                        "category": "campground",
                        "summary": {
                            "title": "Rainie Falls Overlook",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 42.65,
                            "lng": -123.58,
                            "short_description": "Overlook above the river corridor.",
                        },
                    },
                    {
                        "id": "place:ridb:not-public",
                        "name": "Chickamauga Battlefield Group Campground",
                        "category": "campground",
                        "summary": {
                            "title": "Chickamauga Battlefield Group Campground",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 34.91,
                            "lng": -85.26,
                            "short_description": "THIS IS NOT A PUBLIC CAMPGROUND.",
                        },
                    },
                    {
                        "id": "place:ridb:dump",
                        "name": "Bryce Canyon NP Dump Station Fee for Non - Campers",
                        "category": "campground",
                        "summary": {
                            "title": "Bryce Canyon NP Dump Station Fee for Non - Campers",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 37.62,
                            "lng": -112.16,
                            "short_description": "Dump station fee for non-campers.",
                        },
                    },
                    {
                        "id": "place:ridb:real-camp",
                        "name": "Lane Cove Campground",
                        "category": "campground",
                        "summary": {
                            "title": "Lane Cove Campground",
                            "category": "campground",
                            "explore_group": "camping",
                            "lat": 48.0,
                            "lng": -88.8,
                            "short_description": "Lane Cove Campground is located on Isle Royale off of the Lane Cove Trail.",
                        },
                    },
                ],
            }))
            by_title = {item["title"]: item for item in build_explore_index(path)["items"]}
            self.assertEqual(by_title["Boott Cotton Mills Museum"]["category"], "historic")
            self.assertEqual(by_title["Boott Cotton Mills Museum"]["group"], "historic")
            self.assertEqual(by_title["Bear Gulch Nature Center"]["category"], "activity")
            self.assertEqual(by_title["Bear Gulch Nature Center"]["group"], "things")
            self.assertEqual(by_title["Burns Run East Boat Ramp"]["category"], "water")
            self.assertEqual(by_title["Burns Run East Boat Ramp"]["group"], "water")
            self.assertEqual(by_title["Ute - Elk #2028"]["category"], "trail")
            self.assertEqual(by_title["Ute - Elk #2028"]["group"], "trails")
            self.assertEqual(by_title["Shepard Branch Shooting Range"]["category"], "activity")
            self.assertEqual(by_title["Shepard Branch Shooting Range"]["group"], "things")
            self.assertEqual(by_title["Conecuh Shooting / Rifle Range"]["category"], "activity")
            self.assertEqual(by_title["Conecuh Shooting / Rifle Range"]["group"], "things")
            self.assertEqual(by_title["Lake Andrusia Boat Site"]["category"], "water")
            self.assertEqual(by_title["Lake Andrusia Boat Site"]["group"], "water")
            self.assertEqual(by_title["Rainie Falls Overlook"]["category"], "viewpoint")
            self.assertEqual(by_title["Rainie Falls Overlook"]["group"], "viewpoint")
            self.assertNotIn("Chickamauga Battlefield Group Campground", by_title)
            self.assertNotIn("Bryce Canyon NP Dump Station Fee for Non - Campers", by_title)
            self.assertEqual(by_title["Lane Cove Campground"]["category"], "campground")
            self.assertEqual(by_title["Lane Cove Campground"]["group"], "camping")

    def test_weak_trail_names_are_review_only(self):
        self.assertTrue(trail_review_only('"A"'))
        self.assertTrue(trail_review_only("17DC454"))
        self.assertTrue(trail_review_only("0185.DA"))
        self.assertTrue(trail_review_only("0220N-0221"))
        self.assertTrue(trail_review_only("04N12-SNOW TRAIL"))
        self.assertTrue(trail_review_only("ACCESS"))
        self.assertTrue(trail_review_only("Ninemile Spur Ai"))
        self.assertTrue(trail_review_only(public_trail_title("PINE RIDGE A")))
        self.assertTrue(trail_review_only(public_trail_title("PINE RIDGE MT. BIKE G")))
        self.assertTrue(trail_review_only(public_trail_title("MGRA MORAINE/GLACIER LAKE")))
        self.assertTrue(trail_review_only("Cork Ridge - Pine"))
        self.assertFalse(trail_review_only("PCT"))
        self.assertFalse(trail_review_only("CDT"))
        self.assertFalse(trail_review_only("ABALONE"))
        self.assertFalse(trail_review_only("Pine Ridge Trail"))
        self.assertFalse(trail_review_only(public_trail_title("PINE RIDGE MT. BIKE")))

    def test_trail_index_drops_review_only_trail_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "official.sqlite"
            db = sqlite3.connect(db_path)
            try:
                db.execute("""
                    CREATE TABLE trail (
                      id TEXT,
                      name TEXT,
                      route_geom TEXT,
                      start_geom TEXT,
                      distance_m REAL,
                      elevation_gain_m REAL,
                      difficulty TEXT,
                      allowed_uses TEXT,
                      surface TEXT,
                      managing_agency TEXT,
                      season_text TEXT
                    )
                """)
                start = json.dumps({"type": "Point", "coordinates": [-109.55, 38.57]})
                db.execute(
                    "INSERT INTO trail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    ("trail:weak", "Access", None, start, 1609.344, 0, "2", "Hiking", "NATIVE MATERIAL", "USFS", ""),
                )
                db.execute(
                    "INSERT INTO trail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    ("trail:good", "Pine Ridge Trail", None, start, 3218.688, 120, "3", "Hiking", "NATIVE MATERIAL", "USFS", ""),
                )
                db.commit()
            finally:
                db.close()

            index = build_trail_index(db_path)

        self.assertEqual([item["id"] for item in index["items"]], ["trail:good"])
        self.assertFalse(any(item.get("review_only") for item in index["items"]))

    def test_trail_public_labels_are_reader_friendly(self):
        self.assertEqual(public_trail_title("HIDDEN VALLEY VOYAGUERS HWY"), "Hidden Valley Voyaguers Hwy")
        self.assertEqual(public_trail_title("KENTUCK ORV TRAIL"), "Kentuck ORV Trail")
        self.assertEqual(public_trail_title("AMY'S ARRIVED"), "Amy's Arrived")
        self.assertEqual(public_trail_title("PCT: METHOW VALLEY N. TERMINUS"), "PCT: Methow Valley N. Terminus")
        self.assertEqual(public_trail_title("MCCABE CR - N FK BLACKFOOT"), "Mccabe Creek - North Fork Blackfoot")
        self.assertEqual(public_trail_title("CASTLE CREEK CG BRIDGE TRAIL"), "Castle Creek Campground Bridge Trail")
        self.assertEqual(public_trail_title("PINE RIDGE MT. BIKE"), "Pine Ridge Mountain Bike")
        self.assertEqual(public_trail_title("MGRA MORAINE/GLACIER LAKE"), "MGRA Moraine / Glacier Lake")
        self.assertEqual(public_trail_title("SYLLAMO BIKE TRAIL-JACKS BRANC"), "Syllamo Bike Trail - Jacks Branch")
        self.assertEqual(public_trail_title("SYLLAMO BIKE TRAIL - JACKS BRA"), "Syllamo Bike Trail - Jacks Branch")
        self.assertEqual(public_trail_title("TIMBER CREEK / DEER CREEK TRAI"), "Timber Creek / Deer Creek Trail")
        self.assertEqual(public_trail_title("TRAIL CANYON - LOWER FISH CREE"), "Trail Canyon - Lower Fish Creek")
        self.assertEqual(public_trail_title("LITTLE WEST FORK MORGAN CR ROA"), "Little West Fork Morgan Creek Road")
        self.assertEqual(public_trail_difficulty("4"), "Hard")
        self.assertEqual(public_trail_difficulty("N"), "")
        self.assertEqual(public_trail_surface("NATIVE MATERIAL"), "Natural surface")
        self.assertEqual(public_trail_surface("IMPORTED COMPACTED MATERIAL"), "Compacted surface")
        self.assertEqual(public_trail_uses("Hiking, Biking, Horse"), "Hiking, mountain biking, and horseback riding")
        self.assertEqual(public_trail_uses("Motorcycling"), "Motorcycling")
        self.assertEqual(public_trail_activity({"name": "S14", "allowed_uses": "Motorcycling"}), "OHV route")

    def test_trail_public_facts_support_premium_cards(self):
        item = {
            "name": "Slickrock OHV Route",
            "distance_mi": 7.4,
            "difficulty": "Hard",
            "allowed_uses": "4x4",
            "surface": "Natural surface",
            "route_shape": "Loop",
            "review_only": False,
        }
        item["activity"] = public_trail_activity(item)
        self.assertEqual(item["activity"], "OHV route")
        self.assertEqual(public_trail_fact_labels(item), ["7.4 mi", "Loop", "Hard", "OHV route", "Natural surface"])
        self.assertGreaterEqual(public_trail_quality_score(item), 80)
        self.assertEqual(
            public_trail_route_shape({
                "type": "LineString",
                "coordinates": [
                    [-109.5500, 38.5700],
                    [-109.5510, 38.5710],
                    [-109.5502, 38.5701],
                ],
            }, 1200),
            "Loop",
        )
        self.assertEqual(
            public_trail_route_shape({
                "type": "LineString",
                "coordinates": [
                    [-109.5500, 38.5700],
                    [-109.5900, 38.5900],
                ],
            }, 4800),
            "Point-to-point",
        )

    def test_trail_summary_and_dedupe_prefer_best_public_record(self):
        item = {
            "name": "Pine Ridge Trail",
            "distance_mi": 4.24,
            "elevation_gain_ft": 520,
            "route_shape": "Loop",
            "difficulty": "Moderate",
            "allowed_uses": "Hiking and mountain biking",
            "surface": "Natural surface",
        }
        self.assertEqual(
            public_trail_summary(item),
            "4.2 miles. 520 ft gain. Loop. Moderate.",
        )
        self.assertEqual(
            public_trail_summary({"name": "Lolo Forks", "activity": "Hiking trail"}),
            "Hiking trail. Check current conditions and access before you go.",
        )
        self.assertEqual(
            public_trail_summary({"name": "Middle Falls Overlook", "activity": "Hiking trail", "short_access": True}),
            "Short trail access. Hiking trail.",
        )
        self.assertEqual(
            public_trail_summary({"name": "Arch Trail", "short_access": True, "difficulty": "Moderate", "activity": "Hiking trail", "allowed_uses": "Hiking", "surface": "Natural surface"}),
            "Short trail access. Moderate. Hiking trail. Natural surface.",
        )
        older = {
            "id": "trail:old",
            "name": "Hidden Valley",
            "lat": 38.5319,
            "lng": -109.5172,
            "source_rank": 12,
            "review_only": False,
            "distance_mi": 0.5,
        }
        better = {**older, "id": "trail:best", "distance_mi": 1.9}
        deduped = dedupe_trail_records([older, better])
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["id"], "trail:best")

    def test_trail_index_hides_tiny_low_detail_fragments(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "official.sqlite"
            db = sqlite3.connect(db_path)
            try:
                db.execute("""
                    CREATE TABLE trail (
                      id TEXT,
                      name TEXT,
                      route_geom TEXT,
                      start_geom TEXT,
                      distance_m REAL,
                      elevation_gain_m REAL,
                      difficulty TEXT,
                      allowed_uses TEXT,
                      surface TEXT,
                      managing_agency TEXT,
                      season_text TEXT
                    )
                """)
                start = json.dumps({"type": "Point", "coordinates": [-109.55, 38.57]})
                db.execute(
                    "INSERT INTO trail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    ("trail:tiny-connector", "Easy Connector", None, start, 45, 0, "N", "", "N/A", "USFS", ""),
                )
                db.execute(
                    "INSERT INTO trail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    ("trail:tiny-overlook", "Middle Falls Overlook", None, start, 55, 0, "N", "", "N/A", "USFS", ""),
                )
                db.execute(
                    "INSERT INTO trail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    ("trail:tiny-detailed", "Springs Connector", None, start, 50, 0, "2", "", "NATIVE MATERIAL", "USFS", ""),
                )
                db.commit()
            finally:
                db.close()

            index = build_trail_index(db_path)

        by_id = {item["id"]: item for item in index["items"]}
        self.assertNotIn("trail:tiny-connector", by_id)
        self.assertEqual(by_id["trail:tiny-overlook"]["summary"], "Short trail access. Hiking trail.")
        self.assertIn("Short access", by_id["trail:tiny-overlook"]["fact_labels"])
        self.assertEqual(by_id["trail:tiny-detailed"]["summary"], "Short trail access. Moderate. Hiking trail. Natural surface.")

    def test_trail_index_prioritizes_app_length_routes_over_giant_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "official.sqlite"
            db = sqlite3.connect(db_path)
            try:
                db.execute("""
                    CREATE TABLE trail (
                      id TEXT,
                      name TEXT,
                      route_geom TEXT,
                      start_geom TEXT,
                      distance_m REAL,
                      elevation_gain_m REAL,
                      difficulty TEXT,
                      allowed_uses TEXT,
                      surface TEXT,
                      managing_agency TEXT,
                      season_text TEXT
                    )
                """)
                short_route = json.dumps({
                    "type": "LineString",
                    "coordinates": [[-109.55, 38.57], [-109.59, 38.59]],
                })
                long_route = json.dumps({
                    "type": "LineString",
                    "coordinates": [[-109.55, 38.57], [-110.55, 39.57]],
                })
                rows = [
                    ("trail:long", "Great Western Trail", long_route, None, 257000, 320, "3", "Hiking", "NATIVE MATERIAL", "USFS", ""),
                    ("trail:short", "Hidden Valley Trail", short_route, None, 4800, 120, "3", "Hiking", "NATIVE MATERIAL", "USFS", ""),
                ]
                db.executemany("INSERT INTO trail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
                db.commit()
            finally:
                db.close()

            index = build_trail_index(db_path)

        self.assertEqual(index["items"][0]["id"], "trail:short")
        self.assertEqual(index["items"][0]["route_shape"], "Point-to-point")
        self.assertIn("Point-to-point", index["items"][0]["fact_labels"])

    def test_bullet_camp_summaries_do_not_cut_off_mid_parenthesis(self):
        text = first_sentence(
            "- Near Fort Smith, Montana - Open All Year - 22 RV and tent sites are located on the south shore. "
            "All sites are back in (not pull-through"
        )
        self.assertEqual(text, "Near Fort Smith, Montana. Open All Year")

    def test_camp_summaries_drop_stale_notices_and_dangling_words(self):
        self.assertEqual(
            first_sentence("ATTENTION: This campground was closed for maintenance in December 2020. Riverside camping is available nearby."),
            "Riverside camping is available nearby.",
        )
        self.assertEqual(
            first_sentence("The campgrounds offer spectacular vistas of sandstone domes, canyons, and mesas in addition to the La Sal Mountains as a."),
            "The campgrounds offer spectacular vistas of sandstone domes, canyons, and mesas in addition to the La Sal Mountains.",
        )
        self.assertEqual(
            first_sentence(
                "Along with easy access to biking and off-highway vehicle trails, Sand Flats' campgrounds offer spectacular vistas of sandstone domes, canyons, and mesas in addition to the ever-changing La Sal Mountains as a dramatic backdrop.",
                max_len=180,
            ),
            "Along with easy access to biking and off-highway vehicle trails, Sand Flats' campgrounds offer spectacular vistas of sandstone domes, canyons, and mesas.",
        )

    def test_parking_style_stays_do_not_become_dispersed_camps(self):
        camp = {
            "name": "High Desert Casino",
            "land_type": "Dispersed",
            "description": "Overnight parking allowed in the far lot.",
            "tags": ["wild camp", "dispersed"],
        }
        self.assertEqual(classify_camp_kind(camp), "overnight_parking")

    def test_campground_with_nearby_parking_stays_campground(self):
        camp = {
            "name": "Bicentennial Campground",
            "land_type": "Campground",
            "description": "Small campground near the parking area.",
            "tags": ["parking"],
        }
        self.assertEqual(classify_camp_kind(camp), "campground")

    def test_plain_coordinate_lead_can_stay_dispersed(self):
        camp = {
            "name": "Dispersed tent site",
            "land_type": "Dispersed",
            "description": "Dispersed spots can change quickly.",
            "tags": ["wild camp"],
        }
        self.assertEqual(classify_camp_kind(camp), "dispersed_camp")

    def test_public_copy_forbids_source_artifacts(self):
        self.assertRegex("RIDB data", PUBLIC_COPY_FORBIDDEN_RE)
        self.assertRegex("Downloaded source file", PUBLIC_COPY_FORBIDDEN_RE)
        self.assertRegex("API endpoint", PUBLIC_COPY_FORBIDDEN_RE)

    def test_source_summaries_drop_download_prompts(self):
        text = clean_source_summary("Overview Download the NPS app prior to visiting the park. Riverside campsites sit under cottonwoods.")
        self.assertEqual(text, "Riverside campsites sit under cottonwoods.")

    def test_source_instruction_fragments_are_removed(self):
        text = compact_text(
            "Fishing Point has shore access. Make this page look better with photos and layout notes."
        )
        self.assertEqual(text, "Fishing Point has shore access.")

    def test_informal_source_notes_fall_back_to_clean_copy(self):
        text = clean_description(
            "okay maybe this is the place I put the interp panels…see Jackman Brook.",
            title="Warren Woodstock Vista",
            category="Campground",
            region="White Mountains",
        )
        self.assertIn("Warren Woodstock Vista", text)
        self.assertNotIn("okay maybe", text.lower())
        self.assertNotIn("interp", text.lower())

    def test_repeated_punctuation_is_normalized(self):
        self.assertEqual(compact_text("New England..nowhere in all America…all these houses"), "New England. nowhere in all America all these houses")

    def test_park_fallback_copy_avoids_internal_tone(self):
        text = clean_description("", title="Big Bend National Park", category="Park", region="TX")
        self.assertIn("Big Bend National Park", text)
        self.assertNotIn("managed outdoor area", text)
        self.assertNotIn("official access", text.lower())

    def test_trailhead_fallback_copy_avoids_map_and_route_jargon(self):
        text = clean_description("", title="Hidden Valley Trailhead", category="Trailhead", region="Joshua Tree")
        self.assertIn("Hidden Valley Trailhead", text)
        self.assertNotIn("mapped", text.lower())
        self.assertNotIn("route details", text.lower())

    def test_public_title_repairs_obvious_source_truncations(self):
        self.assertEqual(
            repair_public_title("Big Pine Canyon Group- Clyde Glacier Cam", "Clyde Glacier group campsite", category="campground"),
            "Big Pine Canyon Group - Clyde Glacier Campground",
        )
        self.assertEqual(
            repair_public_title("Lower Virginia Creek Primitive Campgroun", "Rustic campsites", category="campground"),
            "Lower Virginia Creek Primitive Campground",
        )
        self.assertEqual(
            repair_public_title("MEL RIEMAN REC", "The Mel Rieman Campground and Recreation Area", category="campground"),
            "Mel Rieman Recreation Area",
        )


if __name__ == "__main__":
    unittest.main()
