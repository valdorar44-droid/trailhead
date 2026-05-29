import type { CampReusePolicy, RouteStyleMode, TripShapeMode } from '@/lib/api';

export type RouteShapeRole =
  | 'start'
  | 'destination'
  | 'outbound_anchor'
  | 'return_anchor'
  | 'overnight'
  | 'side_stop';

export type RouteBuilderStopLike = {
  id?: string;
  day: number;
  name: string;
  lat: number;
  lng: number;
  type: string;
  description?: string;
  source?: string;
  routePointType?: 'side_stop' | 'break' | 'through';
  routeShapeRole?: RouteShapeRole;
  camp?: unknown;
  gas?: unknown;
  poi?: unknown;
};

export type RouteBuilderIntent = {
  shape: TripShapeMode;
  routeStyle: RouteStyleMode;
  campReusePolicy: CampReusePolicy;
  days: number[];
  maxDriveHoursPerDay?: number | null;
  targetMilesPerDay?: number | null;
};

export type ProviderRouteGeometry = {
  coords: [number, number][];
  totalDistanceMi: number;
  totalDurationHours: number;
  source: 'provider' | 'saved' | 'sketch' | 'none';
  confidence: 'high' | 'medium' | 'low' | 'none';
  engine?: string;
};

export type RouteShapeDayRole = 'outbound' | 'turnaround' | 'return' | 'one_way';

export type DayRouteSegment = {
  day: number;
  startPoint: { lat: number; lng: number };
  endPoint: { lat: number; lng: number };
  targetRouteMile: number;
  providerDistanceMi: number;
  providerDurationHours: number;
  campWindowStart: number;
  campWindowEnd: number;
  campWindowLabel: string;
  overDailyMax: boolean;
  routeSource: ProviderRouteGeometry['source'];
  confidence: ProviderRouteGeometry['confidence'];
  routeShapeRole?: RouteShapeDayRole;
};

export type TripReadinessTask = {
  level: 'ok' | 'warn';
  label: string;
  text: string;
};

export type TripReadiness = {
  navigationReady: boolean;
  routeReady: boolean;
  tasks: TripReadinessTask[];
};

export type RouteBuildIssue = {
  code:
    | 'provider_route_missing'
    | 'provider_route_low_confidence'
    | 'temporary_anchor'
    | 'missing_overnight'
    | 'over_daily_max'
    | 'fuel_range'
    | 'camp_search_widened';
  level: 'info' | 'warn' | 'block';
  day?: number;
  message: string;
};

export type RouteBuildSession<TStop extends RouteBuilderStopLike = RouteBuilderStopLike> = {
  intent: RouteBuilderIntent;
  geometry: ProviderRouteGeometry | null;
  daySegments: DayRouteSegment[];
  durableStops: TStop[];
  temporaryAnchors: TStop[];
  issues: RouteBuildIssue[];
  readiness: TripReadiness;
  navigationReady: boolean;
};
