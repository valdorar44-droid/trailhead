from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.explore_sources.offers.disclosure import PARTNER_BOOKING_DISCLOSURE_LABEL
from scripts.explore_sources.offers.providers.base import OfferSearchQuery
from scripts.explore_sources.offers.providers.outdoorsy import (
    OutdoorsyConfig,
    OutdoorsyProvider,
    config_from_env,
    normalize_outdoorsy_payload,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "scripts/explore_sources/offers/fixtures"
SEARCH = FIXTURES / "outdoorsy_search_sample.json"
EMPTY = FIXTURES / "outdoorsy_empty_sample.json"
PARTIAL = FIXTURES / "outdoorsy_partial_sample.json"


def contains_key(obj: object, needles: tuple[str, ...]) -> bool:
    if isinstance(obj, dict):
        return any(any(needle in str(key).lower() for needle in needles) for key in obj) or any(
            contains_key(value, needles) for value in obj.values()
        )
    if isinstance(obj, list):
        return any(contains_key(item, needles) for item in obj)
    return False


class OutdoorsyProviderTests(unittest.TestCase):
    def test_disabled_no_credentials_returns_empty(self):
        provider = OutdoorsyProvider(OutdoorsyConfig(provider_state="disabled"))
        result = provider.search_rentals(OfferSearchQuery(lat=39.7, lng=-105.0))
        self.assertEqual(result.status, "disabled")
        self.assertEqual(result.offers, [])

    def test_config_clamps_timeout_and_ttl(self):
        config = config_from_env({
            "OUTDOORSY_REQUEST_TIMEOUT_SECONDS": "0",
            "OUTDOORSY_CACHE_TTL_SECONDS": "999999",
            "OUTDOORSY_PROVIDER_STATE": "live_external_checkout",
        })
        self.assertEqual(config.request_timeout_seconds, 1)
        self.assertEqual(config.cache_ttl_seconds, 3600)
        self.assertEqual(config.normalized_state(), "live_external_checkout")

    def test_live_without_inventory_contract_returns_empty(self):
        provider = OutdoorsyProvider(OutdoorsyConfig(
            tune_network_id="network",
            tune_api_key="secret",
            enable_live=True,
            provider_state="live_external_checkout",
        ))
        result = provider.search_rentals(OfferSearchQuery(lat=39.7, lng=-105.0))
        self.assertEqual(result.status, "unconfirmed_contract")
        self.assertEqual(result.offers, [])

    def test_affiliate_only_state_returns_empty_inventory(self):
        provider = OutdoorsyProvider(OutdoorsyConfig(provider_state="configured_affiliate_link"))
        result = provider.search_rentals(OfferSearchQuery(lat=39.7, lng=-105.0))
        self.assertEqual(result.status, "affiliate_only")
        self.assertEqual(result.offers, [])

    def test_valid_fixture_normalization_and_dedupe(self):
        payload = json.loads(SEARCH.read_text())
        result = normalize_outdoorsy_payload(payload, query=OfferSearchQuery(lat=39.7392, lng=-104.9903), fetched_at=100, ttl_seconds=900)
        self.assertEqual(result.status, "ok")
        self.assertEqual(len(result.offers), 2)
        first = result.offers[0]
        self.assertEqual(first.provider, "outdoorsy")
        self.assertEqual(first.type, "campervan_rental")
        self.assertEqual(first.pickup_area, "Denver, CO")
        self.assertEqual(first.approximate_lat, 39.7392)
        self.assertEqual(first.approximate_lng, -104.9903)
        self.assertEqual(first.price_from, 129.0)
        self.assertEqual(first.price_freshness, "Fixture only")
        self.assertEqual(first.disclosure_label, PARTNER_BOOKING_DISCLOSURE_LABEL)
        self.assertEqual(first.external_checkout_status, "unconfirmed")

    def test_empty_result(self):
        result = normalize_outdoorsy_payload(json.loads(EMPTY.read_text()), fetched_at=100)
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.offers, [])

    def test_partial_result_missing_images_and_location_privacy(self):
        result = normalize_outdoorsy_payload(json.loads(PARTIAL.read_text()), fetched_at=100)
        self.assertEqual(len(result.offers), 1)
        offer = result.offers[0]
        self.assertEqual(offer.images, [])
        self.assertEqual(offer.pickup_area, "Boulder, CO")
        self.assertIsNone(offer.approximate_lat)
        self.assertIsNone(offer.approximate_lng)
        public = offer.to_public_dict()
        self.assertNotIn("address", json.dumps(public).lower())

    def test_malformed_response_returns_empty(self):
        result = normalize_outdoorsy_payload({"status": "ok", "rentals": "bad"}, fetched_at=100)
        self.assertEqual(result.status, "malformed_response")
        self.assertEqual(result.offers, [])

    def test_auth_rate_limit_and_transient_failures_return_empty(self):
        for status in ("auth_error", "rate_limited", "transient_error"):
            result = normalize_outdoorsy_payload({"status": status, "rentals": []}, fetched_at=100)
            self.assertEqual(result.status, status)
            self.assertEqual(result.offers, [])

    def test_invalid_dates(self):
        provider = OutdoorsyProvider(OutdoorsyConfig(provider_state="fixture_only", fixture_path=str(SEARCH)))
        result = provider.search_rentals(OfferSearchQuery(start_date="2026-07-10", end_date="2026-07-01"))
        self.assertEqual(result.status, "invalid_request")
        self.assertEqual(result.reason, "invalid_date_range")

    def test_sleeps_party_filtering(self):
        payload = json.loads(SEARCH.read_text())
        result = normalize_outdoorsy_payload(payload, query=OfferSearchQuery(sleeps=4), fetched_at=100)
        self.assertEqual(len(result.offers), 1)
        self.assertEqual(result.offers[0].provider_offer_id, "denver-rv-4")

    def test_pet_and_delivery_filtering(self):
        payload = json.loads(SEARCH.read_text())
        pet_result = normalize_outdoorsy_payload(payload, query=OfferSearchQuery(pet_friendly=True), fetched_at=100)
        delivery_result = normalize_outdoorsy_payload(payload, query=OfferSearchQuery(delivery=True), fetched_at=100)
        self.assertEqual([offer.provider_offer_id for offer in pet_result.offers], ["denver-campervan-1"])
        self.assertEqual([offer.provider_offer_id for offer in delivery_result.offers], ["denver-rv-4"])

    def test_pagination_limit(self):
        payload = json.loads(SEARCH.read_text())
        result = normalize_outdoorsy_payload(payload, query=OfferSearchQuery(limit=1), fetched_at=100)
        self.assertEqual(len(result.offers), 1)

    def test_fixture_mode_reads_file(self):
        provider = OutdoorsyProvider(OutdoorsyConfig(provider_state="fixture_only", fixture_path=str(SEARCH)))
        result = provider.search_rentals(OfferSearchQuery(lat=39.7392, lng=-104.9903))
        self.assertEqual(result.status, "ok")
        self.assertGreaterEqual(len(result.offers), 1)

    def test_missing_fixture_fails_closed(self):
        provider = OutdoorsyProvider(OutdoorsyConfig(provider_state="fixture_only", fixture_path=""))
        result = provider.search_rentals(OfferSearchQuery())
        self.assertEqual(result.status, "empty")
        self.assertEqual(result.offers, [])

    def test_unreadable_fixture_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{")
            provider = OutdoorsyProvider(OutdoorsyConfig(provider_state="fixture_only", fixture_path=str(path)))
            result = provider.search_rentals(OfferSearchQuery())
        self.assertEqual(result.status, "malformed_response")
        self.assertEqual(result.offers, [])

    def test_no_raw_payload_or_secret_fields_returned_to_mobile(self):
        payload = json.loads(SEARCH.read_text())
        result = normalize_outdoorsy_payload(payload, fetched_at=100).to_public_dict()
        self.assertFalse(contains_key(result, ("raw", "token", "api_key", "secret", "network_id")))
        self.assertNotIn("private address", json.dumps(result).lower())

    def test_external_checkout_remains_unconfirmed(self):
        payload = json.loads(SEARCH.read_text())
        result = normalize_outdoorsy_payload(payload, fetched_at=100)
        self.assertTrue(all(offer.external_checkout_status == "unconfirmed" for offer in result.offers))


if __name__ == "__main__":
    unittest.main()
