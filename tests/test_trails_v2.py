import asyncio
import gzip
import hashlib
import json
import unittest
from unittest.mock import AsyncMock, patch

import dashboard.server as server
from dashboard.trails_v2 import build_trail_systems_v2, model_public


def profile(
    trail_id: str,
    name: str,
    coordinates=None,
    *,
    source: str = "osm",
    source_label: str = "OpenStreetMap",
    length_mi=None,
    allowed_uses=None,
    photos=None,
):
    geometry = None
    if coordinates:
        geometry = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coordinates},
                "properties": {"name": name},
            }],
        }
    return {
        "id": trail_id,
        "name": name,
        "lat": coordinates[0][1] if coordinates else 38.0,
        "lng": coordinates[0][0] if coordinates else -109.0,
        "length_mi": length_mi,
        "distance_mi": length_mi,
        "elevation_gain_ft": 0,
        "difficulty": "Moderate" if coordinates else "",
        "route_type": "Loop" if coordinates and coordinates[0] == coordinates[-1] else "Point-to-point" if coordinates else "",
        "surface": "Natural surface" if coordinates else "",
        "allowed_uses": allowed_uses,
        "activities": [allowed_uses] if allowed_uses else ["Hiking"],
        "geometry": geometry,
        "trailheads": [{"name": f"{name} Trailhead", "lat": 38.0, "lng": -109.0, "source": source_label}],
        "photos": photos or [],
        "source": source,
        "source_label": source_label,
        "official_url": "https://example.gov/trail" if source != "osm" else "",
        "provenance": {
            "activities": {"source": source_label if source != "osm" else "Trailhead inference"},
            "catalog": {"feature_type": "trail", "route_type": "Point-to-point" if coordinates else ""},
        },
        "last_checked": 123,
    }


class TrailsV2Tests(unittest.TestCase):
    def test_discovery_access_log_redacts_viewport_coordinates(self):
        record = server.logging.LogRecord(
            "uvicorn.access",
            server.logging.INFO,
            __file__,
            1,
            '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1", "GET", "/api/trails/v2/discover?lat=38.0&lng=-109.0", "1.1", 200),
            None,
        )

        server._SearchV2AccessLogPrivacyFilter().filter(record)

        self.assertEqual(record.args[2], "/api/trails/v2/discover?area=redacted")

    def test_official_geometry_is_complete_and_preserves_measured_zero(self):
        item = profile(
            "trail:usfs:gold-loop",
            "Gold Loop",
            [[-109.0, 38.0], [-109.01, 38.01], [-109.0, 38.0]],
            source="usfs",
            source_label="US Forest Service",
            length_mi=0,
            allowed_uses="Hiking",
        )

        systems = build_trail_systems_v2([item])
        self.assertEqual(len(systems), 1)
        system = systems[0]
        self.assertEqual(system.geometry_status, "complete")
        self.assertTrue(system.capabilities.highlight)
        self.assertTrue(system.capabilities.preview)
        self.assertEqual(system.facts.distance_mi, 0)
        self.assertEqual(system.facts.elevation_gain_ft, 0)
        self.assertEqual(system.permitted_uses, ["Hiking"])
        self.assertEqual(system.geometry["features"][0]["properties"]["trail_id"], "trail:usfs:gold-loop")

    def test_connected_named_osm_fragments_group_but_remain_partial(self):
        first = profile("osm:way:1", "Mill Creek Parkway", [[-109.0, 38.0], [-109.001, 38.001]], length_mi=0.2)
        second = profile("osm:way:2", "Mill Creek Parkway", [[-109.001, 38.001], [-109.002, 38.002]], length_mi=0.2)

        one = build_trail_systems_v2([first, second])[0]
        two = build_trail_systems_v2([second, first])[0]

        self.assertEqual(one.id, two.id)
        self.assertTrue(one.id.startswith("trail-system:osm:way:"))
        self.assertEqual(one.geometry_status, "partial")
        self.assertFalse(one.capabilities.highlight)
        self.assertEqual(one.member_trail_ids, ["osm:way:1", "osm:way:2"])
        self.assertEqual(len(one.geometry["features"]), 2)
        self.assertEqual(one.permitted_uses, [])

    def test_legacy_ui_fallbacks_are_not_exposed_as_trail_facts(self):
        item = profile("osm:way:1", "Above Abyss", [[-109.0, 38.0], [-109.001, 38.001]], length_mi=0.36)
        item["difficulty"] = "Scout first"
        item["route_type"] = "Mapped route"
        item["provenance"]["catalog"]["route_type"] = "Mapped route"

        system = build_trail_systems_v2([item])[0]

        self.assertIsNone(system.facts.difficulty)
        self.assertIsNone(system.facts.route_shape)
        self.assertEqual(system.facts.distance_mi, 0.36)

    def test_complete_authority_suppresses_same_name_fragments(self):
        official = profile(
            "trail:usfs:mill-creek",
            "Mill Creek Parkway",
            [[-109.0, 38.0], [-109.003, 38.003]],
            source="usfs",
            source_label="US Forest Service",
            allowed_uses="Hiking",
        )
        fragment = profile("osm:way:8", "Mill Creek Parkway", [[-109.0, 38.0], [-109.001, 38.001]])

        systems = build_trail_systems_v2([fragment, official])

        self.assertEqual(len(systems), 1)
        self.assertEqual(systems[0].primary_trail_id, "trail:usfs:mill-creek")
        self.assertEqual(systems[0].geometry_status, "complete")

    def test_distant_trails_with_the_same_name_remain_separate_systems(self):
        first = profile(
            "trail:nps:rim-north",
            "Rim Trail",
            [[-109.0, 38.0], [-109.01, 38.01]],
            source="nps",
            source_label="National Park Service",
            allowed_uses="Hiking",
        )
        second = profile(
            "trail:usfs:rim-south",
            "Rim Trail",
            [[-111.0, 36.0], [-111.01, 36.01]],
            source="usfs",
            source_label="US Forest Service",
            allowed_uses="Hiking",
        )

        systems = build_trail_systems_v2([first, second])

        self.assertEqual(len(systems), 2)
        self.assertEqual(
            {item.primary_trail_id for item in systems},
            {"trail:nps:rim-north", "trail:usfs:rim-south"},
        )

    def test_generated_and_technical_fragments_are_suppressed(self):
        generated = profile("osm:way:1", "Mapped trail", [[-109.0, 38.0], [-109.001, 38.001]])
        technical = profile("osm:way:2", "6S61", [[-109.0, 38.0], [-109.001, 38.001]])
        named = profile("osm:relation:3", "Rim Trail", [[-109.0, 38.0], [-109.01, 38.01]])

        systems = build_trail_systems_v2([generated, technical, named])

        self.assertEqual([item.name for item in systems], ["Rim Trail"])

    def test_osm_relation_geometry_is_a_complete_named_route(self):
        relation = profile("osm:relation:3", "Rim Trail", [[-109.0, 38.0], [-109.01, 38.01]])

        system = build_trail_systems_v2([relation])[0]

        self.assertEqual(system.geometry_status, "complete")
        self.assertTrue(system.capabilities.preview)

    def test_canonical_geometry_hint_is_complete_without_embedding_discovery_geometry(self):
        canonical = profile("trail:usfs:rim", "Rim Trail", None, source="usfs", source_label="US Forest Service")
        canonical["geometry_status_hint"] = "complete"
        canonical["geometry_revision"] = "sha256:artifact:trail:usfs:rim"

        system = build_trail_systems_v2([canonical])[0]

        self.assertEqual(system.geometry_status, "complete")
        self.assertEqual(system.geometry_revision, "sha256:artifact:trail:usfs:rim")
        self.assertIsNone(system.geometry)
        self.assertTrue(system.capabilities.preview)

    def test_routed_catalog_trailhead_opens_as_trail_but_point_stays_trailhead(self):
        routed = profile(
            "trail:usfs:arch-coulee",
            "Arch Coulee",
            [[-109.0, 38.0], [-109.01, 38.01]],
            source="usfs",
            source_label="US Forest Service",
        )
        routed["provenance"]["catalog"]["feature_type"] = "trailhead"
        point = profile(
            "place:usfs:arch-coulee-trailhead",
            "Arch Coulee Trailhead",
            None,
            source="usfs",
            source_label="US Forest Service",
        )
        point["provenance"]["catalog"]["feature_type"] = "trailhead"

        routed_system = build_trail_systems_v2([routed])[0]
        point_system = build_trail_systems_v2([point])[0]

        self.assertEqual(routed_system.geometry_status, "complete")
        self.assertEqual(routed_system.kind, "trail")
        self.assertEqual(point_system.geometry_status, "point")
        self.assertEqual(point_system.kind, "trailhead")

    def test_geometry_shard_parser_verifies_hash_and_reads_named_routes(self):
        line = json.dumps({
            "id": "trail:usfs:rim",
            "geometry": {"type": "LineString", "coordinates": [[-109.0, 38.0], [-109.01, 38.01]]},
        }, separators=(",", ":")).encode() + b"\n"
        payload = gzip.compress(line, mtime=0)
        digest = hashlib.sha256(payload).hexdigest()

        parsed = server._parse_canonical_trail_geometry_shard_v2(payload, digest)

        self.assertEqual(parsed["trail:usfs:rim"]["type"], "LineString")
        with self.assertRaises(ValueError):
            server._parse_canonical_trail_geometry_shard_v2(payload, "0" * 64)

    def test_only_exact_attributed_media_is_exposed(self):
        item = profile(
            "trail:usfs:rim",
            "Rim Trail",
            [[-109.0, 38.0], [-109.01, 38.01]],
            source="usfs",
            source_label="US Forest Service",
            photos=[
                {
                    "url": "https://images.example/rim.jpg",
                    "caption": "Rim Trail overlook",
                    "credit": "Park photographer",
                    "license": "CC BY 4.0",
                    "source_url": "https://example.gov/rim-trail",
                },
                {
                    "url": "https://images.example/mountain.jpg",
                    "caption": "A mountain elsewhere",
                    "credit": "Unknown",
                    "license": "CC BY 4.0",
                    "source_url": "https://example.org/mountain",
                },
            ],
        )

        media = build_trail_systems_v2([item])[0].media

        self.assertEqual(len(media), 1)
        self.assertEqual(media[0].caption, "Rim Trail overlook")

    def test_v2_discovery_detail_and_preview_use_same_resolved_system(self):
        official = profile(
            "trail:usfs:preview",
            "Preview Loop",
            [[-109.0, 38.0], [-109.01, 38.01], [-109.0, 38.0]],
            source="usfs",
            source_label="US Forest Service",
            allowed_uses="Hiking",
        )
        server._trail_system_v2_cache.clear()
        with patch.object(server, "_canonical_trail_geometry_revision_v2", new=AsyncMock(return_value="sha256:test")), patch.object(
            server, "_canonical_trail_profiles_near_v2", return_value=[official]
        ), patch.object(server, "list_trail_profiles_near", return_value=[]):
            discovery = asyncio.run(server.trails_discover_v2(lat=38.0, lng=-109.0, limit=20))
            trail_id = discovery["trails"][0]["id"]
            detail = asyncio.run(server.trail_system_v2(trail_id))
            preview = asyncio.run(server.trail_preview_v2(trail_id))

        self.assertEqual(discovery["version"], 2)
        self.assertEqual(detail["id"], trail_id)
        self.assertEqual(detail["geometry_status"], "complete")
        self.assertEqual(preview["geometry_revision"], detail["geometry_revision"])
        self.assertTrue(preview["preview_available"])
        self.assertNotIn("geometry", discovery["trails"][0])

    def test_public_payload_omits_missing_facts(self):
        point = profile("place:nps:trailhead:1", "Rim Trailhead", None, source="nps", source_label="National Park Service")
        payload = model_public(build_trail_systems_v2([point])[0])

        self.assertEqual(payload["geometry_status"], "point")
        self.assertNotIn("distance_mi", payload["facts"])
        self.assertNotIn("route_shape", payload["facts"])


if __name__ == "__main__":
    unittest.main()
