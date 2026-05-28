# Route Provider Spikes

## GraphHopper Round Trips and Alternatives

Status: future option only. This production pass keeps Trailhead on the current Mapbox, Valhalla, and offline Valhalla stack.

Official docs reviewed:

- GraphHopper Routing API: `https://docs.graphhopper.com/openapi/routing`
- GraphHopper map data and routing profiles: `https://docs.graphhopper.com/openapi/map-data-and-routing-profiles`
- GraphHopper pricing: `https://www.graphhopper.com/pricing/`
- GraphHopper credit costs: `https://support.graphhopper.com/support/solutions/articles/44000718211-what-is-one-credit-`

Useful fit:

- `algorithm=round_trip` can create a route that returns to the starting point and accepts `round_trip.distance` plus `round_trip.seed` for different generated tours.
- `algorithm=alternative_route` can return multiple near-optimal paths with controls for max path count, max weight factor, and route overlap.
- The Routing API returns path geometry, instructions, elevation, and path details, which maps cleanly to Trailhead's base geometry layer.
- Standard profiles include car, motorway-avoidance, ferry/toll avoidance, small truck, truck, foot, hike, bike, and MTB. Custom models can modify routing behavior per request.

Cost notes from official pricing docs, checked May 26, 2026:

- Free is listed at 500 credits/day and is marked non-commercial.
- Basic is listed at 69 EUR/month for 5,000 credits/day and 30 max locations/request.
- Standard is listed at 199 EUR/month for 15,000 credits/day and 80 max locations/request.
- Premium is listed at 479 EUR/month for 50,000 credits/day and 200 max locations/request.
- A standard Routing API request with 2 to 10 locations costs 1 credit; more than 10 locations costs locations divided by 10.
- `alternative_route` adds 1 credit, and `round_trip` costs 2x according to the Routing API credit table.

Open questions before implementation:

- Whether GraphHopper's generated round trips are controllable enough for Trailhead overland loops that need named anchor geometry, camp windows, and legal public-land routing.
- Whether custom models can safely represent `wild` mode without sending users onto roads unsuitable for their rig.
- Cost and rate-limit impact: the docs list extra credit cost for `alternative_route` and multiplied cost for round trips.
- Offline parity: Trailhead still needs native/offline Valhalla equivalents or an explicit online-only label before a GraphHopper loop is accepted as navigation-ready.

Decision for this pass:

- Route Builder now creates explicit `Loop` and `There and back` shapes using the existing routing engines.
- `Loop` uses separate outbound and return anchors so the geometry is a real circuit instead of an accidental out-and-back.
- `There and back` intentionally returns from the destination to the start.
- GraphHopper remains a follow-up spike for higher-quality automatic loop candidates and alternative-route suggestions.
