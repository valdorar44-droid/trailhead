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
            {"query": "Moab", "scope": "route", "route_ref": "trip:1"},
            {"query": "Moab", "route_ref": "trip:1"},
            {"query": "Moab", "filters": {"free": True}},
            {"query": "Moab", "radius_meters": 5_000},
            {"query": "Moab", "scope": "offline", "include_external": True, "session_id": "session-offline"},
            {"query": "Moab", "include_external": True},
        ]
        for payload in invalid_requests:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                SearchRequestV2(**payload)

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
        url, params = provider.await_args.args
        self.assertEqual(url, "https://api.mapbox.com/search/searchbox/v1/suggest")
        self.assertNotEqual(params["session_token"], "private-app-session")
        self.assertRegex(
            params["session_token"],
            re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
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

    def test_routes_reject_unimplemented_filters_route_and_external_without_session(self):
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

        self.assertTrue(all(response.status_code == 422 for response in responses))


if __name__ == "__main__":
    unittest.main()
