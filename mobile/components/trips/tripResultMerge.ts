import type {
  Campsite,
  DayPlan,
  GasStation,
  TripResult,
} from '@/lib/api';

type MergeableTripMember = Campsite | GasStation;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedText(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function finiteNumber(value: unknown): number | null {
  const clean = Number(value);
  return Number.isFinite(clean) ? clean : null;
}

function meaningfulValue(value: unknown) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function memberMatches(canonical: MergeableTripMember, legacy: MergeableTripMember) {
  const canonicalId = normalizedText(canonical.id);
  const legacyId = normalizedText(legacy.id);
  if (canonicalId && legacyId && canonicalId === legacyId) return true;

  const canonicalLat = finiteNumber(canonical.lat);
  const canonicalLng = finiteNumber(canonical.lng);
  const legacyLat = finiteNumber(legacy.lat);
  const legacyLng = finiteNumber(legacy.lng);
  const coordinatesMatch = canonicalLat != null
    && canonicalLng != null
    && legacyLat != null
    && legacyLng != null
    && Math.abs(canonicalLat - legacyLat) <= 0.0001
    && Math.abs(canonicalLng - legacyLng) <= 0.0001;
  const canonicalName = normalizedText(canonical.name);
  const legacyName = normalizedText(legacy.name);
  const bothHaveCoordinates = canonicalLat != null
    && canonicalLng != null
    && legacyLat != null
    && legacyLng != null;
  if (canonicalName && legacyName && canonicalName === legacyName) {
    return !bothHaveCoordinates || coordinatesMatch;
  }
  return coordinatesMatch;
}

function mergeRichMember<T extends MergeableTripMember>(legacy: T | undefined, canonical: T): T {
  if (!legacy) return { ...canonical };
  const result: Record<string, unknown> = { ...legacy };
  for (const [key, value] of Object.entries(canonical)) {
    if (meaningfulValue(value) || !(key in result)) result[key] = value;
  }
  return result as unknown as T;
}

function mergeCanonicalMembers<T extends MergeableTripMember>(canonical: T[], legacy: T[]): T[] {
  const claimedLegacyIndexes = new Set<number>();
  return canonical.map(member => {
    const legacyIndex = legacy.findIndex((candidate, index) => (
      !claimedLegacyIndexes.has(index) && memberMatches(member, candidate)
    ));
    if (legacyIndex < 0) return { ...member };
    claimedLegacyIndexes.add(legacyIndex);
    return mergeRichMember(legacy[legacyIndex], member);
  });
}

function mergeDailyItinerary(canonical: DayPlan[], legacy: DayPlan[]): DayPlan[] {
  const legacyByDay = new Map<number, DayPlan>();
  for (const day of legacy) {
    const dayNumber = finiteNumber(day.day);
    if (dayNumber != null && !legacyByDay.has(dayNumber)) legacyByDay.set(dayNumber, day);
  }
  return canonical.map(day => {
    const legacyDay = legacyByDay.get(Number(day.day));
    if (!legacyDay) {
      return {
        ...day,
        highlights: [...(day.highlights ?? [])],
      };
    }
    const merged = {
      ...legacyDay,
      ...day,
      day: day.day,
      title: day.title,
      description: day.description,
      highlights: [...(day.highlights ?? [])],
    };
    if (finiteNumber(legacyDay.est_miles) != null) merged.est_miles = legacyDay.est_miles;
    if (normalizedText(legacyDay.road_type)) merged.road_type = legacyDay.road_type;
    return merged;
  });
}

function legacyBookingArray(builderState: Record<string, unknown> | null) {
  if (!builderState) return undefined;
  for (const key of ['bookings', 'booked_tours', 'bookedTours']) {
    const value = builderState[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return undefined;
}

function mergeBuilderState(
  canonicalValue: TripResult['builder_state'],
  legacyValue: TripResult['builder_state'],
) {
  const canonical = record(canonicalValue);
  const legacy = record(legacyValue);
  if (!canonical && !legacy) return undefined;
  const merged: Record<string, unknown> = {
    ...(legacy ?? {}),
    ...(canonical ?? {}),
  };

  const canonicalNotes = canonical?.notes;
  if (Array.isArray(canonicalNotes) && canonicalNotes.length === 0 && legacy && 'notes' in legacy) {
    merged.notes = legacy.notes;
  }

  const canonicalBookings = canonical?.bookings;
  if (Array.isArray(canonicalBookings) && canonicalBookings.length === 0) {
    const legacyBookings = legacyBookingArray(legacy);
    if (legacyBookings) merged.bookings = legacyBookings;
    else if (legacy && 'bookings' in legacy) merged.bookings = legacy.bookings;
  }
  return merged;
}

/**
 * Rehydrates a compact canonical trip with detail from its complete legacy
 * payload. Canonical V2 owns identity, membership, route, and day copy; the
 * legacy result contributes fields that have not yet moved into the V2 model.
 */
export function mergeCanonicalAndLegacyTripResults(
  canonical: TripResult,
  legacy: TripResult,
): TripResult {
  const canonicalMiles = finiteNumber(canonical.plan.total_est_miles);
  return {
    ...legacy,
    ...canonical,
    trip_id: canonical.trip_id,
    plan: {
      ...legacy.plan,
      ...canonical.plan,
      trip_name: canonical.plan.trip_name,
      overview: canonical.plan.overview,
      duration_days: canonical.plan.duration_days,
      states: [...canonical.plan.states],
      total_est_miles: canonicalMiles != null
        ? canonicalMiles
        : legacy.plan.total_est_miles,
      waypoints: canonical.plan.waypoints.map(waypoint => ({ ...waypoint })),
      daily_itinerary: mergeDailyItinerary(
        canonical.plan.daily_itinerary,
        legacy.plan.daily_itinerary,
      ),
      logistics: legacy.plan.logistics ?? canonical.plan.logistics,
    },
    campsites: mergeCanonicalMembers(canonical.campsites, legacy.campsites),
    gas_stations: mergeCanonicalMembers(canonical.gas_stations, legacy.gas_stations),
    route_geometry: canonical.route_geometry,
    builder_state: mergeBuilderState(canonical.builder_state, legacy.builder_state),
    updated_at: canonical.updated_at,
    version: canonical.version,
  };
}
