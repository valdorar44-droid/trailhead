from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

import dashboard.server as server
from dashboard.search_v2 import (
    SearchBoundsV2,
    SearchCenterV2,
    SearchDocumentV2,
    SearchProvenanceV2,
    SearchRequestV2,
    SearchResolveRequestV2,
    SearchResultV2,
    SearchV2Service,
)


def _document(
    result_id: str,
    title: str,
    *,
    kind: str = "destination",
    categories: tuple[str, ...] | None = None,
    aliases: tuple[str, ...] = (),
    lat: float = 38.5733,
    lng: float = -109.5498,
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
        parent="Utah",
        aliases=aliases,
        provider="trailhead",
        source_label="Trailhead",
        detail_ref=result_id,
        quality_score=95,
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
        with (
            patch.object(server.settings, "mapbox_token", "pk.test"),
            patch.object(server, "_mapbox_get", provider),
        ):
            results = await server._search_v2_external_mapbox(SearchRequestV2(
                query="Moab",
                intent="destination",
                include_external=True,
                session_id="private-app-session",
            ), 8, "suggest")

        self.assertEqual(results[0].result_id, "mapbox:place.moab")
        self.assertIsNone(results[0].coordinates)
        self.assertTrue(results[0].detail_ref.startswith("provider:mapbox:place.moab:"))
        self.assertNotIn("private-app-session", results[0].detail_ref)
        url, params = provider.await_args.args
        self.assertEqual(url, "https://api.mapbox.com/search/searchbox/v1/suggest")
        self.assertNotEqual(params["session_token"], "private-app-session")
        self.assertRegex(
            params["session_token"],
            re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
        )

    async def test_explicit_selection_model_requires_both_stable_references(self):
        with self.assertRaises(ValidationError):
            SearchResolveRequestV2(
                query="Moab",
                selected_result_id="mapbox:place.moab",
            )


class SearchV2ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.service = _fixture_service()

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
            calls_after_valid_selection = provider.await_count
            forged = self.client.post("/api/search/v2/resolve", json={
                **body,
                "selected_detail_ref": "provider:mapbox:place.moab:forged",
            })

        self.assertEqual(resolved.status_code, 200)
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
