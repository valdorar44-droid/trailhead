from __future__ import annotations

import json
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse
from pathlib import Path

from scripts.build_explore_catalog_v3 import build_catalog
from scripts.explore_sources.base.aliases import aliases_for_category
from scripts.explore_sources.base.cards import build_card
from scripts.explore_sources.base.dedupe import dedupe_places
from scripts.explore_sources.base.fetch import parse_headers, resolve_input_paths
from scripts.explore_sources.base.quality import score_place
from scripts.explore_sources.base.schema import ExplorePlaceV3
from scripts.explore_sources.blm.import_blm import import_blm_fixture
from scripts.explore_sources.nps.fetch_nps import fetch_nps_parks_to_cache, fetch_nps_source_pack_to_cache, park_codes_for_item, request_params
from scripts.explore_sources.nps.import_nps import import_nps_fixture
from scripts.explore_sources.openbeta.import_openbeta import import_openbeta_fixture
from scripts.explore_sources.osm.import_geofabrik import import_osm_fixture
from scripts.explore_sources.ridb.fetch_ridb import fetch_ridb_facilities_to_cache, request_params as ridb_request_params
from scripts.explore_sources.ridb.import_ridb import import_ridb_fixture
from scripts.explore_sources.usfs.import_usfs import import_usfs_fixture
from scripts.explore_sources.wikidata.fetch_wikidata import fetch_wikidata_places_to_cache, sparql_query
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


class FakeHttpResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class FakeNpsOpener:
    def __init__(self):
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append((request, timeout))
        qs = parse_qs(urlparse(request.full_url).query)
        start = int(qs.get("start", ["0"])[0])
        page = [
            {
                "parkCode": "yose",
                "fullName": "Yosemite National Park",
                "latitude": "37.84883288",
                "longitude": "-119.5571873",
                "states": "CA",
                "designation": "National Park",
                "url": "https://www.nps.gov/yose/index.htm",
                "description": "Granite cliffs, waterfalls, and high Sierra wilderness.",
            },
            {
                "parkCode": "zion",
                "fullName": "Zion National Park",
                "latitude": "37.2982",
                "longitude": "-112.9478",
                "states": "UT",
                "designation": "National Park",
                "url": "https://www.nps.gov/zion/index.htm",
                "description": "Canyon hikes, river routes, and desert cliffs.",
            },
        ][start:start + 1]
        return FakeHttpResponse({"total": "2", "data": page})


class FakeNpsSourcePackOpener:
    def __init__(self):
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append((request, timeout))
        endpoint = urlparse(request.full_url).path.rstrip("/").split("/")[-1]
        if endpoint == "parks":
            return FakeHttpResponse({
                "total": "1",
                "data": [nps_rich_park()],
            })
        items = {
            "places": [{
                "id": "bridalveil-fall",
                "title": "Bridalveil Fall",
                "shortDescription": "A classic Yosemite waterfall viewpoint.",
                "latitude": "37.716",
                "longitude": "-119.647",
                "url": "https://www.nps.gov/places/bridalveil-fall.htm",
                "images": [{"url": "https://www.nps.gov/bride.jpg", "caption": "Bridalveil Fall", "credit": "NPS"}],
            }],
            "thingstodo": [{
                "id": "mist-trail",
                "title": "Mist Trail",
                "shortDescription": "Stone steps beside Vernal Fall and Nevada Fall.",
                "latLong": "lat:37.7325, long:-119.5586",
                "url": "https://www.nps.gov/thingstodo/mist-trail.htm",
                "images": [{"url": "https://www.nps.gov/mist.jpg", "caption": "Mist Trail", "credit": "NPS"}],
            }],
        }.get(endpoint, [])
        return FakeHttpResponse({"total": str(len(items)), "data": items})


def nps_rich_park() -> dict:
    return {
        "parkCode": "yose",
        "fullName": "Yosemite National Park",
        "latitude": "37.84883288",
        "longitude": "-119.5571873",
        "states": "CA",
        "designation": "National Park",
        "url": "https://www.nps.gov/yose/index.htm",
        "description": "Granite cliffs, waterfalls, and high Sierra wilderness.",
        "activities": [{"name": "Hiking"}, {"name": "Climbing"}],
        "topics": [{"name": "Waterfalls"}],
        "images": [{"url": "https://www.nps.gov/yose.jpg", "caption": "Yosemite Valley", "credit": "NPS"}],
        "entranceFees": [{"title": "Private Vehicle", "cost": "35.00"}],
        "operatingHours": [{"name": "Yosemite", "description": "Open 24 hours unless roads close."}],
    }


def nps_rich_payload() -> dict:
    return {
        "source": "nps",
        "endpoint": "source_pack",
        "data": [nps_rich_park()],
        "related": {
            "yose": {
                "thingstodo": [{
                    "id": "mist-trail",
                    "title": "Mist Trail",
                    "shortDescription": "Stone steps beside Vernal Fall and Nevada Fall.",
                    "latLong": "lat:37.7325, long:-119.5586",
                    "url": "https://www.nps.gov/thingstodo/mist-trail.htm",
                    "images": [{"url": "https://www.nps.gov/mist.jpg", "caption": "Mist Trail", "credit": "NPS"}],
                }],
                "places": [{
                    "id": "bridalveil-fall",
                    "title": "Bridalveil Fall",
                    "shortDescription": "A classic Yosemite waterfall viewpoint.",
                    "latitude": "37.716",
                    "longitude": "-119.647",
                    "url": "https://www.nps.gov/places/bridalveil-fall.htm",
                    "images": [{"url": "https://www.nps.gov/bride.jpg", "caption": "Bridalveil Fall", "credit": "NPS"}],
                }],
                "visitorcenters": [{
                    "id": "yosemite-valley-visitor-center",
                    "title": "Yosemite Valley Visitor Center",
                    "shortDescription": "Ranger information and exhibits.",
                    "latitude": "37.7486",
                    "longitude": "-119.5871",
                    "url": "https://www.nps.gov/places/yosemite-valley-visitor-center.htm",
                }],
                "campgrounds": [{
                    "id": "upper-pines",
                    "title": "Upper Pines Campground",
                    "shortDescription": "A reservable campground in Yosemite Valley.",
                    "latitude": "37.739",
                    "longitude": "-119.565",
                    "url": "https://www.nps.gov/places/upper-pines-campground.htm",
                }],
                "alerts": [{
                    "id": "road-work",
                    "title": "Road work",
                    "category": "Park Closure",
                    "url": "https://www.nps.gov/yose/planyourvisit/conditions.htm",
                }],
            }
        },
    }


class FakeRidbOpener:
    def __init__(self):
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append((request, timeout))
        qs = parse_qs(urlparse(request.full_url).query)
        offset = int(qs.get("offset", ["0"])[0])
        page = [
            {
                "FacilityID": "251974",
                "FacilityName": "Yosemite Valley Campground",
                "FacilityTypeDescription": "Campground",
                "FacilityLatitude": 37.742,
                "FacilityLongitude": -119.565,
                "FacilityState": "CA",
                "FacilityCity": "Yosemite Valley",
                "FacilityDescription": "Official campground facility record for Yosemite Valley.",
                "FacilityReservationURL": "https://www.recreation.gov/camping/campgrounds/251974",
                "Reservable": True,
            },
            {
                "FacilityID": "233336",
                "FacilityName": "Watchman Campground",
                "FacilityTypeDescription": "Campground",
                "FacilityLatitude": 37.2002,
                "FacilityLongitude": -112.9877,
                "FacilityState": "UT",
                "FacilityCity": "Springdale",
                "FacilityDescription": "Official campground facility record for Zion Canyon.",
                "FacilityReservationURL": "https://www.recreation.gov/camping/campgrounds/233336",
                "Reservable": True,
            },
        ][offset:offset + 1]
        return FakeHttpResponse({
            "METADATA": {"RESULTS": {"TOTAL_COUNT": 2, "CURRENT_COUNT": len(page)}},
            "RECDATA": page,
        })


class FakeWikidataOpener:
    def __init__(self):
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append((request, timeout))
        return FakeHttpResponse({
            "head": {"vars": ["item", "itemLabel", "coord"]},
            "results": {
                "bindings": [
                    {
                        "item": {"type": "uri", "value": "http://www.wikidata.org/entity/Q805806"},
                        "itemLabel": {"type": "literal", "value": "Baltoro Glacier"},
                        "itemDescription": {"type": "literal", "value": "Glacier in the Karakoram range."},
                        "class": {"type": "uri", "value": "http://www.wikidata.org/entity/Q35666"},
                        "classLabel": {"type": "literal", "value": "glacier"},
                        "coord": {"type": "literal", "value": "Point(76.3808 35.7364)"},
                        "countryLabel": {"type": "literal", "value": "Pakistan"},
                        "adminLabel": {"type": "literal", "value": "Gilgit-Baltistan"},
                        "image": {"type": "uri", "value": "http://commons.wikimedia.org/wiki/Special:FilePath/Baltoro_glacier_from_air.jpg"},
                    },
                    {
                        "item": {"type": "uri", "value": "http://www.wikidata.org/entity/Q780770"},
                        "itemLabel": {"type": "literal", "value": "Attabad Lake"},
                        "itemDescription": {"type": "literal", "value": "Lake in Hunza Valley."},
                        "class": {"type": "uri", "value": "http://www.wikidata.org/entity/Q23397"},
                        "classLabel": {"type": "literal", "value": "lake"},
                        "coord": {"type": "literal", "value": "Point(74.8675 36.33694)"},
                        "countryLabel": {"type": "literal", "value": "Pakistan"},
                        "adminLabel": {"type": "literal", "value": "Hunza District"},
                    },
                ]
            },
        })


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

    def test_nps_importer_builds_rich_source_pack(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nps_source_pack.json"
            path.write_text(json.dumps(nps_rich_payload()))

            records, places, trails = import_nps_fixture(path, fetched_at=123)

        self.assertEqual(len(records), 1)
        self.assertEqual(len(trails), 0)
        place = places[0]
        pack = place.source_pack
        self.assertEqual(pack["quality"], "official")
        self.assertEqual(pack["nps_park_code"], "yose")
        self.assertEqual(pack["fees"], ["Private Vehicle: $35"])
        self.assertIn("Open 24 hours", pack["operating_hours"])
        self.assertEqual(pack["alerts"][0]["title"], "Road work")
        self.assertEqual(pack["things_to_do"][0]["title"], "Mist Trail")
        self.assertAlmostEqual(pack["things_to_do"][0]["lat"], 37.7325)
        self.assertEqual(pack["things_to_see"][0]["title"], "Bridalveil Fall")
        self.assertEqual(pack["visitor_centers"][0]["title"], "Yosemite Valley Visitor Center")
        self.assertEqual(pack["campgrounds"][0]["title"], "Upper Pines Campground")
        self.assertTrue(any(item["url"] == "https://www.nps.gov/mist.jpg" for item in place.media))

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

    def test_source_url_fetches_to_cache_and_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "cache"
            headers = parse_headers(["X-Test: Trailhead"])
            paths = resolve_input_paths([], [NPS.as_uri()], source="nps", cache_dir=cache_dir, headers=headers)
            self.assertEqual(len(paths), 1)
            cached = Path(paths[0])
            self.assertTrue(cached.exists())
            self.assertEqual(cached.parent.name, "nps")
            records, places, _trails = import_nps_fixture(cached, fetched_at=123)
            self.assertEqual(len(records), 1)
            self.assertEqual(places[0].name, "Yosemite National Park")

    def test_nps_live_fetcher_pages_and_caches_official_parks(self):
        with tempfile.TemporaryDirectory() as tmp:
            opener = FakeNpsOpener()
            path = fetch_nps_parks_to_cache(
                api_key="test-key",
                cache_dir=tmp,
                park_codes=["yose", "zion"],
                limit=1,
                max_records=2,
                opener=opener,
            )
            payload = json.loads(path.read_text())
            self.assertEqual(payload["source"], "nps")
            self.assertEqual(payload["count"], 2)
            self.assertEqual([item["parkCode"] for item in payload["data"]], ["yose", "zion"])
            self.assertEqual(len(opener.requests), 2)
            first_request, timeout = opener.requests[0]
            self.assertEqual(timeout, 30.0)
            self.assertEqual(parse_qs(urlparse(first_request.full_url).query)["api_key"], ["test-key"])
            records, places, _trails = import_nps_fixture(path, fetched_at=123)
            self.assertEqual(len(records), 2)
            self.assertTrue(any(place.name == "Zion National Park" for place in places))
            cached_again = fetch_nps_parks_to_cache(
                api_key="test-key",
                cache_dir=tmp,
                park_codes=["yose", "zion"],
                limit=1,
                max_records=2,
                opener=opener,
            )
            self.assertEqual(cached_again, path)
            self.assertEqual(len(opener.requests), 2)

    def test_nps_source_pack_fetcher_caches_related_official_endpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            opener = FakeNpsSourcePackOpener()
            path = fetch_nps_source_pack_to_cache(
                api_key="test-key",
                cache_dir=tmp,
                park_codes=["yose"],
                limit=1,
                max_records=1,
                related_endpoints=["places", "thingstodo"],
                related_max_records=1,
                opener=opener,
            )
            payload = json.loads(path.read_text())
            endpoints = [urlparse(request.full_url).path.rstrip("/").split("/")[-1] for request, _timeout in opener.requests]
            self.assertEqual(payload["endpoint"], "source_pack")
            self.assertEqual(payload["count"], 1)
            self.assertEqual(payload["related"]["yose"]["places"][0]["title"], "Bridalveil Fall")
            self.assertEqual(payload["related"]["yose"]["thingstodo"][0]["title"], "Mist Trail")
            self.assertEqual(endpoints, ["parks", "places", "thingstodo"])
            records, places, _trails = import_nps_fixture(path, fetched_at=123)
            self.assertEqual(len(records), 1)
            self.assertEqual(places[0].source_pack["things_to_see"][0]["title"], "Bridalveil Fall")
            cached_again = fetch_nps_source_pack_to_cache(
                api_key="test-key",
                cache_dir=tmp,
                park_codes=["yose"],
                limit=1,
                max_records=1,
                related_endpoints=["places", "thingstodo"],
                related_max_records=1,
                opener=opener,
            )
            self.assertEqual(cached_again, path)
            self.assertEqual(len(opener.requests), 3)

    def test_nps_live_request_params(self):
        params = request_params(park_codes=["yose"], states=["CA", "UT"], query="waterfalls", limit=25, start=50)
        self.assertEqual(params["parkCode"], "yose")
        self.assertEqual(params["stateCode"], "CA,UT")
        self.assertEqual(params["q"], "waterfalls")
        self.assertEqual(params["limit"], 25)
        self.assertEqual(params["start"], 50)

    def test_nps_related_item_park_code_from_url(self):
        self.assertEqual(park_codes_for_item({"url": "https://www.nps.gov/yose/planyourvisit/mist-trail.htm"}), ["yose"])
        self.assertEqual(park_codes_for_item({"url": "https://www.nps.gov/places/bridalveil-fall.htm"}), [])

    def test_ridb_live_fetcher_pages_and_caches_official_facilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            opener = FakeRidbOpener()
            path = fetch_ridb_facilities_to_cache(
                api_key="ridb-key",
                cache_dir=tmp,
                states=["CA", "UT"],
                activities=["CAMPING"],
                query="campground",
                limit=1,
                max_records=2,
                opener=opener,
            )
            payload = json.loads(path.read_text())
            self.assertEqual(payload["source"], "ridb")
            self.assertEqual(payload["count"], 2)
            self.assertEqual([item["FacilityID"] for item in payload["RECDATA"]], ["251974", "233336"])
            self.assertEqual(len(opener.requests), 2)
            first_request, timeout = opener.requests[0]
            self.assertEqual(timeout, 30.0)
            self.assertEqual(first_request.headers["Apikey"], "ridb-key")
            records, places, _trails = import_ridb_fixture(path, fetched_at=123)
            self.assertEqual(len(records), 2)
            self.assertTrue(any(place.name == "Watchman Campground" and place.quality == "official_source" for place in places))
            cached_again = fetch_ridb_facilities_to_cache(
                api_key="ridb-key",
                cache_dir=tmp,
                states=["CA", "UT"],
                activities=["CAMPING"],
                query="campground",
                limit=1,
                max_records=2,
                opener=opener,
            )
            self.assertEqual(cached_again, path)
            self.assertEqual(len(opener.requests), 2)

    def test_ridb_live_request_params(self):
        params = ridb_request_params(
            states=["CA", "UT"],
            activities=["CAMPING"],
            query="campground",
            latitude=37.7,
            longitude=-119.5,
            radius=25,
            limit=20,
            offset=40,
        )
        self.assertEqual(params["state"], "CA,UT")
        self.assertEqual(params["activity"], "CAMPING")
        self.assertEqual(params["query"], "campground")
        self.assertEqual(params["latitude"], 37.7)
        self.assertEqual(params["longitude"], -119.5)
        self.assertEqual(params["radius"], 25)
        self.assertEqual(params["limit"], 20)
        self.assertEqual(params["offset"], 40)

    def test_wikidata_live_fetcher_caches_sparql_places(self):
        with tempfile.TemporaryDirectory() as tmp:
            opener = FakeWikidataOpener()
            path = fetch_wikidata_places_to_cache(
                cache_dir=tmp,
                class_qids=["Q35666", "Q23397"],
                country_qids=["Q843"],
                limit=2,
                opener=opener,
            )
            payload = json.loads(path.read_text())
            self.assertEqual(payload["source"], "wikidata")
            self.assertEqual(payload["count"], 2)
            self.assertEqual([item["qid"] for item in payload["records"]], ["Q805806", "Q780770"])
            self.assertEqual(len(opener.requests), 1)
            request, timeout = opener.requests[0]
            self.assertEqual(timeout, 90.0)
            self.assertIn("query.wikidata.org/sparql", request.full_url)
            records, places, _trails = import_wikidata_fixture(path, fetched_at=123)
            self.assertEqual(len(records), 2)
            baltoro = next(place for place in places if place.name == "Baltoro Glacier")
            self.assertEqual(baltoro.category, "glacier")
            self.assertTrue(baltoro.media)
            cached_again = fetch_wikidata_places_to_cache(
                cache_dir=tmp,
                class_qids=["Q35666", "Q23397"],
                country_qids=["Q843"],
                limit=2,
                opener=opener,
            )
            self.assertEqual(cached_again, path)
            self.assertEqual(len(opener.requests), 1)

    def test_wikidata_sparql_query_includes_class_and_country_filters(self):
        query = sparql_query(class_qids=["Q35666"], country_qids=["Q843"], limit=25)
        self.assertIn("wd:Q35666", query)
        self.assertIn("wd:Q843", query)
        self.assertIn("wdt:P31/wdt:P279*", query)
        self.assertIn("LIMIT 25", query)

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
            cache_dir = Path(tmp) / "source_cache"
            from scripts.build_explore_catalog_v3 import main
            import sys
            old_argv = sys.argv
            try:
                sys.argv = [
                    "build_explore_catalog_v3.py",
                    "--source-fixture", str(YOSEMITE),
                    "--ridb-fixture", str(RIDB),
                    "--nps-url", NPS.as_uri(),
                    "--usfs-fixture", str(USFS),
                    "--blm-fixture", str(BLM),
                    "--wikidata-fixture", str(WIKIDATA),
                    "--openbeta-fixture", str(OPENBETA),
                    "--source-cache-dir", str(cache_dir),
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
            self.assertTrue(any((cache_dir / "nps").glob("*.json")))
            self.assertEqual(json.loads(out.read_text())["schema_version"], 3)

    def test_build_catalog_accepts_cached_live_nps_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fetch_nps_parks_to_cache(
                api_key="test-key",
                cache_dir=tmp,
                park_codes=["yose"],
                limit=1,
                max_records=1,
                opener=FakeNpsOpener(),
            )
            _records, places, _trails = build_catalog(nps_fixtures=[str(path)])
            self.assertTrue(any(place.name == "Yosemite National Park" and place.category == "park" for place in places))

    def test_build_catalog_accepts_cached_live_ridb_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fetch_ridb_facilities_to_cache(
                api_key="ridb-key",
                cache_dir=tmp,
                states=["CA"],
                limit=1,
                max_records=1,
                opener=FakeRidbOpener(),
            )
            _records, places, _trails = build_catalog(ridb_fixtures=[str(path)])
            self.assertTrue(any(place.name == "Yosemite Valley Campground" and place.category == "campground" for place in places))

    def test_build_catalog_accepts_cached_live_wikidata_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = fetch_wikidata_places_to_cache(
                cache_dir=tmp,
                class_qids=["Q35666"],
                country_qids=["Q843"],
                limit=2,
                opener=FakeWikidataOpener(),
            )
            _records, places, _trails = build_catalog(wikidata_fixtures=[str(path)])
            self.assertTrue(any(place.name == "Baltoro Glacier" and place.category == "glacier" for place in places))


if __name__ == "__main__":
    unittest.main()
