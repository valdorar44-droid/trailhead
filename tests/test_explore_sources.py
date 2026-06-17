from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_explore_catalog_v3 import build_catalog
from scripts.explore_sources.base.aliases import aliases_for_category
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.dedupe import dedupe_places
from scripts.explore_sources.base.quality import score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3
from scripts.explore_sources.blm.import_blm import import_blm_fixture
from scripts.explore_sources.nps.import_nps import import_nps_fixture
from scripts.explore_sources.openbeta.import_openbeta import import_openbeta_fixture
from scripts.explore_sources.osm.import_geofabrik import import_osm_fixture
from scripts.explore_sources.ridb.import_ridb import import_ridb_fixture
from scripts.explore_sources.usfs.import_usfs import import_usfs_fixture
from scripts.explore_sources.wikidata.import_wikidata import import_wikidata_fixture


ROOT = Path(__file__).resolve().parents[1]
YOSEMITE = ROOT / "tests/fixtures/explore_sources/osm_yosemite_sample.geojson"
PAKISTAN = ROOT / "tests/fixtures/explore_sources/osm_pakistan_sample.geojson"
RIDB = ROOT / "tests/fixtures/explore_sources/ridb_sample.json"
NPS = ROOT / "tests/fixtures/explore_sources/nps_sample.json"
USFS = ROOT / "tests/fixtures/explore_sources/usfs_sierra_sample.geojson"
BLM = ROOT / "tests/fixtures/explore_sources/blm_moab_sample.geojson"
WIKIDATA = ROOT / "tests/fixtures/explore_sources/wikidata_pakistan_landmarks_sample.json"
OPENBETA = ROOT / "tests/fixtures/explore_sources/openbeta_climbing_sample.json"


class ExploreSourcePipelineTests(unittest.TestCase):
    def test_osm_tag_mapping_and_attribution(self):
        records, places, trails = import_osm_fixture(YOSEMITE, fetched_at=123)
        categories = {place.category for place in places}
        self.assertIn("campground", categories)
        self.assertIn("trailhead", categories)
        self.assertIn("waterfall", categories)
        self.assertIn("viewpoint", categories)
        self.assertIn("peak", categories)
        self.assertTrue(trails)
        self.assertTrue(all(record.license == "Open Database License (ODbL)" for record in records))
        self.assertTrue(all("OpenStreetMap contributors" in record.attribution for record in records))

    def test_same_source_id_dedupes(self):
        place = ExplorePlaceV3(id="a", source_ids=["osm:node/1"], name="Camp", category="campground", lat=1, lng=1)
        duplicate = ExplorePlaceV3(id="b", source_ids=["osm:node/1"], name="Camp", category="campground", lat=1, lng=1)
        self.assertEqual(len(dedupe_places([place, duplicate])), 1)

    def test_same_name_category_nearby_dedupes(self):
        a = ExplorePlaceV3(id="a", source_ids=["osm:node/1"], name="Yosemite Valley Campground", category="campground", lat=37.742, lng=-119.565)
        b = ExplorePlaceV3(id="b", source_ids=["osm:node/2"], name="Yosemite Valley Campground", category="campground", lat=37.7422, lng=-119.5651)
        self.assertEqual(len(dedupe_places([a, b])), 1)

    def test_trailhead_near_trail_links_but_does_not_merge(self):
        _records, places, trails = build_catalog([str(YOSEMITE)])
        trailhead = next(place for place in places if place.name == "Mist Trail Trailhead")
        trail = next(trail for trail in trails if trail.name == "Mist Trail")
        self.assertIn(trail.id, trailhead.linked_trail_ids)
        self.assertTrue(any(place.name == "Mist Trail" for place in places))
        self.assertTrue(any(place.name == "Mist Trail Trailhead" for place in places))

    def test_official_campground_and_osm_camp_site_merge(self):
        osm = ExplorePlaceV3(
            id="osm",
            source_ids=["osm:node/1005"],
            name="Yosemite Valley Campground",
            category="campground",
            lat=37.742,
            lng=-119.565,
            sources=[{"source": "osm", "source_id": "node/1005"}],
        )
        official = ExplorePlaceV3(
            id="ridb",
            source_ids=["ridb:251974"],
            name="Yosemite Valley Campground",
            category="campground",
            lat=37.7421,
            lng=-119.5651,
            quality="official_source",
            quality_score=85,
            sources=[{"source": "ridb", "source_id": "251974"}],
        )
        merged = dedupe_places([osm, official])
        self.assertEqual(len(merged), 1)
        self.assertIn("ridb:251974", merged[0].source_ids)
        self.assertIn("osm:node/1005", merged[0].source_ids)

    def test_ridb_importer_builds_official_campground(self):
        records, places, trails = import_ridb_fixture(RIDB, fetched_at=123)
        self.assertEqual(len(records), 1)
        self.assertEqual(len(trails), 0)
        place = places[0]
        self.assertEqual(place.category, "campground")
        self.assertEqual(place.quality, "official_source")
        self.assertTrue(place.verified)
        self.assertIn("RIDB", records[0].attribution)
        self.assertIn("reservation", json.dumps(place.reservations).lower())
        self.assertIn("Official source", place.card["source_badge"])

    def test_nps_importer_builds_official_park(self):
        records, places, trails = import_nps_fixture(NPS, fetched_at=123)
        self.assertEqual(len(records), 1)
        self.assertEqual(len(trails), 0)
        place = places[0]
        self.assertEqual(place.category, "park")
        self.assertEqual(place.quality, "official_source")
        self.assertIn("Hiking", place.amenities)
        self.assertIn("national park", place.search_blob)
        self.assertIn("National Park Service", records[0].attribution)

    def test_usfs_importer_builds_trails_roads_and_recreation_places(self):
        records, places, trails = import_usfs_fixture(USFS, fetched_at=123)
        self.assertEqual(len(records), 6)
        self.assertEqual(len(trails), 2)
        categories = {place.category for place in places}
        self.assertIn("trail", categories)
        self.assertIn("trailhead", categories)
        self.assertIn("forest_road", categories)
        self.assertIn("campground", categories)
        self.assertIn("shelter", categories)
        self.assertIn("forest", categories)
        pohono = next(trail for trail in trails if trail.name == "Pohono Trail")
        self.assertEqual(pohono.land_manager, "Sierra National Forest")
        self.assertIn("hiking", pohono.allowed_uses)
        road = next(trail for trail in trails if trail.name == "Forest Road 5S30")
        self.assertIn("4x4", road.allowed_uses)
        self.assertTrue(all(record.license.startswith("USFS") for record in records))
        self.assertTrue(all("USDA Forest Service" in record.attribution for record in records))

    def test_blm_importer_builds_public_land_ohv_and_dispersed_camp(self):
        records, places, trails = import_blm_fixture(BLM, fetched_at=123)
        self.assertEqual(len(records), 6)
        self.assertEqual(len(trails), 2)
        categories = {place.category for place in places}
        self.assertIn("offroad_route", categories)
        self.assertIn("scenic_drive", categories)
        self.assertIn("public_land", categories)
        self.assertIn("dispersed_camp", categories)
        self.assertIn("trailhead", categories)
        self.assertIn("viewpoint", categories)
        ohv = next(trail for trail in trails if trail.name == "Fins and Things OHV Route")
        self.assertEqual(ohv.route_type, "OHV route")
        self.assertIn("4x4", ohv.allowed_uses)
        self.assertIn("overland", ohv.activities)
        monument = next(place for place in places if place.name == "Bears Ears National Monument")
        self.assertEqual(monument.category, "public_land")
        self.assertIn("national_monument", monument.subcategories)
        self.assertIn("monuments", monument.search_blob)
        camp = next(place for place in places if place.name == "Willow Springs Dispersed Camping")
        self.assertEqual(camp.category, "dispersed_camp")
        self.assertIn("boondocking", camp.search_blob)
        self.assertTrue(all(record.license.startswith("BLM") for record in records))
        self.assertTrue(all("Bureau of Land Management" in record.attribution for record in records))

    def test_wikidata_importer_builds_global_landmarks_aliases_and_media(self):
        records, places, trails = import_wikidata_fixture(WIKIDATA, fetched_at=123)
        self.assertEqual(len(records), 5)
        self.assertEqual(len(trails), 0)
        categories = {place.category for place in places}
        self.assertIn("glacier", categories)
        self.assertIn("peak", categories)
        self.assertIn("viewpoint", categories)
        self.assertIn("lake", categories)
        self.assertIn("historic_site", categories)
        baltoro = next(place for place in places if place.name == "Baltoro Glacier")
        self.assertEqual(baltoro.quality, "open_community_data")
        self.assertIn("Concordia approach", baltoro.search_aliases)
        self.assertTrue(baltoro.media)
        k2 = next(place for place in places if place.name == "K2")
        self.assertIn("eight-thousander", k2.search_blob)
        lake = next(place for place in places if place.name == "Attabad Lake")
        self.assertEqual(lake.category, "lake")
        self.assertIn("Gojal Lake", lake.search_aliases)
        self.assertTrue(all(record.license.startswith("Creative Commons CC0") for record in records))
        self.assertTrue(all("Wikidata contributors" in record.attribution for record in records))

    def test_openbeta_importer_builds_climbing_and_bouldering_cards(self):
        records, places, trails = import_openbeta_fixture(OPENBETA, fetched_at=123)
        self.assertEqual(len(records), 4)
        self.assertEqual(len(trails), 0)
        categories = {place.category for place in places}
        self.assertIn("climbing_area", categories)
        self.assertIn("bouldering_area", categories)
        yosemite = next(place for place in places if place.name == "Yosemite Valley Climbing")
        self.assertEqual(yosemite.quality, "open_community_data")
        self.assertIn("big wall", yosemite.search_blob)
        self.assertIn("1240 routes", yosemite.amenities)
        self.assertTrue(yosemite.media)
        rocklands = next(place for place in places if place.name == "Rocklands Bouldering")
        self.assertEqual(rocklands.category, "bouldering_area")
        self.assertIn("v0-v16", rocklands.search_blob)
        self.assertTrue(all(record.license.startswith("OpenBeta") for record in records))
        self.assertTrue(all("OpenBeta contributors" in record.attribution for record in records))

    def test_peak_viewpoint_and_trail_same_name_do_not_auto_merge(self):
        _records, places, _trails = build_catalog([str(YOSEMITE)])
        sentinel = [place for place in places if place.name == "Sentinel Dome"]
        self.assertGreaterEqual(len(sentinel), 3)
        self.assertEqual({"peak", "viewpoint", "trail"}, {place.category for place in sentinel})

    def test_smart_card_fallbacks_for_sparse_categories(self):
        for category, expected in [("trail", "trail conditions"), ("hut", "Backcountry shelter"), ("waterfall", "seasonal flow")]:
            place = ExplorePlaceV3(id=category, name=f"Sparse {category}", category=category)
            build_card(place)
            text = json.dumps(place.card)
            self.assertIn(expected, text)
            self.assertIn("Verify access", place.card["warnings"])

    def test_search_aliases(self):
        self.assertIn("hiking", aliases_for_category("trail"))
        self.assertIn("trail access", aliases_for_category("trailhead"))
        self.assertIn("falls", aliases_for_category("waterfall"))
        self.assertIn("gas", aliases_for_category("fuel"))
        self.assertIn("backcountry hut", aliases_for_category("hut"))

    def test_quality_score_official_beats_osm_only(self):
        official = score_place(ExplorePlaceV3(id="official", sources=[{"source": "nps"}]))
        osm = score_place(ExplorePlaceV3(id="osm", sources=[{"source": "osm"}]))
        self.assertGreater(official.quality_score, osm.quality_score)

    def test_builder_outputs_searchable_pilot_catalog(self):
        records, places, trails = build_catalog(
            [str(YOSEMITE), str(PAKISTAN)],
            ridb_fixtures=[str(RIDB)],
            nps_fixtures=[str(NPS)],
            usfs_fixtures=[str(USFS)],
            blm_fixtures=[str(BLM)],
            wikidata_fixtures=[str(WIKIDATA)],
            openbeta_fixtures=[str(OPENBETA)],
        )
        self.assertGreaterEqual(len(records), 10)
        self.assertTrue(any(trail.name == "K2 Base Camp Trek" for trail in trails))
        campground = next(place for place in places if place.name == "Yosemite Valley Campground")
        self.assertIn("ridb:251974", campground.source_ids)
        self.assertIn("osm:node/1005", campground.source_ids)
        self.assertEqual(campground.quality, "official_source")
        self.assertTrue(any(place.name == "Yosemite National Park" and place.category == "park" for place in places))
        self.assertTrue(any(place.name == "Pohono Trail" and place.category == "trail" for place in places))
        self.assertTrue(any(place.name == "Forest Road 5S30" and place.category == "forest_road" for place in places))
        self.assertTrue(any(place.name == "Bears Ears National Monument" and place.category == "public_land" for place in places))
        self.assertTrue(any(place.name == "Fins and Things OHV Route" and place.category == "offroad_route" for place in places))
        self.assertTrue(any(place.name == "K2" and place.category == "peak" for place in places))
        self.assertTrue(any(place.name == "Attabad Lake" and place.category == "lake" for place in places))
        self.assertTrue(any(place.name == "Yosemite Valley Climbing" and place.category == "climbing_area" for place in places))
        self.assertTrue(any(place.name == "Rocklands Bouldering" and place.category == "bouldering_area" for place in places))
        blobs = " ".join(place.search_blob for place in places)
        for term in ["camping", "hiking", "trailhead", "waterfalls", "fuel", "resupply", "k2", "hunza", "national park", "forest road", "ohv", "monuments", "boondocking", "gojal lake", "concordia approach", "rock climbing", "big wall"]:
            self.assertIn(term, blobs)

    def test_command_writes_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "explore_catalog_v3.json"
            trails_out = Path(tmp) / "explore_trail_geometries_v1.json"
            records_out = Path(tmp) / "source_records.jsonl"
            from scripts.build_explore_catalog_v3 import main
            import sys
            old_argv = sys.argv
            try:
                sys.argv = [
                    "build_explore_catalog_v3.py",
                    "--source-fixture", str(YOSEMITE),
                    "--ridb-fixture", str(RIDB),
                    "--nps-fixture", str(NPS),
                    "--usfs-fixture", str(USFS),
                    "--blm-fixture", str(BLM),
                    "--wikidata-fixture", str(WIKIDATA),
                    "--openbeta-fixture", str(OPENBETA),
                    "--out", str(out),
                    "--trails-out", str(trails_out),
                    "--source-records-out", str(records_out),
                    "--imports-out", str(Path(tmp) / "imports"),
                ]
                self.assertEqual(main(), 0)
            finally:
                sys.argv = old_argv
            self.assertTrue(out.exists())
            self.assertTrue(trails_out.exists())
            self.assertTrue(records_out.exists())
            self.assertEqual(json.loads(out.read_text())["schema_version"], 3)


if __name__ == "__main__":
    unittest.main()
