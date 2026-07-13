export type RoutePersistenceScope = 'trip' | 'navigation' | 'search';

export type ActiveRouteContext = {
  scope: RoutePersistenceScope;
  waypointSignature: string;
  tripContextSignature: string;
};

type RoutePersistenceRequest = {
  scope: RoutePersistenceScope;
  tripId: string | null | undefined;
  requestWaypointSignature: string | null | undefined;
  tripWaypointSignature: string | null | undefined;
};

export function isFullTripRouteRequest(
  requestWaypointSignature: string | null | undefined,
  tripWaypointSignature: string | null | undefined,
) {
  return !!requestWaypointSignature
    && requestWaypointSignature !== 'rwp1:'
    && requestWaypointSignature === tripWaypointSignature;
}

export function routeMatchesTripContext(
  route: ActiveRouteContext | null | undefined,
  tripWaypointSignature: string,
) {
  if (!route || route.tripContextSignature !== tripWaypointSignature) return false;
  return route.scope !== 'trip'
    || isFullTripRouteRequest(route.waypointSignature, tripWaypointSignature);
}

/** Only a complete route through the active trip's stops may replace its saved line. */
export function shouldPersistTripRoute(request: RoutePersistenceRequest) {
  return request.scope === 'trip'
    && !!request.tripId
    && isFullTripRouteRequest(request.requestWaypointSignature, request.tripWaypointSignature);
}
