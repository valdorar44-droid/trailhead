import { isFullTripRouteRequest, routeMatchesTripContext, shouldPersistTripRoute } from '../routePersistencePolicy';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`route persistence policy failed: ${message}`);
}

const fullTrip = 'rwp1:-104.9903,39.7392|-109.5498,38.5733|-104.9903,39.7392';

assert(
  isFullTripRouteRequest(fullTrip, fullTrip),
  'a route-options rebuild through every trip stop is still a full trip route',
);

assert(
  !isFullTripRouteRequest(
    'rwp1:-104.9800,39.7300|-109.5498,38.5733|-104.9903,39.7392',
    fullTrip,
  ),
  'a reroute from the current vehicle location remains navigation-only',
);

assert(
  routeMatchesTripContext({
    scope: 'navigation',
    waypointSignature: 'rwp1:-104.9800,39.7300|-109.5498,38.5733',
    tripContextSignature: fullTrip,
  }, fullTrip),
  'a navigation route remains valid while its trip context is unchanged',
);

assert(
  !routeMatchesTripContext({
    scope: 'navigation',
    waypointSignature: 'rwp1:-104.9800,39.7300|-109.5498,38.5733',
    tripContextSignature: fullTrip,
  }, 'rwp1:'),
  'a transient route is invalidated when the active trip clears',
);

assert(
  shouldPersistTripRoute({
    scope: 'trip',
    tripId: 'trip-1',
    requestWaypointSignature: fullTrip,
    tripWaypointSignature: fullTrip,
  }),
  'a complete matching trip route is durable',
);

assert(
  !shouldPersistTripRoute({
    scope: 'search',
    tripId: 'trip-1',
    requestWaypointSignature: 'rwp1:-104.9903,39.7392|-105.2705,40.0150',
    tripWaypointSignature: fullTrip,
  }),
  'a place-search route cannot replace the trip route',
);

assert(
  !shouldPersistTripRoute({
    scope: 'navigation',
    tripId: 'trip-1',
    requestWaypointSignature: 'rwp1:-106.1000,39.1000|-109.5498,38.5733|-104.9903,39.7392',
    tripWaypointSignature: fullTrip,
  }),
  'a partial navigation reroute cannot replace the trip route',
);

assert(
  !shouldPersistTripRoute({
    scope: 'trip',
    tripId: 'trip-1',
    requestWaypointSignature: 'rwp1:-104.9903,39.7392|-109.5498,38.5733',
    tripWaypointSignature: fullTrip,
  }),
  'an incomplete trip route is not durable',
);

console.log('route persistence policy tests passed');
