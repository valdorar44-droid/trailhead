import type { CampReusePolicy, RouteStyleMode } from '@/lib/api';
import {
  loadWelcomeSetupPreferences,
  type WelcomeSetupPreferences,
  type WelcomeTravelNeed,
} from '@/lib/welcomeGate';

export type TripPreferenceContext = {
  vehicle?: WelcomeSetupPreferences['vehicle'];
  rental_interest: 'none' | 'consider' | 'needed' | 'unknown';
  camping_style?: WelcomeSetupPreferences['camping'];
  party?: WelcomeSetupPreferences['party'];
  needs: Record<WelcomeTravelNeed, boolean>;
  route_builder: {
    route_style: RouteStyleMode;
    camp_preference: 'public' | 'developed' | 'rv' | 'private' | 'any';
    camp_reuse_policy: CampReusePolicy;
    place_filters: string[];
    show_rental_suggestions: boolean;
  };
};

const DEFAULT_NEEDS: Record<WelcomeTravelNeed, boolean> = {
  pets: false,
  kids: false,
  towing: false,
  downloads: false,
};

function hasNeed(preferences: WelcomeSetupPreferences | null | undefined, need: WelcomeTravelNeed) {
  return Array.isArray(preferences?.needs) && preferences.needs.includes(need);
}

export function rentalInterestFromWelcomePreferences(preferences: WelcomeSetupPreferences | null | undefined): TripPreferenceContext['rental_interest'] {
  if (!preferences?.vehicle) return 'unknown';
  if (preferences.vehicle === 'need_rental') return 'needed';
  if (preferences.vehicle === 'rent_sometimes') return 'consider';
  if (preferences.vehicle === 'own_vehicle') return 'none';
  return 'unknown';
}

export function campPreferenceFromWelcomePreferences(preferences: WelcomeSetupPreferences | null | undefined): TripPreferenceContext['route_builder']['camp_preference'] {
  if (preferences?.camping === 'rv_parks') return 'rv';
  if (preferences?.camping === 'campgrounds') return 'developed';
  if (preferences?.camping === 'mixed') return 'any';
  return 'public';
}

export function routeStyleFromWelcomePreferences(preferences: WelcomeSetupPreferences | null | undefined): RouteStyleMode {
  if (preferences?.camping === 'dispersed') return 'wild';
  if (preferences?.party === 'family' || hasNeed(preferences, 'kids') || hasNeed(preferences, 'towing')) return 'balanced';
  return 'balanced';
}

export function campReuseFromWelcomePreferences(preferences: WelcomeSetupPreferences | null | undefined): CampReusePolicy {
  if (preferences?.party === 'family' || hasNeed(preferences, 'kids')) return 'same_camp_window';
  return 'different_each_night';
}

export function placeFiltersFromWelcomePreferences(preferences: WelcomeSetupPreferences | null | undefined) {
  const filters = new Set<string>();
  if (hasNeed(preferences, 'towing')) {
    filters.add('parking');
    filters.add('mechanic');
    filters.add('dump');
  }
  if (hasNeed(preferences, 'kids')) {
    filters.add('food');
    filters.add('grocery');
    filters.add('medical');
  }
  if (preferences?.vehicle === 'need_rental' || preferences?.vehicle === 'rent_sometimes') {
    filters.add('private_stay');
    filters.add('lodging');
  }
  if (preferences?.camping === 'rv_parks') {
    filters.add('propane');
    filters.add('water');
    filters.add('dump');
    filters.add('shower');
    filters.add('laundromat');
  }
  return Array.from(filters);
}

export function tripPreferenceContextFromWelcomePreferences(preferences: WelcomeSetupPreferences | null | undefined): TripPreferenceContext | null {
  if (!preferences) return null;
  const rentalInterest = rentalInterestFromWelcomePreferences(preferences);
  return {
    vehicle: preferences.vehicle ?? undefined,
    rental_interest: rentalInterest,
    camping_style: preferences.camping ?? undefined,
    party: preferences.party ?? undefined,
    needs: {
      ...DEFAULT_NEEDS,
      ...(preferences.needs ?? []).reduce((acc, need) => ({ ...acc, [need]: true }), {} as Partial<Record<WelcomeTravelNeed, boolean>>),
    },
    route_builder: {
      route_style: routeStyleFromWelcomePreferences(preferences),
      camp_preference: campPreferenceFromWelcomePreferences(preferences),
      camp_reuse_policy: campReuseFromWelcomePreferences(preferences),
      place_filters: placeFiltersFromWelcomePreferences(preferences),
      show_rental_suggestions: rentalInterest === 'needed' || rentalInterest === 'consider',
    },
  };
}

export function mergeTripPreferencesIntoRigContext(
  rigProfile: Record<string, unknown> | null | undefined,
  preferences: WelcomeSetupPreferences | null | undefined,
) {
  const tripPreferences = tripPreferenceContextFromWelcomePreferences(preferences);
  const base = rigProfile ? { ...rigProfile } : {};
  if (tripPreferences) base.trip_preferences = tripPreferences;
  return Object.keys(base).length ? base : null;
}

export async function loadTripPreferenceContext() {
  const preferences = await loadWelcomeSetupPreferences();
  return tripPreferenceContextFromWelcomePreferences(preferences);
}
