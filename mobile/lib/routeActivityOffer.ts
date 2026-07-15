import type { BookableExperience, OsmPoi, TripResult } from './api';
import type { BookedTour } from './bookedTours';

const MAX_ROUTE_ACTIVITY_OFFERS = 5;
const DEFAULT_PROVIDER_TIMEOUT_MS = 125_000;
const PROVIDER_TIMEOUT_MARGIN_MS = 5_000;
const MIN_PROVIDER_TIMEOUT_MS = 6_000;

export const ROUTE_ACTIVITY_POLL_DELAYS_MS = [
  4_500,
  6_500,
  8_500,
  10_500,
  12_500,
] as const;

export type PendingRouteActivityOffer = {
  tripId: string;
  createdAt: number;
  experiences: BookableExperience[];
};

export function mergeRouteActivityBooking(
  builderState: Record<string, unknown> | null | undefined,
  booking: BookedTour | null | undefined,
  previousBuilderState?: Record<string, unknown> | null,
) {
  const base = { ...(builderState ?? {}) };
  const candidates = [
    booking,
    ...[base, previousBuilderState ?? {}].flatMap(state => {
      const existing = state.bookings ?? state.booked_tours ?? state.bookedTours;
      return Array.isArray(existing) ? existing : [];
    }),
  ];
  const seen = new Set<string>();
  const bookings = candidates.filter((candidate): candidate is BookedTour => {
    if (!candidate || typeof candidate !== 'object') return false;
    const id = String((candidate as BookedTour).id || '').trim();
    const title = String((candidate as BookedTour).title || '').trim();
    if (!id || !title || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  delete base.booked_tours;
  delete base.bookedTours;
  return bookings.length ? { ...base, bookings } : base;
}

function isApprovedViatorUrl(candidate: string) {
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return parsed.protocol === 'https:'
      && (hostname === 'viator.com' || hostname.endsWith('.viator.com'));
  } catch {
    return false;
  }
}

export function routeActivityBookingUrl(experience: BookableExperience) {
  const url = [experience.booking_url, experience.affiliate_url, experience.source_url]
    .map(candidate => String(candidate || '').trim())
    .find(isApprovedViatorUrl);
  return url || '';
}

export function isUsableViatorRouteActivity(experience: BookableExperience) {
  const source = String(experience.source || '').trim().toLowerCase();
  const sourceBadge = String(experience.source_badge || '').trim().toLowerCase();
  const providerId = String(experience.provider?.id || '').trim().toLowerCase();
  return (source === 'viator' || sourceBadge === 'viator' || providerId === 'viator')
    && Boolean(String(experience.id || experience.source_id || '').trim())
    && Boolean(String(experience.title || '').trim())
    && Boolean(routeActivityBookingUrl(experience));
}

function validCoordinatePair(latValue: unknown, lngValue: unknown) {
  if (latValue === null || latValue === undefined || String(latValue).trim() === '') return null;
  if (lngValue === null || lngValue === undefined || String(lngValue).trim() === '') return null;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

const EXACT_ROUTE_ACTIVITY_COORDINATE_SOURCES = new Set([
  'product',
  'product_detail',
  'meeting_point',
  'itinerary_point',
  'curated_product',
]);

export function routeActivityHasExactCoordinates(experience: BookableExperience) {
  const coordinates = validCoordinatePair(experience.lat, experience.lng);
  if (!coordinates) return false;

  const source = String(experience.coordinate_source || '').trim().toLowerCase();
  const precision = String(experience.coordinate_precision || '').trim().toLowerCase();
  if (source === 'destination_centroid'
    || precision === 'approximate'
    || experience.route_stop_eligible === false) {
    return false;
  }
  if (experience.route_stop_eligible === true
    || EXACT_ROUTE_ACTIVITY_COORDINATE_SOURCES.has(source)
    || precision === 'exact'
    || precision === 'product') {
    return true;
  }

  // Older cached Viator products predate provenance fields but retain their source coordinates.
  const raw = experience.raw;
  const rawCoordinates = validCoordinatePair(
    raw?.lat ?? raw?.latitude,
    raw?.lng ?? raw?.longitude,
  );
  return Boolean(rawCoordinates
    && Math.abs(rawCoordinates.lat - coordinates.lat) <= 0.000001
    && Math.abs(rawCoordinates.lng - coordinates.lng) <= 0.000001);
}

export function buildPendingRouteActivityOffer(
  tripId: string,
  results: BookableExperience[],
  createdAt = Date.now(),
): PendingRouteActivityOffer | null {
  const cleanTripId = tripId.trim();
  if (!cleanTripId) return null;

  const seen = new Set<string>();
  const experiences = results.filter(experience => {
    if (!isUsableViatorRouteActivity(experience)) return false;
    const key = String(experience.source_id || experience.id).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_ROUTE_ACTIVITY_OFFERS);

  return experiences.length ? { tripId: cleanTripId, createdAt, experiences } : null;
}

export function buildCommittedRouteActivityOffer(
  tripId: string,
  activeTripId: string | null | undefined,
  results: BookableExperience[],
  createdAt = Date.now(),
) {
  const cleanTripId = String(tripId || '').trim();
  if (!cleanTripId || cleanTripId !== String(activeTripId || '').trim()) return null;
  return buildPendingRouteActivityOffer(cleanTripId, results, createdAt);
}

export function routeActivityPollWindowMs(providerTimeoutSeconds?: number | null) {
  const providerTimeoutMs = Number(providerTimeoutSeconds) * 1_000;
  const boundedProviderTimeoutMs = Number.isFinite(providerTimeoutMs) && providerTimeoutMs > 0
    ? Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.min(DEFAULT_PROVIDER_TIMEOUT_MS, providerTimeoutMs))
    : DEFAULT_PROVIDER_TIMEOUT_MS;
  return boundedProviderTimeoutMs + PROVIDER_TIMEOUT_MARGIN_MS;
}

export function nextRouteActivityPollDelayMs(
  attempt: number,
  elapsedMs: number,
  pollWindowMs: number,
) {
  const remainingMs = Math.max(0, pollWindowMs - Math.max(0, elapsedMs));
  if (remainingMs === 0) return null;
  const scheduleIndex = Math.max(0, Math.min(
    ROUTE_ACTIVITY_POLL_DELAYS_MS.length - 1,
    Math.floor(attempt),
  ));
  return Math.min(ROUTE_ACTIVITY_POLL_DELAYS_MS[scheduleIndex], remainingMs);
}

export function routeActivityDay(experience: BookableExperience, fallbackDay = 1) {
  const day = Math.round(Number(experience.route_match?.day ?? experience.route_anchor?.day));
  return Number.isFinite(day) && day > 0 ? day : Math.max(1, Math.round(fallbackDay) || 1);
}

export function routeActivityPlace(experience: BookableExperience): OsmPoi | null {
  if (!isUsableViatorRouteActivity(experience) || !routeActivityHasExactCoordinates(experience)) return null;
  const bookingUrl = routeActivityBookingUrl(experience);
  const summary = experience.summary || experience.description || 'Booked through Viator.';
  return {
    id: String(experience.id || experience.source_id),
    provider_place_id: experience.source_id || experience.id,
    name: experience.title.trim(),
    lat: Number(experience.lat),
    lng: Number(experience.lng),
    type: 'attraction',
    display_type: experience.category || 'Activity',
    source: 'viator',
    source_label: experience.source_badge || 'Viator',
    source_badge: experience.source_badge || 'Viator',
    booking_url: bookingUrl,
    official_url: bookingUrl,
    summary,
    description: summary,
    rating: experience.rating ?? undefined,
    review_count: experience.review_count ?? undefined,
    photo_url: experience.hero_image_url || experience.images?.find(image => image.url)?.url || null,
    attribution: experience.attribution || experience.source_badge || 'Viator',
  };
}

function normalizedRouteActivityId(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/^viator:/, '');
}

function routeActivityDistanceMeters(
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
) {
  const radiusM = 6_371_000;
  const toRadians = Math.PI / 180;
  const lat1 = first.lat * toRadians;
  const lat2 = second.lat * toRadians;
  const deltaLat = (second.lat - first.lat) * toRadians;
  const deltaLng = (second.lng - first.lng) * toRadians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return radiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function tripAlreadyHasRouteActivityStop(
  trip: Pick<TripResult, 'plan' | 'route_pois'>,
  place: Pick<OsmPoi, 'id' | 'provider_place_id' | 'name' | 'lat' | 'lng'>,
  day: number,
) {
  const targetDay = Math.max(1, Math.round(Number(day)) || 1);
  const targetIds = new Set(
    [place.id, place.provider_place_id]
      .map(normalizedRouteActivityId)
      .filter(Boolean),
  );
  const isNear = (candidate: { lat?: number; lng?: number }) => {
    const lat = Number(candidate.lat);
    const lng = Number(candidate.lng);
    return Number.isFinite(lat)
      && Number.isFinite(lng)
      && routeActivityDistanceMeters(place, { lat, lng }) <= 150;
  };

  const matchingRoutePoi = (trip.route_pois ?? []).some(candidate => {
    const raw = candidate as OsmPoi & {
      day?: number;
      recommended_day?: number;
      route_point_type?: 'side_stop' | 'break' | 'through';
    };
    const candidateDay = Math.round(Number(raw.recommended_day ?? raw.day));
    if (candidateDay !== targetDay) return false;
    const candidateIds = [raw.id, raw.provider_place_id].map(normalizedRouteActivityId);
    return candidateIds.some(id => id && targetIds.has(id)) || isNear(raw);
  });
  if (matchingRoutePoi) return true;

  return (trip.plan.waypoints ?? []).some(waypoint => (
    Number(waypoint.day) === targetDay
    && waypoint.route_point_type !== 'side_stop'
    && isNear(waypoint)
  ));
}

export function bookedTourFromRouteActivity(
  experience: BookableExperience,
  bookedAt = new Date().toISOString(),
): BookedTour | null {
  if (!isUsableViatorRouteActivity(experience)) return null;
  const sourceId = String(experience.source_id || experience.id).trim();
  const id = sourceId.toLowerCase().startsWith('viator:') ? sourceId : `viator:${sourceId}`;
  const locationParts = [experience.region, experience.country]
    .map(value => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  return {
    id,
    title: experience.title.trim(),
    productTitle: experience.title.trim(),
    location: locationParts.join(', ') || undefined,
    imageUrl: experience.hero_image_url || experience.images?.find(image => image.url)?.url || undefined,
    status: 'confirmed',
    cancellationSummary: String(experience.cancellation_summary || '').trim() || undefined,
    detailsUrl: routeActivityBookingUrl(experience),
    calendarNote: [experience.duration_label, experience.summary]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' · ') || undefined,
    bookedAt,
  };
}
