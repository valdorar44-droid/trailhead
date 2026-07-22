# Route Builder Geoapify Provider Follow-Up

Status: implemented for guarded 1.0.10 preview testing. No production flag or deployment was changed.

## Shipped scope

- Geoapify remains backend-only behind a blank-by-default `GEOAPIFY_API_KEY`.
- Only Search V2 requests with `surface=route_editor` and `intent=destination` use Geoapify autocomplete. Map and Explore continue to use their existing Mapbox Search Box behavior. Offline and Trailhead canonical results are unchanged and remain first.
- Geoapify suggestions are coordinate-free, `temporary`, and cannot be written to a trip. A suggestion resolves only after the user presses its exact row.
- The resolution reference is HMAC-signed, short-lived, and bound to the provider ID plus the exact query, session, surface, intent, scope, and geographic context. A copied, forged, expired, cross-query, or cross-session reference is rejected before provider access.
- Resolution accepts only the exact Geoapify `place_id` returned by the bounded autocomplete lookup. The resolved row contains coordinates, is marked `durable_external`, and carries the normalized provider ID and required source attribution.
- Route Builder's existing central temporary-result save guard remains in place. A durable selection stores its provider identity and attribution in both builder state and the saved waypoint, so reopening the route does not turn it back into an unresolved suggestion.
- User-facing rows use neutral labels such as `Address`, `Town or city`, `Region`, and `Place`. Provider names are retained only as provenance/legal metadata, not ordinary UI copy.
- Viator, Originals, canonical/offline search, existing Geoapify Places inventory, downloads, camps, trails, and Mapbox map/navigation behavior are not changed by this follow-up.

## Runtime safeguards

- Autocomplete returns at most 10 normalized rows and uses the existing provider budget guard.
- Autocomplete snapshots use a short, hashed-key runtime cache; raw search text is not added to cache keys, telemetry keys, or warning logs.
- Explicit resolution reuses the bounded Search V2 retrieve LRU, per-key singleflight, trusted subject/session quotas, and provider timeout.
- Geoapify `401`, `403`, and `429` responses use the existing 15-minute permission/quota backoff and fail closed to an empty provider result.
- A stale or unavailable selection uses: `That place is no longer available. Search again or drop a pin.`
- The Search V2 access-log filter continues to redact query text and session identifiers.

## Configuration

```dotenv
GEOAPIFY_API_KEY=
# Optional emergency/provider switch; defaults to enabled only when a key exists.
GEOAPIFY_DURABLE_SEARCH_ENABLED=true
```

The existing Geoapify project key should support both Places and address autocomplete unless that project has an endpoint restriction. No mobile key is needed and no credential is embedded in the app.

## Plan and cost checkpoint

No plan upgrade is required to develop or preview this path at low traffic. Geoapify's published free plan currently lists 3,000 credits/day and 5 requests/second. Its API10 plan currently lists 10,000 credits/day, 12 requests/second, commercial use/SLA benefits, and a listed price of US$59/month. Confirm the live limits before public rollout because pricing can change.

Upgrade before public enablement if measured suggest-plus-resolve volume approaches the current daily or rate limit, or if the desired commercial/white-label terms require it. Free-plan use must follow Geoapify branding requirements; OpenStreetMap attribution remains required under the underlying data license. Keep legal attribution in the app's source/attribution surface without adding provider jargon to ordinary search rows.

References:

- [Geoapify Address Autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/)
- [Geoapify Geocoding and storage guidance](https://www.geoapify.com/geocoding-api/)
- [Geoapify pricing](https://www.geoapify.com/pricing/)
- [Geoapify terms](https://www.geoapify.com/terms-and-conditions/)
- [Mapbox Search Box temporary-use rules](https://docs.mapbox.com/api/search/search-box/)

## Verification

- Backend Search V2 coverage includes provider dispatch by surface, coordinate-free suggestions, durable exact-ID resolution, signed-reference query/session/scope binding, expiry, concurrency/singleflight, replay cache, and preservation of existing Mapbox resolution.
- Mobile Search V2 coverage includes explicit-press resolution, unchanged temporary-result blocking, durable result presentation, attribution handoff, and route-draft reload.
- The focused backend and mobile suites must pass before enabling the provider in a preview environment.
