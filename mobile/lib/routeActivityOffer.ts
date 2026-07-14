import type { BookableExperience, OsmPoi } from './api';

const HTTP_URL = /^https?:\/\//i;
const MAX_ROUTE_ACTIVITY_OFFERS = 5;

export type PendingRouteActivityOffer = {
  tripId: string;
  createdAt: number;
  experiences: BookableExperience[];
};

export function routeActivityBookingUrl(experience: BookableExperience) {
  const url = [experience.booking_url, experience.affiliate_url, experience.source_url]
    .map(candidate => String(candidate || '').trim())
    .find(candidate => HTTP_URL.test(candidate));
  return url || '';
}

export function isUsableViatorRouteActivity(experience: BookableExperience) {
  const source = `${experience.source || ''} ${experience.source_badge || ''}`.toLowerCase();
  const hasLat = experience.lat !== null
    && experience.lat !== undefined
    && String(experience.lat).trim() !== '';
  const hasLng = experience.lng !== null
    && experience.lng !== undefined
    && String(experience.lng).trim() !== '';
  const lat = Number(experience.lat);
  const lng = Number(experience.lng);
  return source.includes('viator')
    && Boolean(String(experience.id || experience.source_id || '').trim())
    && Boolean(String(experience.title || '').trim())
    && hasLat
    && Number.isFinite(lat)
    && lat >= -90
    && lat <= 90
    && hasLng
    && Number.isFinite(lng)
    && lng >= -180
    && lng <= 180
    && Boolean(routeActivityBookingUrl(experience));
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

export function routeActivityDay(experience: BookableExperience, fallbackDay = 1) {
  const day = Math.round(Number(experience.route_match?.day ?? experience.route_anchor?.day));
  return Number.isFinite(day) && day > 0 ? day : Math.max(1, Math.round(fallbackDay) || 1);
}

export function routeActivityPlace(experience: BookableExperience): OsmPoi | null {
  if (!isUsableViatorRouteActivity(experience)) return null;
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
