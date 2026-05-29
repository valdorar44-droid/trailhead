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
