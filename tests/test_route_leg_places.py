import unittest
from unittest.mock import AsyncMock, patch

import dashboard.server as server
from dashboard.marine_chart_provider import MarineBounds, marine_chart_profile, nearest_marine_station, parse_ndbc_realtime
from dashboard import place_packs


class RouteLegPlaceProjectionTests(unittest.TestCase):
    def test_route_projection_on_multi_segment_leg(self):
        route = [[-109.0, 38.0], [-109.5, 38.0], [-109.5, 38.5]]
        item = {"name": "Mid leg camp", "lat": 38.25, "lng": -109.48}

        projected = server._annotate_route_candidate(item, server._route_points_from_lonlat(route), recommended_day=2)

        self.assertEqual(projected["recommended_day"], 2)
        self.assertEqual(projected["route_segment_index"], 1)
        self.assertGreater(projected["route_progress"], 0.5)
        self.assertLess(projected["route_distance_mi"], 2)

    def test_leg_scope_sort_prefers_route_fit_before_source_priority(self):
        near_osm = {"name": "Near OSM", "lat": 38.0, "lng": -109.01, "type": "viewpoint", "source": "osm"}
        far_nps = {"name": "Far NPS", "lat": 38.8, "lng": -109.8, "type": "viewpoint", "source": "nps"}
        route = server._route_points_from_lonlat([[-109.0, 38.0], [-109.5, 38.0]])
        for item in (near_osm, far_nps):
            server._annotate_route_candidate(item, route, recommended_day=1)

        sorted_items = sorted(
            [far_nps, near_osm],
            key=lambda p: (float(p["route_distance_mi"] if p.get("route_distance_mi") is not None else 9999), server._place_type_priority(p.get("type")), server._place_source_priority(p)),
        )

        self.assertEqual(sorted_items[0]["name"], "Near OSM")


class CampPackNormalizationTests(unittest.TestCase):
    def test_camp_pack_keeps_link_and_source_fields(self):
        point = place_packs._normalize_camp_source({
            "id": "123",
            "name": "Official Camp",
            "lat": 38.1,
            "lng": -109.2,
            "source": "ridb",
            "verified_source": "Recreation.gov",
            "official_url": "https://www.recreation.gov/camping/campgrounds/123",
            "booking_url": "https://www.recreation.gov/camping/campgrounds/123",
            "reservable": True,
            "amenities": ["Water"],
            "site_types": ["Tent"],
            "last_checked": 123456,
        })

        self.assertEqual(point["type"], "camp")
        self.assertEqual(point["source_badge"], "Recreation.gov")
        self.assertTrue(point["reservable"])
        self.assertIn("booking_url", point)
        self.assertEqual(point["amenities"], ["Water"])

    def test_water_pack_normalizes_access_fields(self):
        point = place_packs._normalize_overpass_element({
            "type": "node",
            "id": 99,
            "lat": 38.1,
            "lon": -109.2,
            "tags": {
                "leisure": "slipway",
                "name": "Sand Flats Boat Launch",
                "fishing": "yes",
                "access": "yes",
                "fee": "yes",
                "waterbody": "Colorado River",
            },
        })

        self.assertIsNotNone(point)
        self.assertEqual(point["type"], "water")
        self.assertEqual(point["subtype"], "boat_ramp")
        self.assertEqual(point["waterbody_name"], "Colorado River")
        self.assertEqual(point["access"], "fee")
        self.assertEqual(point["craft"], "motorboat")
        self.assertEqual(point["fishing_score_label"], "Strong evidence")
        self.assertIn("water", place_packs.PACK_DEFINITIONS)

    def test_water_pack_normalizes_navigation_hazards(self):
        point = place_packs._normalize_overpass_element({
            "type": "node",
            "id": 6201,
            "lat": 49.05,
            "lon": -94.55,
            "tags": {
                "seamark:type": "rock",
                "seamark:rock:water_level": "covers",
                "seamark:rock:depth": "1.2",
                "name": "Submerged Rock",
            },
        })

        self.assertIsNotNone(point)
        self.assertEqual(point["type"], "water")
        self.assertEqual(point["subtype"], "water_hazard")
        self.assertEqual(point["source_badge"], "OpenSeaMap / OSM")
        self.assertEqual(point["hazard_type"], "Covers")
        self.assertAlmostEqual(point["depth_ft"], 3.9)
        self.assertIn("CHS chart 6201", point["chart_source"])
        self.assertIn("water_navigation", point["tags"])

    def test_water_navigation_line_feature_normalizes_recommended_track(self):
        feature = server._water_nav_line_feature({
            "type": "way",
            "id": 42,
            "tags": {
                "seamark:type": "recommended_track",
                "name": "Safe Passage",
                "seamark:recommended_track:maximum_draught": "6 ft",
            },
            "geometry": [
                {"lat": 49.0, "lon": -94.6},
                {"lat": 49.1, "lon": -94.5},
            ],
        })

        self.assertIsNotNone(feature)
        self.assertEqual(feature["geometry"]["type"], "LineString")
        self.assertEqual(feature["properties"]["kind"], "recommended_track")
        self.assertEqual(feature["properties"]["label"], "Recommended track")
        self.assertEqual(feature["properties"]["max_draft"], "6 ft")
        self.assertEqual(feature["properties"]["max_draft_ft"], 6.0)

    def test_water_navigation_point_feature_normalizes_lateral_marker(self):
        feature = server._water_nav_point_feature({
            "type": "node",
            "id": 6202,
            "lat": 49.05,
            "lon": -94.55,
            "tags": {
                "seamark:type": "buoy_lateral",
                "seamark:buoy_lateral:colour": "green",
                "seamark:buoy_lateral:shape": "can",
                "seamark:light:character": "Fl G 4s",
                "name": "Green Can 3",
            },
        })

        self.assertIsNotNone(feature)
        self.assertEqual(feature["geometry"]["type"], "Point")
        self.assertEqual(feature["properties"]["kind"], "navigation_aid")
        self.assertEqual(feature["properties"]["subtype"], "navigation_aid")
        self.assertEqual(feature["properties"]["marker_color"], "green")
        self.assertEqual(feature["properties"]["code"], "G")
        self.assertEqual(feature["properties"]["mark_shape"], "Can")

    def test_marine_chart_profile_lotw_includes_bathymetry_and_buoy(self):
        profile = marine_chart_profile(MarineBounds(north=49.25, south=48.85, east=-94.2, west=-95.0))
        source_ids = {source["id"] for source in profile["sources"]}

        self.assertEqual(profile["region"], "lake_of_the_woods")
        self.assertIn("chs_nonna", source_ids)
        self.assertIn("mn_dnr_lake_bathymetry", source_ids)
        self.assertIn("ndbc_45148", source_ids)

    def test_lotw_conditions_parse_ndbc_realtime(self):
        station = nearest_marine_station(49.0, -94.5)
        payload = parse_ndbc_realtime(
            """#YY  MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS TIDE
2026 05 27 16 00 140 12.0 18.0 0.7 4 3.2 120 1007.1 18.0 11.5 15.0 MM MM
""",
            station,
        )

        self.assertIsNotNone(payload)
        self.assertEqual(payload["station"]["id"], "45148")
        self.assertAlmostEqual(payload["wave_height_ft"], 2.3)
        self.assertAlmostEqual(payload["gust_mph"], 20.7)
        self.assertEqual(payload["crossing_risk"]["label"], "Moderate")


class CampLinkResolverTests(unittest.IsolatedAsyncioTestCase):
    async def test_recreation_link_falls_back_to_search_on_bad_get(self):
        class FakeResponse:
            status_code = 404
            text = "page not found"
            url = "https://www.recreation.gov/error"

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, url):
                return FakeResponse()

        place = {
            "name": "Needles Campground",
            "source": "ridb",
            "source_place_id": "123",
            "official_url": "https://www.recreation.gov/camping/campgrounds/123",
        }
        with (
            patch.object(server, "get_cached", return_value=None),
            patch.object(server, "set_cached"),
            patch.object(server.httpx, "AsyncClient", return_value=FakeClient()),
        ):
            resolved = await server._resolve_camp_link(place, place["official_url"], reservable=True)

        self.assertEqual(resolved["label"], "Search official site")
        self.assertIn("recreation.gov/search", resolved["url"])


class ValhallaAreaRoutingTests(unittest.IsolatedAsyncioTestCase):
    def tearDown(self):
        server.settings.valhalla_url = "https://valhalla1.openstreetmap.de"
        server.settings.valhalla_area_urls = ""

    def test_valhalla_area_selector_uses_matching_bounds(self):
        server.settings.valhalla_area_urls = (
            '[{"id":"midwest","url":"http://midwest:8002",'
            '"bounds":{"s":36,"w":-98,"n":50,"e":-80},"states":["MN","WI","IL","IN","MI","OH"]}]'
        )

        target = server._select_valhalla_target([
            {"lat": 41.8781, "lon": -87.6298},
            {"lat": 42.3314, "lon": -83.0458},
        ])

        self.assertEqual(target["id"], "midwest")
        self.assertEqual(target["url"], "http://midwest:8002")

    def test_valhalla_area_selector_falls_back_for_cross_area_route(self):
        server.settings.valhalla_url = "http://default:8002"
        server.settings.valhalla_area_urls = (
            '[{"id":"midwest","url":"http://midwest:8002",'
            '"bounds":{"s":36,"w":-98,"n":50,"e":-80}}]'
        )

        target = server._select_valhalla_target([
            {"lat": 41.8781, "lon": -87.6298},
            {"lat": 34.0522, "lon": -118.2437},
        ])

        self.assertEqual(target["id"], "default")
        self.assertEqual(target["url"], "http://default:8002")

    def test_route_cache_key_includes_valhalla_target(self):
        payload = server._route_payload(
            [{"lat": 41.8781, "lon": -87.6298}, {"lat": 42.3314, "lon": -83.0458}],
            server.RouteOptions(),
            "miles",
        )

        self.assertNotEqual(
            server._route_cache_key(payload, "midwest"),
            server._route_cache_key(payload, "east"),
        )

    async def test_coverage_probe_reports_valhalla_success(self):
        class FakeResponse:
            status_code = 200
            text = ""

            def json(self):
                return {"trip": {"status": 0, "status_message": "Found route", "summary": {"length": 12.5, "time": 900}}}

        class FakeClient:
            async def post(self, url, json, timeout):
                return FakeResponse()

        probe = server.VALHALLA_COVERAGE_PROBES[0]
        result = await server._run_valhalla_coverage_probe(FakeClient(), probe)

        self.assertTrue(result["ok"])
        self.assertEqual(result["engine"], "valhalla")
        self.assertFalse(result["fallback_expected"])
        self.assertEqual(result["length"], 12.5)

    async def test_coverage_probe_posts_to_selected_area_url(self):
        server.settings.valhalla_area_urls = (
            '[{"id":"west","url":"http://west:8002",'
            '"bounds":{"s":31,"w":-125,"n":50,"e":-102}}]'
        )
        seen = {}

        class FakeResponse:
            status_code = 200
            text = ""

            def json(self):
                return {"trip": {"status": 0, "status_message": "Found route", "summary": {"length": 12.5, "time": 900}}}

        class FakeClient:
            async def post(self, url, json, timeout):
                seen["url"] = url
                return FakeResponse()

        probe = next(p for p in server.VALHALLA_COVERAGE_PROBES if p["id"] == "moab_big_sur")
        result = await server._run_valhalla_coverage_probe(FakeClient(), probe)

        self.assertTrue(result["ok"])
        self.assertEqual(result["target"], "west")
        self.assertEqual(seen["url"], "http://west:8002/route")

    async def test_coverage_probe_marks_missing_edges_as_expected_fallback(self):
        class FakeResponse:
            status_code = 200
            text = ""

            def json(self):
                return {"trip": {"status": 171, "status_message": "No suitable edges near location"}}

        class FakeClient:
            async def post(self, url, json, timeout):
                return FakeResponse()

        probe = next(p for p in server.VALHALLA_COVERAGE_PROBES if p["id"] == "seattle_boise")
        result = await server._run_valhalla_coverage_probe(FakeClient(), probe)

        self.assertFalse(result["ok"])
        self.assertTrue(result["fallback_expected"])
        self.assertEqual(result["error"], "No suitable edges near location")
        self.assertEqual(result["region"], "pacific_northwest_to_idaho")

    async def test_coverage_probe_parses_valhalla_http_error_json(self):
        class FakeResponse:
            status_code = 400
            text = '{"error_code":171,"error":"No suitable edges near location"}'

            def json(self):
                return {"error_code": 171, "error": "No suitable edges near location"}

        class FakeClient:
            async def post(self, url, json, timeout):
                return FakeResponse()

        probe = server.VALHALLA_COVERAGE_PROBES[3]
        result = await server._run_valhalla_coverage_probe(FakeClient(), probe)

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], 400)
        self.assertEqual(result["valhalla_status"], 171)
        self.assertEqual(result["error"], "No suitable edges near location")

    async def test_route_proxy_drops_optional_side_stops_before_valhalla(self):
        server.settings.valhalla_url = "http://default:8002"
        seen = {}

        class FakeResponse:
            status_code = 200
            text = ""

            def json(self):
                return {"trip": {"status": 0, "status_message": "Found route", "summary": {"length": 10, "time": 600}}}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def post(self, url, json):
                seen["url"] = url
                seen["payload"] = json
                return FakeResponse()

        body = server.RouteRequest(
            locations=[
                {"lat": 38.5733, "lon": -109.5498, "type": "break"},
                {"lat": 38.57, "lon": -109.54, "type": "side_stop"},
                {"lat": 38.5677, "lon": -109.5271, "type": "break"},
            ],
            options=server.RouteOptions(),
            units="miles",
        )

        with (
            patch.object(server, "get_route_cached", return_value=None),
            patch.object(server, "set_route_cached"),
            patch.object(server.httpx, "AsyncClient", return_value=FakeClient()),
        ):
            result = await server.route_proxy(body)

        self.assertEqual(seen["url"], "http://default:8002/route")
        self.assertEqual(len(seen["payload"]["locations"]), 2)
        self.assertTrue(all(loc["type"] == "break" for loc in seen["payload"]["locations"]))
        self.assertEqual(result["_trailhead"]["engine"], "valhalla")
        self.assertEqual(result["_trailhead"]["repair"], "dropped_optional_points")
        self.assertEqual(result["_trailhead"]["dropped_optional_points"], 1)


if __name__ == "__main__":
    unittest.main()
