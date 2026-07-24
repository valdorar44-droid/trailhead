import type { TripResult } from './api';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(value: unknown): string | null {
  const clean = String(value ?? '').trim().slice(0, 10);
  if (!DATE_PATTERN.test(clean)) return null;
  const parsed = new Date(`${clean}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : clean;
}

function addDays(value: string, offset: number): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Math.max(0, Math.round(offset)));
  return parsed.toISOString().slice(0, 10);
}

export function tripDepartureDate(trip: TripResult | null | undefined): string | null {
  const state = trip?.builder_state as Record<string, unknown> | undefined;
  const schedule = state?.schedule && typeof state.schedule === 'object'
    ? state.schedule as Record<string, unknown>
    : undefined;
  return dateOnly(
    state?.departure_date
    ?? state?.start_date
    ?? state?.trip_start_date
    ?? schedule?.departure_date
    ?? schedule?.start_date,
  );
}

export function forecastIndexForTripDay(
  forecastDates: readonly string[] | null | undefined,
  day: number,
  departureDate?: string | null,
): number {
  if (!forecastDates?.length) return 0;
  const safeDay = Math.max(1, Math.round(Number(day) || 1));
  const cleanDeparture = dateOnly(departureDate);
  if (cleanDeparture) {
    const target = addDays(cleanDeparture, safeDay - 1);
    const exact = forecastDates.findIndex(value => dateOnly(value) === target);
    if (exact >= 0) return exact;
  }
  return Math.min(safeDay - 1, forecastDates.length - 1);
}

export function forecastDateLabel(value: unknown): string {
  const clean = dateOnly(value);
  if (!clean) return '';
  return new Date(`${clean}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function tripRouteDurationSeconds(trip: TripResult | null | undefined): number | null {
  const raw = Number(
    trip?.route_geometry?.totalDuration
    ?? trip?.route_geometry?.total_duration,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function dayDriveMinutes(input: {
  dayMiles: number;
  tripMiles: number;
  routeDurationSeconds?: number | null;
}): number | null {
  const dayMiles = Number(input.dayMiles);
  const tripMiles = Number(input.tripMiles);
  const routeDurationSeconds = Number(input.routeDurationSeconds);
  if (
    !Number.isFinite(dayMiles)
    || dayMiles <= 0
    || !Number.isFinite(tripMiles)
    || tripMiles <= 0
    || !Number.isFinite(routeDurationSeconds)
    || routeDurationSeconds <= 0
  ) return null;
  return Math.max(1, Math.round((dayMiles / tripMiles) * routeDurationSeconds / 60));
}

export function driveTimeLabel(minutes: number | null | undefined): string {
  if (!Number.isFinite(minutes) || Number(minutes) <= 0) return '';
  const total = Math.max(1, Math.round(Number(minutes)));
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  if (!hours) return `${remaining} min`;
  if (!remaining) return `${hours} hr`;
  return `${hours} hr ${remaining} min`;
}
