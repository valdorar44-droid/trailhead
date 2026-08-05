# Smokies current-road observation V1

Trailhead checks the National Park Service's GRSM alert feed immediately before
starting a Great Smoky Mountains Original chapter:

- Human-readable source: `https://www.nps.gov/grsm/planyourvisit/conditions.htm`
- Machine-readable feed: `https://www.nps.gov/grsm/park-alerts-grsm.json`
- Source owner: National Park Service
- Operational source ID: `grsm-current-cautions`

The integration is gated by
`TRAILHEAD_ORIGINALS_ROAD_READINESS_ENABLED=off|internal|public`. The default is
`off`; `internal` is available only to authenticated administrators.

The feed is a current closure list. Absence from that list is **not** proof that
a road is safe or guaranteed open. The only successful reader-facing statement
is: `The current NPS road check does not list a closure for this chapter.`

## Identity and failure behavior

The reader intersects official NPS road-segment UUIDs with the immutable source
geometry IDs bound to the selected chapter and route variant. It does not use
road-name matching, coordinates, search results, or generated interpretation.

Missing segment IDs on an active closure, malformed data, stale evidence,
unreviewed route geometry, or a route segment owned by an agency not covered by
the NPS feed produces `check_required`. Static route geometry, seasonal rules,
vehicle-free days, vehicle restrictions, fees, and live closures remain
separate evidence layers.

The server retains only normalized segment identity sets, response hash, ETag,
Last-Modified, and fetch time in its bounded in-memory cache. It does not retain
source prose, user location, traveled routes, vehicle details, or a user's
chapter selection.
