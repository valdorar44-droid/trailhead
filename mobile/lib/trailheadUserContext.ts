import type { TripMemory, TripResult } from '@/lib/api';
import type { RigProfile } from '@/lib/store';
import { loadWelcomeSetupPreferences, type WelcomeSetupPreferences } from '@/lib/welcomeGate';
import { tripPreferenceContextFromWelcomePreferences, type TripPreferenceContext } from '@/lib/tripPreferences';

export type TrailheadUserContext = {
  preferences: WelcomeSetupPreferences | null;
  tripPreferences: TripPreferenceContext | null;
  rigProfile: RigProfile | null;
  activeTrip: TripResult | null;
  vehicleSummary: string;
  activeTripSummary: string;
  routeBuilderDefaults: TripPreferenceContext['route_builder'] | null;
  rentalInterest: TripPreferenceContext['rental_interest'] | null;
  campStyles: string[];
  tripMemory: TripMemory;
};

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function preferredStayLabels(tripPreferences: TripPreferenceContext | null): string[] {
  const styles = tripPreferences?.camping_styles ?? [];
  const labels = new Set<string>();
  if (styles.includes('dispersed')) labels.add('dispersed public land');
  if (styles.includes('developed')) labels.add('developed campgrounds');
  if (styles.includes('private')) labels.add('private stays');
  if (styles.includes('rv_parks')) labels.add('RV parks');
  if (styles.includes('any')) labels.add('any legal stay');
  return Array.from(labels);
}

function publicPrivatePreference(tripPreferences: TripPreferenceContext | null) {
  const camp = tripPreferences?.route_builder.camp_preference;
  if (camp === 'private') return 'private';
  if (camp === 'rv' || camp === 'developed') return 'developed';
  if (camp === 'public') return 'public';
  return 'mixed';
}

export function buildTripMemoryFromContext(
  rigProfile: RigProfile | null | undefined,
  tripPreferences: TripPreferenceContext | null | undefined,
): TripMemory {
  const rangeMiles = Number(rigProfile?.fuel_range_miles || 0);
  return {
    vehicle: rigProfile ? {
      type: rigProfile.vehicle_type,
      make: rigProfile.make,
      model: rigProfile.model,
      year: rigProfile.year,
      trim: rigProfile.trim,
      drive: rigProfile.drive,
      low_range: rigProfile.has_low_range,
      tires: {
        size: rigProfile.tire_size,
        diameter_in: rigProfile.tire_diameter_in,
        type: rigProfile.tire_type,
        full_size_spare: rigProfile.full_size_spare,
      },
      dimensions: {
        length_ft: rigProfile.length_ft,
        width_in: rigProfile.width_in,
        height_ft: rigProfile.height_ft,
        wheelbase_in: rigProfile.wheelbase_in,
      },
      gear: {
        winch: rigProfile.has_winch,
        recovery_points: rigProfile.has_recovery_points,
        traction_boards: rigProfile.has_traction_boards,
        air_compressor: rigProfile.has_air_compressor,
        skid_plates: rigProfile.has_skids,
        rock_sliders: rigProfile.has_rock_sliders,
      },
      limits: {
        max_trail_difficulty: rigProfile.max_trail_difficulty,
        max_water_depth_in: rigProfile.max_water_depth_in,
        avoid_narrow_trails: rigProfile.avoid_narrow_trails,
        avoid_body_damage: rigProfile.avoid_body_damage,
      },
    } : undefined,
    range: rangeMiles > 0 ? { miles: rangeMiles } : undefined,
    clearance: rigProfile?.ground_clearance_in ? { inches: rigProfile.ground_clearance_in } : undefined,
    trailer: rigProfile?.is_towing ? { length_ft: rigProfile.trailer_length_ft } : undefined,
    comfort_level: rigProfile?.max_trail_difficulty || 'remote-ready',
    preferred_stays: preferredStayLabels(tripPreferences ?? null),
    avoid_rules: [
      rigProfile?.avoid_narrow_trails ? 'narrow trails' : null,
      rigProfile?.avoid_body_damage ? 'body damage' : null,
    ].filter(Boolean) as string[],
    public_private_preference: publicPrivatePreference(tripPreferences ?? null),
  };
}

export function vehicleSummaryFromRig(rigProfile: RigProfile | null | undefined) {
  if (!rigProfile) return 'No rig saved';
  const title = [rigProfile.year, rigProfile.make, rigProfile.model].map(cleanText).filter(Boolean).join(' ');
  return title || cleanText(rigProfile.vehicle_type) || 'Saved rig';
}

export function activeTripSummaryFromTrip(activeTrip: TripResult | null | undefined) {
  if (!activeTrip) return 'No active trip';
  const name = cleanText(activeTrip.plan?.trip_name) || 'Active trip';
  const days = Number(activeTrip.plan?.duration_days || activeTrip.plan?.daily_itinerary?.length || 0);
  const miles = Number(activeTrip.plan?.total_est_miles || activeTrip.route_geometry?.totalDistance || activeTrip.route_geometry?.total_distance || 0);
  const pieces = [
    days > 0 ? `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}` : null,
    miles > 0 ? `${Math.round(miles).toLocaleString()} mi` : null,
  ].filter(Boolean);
  return pieces.length ? `${name} · ${pieces.join(' · ')}` : name;
}

export function buildTrailheadUserContext(input: {
  preferences?: WelcomeSetupPreferences | null;
  rigProfile?: RigProfile | null;
  activeTrip?: TripResult | null;
}): TrailheadUserContext {
  const preferences = input.preferences ?? null;
  const tripPreferences = tripPreferenceContextFromWelcomePreferences(preferences);
  return {
    preferences,
    tripPreferences,
    rigProfile: input.rigProfile ?? null,
    activeTrip: input.activeTrip ?? null,
    vehicleSummary: vehicleSummaryFromRig(input.rigProfile),
    activeTripSummary: activeTripSummaryFromTrip(input.activeTrip),
    routeBuilderDefaults: tripPreferences?.route_builder ?? null,
    rentalInterest: tripPreferences?.rental_interest ?? null,
    campStyles: preferredStayLabels(tripPreferences),
    tripMemory: buildTripMemoryFromContext(input.rigProfile, tripPreferences),
  };
}

export async function loadTrailheadUserContext(input: {
  rigProfile?: RigProfile | null;
  activeTrip?: TripResult | null;
}) {
  const preferences = await loadWelcomeSetupPreferences();
  return buildTrailheadUserContext({ ...input, preferences });
}
