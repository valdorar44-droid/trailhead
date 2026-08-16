from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import dashboard.server as server
from dashboard.search_v2 import (
    SearchBoundsV2,
    SearchCenterV2,
    SearchCursorError,
    SearchDocumentV2,
    SearchProvenanceV2,
    SearchRequestV2,
    SearchResolveRequestV2,
    SearchResultV2,
    SearchV2Service,
    documents_from_canonical,
)


def _document(
    result_id: str,
    title: str,
    *,
    kind: str = "destination",
    categories: tuple[str, ...] | None = None,
    aliases: tuple[str, ...] = (),
    lat: float | None = 38.5733,
    lng: float | None = -109.5498,
    difficulty: tuple[str, ...] = (),
    surface: tuple[str, ...] = (),
    activities: tuple[str, ...] = (),
    verified: bool = True,
    quality_score: float = 95,
    parent: str = "Utah",
) -> SearchDocumentV2:
    return SearchDocumentV2(
        result_id=result_id,
        canonical_place_id=result_id,
        title=title,
        subtitle=f"{title}, Utah",
        kind=kind,
        categories=categories or (kind,),
        lat=lat,
        lng=lng,
        parent=parent,
        aliases=aliases,
        provider="trailhead",
        source_label="Trailhead",
        detail_ref=result_id,
        quality_score=quality_score,
        difficulty=difficulty,
        surface=surface,
        activities=activities,
        verified=verified,
    )


def _fixture_documents() -> list[SearchDocumentV2]:
    return [
        _document("destination:moab-utah", "Moab", aliases=("Moab Utah",)),
        _document(
            "destination:arches", "Arches",
            aliases=("Arches National Park",), lat=38.7331, lng=-109.5925,
        ),
        _document(
            "camp:moab-desert", "Moab Desert Campground", kind="camp",
            categories=("camp", "campground"), lat=38.61, lng=-109.57,
        ),
        *[
            _document(
                f"trail:moab-{index:02d}", f"Moab Trail {index:02d}",
                kind="trail", categories=("trail", "hiking"),
                activities=("hiking",),
                lat=38.60 + index / 1000, lng=-109.60 - index / 1000,
            )
            for index in range(12)
        ],
    ]


def _fixture_service(*, external_provider=None, timeout: float = 0.2) -> SearchV2Service:
    documents = _fixture_documents()
    return SearchV2Service(
        lambda: (documents, "fixture-v1"),
        external_provider,
        external_timeout_seconds=timeout,
    )


class SearchV2ServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_destination_context_is_private_and_does_not_change_request_schema(self):
        request = SearchRequestV2(query="Moab Utah")
        request._destination_context = True
        request._destination_query = "moab"
        request._destination_country = "US"
        request._remote_category_context = True
        request._remote_category = "fuel"
        request._remote_destination_query = "Flagstaff"
        request._remote_destination_country = "US"

        self.assertEqual(
            set(SearchRequestV2.model_json_schema()["properties"]),
            {
                "query", "surface", "intent", "scope", "center", "bounds",
                "route_ref", "radius_meters", "categories", "filters", "cursor",
                "limit", "session_id", "include_external",
            },
        )
        self.assertNotIn("destination", json.dumps(request.model_dump()))
        self.assertNotIn("remote_category", json.dumps(request.model_dump()))

    async def test_moab_destination_exact_identity_wins(self):
        service = _fixture_service()
        response = await service.resolve(SearchRequestV2(
            query="Moab", intent="destination", include_external=False,
        ))

        self.assertEqual(response.status, "resolved")
        self.assertIsNotNone(response.selected)
        self.assertEqual(response.selected.result_id, "destination:moab-utah")
        self.assertEqual(response.selected.match_reason, "exact_title")
        self.assertEqual(response.selected.persistence_policy, "canonical")

    async def test_typo_and_aliases_are_deterministic(self):
        service = _fixture_service()

        typo = await service.page(SearchRequestV2(
            query="moba", intent="destination", include_external=False,
        ))
        alias = await service.page(SearchRequestV2(
            query="Arches National Park", intent="destination", include_external=False,
        ))

        self.assertEqual(typo.results[0].result_id, "destination:moab-utah")
        self.assertEqual(alias.results[0].result_id, "destination:arches")
        self.assertEqual(alias.results[0].match_reason, "exact_alias")

    def test_canonical_conversion_preserves_explicit_facets_and_verification(self):
        documents = documents_from_canonical(
            [{
                "id": "place:unverified",
                "title": "Moab Scenic Stop",
                "category": "viewpoint",
                "tags": "Scenic Driving",
                "activity": ["Driving", "Photography"],
                "verified": False,
                "enrichment_score": 99,
            }],
            [{
                "id": "trail:facets",
                "name": "Moab Facet Trail",
                "activity": "Hiking trail",
                "allowed_uses": ["Hiking", "Horseback riding"],
                "difficulty": "Moderate",
                "surface": "Natural surface",
                "verified": True,
                "quality_score": 92,
            }],
        )

        place, trail = documents
        self.assertFalse(place.verified)
        self.assertEqual(place.quality_score, 99)
        self.assertIn("scenic_driving", place.categories)
        self.assertEqual(place.activities, ("driving", "photography"))
        self.assertTrue(trail.verified)
        self.assertEqual(trail.difficulty, ("moderate",))
        self.assertEqual(trail.surface, ("natural_surface",))
        self.assertEqual(
            trail.activities,
            ("hiking_trail", "hiking", "horseback_riding"),
        )

    async def test_real_explore_taxonomy_maps_serving_rows_to_intents_and_facets(self):
        def serving_row(
            slug: str, category: str, group: str,
        ) -> dict[str, object]:
            return {
                "id": f"place:serving:{slug}",
                "title": f"Moab {slug.replace('_', ' ').title()}",
                "category": category,
                "group": group,
                "description": f"Representative {category} serving row.",
                "lat": 38.5733,
                "lng": -109.5498,
                "verified": True,
                "enrichment_score": 90,
                "provenance": {
                    "primary": {"attribution": "Official source"},
                },
            }

        rows = [
            serving_row("campground", "campground", "camping"),
            serving_row("rv_park", "rv_park", "camping"),
            serving_row("dispersed_camp", "dispersed_camp", "camping"),
            serving_row("overnight_parking", "overnight_parking", "camping"),
            serving_row("private_camp", "private_camp", "camping"),
            serving_row("glamping", "glamping", "lodging"),
            serving_row("lodging", "lodging", "lodging"),
            serving_row("offroad_route", "offroad_route", "trails"),
            serving_row("forest_road", "forest_road", "trails"),
            serving_row("viewpoint", "viewpoint", "viewpoint"),
            serving_row("peak", "peak", "viewpoint"),
            serving_row("scenic_drive", "scenic_drive", "drives"),
            serving_row("historic", "historic", "historic"),
            serving_row("public_land", "public_land", "parks"),
            serving_row("parks", "parks", "parks"),
            serving_row("visitor_center", "visitor_center", "things"),
            serving_row("activity", "activity", "things"),
        ]
        documents = documents_from_canonical(rows, [])
        self.assertEqual(len(documents), len(rows))
        service = SearchV2Service(lambda: (documents, "serving-taxonomy-v1"))

        camp_ids = {
            "place:serving:campground",
            "place:serving:rv_park",
            "place:serving:dispersed_camp",
            "place:serving:overnight_parking",
            "place:serving:private_camp",
            "place:serving:glamping",
            "place:serving:lodging",
        }
        camps = await service.page(SearchRequestV2(
            query="Moab", intent="camp", limit=30,
        ))
        self.assertEqual({item.result_id for item in camps.results}, camp_ids)

        selectors = {
            "camp": camp_ids,
            "huts": {
                "place:serving:glamping", "place:serving:lodging",
            },
            "trails": {
                "place:serving:offroad_route", "place:serving:forest_road",
            },
            "views": {
                "place:serving:viewpoint", "place:serving:peak",
                "place:serving:scenic_drive",
            },
            "scenic": {
                "place:serving:viewpoint", "place:serving:peak",
                "place:serving:scenic_drive", "place:serving:historic",
            },
            "land": {"place:serving:public_land"},
            "parks": {
                "place:serving:public_land", "place:serving:parks",
            },
            "things": {
                "place:serving:viewpoint", "place:serving:peak",
                "place:serving:scenic_drive", "place:serving:historic",
                "place:serving:visitor_center", "place:serving:activity",
            },
        }
        for selector, expected_ids in selectors.items():
            with self.subTest(selector=selector):
                response = await service.page(SearchRequestV2(
                    query="Moab", categories=[selector], limit=30,
                ))
                self.assertTrue(response.results)
                self.assertEqual(
                    {item.result_id for item in response.results}, expected_ids,
                )

        trails = await service.page(SearchRequestV2(
            query="Moab", intent="trail", limit=30,
        ))
        self.assertEqual(
            {item.result_id for item in trails.results},
            {"place:serving:offroad_route", "place:serving:forest_road"},
        )

        destinations = await service.page(SearchRequestV2(
            query="Moab", intent="destination", limit=30,
        ))
        self.assertEqual(
            {item.result_id for item in destinations.results},
            {"place:serving:public_land", "place:serving:parks"},
        )

        category_filter = await service.page(SearchRequestV2(
            query="Moab", filters={"category": "camp"}, limit=30,
        ))
        self.assertEqual(
            {item.result_id for item in category_filter.results}, camp_ids,
        )

    async def test_service_taxonomy_keeps_fuel_and_supplies_online_offline_parity(self):
        fuel_categories = {
            "fuel", "gas_station", "service_station", "propane", "dump",
        }
        supply_categories = {
            "grocery", "market", "mechanic", "repair", "supplies", "hardware",
            "parts",
        }
        rows = [
            {
                "id": f"place:service:{category}",
                "title": f"Moab {category.replace('_', ' ').title()}",
                "category": category,
                "group": "fuel" if category in fuel_categories else "resupply",
                "description": f"Representative {category} serving row.",
                "lat": 38.5733,
                "lng": -109.5498,
                "verified": True,
                "enrichment_score": 90,
            }
            for category in sorted(fuel_categories | supply_categories)
        ]
        rows.append({
            "id": "place:service:water",
            "title": "Moab Water",
            "category": "water",
            "group": "water",
            "description": "Representative water serving row.",
            "lat": 38.5733,
            "lng": -109.5498,
            "verified": True,
            "enrichment_score": 90,
        })
        documents = documents_from_canonical(rows, [])
        self.assertEqual(len(documents), len(rows))
        self.assertTrue(all(document.kind == "service" for document in documents))
        service = SearchV2Service(lambda: (documents, "serving-services-v1"))

        expected_by_selector = {
            "fuel": {f"place:service:{value}" for value in fuel_categories},
            "resupply": {f"place:service:{value}" for value in supply_categories},
        }
        for selector, expected_ids in expected_by_selector.items():
            with self.subTest(selector=selector):
                online = await service.page(SearchRequestV2(
                    query="Moab", categories=[selector], limit=30,
                ))
                offline = await service.page(SearchRequestV2(
                    query="Moab", scope="offline", categories=[selector], limit=30,
                ))
                self.assertEqual(
                    {item.result_id for item in online.results}, expected_ids,
                )
                self.assertEqual(
                    {item.result_id for item in offline.results}, expected_ids,
                )

        service_results = await service.page(SearchRequestV2(
            query="Moab", intent="service", limit=30,
        ))
        self.assertEqual(
            {item.result_id for item in service_results.results},
            {f"place:service:{value}" for value in fuel_categories | supply_categories | {"water"}},
        )

    async def test_external_service_rows_use_the_same_fuel_and_supplies_facets(self):
        external_by_selector = {
            "fuel": ["fuel", "gas_station", "service_station", "propane", "dump"],
            "resupply": [
                "grocery", "market", "mechanic", "repair", "supplies", "hardware",
                "parts",
            ],
        }

        async def provider(request, limit, _mode):
            selector = request.categories[0] if request.categories else ""
            categories = external_by_selector.get(selector, ["service", "water"])
            return [SearchResultV2(
                result_id=f"mapbox:poi.{category}",
                title=f"Moab {category.replace('_', ' ').title()}",
                kind="place",
                categories=[category],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id=f"poi.{category}",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref=f"provider:mapbox:poi.{category}:signed",
                score=100_000,
                match_reason="provider_fallback",
            ) for category in categories[:limit]]

        service = SearchV2Service(lambda: ([], "external-services-v1"), provider)
        for selector, categories in external_by_selector.items():
            with self.subTest(selector=selector):
                response = await service.page(SearchRequestV2(
                    query="Moab", intent="service", categories=[selector],
                    include_external=True,
                    session_id=f"external-service-{selector}", limit=10,
                ))
                self.assertEqual(
                    {item.categories[0] for item in response.results},
                    set(categories),
                )

        generic_services = await service.page(SearchRequestV2(
            query="Moab", intent="service", include_external=True,
            session_id="external-service-generic", limit=10,
        ))
        self.assertEqual(
            {item.categories[0] for item in generic_services.results},
            {"service", "water"},
        )

    async def test_short_typeahead_prefix_prefers_matching_titles(self):
        service = _fixture_service()

        response = await service.page(SearchRequestV2(
            query="Mo", include_external=False, limit=8,
        ), mode="suggest")

        self.assertGreater(len(response.results), 0)
        self.assertEqual(response.results[0].result_id, "destination:moab-utah")
        self.assertEqual(response.results[0].match_reason, "title_prefix")

    async def test_cursor_pagination_is_stable_and_non_overlapping(self):
        service = _fixture_service()
        request = SearchRequestV2(
            query="Moab Trail", intent="trail", include_external=False, limit=5,
        )

        first = await service.page(request)
        second = await service.page(request.model_copy(update={"cursor": first.next_cursor}))
        third = await service.page(request.model_copy(update={"cursor": second.next_cursor}))

        first_ids = {item.result_id for item in first.results}
        second_ids = {item.result_id for item in second.results}
        third_ids = {item.result_id for item in third.results}
        self.assertEqual(len(first.results), 5)
        self.assertEqual(len(second.results), 5)
        self.assertEqual(len(third.results), 2)
        self.assertFalse(first_ids & second_ids)
        self.assertFalse(first_ids & third_ids)
        self.assertFalse(second_ids & third_ids)
        self.assertFalse(third.has_more)
        self.assertIsNone(third.next_cursor)

    async def test_first_ten_results_payload_is_compact(self):
        service = _fixture_service()
        response = await service.page(SearchRequestV2(
            query="Moab Trail", intent="trail", include_external=False, limit=10,
        ))

        encoded = response.model_dump_json().encode("utf-8")
        self.assertEqual(len(response.results), 10)
        self.assertLess(len(encoded), 100_000)
        self.assertNotIn(b"raw_feature", encoded)
        self.assertNotIn(b"route_geometry", encoded)

    async def test_external_results_are_explicitly_temporary(self):
        async def provider(_request, _limit, _mode):
            return [SearchResultV2(
                result_id="mapbox:place.moab",
                title="Moab",
                subtitle="Utah, United States",
                kind="destination",
                categories=["destination"],
                coordinates=SearchCenterV2(lat=38.5733, lng=-109.5498),
                provenance=SearchProvenanceV2(
                    provider="mapbox",
                    source_label="Mapbox search",
                    provider_result_id="place.moab",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.moab",
                score=100_000,
                match_reason="provider_fallback",
            )]

        service = SearchV2Service(lambda: ([], "empty-v1"), provider)
        response = await service.page(SearchRequestV2(
            query="Moab", intent="destination", include_external=True,
            session_id="session-external",
        ))

        self.assertEqual(len(response.results), 1)
        result = response.results[0]
        self.assertEqual(result.persistence_policy, "temporary")
        self.assertTrue(result.provenance.temporary_use_only)
        self.assertIsNone(result.canonical_place_id)

    async def test_query_only_resolve_never_auto_selects_unresolved_external_suggestion(self):
        async def provider(_request, _limit, _mode):
            return [SearchResultV2(
                result_id="mapbox:place.moab",
                title="Moab",
                kind="destination",
                categories=["destination"],
                coordinates=None,
                provenance=SearchProvenanceV2(
                    provider="mapbox",
                    source_label="Mapbox search",
                    provider_result_id="place.moab",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.moab:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        service = SearchV2Service(lambda: ([], "empty-v1"), provider)
        response = await service.resolve(SearchRequestV2(
            query="Moab",
            intent="destination",
            include_external=True,
            session_id="legacy-external-session",
        ))

        self.assertEqual(response.status, "ambiguous")
        self.assertIsNone(response.selected)
        self.assertEqual(response.reason, "explicit_selection_required")
        self.assertEqual(response.alternatives[0].result_id, "mapbox:place.moab")

    async def test_external_deadline_cancels_slow_provider(self):
        cancelled = asyncio.Event()

        async def provider(_request, _limit, _mode):
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                cancelled.set()
                raise

        service = SearchV2Service(
            lambda: ([], "empty-v1"), provider, external_timeout_seconds=0.01,
        )
        response = await service.page(SearchRequestV2(
            query="Moab", include_external=True, session_id="session-timeout",
        ))

        self.assertEqual(response.results, [])
        self.assertTrue(cancelled.is_set())

    async def test_viewport_bounds_use_spatial_index(self):
        service = _fixture_service()
        response = await service.page(SearchRequestV2(
            query="Moab",
            scope="viewport",
            bounds=SearchBoundsV2(west=-109.58, south=38.55, east=-109.52, north=38.63),
            include_external=False,
        ))

        self.assertIn("destination:moab-utah", {item.result_id for item in response.results})
        self.assertNotIn("destination:arches", {item.result_id for item in response.results})

    async def test_nearby_radius_is_applied_to_canonical_results(self):
        service = _fixture_service()
        response = await service.page(SearchRequestV2(
            query="Moab",
            scope="nearby",
            center=SearchCenterV2(lat=38.5733, lng=-109.5498),
            radius_meters=3_000,
            include_external=False,
        ))

        self.assertEqual(
            [item.result_id for item in response.results],
            ["destination:moab-utah"],
        )

    async def test_offline_scope_never_invokes_external_provider(self):
        calls = 0

        async def provider(_request, _limit, _mode):
            nonlocal calls
            calls += 1
            return []

        service = _fixture_service(external_provider=provider)
        response = await service.page(SearchRequestV2(
            query="Moab", scope="offline", include_external=False,
        ))

        self.assertGreater(len(response.results), 0)
        self.assertEqual(calls, 0)
        self.assertEqual(response.source_counts["external"], 0)

    async def test_provider_deadline_is_mode_aware_for_suggest_and_results(self):
        observed_timeouts: list[float] = []

        async def provider(_request, _limit, _mode):
            return []

        real_wait_for = asyncio.wait_for

        async def tracked_wait_for(awaitable, *, timeout):
            observed_timeouts.append(timeout)
            return await real_wait_for(awaitable, timeout=timeout)

        service = SearchV2Service(
            lambda: ([], "mode-timeout-v1"), provider,
            external_timeout_seconds=4.5,
        )
        with patch("dashboard.search_v2.asyncio.wait_for", side_effect=tracked_wait_for):
            await service.page(SearchRequestV2(
                query="Moab", include_external=True,
                session_id="mode-timeout-suggest",
            ), mode="suggest")
            await service.page(SearchRequestV2(
                query="Moab", include_external=True,
                session_id="mode-timeout-results",
            ), mode="results")

        self.assertEqual(observed_timeouts, [2.5, 4.5])

    async def test_external_cache_is_bounded_hashed_and_rate_limited(self):
        calls = 0

        async def provider(request, _limit, _mode):
            nonlocal calls
            calls += 1
            return [SearchResultV2(
                result_id=f"mapbox:{request.query.lower()}",
                title=request.query,
                kind="destination",
                categories=["destination"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
            )]

        service = SearchV2Service(
            lambda: ([], "empty-v1"),
            provider,
            external_cache_max_entries=2,
            external_session_rate_limit=1,
        )
        request = SearchRequestV2(
            query="Private cabin address", include_external=True,
            session_id="session-private",
        )
        first = await service.page(request)
        cached = await service.page(request)
        rate_limited = await service.page(request.model_copy(update={"query": "Another address"}))

        self.assertEqual(calls, 1)
        self.assertEqual(first.results[0].result_id, cached.results[0].result_id)
        self.assertEqual(rate_limited.results, [])
        cache_keys = " ".join(service._external_cache.keys()).lower()
        self.assertNotIn("private", cache_keys)
        self.assertNotIn("address", cache_keys)
        self.assertLessEqual(len(service._external_cache), 2)

    async def test_trusted_subject_quota_survives_rotating_client_sessions(self):
        calls = 0

        async def provider(request, _limit, _mode):
            nonlocal calls
            calls += 1
            return [SearchResultV2(
                result_id=f"mapbox:place.{re.sub(r'[^a-z0-9]+', '-', request.query.lower())}",
                title=request.query,
                kind="destination",
                categories=["place"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
            )]

        documents = [
            _document("place:moab-one", "Moab One", kind="place"),
            _document("place:moab-two", "Moab Two", kind="place"),
            _document("place:moab-three", "Moab Three", kind="place"),
            _document("place:moab-four", "Moab Four", kind="place"),
        ]
        service = SearchV2Service(
            lambda: (documents, "trusted-subject-v1"),
            provider,
            external_rate_limit=100,
            external_session_rate_limit=100,
            external_subject_rate_limit=2,
        )

        responses = []
        for index, query in enumerate(("Moab One", "Moab Two", "Moab Three")):
            responses.append(await service.page(
                SearchRequestV2(
                    query=query, include_external=True,
                    session_id=f"rotating-session-{index}",
                ),
                external_subject="guest-subject-a",
            ))

        self.assertEqual(calls, 2)
        # The third request is provider-limited, but its canonical result remains.
        self.assertEqual(responses[2].results[0].result_id, "place:moab-three")
        self.assertTrue(all(
            item.persistence_policy == "canonical" for item in responses[2].results
        ))

        separate = await service.page(
            SearchRequestV2(
                query="Moab Four", include_external=True,
                session_id="separate-session",
            ),
            external_subject="guest-subject-b",
        )
        self.assertEqual(calls, 3)
        self.assertTrue(any(
            item.persistence_policy == "temporary" for item in separate.results
        ))

    async def test_trusted_subject_bucket_map_is_bounded_under_rotation(self):
        async def provider(request, _limit, _mode):
            return [SearchResultV2(
                result_id=f"mapbox:place.{re.sub(r'[^a-z0-9]+', '-', request.query.lower())}",
                title=request.query,
                kind="destination",
                categories=["place"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
            )]

        service = SearchV2Service(
            lambda: ([], "subject-bound-v1"),
            provider,
            external_rate_limit=100,
            external_session_rate_limit=100,
            external_subject_rate_limit=100,
            external_subject_max_entries=2,
        )
        for index in range(6):
            await service.page(
                SearchRequestV2(
                    query=f"Moab {index}", include_external=True,
                    session_id=f"bounded-session-{index}",
                ),
                external_subject=f"bounded-subject-{index}",
            )

        self.assertLessEqual(len(service._external_subject_calls), 2)

    def test_unsupported_scope_combinations_fail_closed(self):
        invalid_requests = [
            {"query": "Moab", "route_ref": "trip:1"},
            {"query": "Moab", "filters": {"free": True}},
            {"query": "Moab", "radius_meters": 5_000},
            {"query": "Moab", "scope": "offline", "include_external": True, "session_id": "session-offline"},
            {"query": "Moab", "include_external": True},
        ]
        for payload in invalid_requests:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                SearchRequestV2(**payload)

        route_request = SearchRequestV2(
            query="Moab", scope="route", route_ref="trip:owned-trip",
        )
        self.assertEqual(route_request.scope, "route")

    async def test_supported_filters_apply_to_server_ranked_results(self):
        service = _fixture_service()
        camps = await service.page(SearchRequestV2(
            query="Moab", filters={"kind": "camp", "verified": True},
        ))
        trails = await service.page(SearchRequestV2(
            query="Moab", filters={"activity": "hiking"},
        ))

        self.assertEqual([item.kind for item in camps.results], ["camp"])
        self.assertTrue(trails.results)
        self.assertTrue(all(item.kind == "trail" for item in trails.results))

    async def test_filters_use_explicit_facets_booleans_and_verification(self):
        documents = [
            _document(
                "trail:verified", "Moab Ridge Trail", kind="trail",
                categories=("trail", "hiking", "moderate"),
                difficulty=("moderate",), surface=("natural_surface",),
                activities=("hiking",), verified=True, quality_score=92,
            ),
            _document(
                "trail:unverified", "Moab River Trail", kind="trail",
                categories=("trail", "cycling", "easy"),
                difficulty=("easy",), surface=("paved",),
                activities=("cycling",), verified=False, quality_score=99,
            ),
            _document(
                "trail:no-coordinates", "Moab Hidden Trail", kind="trail",
                categories=("trail", "hiking"), activities=("hiking",),
                verified=False, quality_score=99, lat=None, lng=None,
            ),
        ]
        service = SearchV2Service(lambda: (documents, "facets-v1"))

        unverified = await service.page(SearchRequestV2(
            query="Moab", filters={"verified": "false"},
        ))
        moderate = await service.page(SearchRequestV2(
            query="Moab", filters={"difficulty": "moderate"},
        ))
        hiking_as_difficulty = await service.page(SearchRequestV2(
            query="Moab", filters={"difficulty": "hiking"},
        ))
        without_coordinates = await service.page(SearchRequestV2(
            query="Moab", filters={"has_coordinates": "false"},
        ))

        self.assertEqual(
            {item.result_id for item in unverified.results},
            {"trail:unverified", "trail:no-coordinates"},
        )
        self.assertEqual(
            [item.result_id for item in moderate.results], ["trail:verified"],
        )
        self.assertEqual(hiking_as_difficulty.results, [])
        self.assertEqual(
            [item.result_id for item in without_coordinates.results],
            ["trail:no-coordinates"],
        )
        with self.assertRaises(ValidationError):
            SearchRequestV2(query="Moab", filters={"verified": "maybe"})

    async def test_external_categories_do_not_impersonate_activity_facets(self):
        async def provider(_request, _limit, _mode):
            return [SearchResultV2(
                result_id="mapbox:poi.hiking-store",
                title="Moab Hiking Store",
                kind="place",
                categories=["hiking"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="poi.hiking-store",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:poi.hiking-store:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        service = SearchV2Service(lambda: ([], "external-facets-v1"), provider)
        response = await service.page(SearchRequestV2(
            query="Moab", filters={"activity": "hiking"},
            include_external=True, session_id="external-facets-session",
        ))

        self.assertEqual(response.results, [])

    async def test_filters_are_applied_before_the_bounded_rank_candidate_set(self):
        documents = [
            _document(
                f"trail:paved-{index:04d}", f"Moab A Trail {index:04d}",
                kind="trail", categories=("trail", "paved"),
                surface=("paved",),
            )
            for index in range(2_050)
        ]
        documents.append(_document(
            "trail:gravel-target", "Moab Z Gravel Trail", kind="trail",
            categories=("trail", "gravel"), surface=("gravel",),
        ))
        service = SearchV2Service(lambda: (documents, "filter-pushdown-v1"))

        response = await service.page(SearchRequestV2(
            query="Moab", intent="trail", filters={"surface": "gravel"},
            limit=5,
        ))

        self.assertEqual(
            [item.result_id for item in response.results],
            ["trail:gravel-target"],
        )

    async def test_nearby_scope_is_spatially_bounded_before_candidate_limit(self):
        documents = [
            _document(
                f"camp:far-{index:04d}", f"Moab A Camp {index:04d}",
                kind="camp", categories=("camp",),
                lat=40.7608, lng=-111.8910,
            )
            for index in range(2_050)
        ]
        documents.append(_document(
            "camp:near-target", "Moab Z Camp", kind="camp",
            categories=("camp",), lat=38.5740, lng=-109.5500,
        ))
        service = SearchV2Service(lambda: (documents, "nearby-pushdown-v1"))

        response = await service.page(SearchRequestV2(
            query="Moab", intent="camp", scope="nearby",
            center=SearchCenterV2(lat=38.5733, lng=-109.5498),
            radius_meters=3_000, limit=5,
        ))

        self.assertEqual(
            [item.result_id for item in response.results],
            ["camp:near-target"],
        )

    async def test_new_york_city_is_not_starved_by_a_full_canonical_page(self):
        provider_calls: list[int] = []

        async def provider(_request, limit, _mode):
            provider_calls.append(limit)
            return [SearchResultV2(
                result_id="mapbox:place.new-york",
                title="New York",
                subtitle="New York, United States",
                kind="destination",
                categories=["place"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="place.new-york",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.new-york:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        documents = [
            _document(
                f"place:new-york-water-{index:02d}",
                f"New York {'Lake' if index % 2 == 0 else 'Creek'} {index:02d}",
                kind="water", categories=("water", "lake"),
            )
            for index in range(14)
        ]
        service = SearchV2Service(lambda: (documents, "new-york-v1"), provider)
        request = SearchRequestV2(
            query="New York", intent="any", include_external=True,
            session_id="ambiguous-new-york", limit=5,
        )

        first = await service.page(request)
        self.assertEqual(first.results[0].result_id, "mapbox:place.new-york")
        self.assertEqual(first.results[0].persistence_policy, "temporary")
        self.assertTrue(any(
            item.persistence_policy == "canonical" for item in first.results[1:]
        ))
        self.assertIsNotNone(first.next_cursor)
        second = await service.page(request.model_copy(update={"cursor": first.next_cursor}))
        self.assertFalse(
            {item.result_id for item in first.results}
            & {item.result_id for item in second.results}
        )
        self.assertEqual(provider_calls, [10])

    async def test_chicago_city_beats_weak_ambiguous_catalog_matches(self):
        async def provider(_request, _limit, _mode):
            return [SearchResultV2(
                result_id="mapbox:place.chicago",
                title="Chicago",
                subtitle="Illinois, United States",
                kind="destination",
                categories=["city"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="place.chicago",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.chicago:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        documents = [
            _document(
                f"place:chicago-{index:02d}",
                f"Chicago {'Lakes' if index % 2 == 0 else 'Creek'} {index:02d}",
                kind="place", categories=("lake", "water"),
            )
            for index in range(12)
        ]
        service = SearchV2Service(lambda: (documents, "chicago-v1"), provider)
        response = await service.page(SearchRequestV2(
            query="Chicago", intent="any", include_external=True,
            session_id="ambiguous-chicago", limit=5,
        ))

        self.assertEqual(response.results[0].result_id, "mapbox:place.chicago")
        self.assertEqual(response.results[0].kind, "destination")
        self.assertTrue(all(
            item.persistence_policy == "canonical" for item in response.results[1:]
        ))

    async def test_exact_canonical_trail_is_never_displaced_by_external_geocode(self):
        provider_calls = 0

        async def provider(_request, _limit, _mode):
            nonlocal provider_calls
            provider_calls += 1
            return [SearchResultV2(
                result_id="mapbox:place.moab-rim-trail",
                title="Moab Rim Trail",
                subtitle="Moab, Utah",
                kind="destination",
                categories=["place"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="place.moab-rim-trail",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.moab-rim-trail:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        documents = [
            _document(
                "trail:moab-rim", "Moab Rim Trail", kind="trail",
                categories=("trail", "offroad_route"),
            ),
            *[
                _document(
                    f"trail:moab-rim-connector-{index:02d}",
                    f"Moab Rim Trail Connector {index:02d}", kind="trail",
                    categories=("trail",),
                )
                for index in range(12)
            ],
        ]
        service = SearchV2Service(lambda: (documents, "exact-trail-v1"), provider)
        response = await service.page(SearchRequestV2(
            query="Moab Rim Trail", intent="any", include_external=True,
            session_id="exact-trail-query", limit=5,
        ))

        self.assertEqual(response.results[0].result_id, "trail:moab-rim")
        self.assertEqual(response.results[0].match_reason, "exact_title")
        self.assertEqual(response.results[0].persistence_policy, "canonical")
        self.assertIn(
            "mapbox:place.moab-rim-trail",
            [item.result_id for item in response.results[1:]],
        )
        self.assertEqual(provider_calls, 1)

    async def test_city_state_query_promotes_exact_mapbox_city_before_canonical_pois(self):
        observed: list[SearchRequestV2] = []

        async def provider(request, _limit, _mode):
            observed.append(request)
            return [SearchResultV2(
                result_id="mapbox:place.moab",
                title="Moab",
                subtitle="Utah, United States",
                kind="destination",
                categories=["place"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="place.moab", temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.moab:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        documents = [
            _document(
                "poi:moab-utah-properties", "Moab Utah Properties",
                kind="place", categories=("real_estate",),
            ),
            _document(
                "trail:moab-utah", "Moab Utah", kind="trail",
                categories=("trail",),
            ),
        ]
        for index, query in enumerate(("Moab Utah", "Moab, UT")):
            with self.subTest(query=query):
                service = SearchV2Service(
                    lambda: (documents, f"destination-query-v{index}"), provider,
                )
                response = await service.page(SearchRequestV2(
                    query=query,
                    center=SearchCenterV2(lat=49.8951, lng=-97.1384),
                    include_external=True,
                    session_id=f"destination-query-session-{index}",
                    limit=5,
                ))

                self.assertEqual(response.results[0].result_id, "mapbox:place.moab")
                self.assertTrue(observed[-1]._destination_context)
                self.assertEqual(observed[-1]._destination_query, "moab")
                self.assertEqual(observed[-1]._destination_country, "US")

    async def test_one_word_city_keeps_exact_canonical_destination_first(self):
        async def provider(_request, _limit, _mode):
            return [SearchResultV2(
                result_id="mapbox:place.moab",
                title="Moab",
                subtitle="Utah, United States",
                kind="destination",
                categories=["place"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="place.moab", temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.moab:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        service = _fixture_service(external_provider=provider)
        response = await service.page(SearchRequestV2(
            query="Moab", center=SearchCenterV2(lat=49.8951, lng=-97.1384),
            include_external=True, session_id="one-word-destination", limit=5,
        ))

        self.assertEqual(response.results[0].result_id, "destination:moab-utah")
        self.assertEqual(response.results[1].result_id, "mapbox:place.moab")

    async def test_trail_viewpoint_and_service_queries_do_not_enter_destination_mode(self):
        observed: list[SearchRequestV2] = []

        async def provider(request, _limit, _mode):
            observed.append(request)
            return []

        service = SearchV2Service(
            lambda: (_fixture_documents(), "non-destination-v1"), provider,
        )
        for index, query in enumerate((
            "Moab Rim Trail", "viewpoint near Moab", "fuel near Flagstaff",
            "things near me", "hikes in", "say hi",
        )):
            with self.subTest(query=query):
                await service.page(SearchRequestV2(
                    query=query,
                    center=SearchCenterV2(lat=49.8951, lng=-97.1384),
                    include_external=True,
                    session_id=f"non-destination-query-{index}",
                ))
                self.assertFalse(observed[-1]._destination_context)

        self.assertFalse(observed[0]._remote_category_context)
        self.assertTrue(observed[1]._remote_category_context)
        self.assertEqual(observed[1]._remote_category, "viewpoint")
        self.assertEqual(observed[1]._remote_destination_query, "Moab")
        self.assertTrue(observed[2]._remote_category_context)
        self.assertEqual(observed[2]._remote_category, "fuel")
        self.assertEqual(observed[2]._remote_destination_query, "Flagstaff")
        self.assertTrue(all(
            not item._remote_category_context for item in observed[3:]
        ))
        await service.page(SearchRequestV2(
            query="fuel near Flagstaff",
            surface="route_editor",
            include_external=True,
            session_id="route-editor-context-query",
        ))
        self.assertFalse(observed[-1]._remote_category_context)
        await service.page(SearchRequestV2(
            query="fuel near Flagstaff",
            scope="nearby",
            center=SearchCenterV2(lat=49.8951, lng=-97.1384),
            include_external=True,
            session_id="nearby-context-query",
        ))
        self.assertTrue(observed[-1]._remote_category_context)
        self.assertEqual(observed[-1]._remote_category, "fuel")
        self.assertEqual(observed[-1]._remote_destination_query, "Flagstaff")
        await service.page(SearchRequestV2(
            query="viewpoint near Moab",
            scope="viewport",
            bounds=SearchBoundsV2(
                west=-97.2, south=49.8, east=-97.0, north=50.0,
            ),
            include_external=True,
            session_id="viewport-context-query",
        ))
        self.assertTrue(observed[-1]._remote_category_context)
        self.assertEqual(observed[-1]._remote_category, "viewpoint")
        self.assertEqual(observed[-1]._remote_destination_query, "Moab")

    def test_remote_category_context_replaces_only_named_destination_spatial_scope(self):
        result = SearchResultV2(
            result_id="mapbox:poi.flagstaff-fuel",
            title="Flagstaff Fuel",
            subtitle="Flagstaff, Arizona",
            kind="place",
            categories=["gas_station"],
            coordinates=SearchCenterV2(lat=35.1983, lng=-111.6513),
            provenance=SearchProvenanceV2(
                provider="mapbox",
                source_label="Mapbox search",
                provider_result_id="poi.flagstaff-fuel",
                temporary_use_only=True,
            ),
            persistence_policy="temporary",
            detail_ref="provider:mapbox:v2:1800000000:0123456789abcdef0123456789abcdef",
        )
        viewport_request = SearchRequestV2(
            query="fuel near Flagstaff",
            scope="viewport",
            bounds=SearchBoundsV2(
                west=-97.2, south=49.8, east=-97.0, north=50.0,
            ),
            include_external=True,
            session_id="viewport-remote-context",
        )
        nearby_request = SearchRequestV2(
            query="fuel near Flagstaff",
            scope="nearby",
            center=SearchCenterV2(lat=49.8951, lng=-97.1384),
            include_external=True,
            session_id="nearby-remote-context",
        )
        ordinary_viewport = viewport_request.model_copy(
            update={"query": "fuel stations"},
        )

        for request in (viewport_request, nearby_request):
            contextual = server.infer_remote_category_search_request_v2(request)
            self.assertTrue(contextual._remote_category_context)
            self.assertIs(server._external_result_for_request(result, contextual), result)
        self.assertFalse(
            server.infer_remote_category_search_request_v2(
                ordinary_viewport,
            )._remote_category_context,
        )
        self.assertIsNone(
            server._external_result_for_request(result, ordinary_viewport),
        )

    async def test_remote_category_uses_only_anchored_provider_rows(self):
        observed: list[SearchRequestV2] = []

        async def provider(request, _limit, _mode):
            observed.append(request)
            return [SearchResultV2(
                result_id="mapbox:poi.flagstaff-fuel",
                title="Flagstaff Fuel",
                subtitle="Flagstaff, Arizona",
                kind="service",
                categories=["gas_station"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="poi.flagstaff-fuel",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:poi.flagstaff-fuel:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        documents = [
            _document(
                "service:flagstaff-plaza", "Flagstaff Plaza Fuel",
                kind="service", categories=("fuel",), parent="Virginia",
            ),
        ]
        service = SearchV2Service(
            lambda: (documents, "remote-category-v1"), provider,
        )
        response = await service.page(SearchRequestV2(
            query="fuel near Flagstaff",
            center=SearchCenterV2(lat=49.8951, lng=-97.1384),
            include_external=True,
            session_id="remote-category-session",
            limit=5,
        ))

        self.assertEqual(
            [item.result_id for item in response.results],
            ["mapbox:poi.flagstaff-fuel"],
        )
        self.assertEqual(response.source_counts, {"trailhead": 0, "external": 1})
        self.assertTrue(observed[0]._remote_category_context)
        self.assertEqual(observed[0]._remote_category, "fuel")
        self.assertEqual(observed[0]._remote_destination_query, "Flagstaff")

    async def test_remote_category_provider_failure_does_not_fall_back_to_unanchored_catalog(self):
        async def provider(_request, _limit, _mode):
            raise TimeoutError("provider timeout")

        service = SearchV2Service(
            lambda: ([
                _document(
                    "service:flagstaff-plaza", "Flagstaff Plaza Fuel",
                    kind="service", categories=("fuel",), parent="Virginia",
                ),
            ], "remote-category-timeout-v1"),
            provider,
        )
        response = await service.page(SearchRequestV2(
            query="fuel near Flagstaff",
            center=SearchCenterV2(lat=49.8951, lng=-97.1384),
            include_external=True,
            session_id="remote-category-timeout-session",
            limit=5,
        ))

        self.assertEqual(response.results, [])
        self.assertEqual(response.source_counts, {"trailhead": 0, "external": 0})

    async def test_remote_category_without_external_provider_fails_closed(self):
        provider_calls = 0

        async def provider(_request, _limit, _mode):
            nonlocal provider_calls
            provider_calls += 1
            return []

        service = SearchV2Service(
            lambda: ([
                _document(
                    "service:flagstaff-plaza", "Flagstaff Plaza Fuel",
                    kind="service", categories=("fuel",), parent="Virginia",
                ),
            ], "remote-category-no-external-v1"),
            provider,
        )
        response = await service.page(SearchRequestV2(
            query="fuel near Flagstaff",
            include_external=False,
            session_id="remote-category-no-external-session",
            limit=5,
        ))

        self.assertEqual(response.results, [])
        self.assertEqual(response.source_counts, {"trailhead": 0, "external": 0})
        self.assertEqual(provider_calls, 0)

    async def test_external_fallback_uses_one_stable_snapshot_after_canonical_rows(self):
        requested_limits: list[int] = []

        async def provider(_request, limit, _mode):
            requested_limits.append(limit)
            return [SearchResultV2(
                result_id=f"mapbox:place.external-{index}",
                title=f"Moab External {index}",
                kind="destination",
                categories=["destination"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id=f"place.external-{index}",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref=f"provider:mapbox:place.external-{index}:signed",
                score=100_000 + index,
                match_reason="provider_fallback",
            ) for index in range(min(limit, 5))]

        canonical = [
            _document("destination:moab-a", "Moab Alpha"),
            _document("destination:moab-b", "Moab Beta"),
        ]
        service = SearchV2Service(lambda: (canonical, "external-page-v1"), provider)
        request = SearchRequestV2(
            query="Moab", intent="destination", include_external=True,
            session_id="external-page-session", limit=2,
        )
        results = []
        page = await service.page(request)
        results.extend(page.results)
        while page.next_cursor:
            page = await service.page(request.model_copy(update={"cursor": page.next_cursor}))
            results.extend(page.results)

        ids = [item.result_id for item in results]
        self.assertEqual(
            set(ids[:2]), {"destination:moab-a", "destination:moab-b"},
        )
        self.assertTrue(all(item.persistence_policy == "canonical" for item in results[:2]))
        self.assertEqual(
            ids[2:], [f"mapbox:place.external-{index}" for index in range(5)],
        )
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(requested_limits, [10])

    async def test_external_snapshot_default_spans_mapbox_session_window(self):
        provider_calls = 0

        async def provider(_request, _limit, _mode):
            nonlocal provider_calls
            provider_calls += 1
            return [SearchResultV2(
                result_id="mapbox:place.session-stable",
                title="Moab Session Result",
                kind="destination",
                categories=["destination"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="place.session-stable",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.session-stable:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        service = SearchV2Service(lambda: ([], "external-session-v1"), provider)
        self.assertGreaterEqual(service._external_cache_ttl_seconds, 180.0)
        request = SearchRequestV2(
            query="Moab", intent="destination", include_external=True,
            session_id="external-session-window", limit=5,
        )
        with patch("dashboard.search_v2._monotonic_seconds", return_value=1_000.0):
            first = await service.page(request)
        with patch("dashboard.search_v2._monotonic_seconds", return_value=1_179.0):
            second = await service.page(request)

        self.assertEqual(provider_calls, 1)
        self.assertEqual(
            [item.result_id for item in first.results],
            ["mapbox:place.session-stable"],
        )
        self.assertEqual(
            [item.result_id for item in second.results],
            ["mapbox:place.session-stable"],
        )

    async def test_expired_external_snapshot_invalidates_cursor_without_skipping_canonical_rows(self):
        provider_calls = 0

        async def provider(_request, _limit, _mode):
            nonlocal provider_calls
            provider_calls += 1
            return [SearchResultV2(
                result_id="mapbox:place.moab",
                title="Moab",
                kind="destination",
                categories=["place"],
                provenance=SearchProvenanceV2(
                    provider="mapbox", source_label="Mapbox search",
                    provider_result_id="place.moab",
                    temporary_use_only=True,
                ),
                persistence_policy="temporary",
                detail_ref="provider:mapbox:place.moab:signed",
                score=100_000,
                match_reason="provider_fallback",
            )]

        canonical = [
            _document(
                f"place:moab-{index:02d}", f"Moab Place {index:02d}",
                kind="place", categories=("place",),
            )
            for index in range(12)
        ]
        service = SearchV2Service(
            lambda: (canonical, "external-expiry-v1"),
            provider,
            external_cache_ttl_seconds=1,
        )
        request = SearchRequestV2(
            query="Moab", include_external=True,
            session_id="external-expiry-session", limit=5,
        )

        with patch("dashboard.search_v2._monotonic_seconds", return_value=1_000.0):
            first = await service.page(request)
        first_canonical_ids = {
            item.result_id for item in first.results
            if item.persistence_policy == "canonical"
        }
        self.assertEqual(len(first_canonical_ids), 4)
        self.assertIsNotNone(first.next_cursor)

        with (
            patch("dashboard.search_v2._monotonic_seconds", return_value=1_002.0),
            self.assertRaisesRegex(SearchCursorError, "provider snapshot has expired"),
        ):
            await service.page(request.model_copy(update={"cursor": first.next_cursor}))

        # A cursor page never refetches or silently recomposes the provider
        # snapshot, so no shifted page can duplicate or skip a canonical ID.
        self.assertEqual(provider_calls, 1)

    async def test_mapbox_fallback_uses_searchbox_and_pseudonymous_session(self):
        provider = AsyncMock(return_value={
            "suggestions": [{
                "mapbox_id": "place.moab",
                "name": "Moab",
                "feature_type": "place",
                "place_formatted": "Utah, United States",
                "context": {"region": {"name": "Utah"}},
            }],
        })
        legacy_geocoder = AsyncMock()
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", provider),
            patch.object(server, "geocode_places", legacy_geocoder),
        ):
            results = await server._search_v2_external_mapbox(SearchRequestV2(
                query="Moab",
                intent="destination",
                include_external=True,
                session_id="private-app-session",
            ), 8, "suggest")

        self.assertEqual(results[0].result_id, "mapbox:place.moab")
        self.assertIsNone(results[0].coordinates)
        self.assertRegex(
            results[0].detail_ref,
            re.compile(r"^provider:mapbox:v2:[0-9]{10,12}:[0-9a-f]{32}$"),
        )
        self.assertNotIn("private-app-session", results[0].detail_ref)
        url, params = provider.await_args.args
        self.assertEqual(url, "https://api.mapbox.com/search/searchbox/v1/suggest")
        self.assertNotEqual(params["session_token"], "private-app-session")
        self.assertRegex(
            params["session_token"],
            re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
        )
        legacy_geocoder.assert_not_awaited()

    async def test_mapbox_http_client_reuses_connections_and_closes_on_shutdown(self):
        response = SimpleNamespace(
            status_code=200,
            headers={"content-type": "application/json"},
            json=lambda: {"suggestions": []},
        )
        client = SimpleNamespace(
            is_closed=False,
            get=AsyncMock(return_value=response),
            aclose=AsyncMock(),
        )
        server._mapbox_client = None

        with patch.object(server.httpx, "AsyncClient", return_value=client) as factory:
            first = await server._mapbox_get(
                "https://api.mapbox.com/search/searchbox/v1/suggest",
                {"q": "Moab"},
            )
            second = await server._mapbox_get(
                "https://api.mapbox.com/search/searchbox/v1/suggest",
                {"q": "Moab Utah"},
            )
            await server._close_mapbox_client()

        self.assertEqual(first, {"suggestions": []})
        self.assertEqual(second, {"suggestions": []})
        self.assertEqual(factory.call_count, 1)
        self.assertEqual(client.get.await_count, 2)
        client.aclose.assert_awaited_once()
        self.assertIsNone(server._mapbox_client)

    async def test_mapbox_explicit_city_state_removes_phone_bias_and_uses_admin_types(self):
        provider = AsyncMock(return_value={"suggestions": []})
        request = SearchRequestV2(
            query="Moab Utah",
            center=SearchCenterV2(lat=49.8951, lng=-97.1384),
            include_external=True,
            session_id="remote-destination-session",
        )
        request._destination_context = True
        request._destination_query = "moab"
        request._destination_country = "US"
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", provider),
        ):
            await server._search_v2_external_mapbox(request, 8, "suggest")

        _url, params = provider.await_args.args
        self.assertEqual(params["country"], "US")
        self.assertNotIn("proximity", params)
        self.assertNotIn("origin", params)
        self.assertEqual(
            params["types"],
            "place,city,locality,district,region,country",
        )

    async def test_mapbox_remote_category_resolves_destination_before_poi_search(self):
        provider = AsyncMock(return_value={
            "suggestions": [{
                "mapbox_id": "poi.flagstaff-fuel",
                "name": "Flagstaff Fuel",
                "feature_type": "poi",
                "place_formatted": "Flagstaff, Arizona",
                "context": {
                    "place": {"name": "Flagstaff"},
                    "region": {"name": "Arizona"},
                },
            }],
        })
        geocoder = AsyncMock(return_value=[{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-111.6513, 35.1983]},
            "properties": {"feature_type": "place", "name": "Flagstaff"},
        }])
        client = object()
        request = SearchRequestV2(
            query="fuel near Flagstaff",
            center=SearchCenterV2(lat=49.8951, lng=-97.1384),
            include_external=True,
            session_id="remote-category-provider-session",
        )
        request._remote_category_context = True
        request._remote_category = "fuel"
        request._remote_destination_query = "Flagstaff"
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_get_mapbox_client", return_value=client),
            patch.object(server, "_mapbox_forward_geocode_features", geocoder),
            patch.object(server, "_mapbox_get", provider),
        ):
            results = await server._search_v2_external_mapbox(
                request, 8, "results",
            )

        geocoder.assert_awaited_once_with(
            client,
            "Flagstaff",
            limit=1,
            country="",
            types="place,locality,district,region",
            language="en",
        )
        _url, params = provider.await_args.args
        self.assertEqual(params["q"], "gas station")
        self.assertEqual(params["types"], "poi")
        self.assertEqual(params["proximity"], "-111.651300,35.198300")
        self.assertEqual(params["origin"], params["proximity"])
        self.assertNotIn("-97.138400", params["proximity"])
        west, south, east, north = [
            float(value) for value in params["bbox"].split(",")
        ]
        self.assertLess(west, -111.6513)
        self.assertGreater(east, -111.6513)
        self.assertLess(south, 35.1983)
        self.assertGreater(north, 35.1983)
        self.assertLess(east - west, 2.0)
        self.assertLess(north - south, 1.5)
        self.assertNotIn("-97.138400", params["bbox"])
        self.assertEqual(results[0].result_id, "mapbox:poi.flagstaff-fuel")
        self.assertIsNone(results[0].coordinates)

    async def test_mapbox_remote_category_rejects_street_name_false_destination(self):
        provider = AsyncMock(return_value={
            "suggestions": [
                {
                    "mapbox_id": "poi.ashburn-flagstaff-plaza",
                    "name": "Exxon",
                    "feature_type": "poi",
                    "full_address": "22405 Flagstaff Plz, Ashburn, Virginia",
                    "context": {
                        "place": {"name": "Ashburn"},
                        "region": {"name": "Virginia"},
                    },
                },
                {
                    "mapbox_id": "poi.flagstaff-shell",
                    "name": "Shell",
                    "feature_type": "poi",
                    "full_address": "North of Flagstaff, Arizona",
                    "context": {
                        "place": {"name": "Flagstaff"},
                        "region": {"name": "Arizona"},
                    },
                },
            ],
        })
        geocoder = AsyncMock(return_value=[{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-111.6513, 35.1983]},
            "properties": {"feature_type": "place", "name": "Flagstaff"},
        }])
        request = SearchRequestV2(
            query="fuel near Flagstaff",
            include_external=True,
            session_id="remote-category-context-filter-session",
        )
        request._remote_category_context = True
        request._remote_category = "fuel"
        request._remote_destination_query = "Flagstaff"
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_forward_geocode_features", geocoder),
            patch.object(server, "_mapbox_get", provider),
        ):
            results = await server._search_v2_external_mapbox(
                request, 8, "results",
            )

        self.assertEqual(
            [result.result_id for result in results],
            ["mapbox:poi.flagstaff-shell"],
        )

    def test_mapbox_remote_destination_context_honors_state_qualifier(self):
        anchor = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-94.62, 39.11]},
            "properties": {
                "feature_type": "place",
                "name": "Kansas City",
                "context": {
                    "region": {"name": "Kansas", "region_code": "KS"},
                    "country": {"name": "United States", "country_code": "US"},
                },
            },
        }
        correct_state = {
            "feature_type": "poi",
            "context": {
                "place": {"name": "Kansas City"},
                "region": {"name": "Kansas", "region_code": "KS"},
                "country": {"name": "United States", "country_code": "US"},
            },
        }
        wrong_state = {
            "feature_type": "poi",
            "context": {
                "place": {"name": "Kansas City"},
                "region": {"name": "Missouri", "region_code": "MO"},
                "country": {"name": "United States", "country_code": "US"},
            },
        }

        self.assertTrue(
            server._search_v2_remote_suggestion_matches_destination(
                correct_state, anchor,
            ),
        )
        self.assertFalse(
            server._search_v2_remote_suggestion_matches_destination(
                wrong_state, anchor,
            ),
        )

        v5_anchor = {
            "id": "place.kansas-city-kansas",
            "place_type": ["place"],
            "text": "Kansas City",
            "properties": {"wikidata": "Q486479"},
            "context": [
                {
                    "id": "region.kansas",
                    "text": "Kansas",
                    "short_code": "US-KS",
                },
                {
                    "id": "country.united-states",
                    "text": "United States",
                    "short_code": "US",
                },
            ],
        }
        self.assertTrue(
            server._search_v2_remote_suggestion_matches_destination(
                correct_state, v5_anchor,
            ),
        )
        self.assertFalse(
            server._search_v2_remote_suggestion_matches_destination(
                wrong_state, v5_anchor,
            ),
        )

    async def test_mapbox_remote_category_fails_closed_without_destination_anchor(self):
        request = SearchRequestV2(
            query="viewpoint near Moab",
            include_external=True,
            session_id="missing-remote-anchor-session",
        )
        request._remote_category_context = True
        request._remote_category = "viewpoint"
        request._remote_destination_query = "Moab"
        provider = AsyncMock()
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_forward_geocode_features", AsyncMock(return_value=[])),
            patch.object(server, "_mapbox_get", provider),
        ):
            results = await server._search_v2_external_mapbox(
                request, 8, "results",
            )

        self.assertEqual(results, [])
        provider.assert_not_awaited()

    async def test_mapbox_retrieve_is_bounded_below_mobile_deadline(self):
        request = SearchRequestV2(
            query="Moab", include_external=True,
            session_id="bounded-retrieve-session",
        )
        issued_at = 1_800_000_000
        detail_ref = server._search_v2_mapbox_detail_ref(
            request, "place.bounded-retrieve", issued_at=issued_at,
        )
        observed_timeouts: list[float] = []

        async def bounded_wait(awaitable, *, timeout):
            observed_timeouts.append(timeout)
            awaitable.close()
            raise TimeoutError

        service = SearchV2Service(lambda: ([], "bounded-retrieve-v1"))
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_search_v2_service", service),
            patch.object(server, "_search_v2_external_timeout_seconds", return_value=4.5),
            patch("dashboard.server.asyncio.wait_for", side_effect=bounded_wait),
            patch("dashboard.server.time.time", return_value=issued_at),
            self.assertRaises(HTTPException) as raised,
        ):
            await server._search_v2_resolve_mapbox_selection(
                request,
                selected_result_id="mapbox:place.bounded-retrieve",
                selected_detail_ref=detail_ref,
                external_subject="bounded-retrieve-subject",
            )

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(observed_timeouts, [4.5])

    async def test_generic_destination_preserves_address_search_context(self):
        provider = AsyncMock(return_value={"suggestions": []})
        request = SearchRequestV2(
            query="123 Center Street",
            intent="destination",
            center=SearchCenterV2(lat=38.5733, lng=-109.5498),
            include_external=True,
            session_id="address-destination-session",
        )
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", provider),
        ):
            await server._search_v2_external_mapbox(request, 8, "suggest")

        _url, params = provider.await_args.args
        self.assertIn("address", params["types"])
        self.assertIn("proximity", params)
        self.assertIn("origin", params)

    async def test_concurrent_mapbox_selection_replays_share_one_retrieve(self):
        request = SearchRequestV2(
            query="Moab", include_external=True,
            session_id="concurrent-selection-session",
        )
        detail_ref = server._search_v2_mapbox_detail_ref(request, "place.moab")
        service = SearchV2Service(
            lambda: ([], "concurrent-selection-v1"),
            external_rate_limit=100,
            external_session_rate_limit=100,
            external_subject_rate_limit=100,
        )
        calls = 0
        active = 0
        max_active = 0

        async def provider(url, _params):
            nonlocal calls, active, max_active
            calls += 1
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.03)
            active -= 1
            provider_id = url.rsplit("/", 1)[-1]
            return {"features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-109.5498, 38.5733]},
                "properties": {
                    "mapbox_id": provider_id,
                    "name": "Moab",
                    "feature_type": "place",
                },
            }]}

        with server._search_v2_retrieve_cache_lock:
            server._search_v2_retrieve_cache.clear()
            server._search_v2_retrieve_inflight.clear()
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", side_effect=provider),
            patch.object(server, "_search_v2_service", service),
        ):
            responses = await asyncio.gather(*[
                server._search_v2_resolve_mapbox_selection(
                    request,
                    selected_result_id="mapbox:place.moab",
                    selected_detail_ref=detail_ref,
                    external_subject="same-trusted-subject",
                )
                for _ in range(12)
            ])

            self.assertEqual(calls, 1)
            self.assertTrue(all(item.status == "resolved" for item in responses))
            self.assertEqual(len(server._search_v2_retrieve_inflight), 0)

            # Different signed refs retain independent leaders and can run in
            # parallel rather than forming one global retrieve queue.
            with server._search_v2_retrieve_cache_lock:
                server._search_v2_retrieve_cache.clear()
            calls = active = max_active = 0
            requests = [
                SearchRequestV2(
                    query=f"Remote {index}", include_external=True,
                    session_id=f"unrelated-selection-{index}",
                )
                for index in range(2)
            ]
            await asyncio.gather(*[
                server._search_v2_resolve_mapbox_selection(
                    item,
                    selected_result_id=f"mapbox:place.remote-{index}",
                    selected_detail_ref=server._search_v2_mapbox_detail_ref(
                        item, f"place.remote-{index}",
                    ),
                    external_subject="same-trusted-subject",
                )
                for index, item in enumerate(requests)
            ])

        self.assertEqual(calls, 2)
        self.assertEqual(max_active, 2)
        self.assertEqual(len(server._search_v2_retrieve_inflight), 0)

    async def test_mapbox_retrieve_singleflight_cleans_error_and_cancellation(self):
        request = SearchRequestV2(
            query="Moab", include_external=True,
            session_id="selection-cleanup-session",
        )
        detail_ref = server._search_v2_mapbox_detail_ref(request, "place.moab")
        service = SearchV2Service(
            lambda: ([], "selection-cleanup-v1"),
            external_rate_limit=100,
            external_session_rate_limit=100,
            external_subject_rate_limit=100,
        )

        async def fail(_url, _params):
            raise RuntimeError("provider failed")

        with server._search_v2_retrieve_cache_lock:
            server._search_v2_retrieve_cache.clear()
            server._search_v2_retrieve_inflight.clear()
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", side_effect=fail),
            patch.object(server, "_search_v2_service", service),
        ):
            with self.assertRaisesRegex(RuntimeError, "provider failed"):
                await server._search_v2_resolve_mapbox_selection(
                    request,
                    selected_result_id="mapbox:place.moab",
                    selected_detail_ref=detail_ref,
                    external_subject="cleanup-subject",
                )
        self.assertEqual(len(server._search_v2_retrieve_inflight), 0)

        started = asyncio.Event()

        async def wait_forever(_url, _params):
            started.set()
            await asyncio.Event().wait()

        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", side_effect=wait_forever),
            patch.object(server, "_search_v2_service", service),
        ):
            task = asyncio.create_task(server._search_v2_resolve_mapbox_selection(
                request,
                selected_result_id="mapbox:place.moab",
                selected_detail_ref=detail_ref,
                external_subject="cleanup-subject",
            ))
            await started.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(len(server._search_v2_retrieve_inflight), 0)

    async def test_explicit_selection_model_requires_both_stable_references(self):
        with self.assertRaises(ValidationError):
            SearchResolveRequestV2(
                query="Moab",
                selected_result_id="mapbox:place.moab",
            )

    async def test_external_provider_dispatches_geoapify_for_route_mixed_and_destination_search(self):
        geoapify = AsyncMock(return_value=[])
        mapbox = AsyncMock(return_value=[])
        with (
            patch.object(server, "_search_v2_external_geoapify", geoapify),
            patch.object(server, "_search_v2_external_mapbox", mapbox),
        ):
            await server._search_v2_external_provider(SearchRequestV2(
                query="Moab",
                surface="route_editor",
                intent="any",
                include_external=True,
                session_id="route-mixed-provider-session",
            ), 8, "suggest")
            await server._search_v2_external_provider(SearchRequestV2(
                query="Moab",
                surface="route_editor",
                intent="destination",
                include_external=True,
                session_id="route-provider-session",
            ), 8, "suggest")
            await server._search_v2_external_provider(SearchRequestV2(
                query="Moab",
                surface="map",
                intent="destination",
                include_external=True,
                session_id="map-provider-session",
            ), 8, "suggest")

        self.assertEqual(geoapify.await_count, 2)
        self.assertEqual(
            [call.args[0].intent for call in geoapify.await_args_list],
            ["any", "destination"],
        )
        mapbox.assert_awaited_once()

    async def test_geoapify_suggestion_is_coordinate_free_and_explicit_resolution_is_durable(self):
        request = SearchRequestV2(
            query="Moab visitor center",
            surface="route_editor",
            intent="any",
            include_external=True,
            session_id="geoapify-selection-session",
        )
        candidate = {
            "provider_place_id": "51abc123",
            "name": "Moab Information Center",
            "formatted": "25 E Center Street, Moab, Utah",
            "lat": 38.5734,
            "lng": -109.5499,
            "result_type": "amenity",
            "categories": ["tourism.information"],
            "state": "Utah",
            "country": "United States",
            "attribution": "OpenStreetMap contributors",
        }
        provider_calls = 0

        async def provider(*_args, **_kwargs):
            nonlocal provider_calls
            provider_calls += 1
            await asyncio.sleep(0.02)
            return [candidate]

        service = SearchV2Service(
            lambda: ([], "geoapify-selection-v1"),
            external_rate_limit=100,
            external_session_rate_limit=100,
            external_subject_rate_limit=100,
        )
        with server._search_v2_retrieve_cache_lock:
            server._search_v2_retrieve_cache.clear()
            server._search_v2_retrieve_inflight.clear()
        with (
            patch.object(server, "geoapify_durable_search_enabled", return_value=True),
            patch.object(server, "_search_v2_geoapify_candidates", side_effect=provider),
            patch.object(server, "_search_v2_service", service),
        ):
            suggestions = await server._search_v2_external_geoapify(request, 8, "suggest")
            self.assertEqual(provider_calls, 1)
            self.assertEqual(suggestions[0].result_id, "geoapify:51abc123")
            self.assertIsNone(suggestions[0].coordinates)
            self.assertEqual(suggestions[0].persistence_policy, "temporary")
            self.assertTrue(suggestions[0].provenance.temporary_use_only)
            self.assertNotIn("Geoapify", suggestions[0].provenance.source_label)

            provider_calls = 0
            responses = await asyncio.gather(*[
                server._search_v2_resolve_geoapify_selection(
                    request,
                    selected_result_id=suggestions[0].result_id,
                    selected_detail_ref=suggestions[0].detail_ref or "",
                    external_subject="trusted-route-editor-subject",
                )
                for _ in range(8)
            ])
            replay = await server._search_v2_resolve_geoapify_selection(
                request,
                selected_result_id=suggestions[0].result_id,
                selected_detail_ref=suggestions[0].detail_ref or "",
                external_subject="trusted-route-editor-subject",
            )

        self.assertEqual(provider_calls, 1)
        self.assertTrue(all(item.status == "resolved" for item in responses))
        self.assertEqual(replay.status, "resolved")
        selected = responses[0].selected
        self.assertIsNotNone(selected)
        self.assertEqual(selected.persistence_policy, "durable_external")
        self.assertFalse(selected.provenance.temporary_use_only)
        self.assertEqual(selected.coordinates, SearchCenterV2(lat=38.5734, lng=-109.5499))
        self.assertEqual(selected.provenance.provider_result_id, "51abc123")
        self.assertEqual(selected.provenance.attribution, "OpenStreetMap contributors")
        self.assertIsNone(selected.detail_ref)

    async def test_geoapify_resolution_requires_exact_signed_session_query_and_id(self):
        request = SearchRequestV2(
            query="Moab",
            surface="route_editor",
            intent="destination",
            include_external=True,
            session_id="geoapify-bound-session",
        )
        issued_at = 1_800_000_000
        detail_ref = server._search_v2_geoapify_detail_ref(
            request, "51exact", issued_at=issued_at,
        )
        self.assertEqual(
            server._search_v2_validate_provider_detail_ref(
                "geoapify", request, "51exact", detail_ref,
                now=issued_at + 600,
            ),
            issued_at,
        )
        for changed in (
            request.model_copy(update={"query": "Moab Utah"}),
            request.model_copy(update={"session_id": "other-session"}),
            request.model_copy(update={"scope": "nearby"}),
        ):
            with self.assertRaises(HTTPException):
                server._search_v2_validate_provider_detail_ref(
                    "geoapify", changed, "51exact", detail_ref,
                    now=issued_at + 1,
                )
        with self.assertRaises(HTTPException) as expired:
            server._search_v2_validate_provider_detail_ref(
                "geoapify", request, "51exact", detail_ref,
                now=issued_at + 601,
            )
        self.assertEqual(expired.exception.detail["code"], "search_selection_expired")

        service = SearchV2Service(lambda: ([], "geoapify-exact-v1"))
        with (
            patch.object(server, "geoapify_durable_search_enabled", return_value=True),
            patch.object(server, "_search_v2_service", service),
            patch.object(server, "_search_v2_geoapify_candidates", AsyncMock(return_value=[{
                "provider_place_id": "51different",
                "name": "Different place",
                "lat": 38.5,
                "lng": -109.5,
                "result_type": "place",
            }])),
            patch("dashboard.server.time.time", return_value=issued_at),
        ):
            response = await server._search_v2_resolve_geoapify_selection(
                request,
                selected_result_id="geoapify:51exact",
                selected_detail_ref=detail_ref,
                external_subject="trusted-exact-subject",
            )
        self.assertEqual(response.status, "not_found")
        self.assertIsNone(response.selected)


class SearchV2ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.service = _fixture_service()
        with server._search_v2_retrieve_cache_lock:
            server._search_v2_retrieve_cache.clear()

    def test_external_quota_subject_is_server_owned_and_privacy_safe(self):
        first_guest = SimpleNamespace(
            client=SimpleNamespace(host="198.51.100.10"), headers={},
        )
        same_guest = SimpleNamespace(
            client=SimpleNamespace(host="198.51.100.10"), headers={},
        )
        other_guest = SimpleNamespace(
            client=SimpleNamespace(host="198.51.100.11"), headers={},
        )

        first = server._search_v2_external_subject(first_guest, None)
        same = server._search_v2_external_subject(same_guest, None)
        other = server._search_v2_external_subject(other_guest, None)
        account_one = server._search_v2_external_subject(
            other_guest, {"id": 42},
        )
        account_one_elsewhere = server._search_v2_external_subject(
            first_guest, {"id": 42},
        )
        account_two = server._search_v2_external_subject(
            first_guest, {"id": 43},
        )

        self.assertEqual(first, same)
        self.assertNotEqual(first, other)
        self.assertEqual(account_one, account_one_elsewhere)
        self.assertNotEqual(account_one, account_two)
        self.assertNotIn("198.51.100.10", first)
        self.assertNotIn("42", account_one)

    def test_cloudflare_guest_address_requires_explicit_trust_and_valid_ray(self):
        request = SimpleNamespace(
            client=SimpleNamespace(host="10.0.0.2"),
            headers={
                "cf-ray": "8f1234567890abcd-YYZ",
                "cf-connecting-ip": "203.0.113.9",
            },
        )
        peer_only = SimpleNamespace(
            client=SimpleNamespace(host="10.0.0.2"), headers={},
        )
        client_ip = SimpleNamespace(
            client=SimpleNamespace(host="203.0.113.9"), headers={},
        )

        with patch.dict(os.environ, {
            "TRAILHEAD_TRUST_CLOUDFLARE_CLIENT_IP": "0",
        }):
            untrusted = server._search_v2_external_subject(request, None)
        with patch.dict(os.environ, {
            "TRAILHEAD_TRUST_CLOUDFLARE_CLIENT_IP": "1",
        }):
            trusted = server._search_v2_external_subject(request, None)

        self.assertEqual(
            untrusted, server._search_v2_external_subject(peer_only, None),
        )
        self.assertEqual(
            trusted, server._search_v2_external_subject(client_ip, None),
        )

    def test_mapbox_selection_reference_is_versioned_signed_and_time_bounded(self):
        request = SearchRequestV2(
            query="Moab", include_external=True,
            session_id="selection-expiry-session",
        )
        issued_at = 1_800_000_000
        detail_ref = server._search_v2_mapbox_detail_ref(
            request, "place.moab", issued_at=issued_at,
        )

        self.assertEqual(
            server._search_v2_validate_mapbox_detail_ref(
                request, "place.moab", detail_ref, now=issued_at + 600,
            ),
            issued_at,
        )
        with self.assertRaises(HTTPException) as expired:
            server._search_v2_validate_mapbox_detail_ref(
                request, "place.moab", detail_ref, now=issued_at + 601,
            )
        self.assertEqual(expired.exception.status_code, 422)
        self.assertEqual(expired.exception.detail["code"], "search_selection_expired")

        tampered = detail_ref[:-1] + ("0" if detail_ref[-1] != "0" else "1")
        with self.assertRaises(HTTPException) as invalid:
            server._search_v2_validate_mapbox_detail_ref(
                request, "place.moab", tampered, now=issued_at + 1,
            )
        self.assertEqual(invalid.exception.status_code, 422)
        self.assertEqual(invalid.exception.detail["code"], "invalid_search_selection")

    def test_mapbox_retrieve_cache_is_bounded_and_hash_keyed(self):
        first_key = server._search_v2_retrieve_cache_key(
            "mapbox:place.private", "provider:mapbox:v2:1800000000:deadbeef",
        )
        self.assertNotIn("private", first_key)
        with patch.object(server, "_SEARCH_V2_RETRIEVE_CACHE_MAX_ENTRIES", 2):
            server._search_v2_retrieve_cache_put(first_key, None)
            server._search_v2_retrieve_cache_put("second-key", None)
            server._search_v2_retrieve_cache_put("third-key", None)

        self.assertFalse(server._search_v2_retrieve_cache_get(first_key)[0])
        self.assertTrue(server._search_v2_retrieve_cache_get("second-key")[0])
        self.assertTrue(server._search_v2_retrieve_cache_get("third-key")[0])

        with patch.object(server, "_SEARCH_V2_RETRIEVE_INFLIGHT_MAX_ENTRIES", 2):
            first, first_leader = server._search_v2_retrieve_inflight_join("first")
            second, second_leader = server._search_v2_retrieve_inflight_join("second")
            refused, refused_leader = server._search_v2_retrieve_inflight_join("third")
        self.assertTrue(first_leader)
        self.assertTrue(second_leader)
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertIsNone(refused)
        self.assertFalse(refused_leader)
        server._search_v2_retrieve_inflight_finish("first", first, selected=None)
        server._search_v2_retrieve_inflight_finish("second", second, selected=None)
        self.assertEqual(server._search_v2_retrieve_inflight, {})

    def test_feature_flag_disabled_returns_not_found(self):
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "0"}),
            patch.object(server, "_search_v2_service", self.service),
        ):
            response = self.client.get("/api/search/v2/results", params={"q": "Moab"})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "feature_unavailable")

    def test_access_log_filter_redacts_raw_query(self):
        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg='%s - "%s %s HTTP/%s" %d',
            args=(
                "127.0.0.1:1",
                "GET",
                "/api/search/v2/suggest?q=private+home+address&session_id=session-test",
                "1.1",
                200,
            ),
            exc_info=None,
        )

        server._SearchV2AccessLogPrivacyFilter().filter(record)

        rendered = record.getMessage()
        self.assertNotIn("private", rendered)
        self.assertNotIn("session-test", rendered)
        self.assertIn("query=redacted", rendered)

    def test_admin_can_preview_while_public_feature_flag_is_disabled(self):
        server.app.dependency_overrides[server._optional_user] = lambda: {"id": 1, "is_admin": 1}
        try:
            with (
                patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "0"}),
                patch.object(server, "_search_v2_service", self.service),
            ):
                response = self.client.get("/api/search/v2/results", params={
                    "q": "Moab", "intent": "destination", "include_external": "false",
                })
        finally:
            server.app.dependency_overrides.pop(server._optional_user, None)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["result_id"], "destination:moab-utah")

    def test_routes_validate_bounds_and_return_contract(self):
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
            patch.object(server, "_search_v2_service", self.service),
        ):
            invalid = self.client.get("/api/search/v2/results", params={
                "q": "Moab", "scope": "viewport", "bbox": "bad-bounds",
            })
            valid = self.client.get("/api/search/v2/suggest", params={
                "q": "Moab", "intent": "destination", "include_external": "false",
            })
            resolved = self.client.post("/api/search/v2/resolve", json={
                "query": "Moab", "intent": "destination", "include_external": False,
            })

        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.json()["results"][0]["result_id"], "destination:moab-utah")
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.json()["selected"]["result_id"], "destination:moab-utah")
        self.assertLess(len(json.dumps(valid.json()).encode("utf-8")), 100_000)

    def test_geoapify_route_selection_endpoint_returns_only_resolved_durable_row(self):
        request = SearchRequestV2(
            query="Moab Information Center",
            surface="route_editor",
            intent="destination",
            include_external=True,
            session_id="geoapify-endpoint-session",
        )
        body = {
            **request.model_dump(mode="json"),
            "selected_result_id": "geoapify:51endpoint",
            "selected_detail_ref": server._search_v2_geoapify_detail_ref(
                request, "51endpoint",
            ),
        }
        provider = AsyncMock(return_value=[{
            "provider_place_id": "51endpoint",
            "name": "Moab Information Center",
            "formatted": "25 E Center Street, Moab, Utah",
            "lat": 38.5734,
            "lng": -109.5499,
            "result_type": "amenity",
            "categories": ["tourism.information"],
            "attribution": "OpenStreetMap contributors",
        }])
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
            patch.object(server, "geoapify_durable_search_enabled", return_value=True),
            patch.object(server, "_search_v2_geoapify_candidates", provider),
            patch.object(server, "_search_v2_service", self.service),
        ):
            resolved = self.client.post("/api/search/v2/resolve", json=body)
            forged = self.client.post("/api/search/v2/resolve", json={
                **body,
                "selected_detail_ref": "provider:geoapify:v2:1800000000:forged",
            })

        self.assertEqual(resolved.status_code, 200)
        selected = resolved.json()["selected"]
        self.assertEqual(selected["result_id"], "geoapify:51endpoint")
        self.assertEqual(selected["persistence_policy"], "durable_external")
        self.assertFalse(selected["provenance"]["temporary_use_only"])
        self.assertEqual(selected["coordinates"], {"lat": 38.5734, "lng": -109.5499})
        self.assertEqual(forged.status_code, 422)
        provider.assert_awaited_once()

    def test_remote_category_resolve_recomputes_private_viewport_context(self):
        resolver = AsyncMock(return_value=server.SearchResolveResponseV2(
            query="fuel near Flagstaff",
            status="not_found",
            selected=None,
            alternatives=[],
            reason="fixture",
            revision="remote-context-fixture",
        ))
        body = {
            "query": "fuel near Flagstaff",
            "surface": "map",
            "intent": "any",
            "scope": "viewport",
            "bounds": {
                "west": -97.2,
                "south": 49.8,
                "east": -97.0,
                "north": 50.0,
            },
            "session_id": "viewport-resolve-context",
            "include_external": True,
            "selected_result_id": "mapbox:poi.flagstaff-fuel",
            "selected_detail_ref": (
                "provider:mapbox:v2:1800000000:"
                "0123456789abcdef0123456789abcdef"
            ),
        }
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
            patch.object(server, "_search_v2_resolve_mapbox_selection", resolver),
        ):
            response = self.client.post("/api/search/v2/resolve", json=body)

        self.assertEqual(response.status_code, 200)
        resolver.assert_awaited_once()
        resolved_request = resolver.await_args.args[0]
        self.assertTrue(resolved_request._remote_category_context)
        self.assertEqual(resolved_request._remote_category, "fuel")
        self.assertEqual(
            resolved_request._remote_destination_query,
            "Flagstaff",
        )

    def test_mapbox_suggestion_retrieves_only_after_explicit_valid_selection(self):
        request = SearchRequestV2(
            query="Moab",
            intent="destination",
            include_external=True,
            session_id="selection-session-001",
        )
        provider = AsyncMock(side_effect=[
            {"suggestions": [{
                "mapbox_id": "place.moab",
                "name": "Moab",
                "feature_type": "place",
                "place_formatted": "Utah, United States",
                "context": {"region": {"name": "Utah"}},
            }]},
            {"features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-109.5498, 38.5733]},
                "properties": {
                    "mapbox_id": "place.moab",
                    "name": "Moab",
                    "feature_type": "place",
                    "place_formatted": "Utah, United States",
                    "context": {"region": {"name": "Utah"}},
                },
            }]},
        ])
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", provider),
            patch.object(server, "_search_v2_service", self.service),
        ):
            suggestions = asyncio.run(
                server._search_v2_external_mapbox(request, 8, "suggest")
            )
            self.assertEqual(provider.await_count, 1)
            self.assertIsNone(suggestions[0].coordinates)
            body = {
                **request.model_dump(mode="json"),
                "selected_result_id": suggestions[0].result_id,
                "selected_detail_ref": suggestions[0].detail_ref,
            }
            resolved = self.client.post("/api/search/v2/resolve", json=body)
            replayed = self.client.post("/api/search/v2/resolve", json=body)
            calls_after_valid_selection = provider.await_count
            forged = self.client.post("/api/search/v2/resolve", json={
                **body,
                "selected_detail_ref": "provider:mapbox:place.moab:forged",
            })

        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(replayed.status_code, 200)
        self.assertEqual(replayed.json()["selected"], resolved.json()["selected"])
        self.assertEqual(resolved.json()["status"], "resolved")
        self.assertEqual(resolved.json()["reason"], "explicit_selection")
        selected = resolved.json()["selected"]
        self.assertEqual(selected["result_id"], "mapbox:place.moab")
        self.assertEqual(selected["coordinates"], {"lat": 38.5733, "lng": -109.5498})
        self.assertEqual(selected["persistence_policy"], "temporary")
        self.assertTrue(selected["provenance"]["temporary_use_only"])
        self.assertEqual(calls_after_valid_selection, 2)
        self.assertEqual(forged.status_code, 422)
        self.assertEqual(provider.await_count, calls_after_valid_selection)
        suggest_params = provider.await_args_list[0].args[1]
        retrieve_url, retrieve_params = provider.await_args_list[1].args
        self.assertEqual(
            retrieve_url,
            "https://api.mapbox.com/search/searchbox/v1/retrieve/place.moab",
        )
        self.assertEqual(retrieve_params["session_token"], suggest_params["session_token"])

    def test_rotating_selection_sessions_share_trusted_quota_and_canonical_resolve_continues(self):
        canonical = _document(
            "place:canonical-camp", "Canonical Camp", kind="place",
            categories=("place",),
        )
        limited_service = SearchV2Service(
            lambda: ([canonical], "selection-limit-v1"),
            external_rate_limit=100,
            external_session_rate_limit=100,
            external_subject_rate_limit=1,
        )
        first_request = SearchRequestV2(
            query="Remote One", include_external=True,
            session_id="rotating-retrieve-session-one",
        )
        second_request = SearchRequestV2(
            query="Remote Two", include_external=True,
            session_id="rotating-retrieve-session-two",
        )
        first_body = {
            **first_request.model_dump(mode="json"),
            "selected_result_id": "mapbox:place.one",
            "selected_detail_ref": server._search_v2_mapbox_detail_ref(
                first_request, "place.one",
            ),
        }
        second_body = {
            **second_request.model_dump(mode="json"),
            "selected_result_id": "mapbox:place.two",
            "selected_detail_ref": server._search_v2_mapbox_detail_ref(
                second_request, "place.two",
            ),
        }

        async def retrieve(url, _params):
            provider_id = url.rsplit("/", 1)[-1]
            return {"features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-109.55, 38.57]},
                "properties": {
                    "mapbox_id": provider_id,
                    "name": provider_id.replace("place.", "Remote ").title(),
                    "feature_type": "place",
                },
            }]}

        provider = AsyncMock(side_effect=retrieve)
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", provider),
            patch.object(server, "_search_v2_service", limited_service),
            patch.object(
                server, "_search_v2_external_subject",
                return_value="trusted-guest-subject",
            ),
        ):
            first = self.client.post("/api/search/v2/resolve", json=first_body)
            rotated = self.client.post("/api/search/v2/resolve", json=second_body)
            canonical_response = self.client.post("/api/search/v2/resolve", json={
                "query": "Canonical Camp",
                "include_external": False,
                "selected_result_id": "place:canonical-camp",
                "selected_detail_ref": "place:canonical-camp",
            })

        self.assertEqual(first.status_code, 200)
        self.assertEqual(rotated.status_code, 429)
        self.assertEqual(
            rotated.json()["detail"]["code"], "search_provider_rate_limited",
        )
        provider.assert_awaited_once()
        self.assertEqual(canonical_response.status_code, 200)
        self.assertEqual(
            canonical_response.json()["selected"]["result_id"],
            "place:canonical-camp",
        )

    def test_selected_mapbox_route_result_requires_owner_and_final_coordinate_scope(self):
        trip = {
            "trip_id": "owned-trip",
            "route_geometry": {
                "type": "LineString",
                "coordinates": [[-109.56, 38.56], [-109.54, 38.62]],
            },
        }
        account = {"id": 42, "is_admin": 0}
        base = SearchRequestV2(
            query="Remote City",
            scope="route",
            route_ref="trip:owned-trip",
            include_external=True,
            session_id="route-selection-session",
        )
        with patch.object(server, "get_trip_document_v2", return_value=trip):
            authorized = server._authorize_search_v2_request(base, account)
        detail_ref = server._search_v2_mapbox_detail_ref(authorized, "place.remote")
        body = {
            **base.model_dump(mode="json"),
            "selected_result_id": "mapbox:place.remote",
            "selected_detail_ref": detail_ref,
        }
        provider = AsyncMock(return_value={"features": [{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-111.89, 40.76]},
            "properties": {
                "mapbox_id": "place.remote",
                "name": "Remote City",
                "feature_type": "place",
            },
        }]})
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", provider),
            patch.object(server, "_search_v2_service", self.service),
        ):
            unauthenticated = self.client.post("/api/search/v2/resolve", json=body)
        self.assertEqual(unauthenticated.status_code, 401)
        provider.assert_not_awaited()

        server.app.dependency_overrides[server._optional_user] = lambda: account
        try:
            with (
                patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
                patch.object(server.settings, "mapbox_token", "pk.test"),
                patch.object(server, "_mapbox_get", provider),
                patch.object(server, "_search_v2_service", self.service),
                patch.object(server, "get_trip_document_v2", return_value=trip) as owned,
            ):
                outside = self.client.post("/api/search/v2/resolve", json=body)
        finally:
            server.app.dependency_overrides.pop(server._optional_user, None)
        self.assertEqual(outside.status_code, 200)
        self.assertEqual(outside.json()["status"], "not_found")
        self.assertEqual(outside.json()["reason"], "selected_result_outside_scope")
        owned.assert_called_once_with(42, "owned-trip")
        self.assertEqual(provider.await_count, 1)

    def test_routes_reject_unknown_filters_unowned_route_and_invalid_scope_combinations(self):
        with (
            patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
            patch.object(server, "_search_v2_service", self.service),
        ):
            responses = [
                self.client.get("/api/search/v2/results", params={
                    "q": "Moab", "filters": '{"free":true}',
                }),
                self.client.get("/api/search/v2/results", params={
                    "q": "Moab", "scope": "route", "route_ref": "trip:1",
                }),
                self.client.get("/api/search/v2/results", params={
                    "q": "Moab", "radius_meters": "5000",
                }),
                self.client.get("/api/search/v2/results", params={
                    "q": "Moab", "include_external": "true",
                }),
            ]

        self.assertEqual(
            [response.status_code for response in responses],
            [422, 401, 422, 422],
        )

    def test_short_search_flag_is_a_compatibility_fallback_only(self):
        with patch.dict(os.environ, {"SEARCH_V2_ENABLED": "1"}, clear=True):
            self.assertTrue(server._server_feature_enabled("TRAILHEAD_SEARCH_V2_ENABLED"))
        with patch.dict(os.environ, {
            "SEARCH_V2_ENABLED": "1", "TRAILHEAD_SEARCH_V2_ENABLED": "0",
        }, clear=True):
            self.assertFalse(server._server_feature_enabled("TRAILHEAD_SEARCH_V2_ENABLED"))
        with patch.dict(os.environ, {
            "SEARCH_V2_ENABLED": "1", "TRAILHEAD_SEARCH_V2_ENABLED": "",
        }, clear=True):
            self.assertFalse(server._server_feature_enabled("TRAILHEAD_SEARCH_V2_ENABLED"))

    def test_search_prewarm_defaults_on_when_public_rollout_is_off(self):
        with patch.dict(os.environ, {
            "TRAILHEAD_SEARCH_V2_ENABLED": "0",
        }, clear=True):
            self.assertTrue(server._search_v2_prewarm_enabled())
            self.assertFalse(server._server_feature_enabled("TRAILHEAD_SEARCH_V2_ENABLED"))

    def test_search_prewarm_has_an_explicit_independent_opt_out(self):
        service = SimpleNamespace(prewarm=AsyncMock(return_value=(17, "unused-v1")))
        with (
            patch.dict(os.environ, {
                "TRAILHEAD_SEARCH_V2_ENABLED": "1",
                "TRAILHEAD_SEARCH_V2_PREWARM_ENABLED": "0",
            }, clear=True),
            patch.object(server, "_search_v2_service", service),
        ):
            self.assertFalse(server._search_v2_prewarm_enabled())
            self.assertTrue(server._server_feature_enabled("TRAILHEAD_SEARCH_V2_ENABLED"))
            asyncio.run(server._prewarm_search_v2())

        service.prewarm.assert_not_awaited()

    def test_search_startup_prewarms_for_internal_admin_access(self):
        service = SimpleNamespace(prewarm=AsyncMock(return_value=(17, "internal-v1")))
        with (
            patch.dict(os.environ, {
                "TRAILHEAD_SEARCH_V2_ENABLED": "0",
            }, clear=True),
            patch.object(server, "_search_v2_service", service),
        ):
            asyncio.run(server._prewarm_search_v2())

        service.prewarm.assert_awaited_once_with()

    def test_route_scope_is_account_owned_and_uses_server_route_bounds(self):
        account = {"id": 42, "is_admin": 0}
        server.app.dependency_overrides[server._optional_user] = lambda: account
        trip = {
            "trip_id": "owned-trip",
            "route_geometry": {
                "type": "LineString",
                "coordinates": [[-109.56, 38.56], [-109.54, 38.62]],
            },
        }
        try:
            with (
                patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
                patch.object(server, "_search_v2_service", self.service),
                patch.object(server, "get_trip_document_v2", return_value=trip) as owned,
            ):
                response = self.client.get("/api/search/v2/results", params={
                    "q": "Moab", "scope": "route", "route_ref": "trip:owned-trip",
                })
            with (
                patch.dict(os.environ, {"TRAILHEAD_SEARCH_V2_ENABLED": "1"}),
                patch.object(server, "get_trip_document_v2", return_value=None),
            ):
                missing = self.client.get("/api/search/v2/results", params={
                    "q": "Moab", "scope": "route", "route_ref": "trip:other-trip",
                })
        finally:
            server.app.dependency_overrides.pop(server._optional_user, None)

        self.assertEqual(response.status_code, 200)
        owned.assert_called_once_with(42, "owned-trip")
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
