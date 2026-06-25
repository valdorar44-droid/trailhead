import type { RentalOffersQuery, RouteStyleMode, TripShapeMode } from './api';
import type { RigProfile } from './store';

const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type TripStart = {
  lat?: number | null;
  lng?: number | null;
  name?: string;
};

export type RentalSuggestionFit = {
  shouldSearch: boolean;
  shouldShow: boolean;
  suppressedReason?: string;
  title: string;
  subtitle: string;
  reason: string;
  query: RentalOffersQuery | null;
  context: {
    camp_nights: number;
    route_type: string;
    surface: string;
    trip_type: string;
    vehicle_type: string;
  };
  cacheKey: string;
};

export type RentalSuggestionInput = {
  start?: TripStart | null;
  days: number;
  campNights: number;
  routeStyle: RouteStyleMode | string;
  campPreference: string;
  tripShape: TripShapeMode | string;
  rigProfile?: RigProfile | null;
  dismissedAt?: number;
  now?: number;
  activeNavigation?: boolean;
  safetyWarningActive?: boolean;
};

function hasUsableRig(rig?: RigProfile | null) {
  return Boolean(rig && (rig.vehicle_type || rig.make || rig.model));
}

function startIsSearchable(start?: TripStart | null) {
  return Number.isFinite(start?.lat) && Number.isFinite(start?.lng);
}

function startLabel(start?: TripStart | null) {
  const clean = String(start?.name || '').split(',')[0]?.trim();
  return clean || 'your starting area';
}

function vehicleTypeFor(campPreference: string, routeStyle: string) {
  const text = `${campPreference} ${routeStyle}`.toLowerCase();
  if (/rv/.test(text)) return 'rv_rental';
  if (/trailer/.test(text)) return 'travel_trailer';
  if (/wild|camp|public|developed|private/.test(text)) return 'campervan_rental';
  return 'vehicle_rental';
}

function routeTypeFor(input: RentalSuggestionInput) {
  if (String(input.routeStyle).toLowerCase() === 'wild') return 'outdoors';
  if (/rv/.test(String(input.campPreference).toLowerCase())) return 'rv';
  if (input.campNights >= 2) return 'camping';
  if (input.days >= 3) return 'road_trip';
  return 'route';
}

function roundCoord(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : '0';
}

export function buildRentalSuggestionFit(input: RentalSuggestionInput): RentalSuggestionFit {
  const now = input.now ?? Date.now();
  const campNights = Math.max(0, Math.round(input.campNights || 0));
  const days = Math.max(1, Math.round(input.days || 1));
  const routeType = routeTypeFor({ ...input, days, campNights });
  const vehicleType = vehicleTypeFor(input.campPreference, input.routeStyle);
  const title = 'Need a vehicle for this trip?';
  const subtitle = `Campervans and RVs near ${startLabel(input.start)}`;
  const reason = campNights > 1
    ? `Fits your ${campNights}-night camping route.`
    : days > 1
      ? `Fits your ${days}-day route.`
      : 'Best for trips that start away from your own vehicle.';
  const context = {
    camp_nights: campNights,
    route_type: routeType,
    surface: 'route_builder',
    trip_type: routeType,
    vehicle_type: vehicleType,
  };
  const base: RentalSuggestionFit = {
    shouldSearch: false,
    shouldShow: false,
    title,
    subtitle,
    reason,
    query: null,
    context,
    cacheKey: `rentals:${roundCoord(input.start?.lat)}:${roundCoord(input.start?.lng)}:${days}:${campNights}:${routeType}:${vehicleType}`,
  };

  if (input.activeNavigation) return { ...base, suppressedReason: 'active_navigation' };
  if (input.safetyWarningActive) return { ...base, suppressedReason: 'safety_warning' };
  if (input.dismissedAt && now - input.dismissedAt < DISMISS_WINDOW_MS) {
    return { ...base, suppressedReason: 'recently_dismissed' };
  }
  if (!startIsSearchable(input.start)) return { ...base, suppressedReason: 'missing_start' };
  if (days <= 1 && campNights <= 0) return { ...base, suppressedReason: 'local_day_trip' };

  const hasRig = hasUsableRig(input.rigProfile);
  const rentalFit =
    !hasRig ||
    campNights >= 2 ||
    /rv|van|camp|outdoor|wild/.test(`${input.campPreference} ${input.routeStyle}`.toLowerCase()) ||
    days >= 4;

  if (!rentalFit) return { ...base, suppressedReason: 'own_vehicle_fit' };

  return {
    ...base,
    shouldSearch: true,
    shouldShow: true,
    query: {
      lat: Number(input.start?.lat),
      lng: Number(input.start?.lng),
      limit: 3,
      provider: 'outdoorsy',
      vehicle_type: vehicleType,
    },
  };
}
