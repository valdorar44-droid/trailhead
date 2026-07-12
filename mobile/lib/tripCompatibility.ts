import type { BookableExperience, ExplorePlaceProfile, Logistics, TripResult, Waypoint } from './api';
import {
  createSavedEntity,
  createTripDocument,
  type SavedEntityKind,
  type SavedEntityV1,
  type TripDocumentV2,
  type TripItemKind,
  type TripItemV1,
  TRIP_ITEM_SCHEMA_VERSION,
} from './tripRepository';

function finiteCoordinates(lat: unknown, lng: unknown) {
  const cleanLat = Number(lat);
  const cleanLng = Number(lng);
  return Number.isFinite(cleanLat) && Math.abs(cleanLat) <= 90 && Number.isFinite(cleanLng) && Math.abs(cleanLng) <= 180
    ? { lat: cleanLat, lng: cleanLng }
    : undefined;
}

function stableIdHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function canonicalSavedEntityId(value: string, prefix = 'place') {
  const clean = String(value || '').trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(clean)) return clean;
  const readable = clean.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
  return `${prefix}:${readable || 'item'}:${stableIdHash(clean)}`;
}

function entityKind(value: string): SavedEntityKind {
  const text = value.toLowerCase();
  if (text.includes('camp') || text.includes('glamp')) return 'camp';
  if (text.includes('trail') || text.includes('hike')) return 'trail';
  if (text.includes('fuel') || text.includes('gas')) return 'fuel';
  if (text.includes('water') || text.includes('spring')) return 'water';
  if (text.includes('service') || text.includes('mechanic') || text.includes('repair')) return 'service';
  if (text.includes('activity') || text.includes('tour') || text.includes('guided')) return 'activity';
  return 'place';
}

function tripItemKind(value: string): TripItemKind {
  const kind = entityKind(value);
  return kind === 'trip_pack' ? 'place' : kind;
}

function cleanMedia(values: Array<{ url?: string; caption?: string; credit?: string; source?: string }>) {
  const seen = new Set<string>();
  return values.flatMap(value => {
    const url = String(value.url || '').trim();
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, kind: 'image' as const, caption: value.caption, credit: value.credit, source: value.source }];
  }).slice(0, 12);
}

export function savedEntityFromExplorePlace(place: ExplorePlaceProfile): SavedEntityV1 {
  const category = String(place.summary.explore_group || place.summary.category || place.category || 'place');
  const primary = typeof place.provenance?.primary === 'string'
    ? place.provenance.primary
    : place.provenance?.primary?.attribution || place.provenance?.primary?.source;
  const media = cleanMedia([
    { url: place.summary.image_url || undefined, credit: place.summary.image_credit, source: place.summary.source_title },
    { url: place.summary.thumbnail_url || undefined, credit: place.summary.image_credit, source: place.summary.source_title },
    ...(place.media || []).map(item => ({ ...item, source: place.summary.source_title })),
  ]);
  return createSavedEntity({
    id: canonicalSavedEntityId(place.id, 'place'),
    kind: entityKind(category),
    title: place.summary.title,
    summary: place.summary.short_description || place.profile.summary || place.summary.hook || place.profile.hook,
    category,
    region: place.summary.region || place.summary.state || undefined,
    coordinates: finiteCoordinates(place.summary.lat, place.summary.lng),
    source: primary || place.source_quality?.primary_name || place.source_pack?.primary || place.summary.source_title || undefined,
    sourceId: place.source_ids?.[0],
    sourceUrl: place.source_pack?.official_url || place.summary.source_url || undefined,
    media,
    needsEnrichment: place.enrichment?.level === 'basic',
    facts: {
      verified: Boolean(place.verified || place.provenance?.verified),
      best_season: place.best_season,
      access_notes: typeof place.access === 'string' ? place.access : place.profile.access_notes,
      amenities: place.amenities,
      source_count: place.provenance?.source_count,
      quality: place.enrichment?.level || place.quality,
    },
  });
}

export function savedEntityFromExperience(experience: BookableExperience): SavedEntityV1 {
  return createSavedEntity({
    id: canonicalSavedEntityId(experience.id.startsWith('experience:') ? experience.id : `experience:${experience.id}`, 'experience'),
    kind: 'activity',
    title: experience.title,
    summary: experience.summary || experience.description,
    category: experience.category || 'Guided trip',
    region: experience.region || experience.country,
    coordinates: finiteCoordinates(experience.lat, experience.lng),
    source: experience.source_badge || experience.source,
    sourceId: experience.source_id,
    sourceUrl: experience.source_url,
    bookingUrl: experience.booking_url || experience.affiliate_url,
    media: cleanMedia([
      { url: experience.hero_image_url, source: experience.source_badge || experience.source },
      ...(experience.images || []).map(image => ({ ...image, source: experience.source_badge || experience.source })),
    ]),
    facts: {
      duration: experience.duration_label,
      price_from: experience.price_from,
      currency: experience.currency,
      rating: experience.rating,
      review_count: experience.review_count,
      cancellation: experience.cancellation_summary,
      availability: experience.availability_summary,
    },
  });
}

function itemFromWaypoint(tripId: string, waypoint: Waypoint, index: number, timestamp: number): TripItemV1 {
  return {
    schemaVersion: TRIP_ITEM_SCHEMA_VERSION,
    id: `${tripId}:waypoint:${index}`,
    kind: tripItemKind(waypoint.type || waypoint.land_type || 'place'),
    title: waypoint.name,
    summary: waypoint.description,
    day: Math.max(1, Number(waypoint.day) || 1),
    order: index,
    coordinates: finiteCoordinates(waypoint.lat, waypoint.lng),
    note: waypoint.notes,
    source: waypoint.verified_source,
    sourceUrl: waypoint.verification_note,
    facts: { legacyWaypoint: waypoint },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function tripDocumentFromTripResult(trip: TripResult): TripDocumentV2 {
  const timestamp = Number(trip.updated_at) || Date.now();
  const rawBookings = trip.builder_state?.bookings || trip.builder_state?.booked_tours || trip.builder_state?.bookedTours;
  const bookings = Array.isArray(rawBookings) ? rawBookings.filter(value => value && typeof value === 'object') as Array<Record<string, unknown>> : [];
  return createTripDocument({
    id: trip.trip_id,
    title: trip.plan?.trip_name || 'Untitled trip',
    summary: trip.plan?.overview,
    status: 'active',
    regions: trip.plan?.states || [],
    days: (trip.plan?.daily_itinerary || []).map((day, index) => ({
      day: Number(day.day) || index + 1,
      title: day.title || `Day ${index + 1}`,
      summary: day.description,
    })),
    items: (trip.plan?.waypoints || []).map((waypoint, index) => itemFromWaypoint(trip.trip_id, waypoint, index, timestamp)),
    notes: [],
    readiness: { status: 'review' },
    bookings,
    alerts: [],
    offline: { ...(trip.timeline?.offline_readiness || {}) },
    visibility: 'private',
    route: trip.route_geometry ? { ...trip.route_geometry } : undefined,
    source: 'trip_result',
    createdAt: timestamp,
    updatedAt: timestamp,
    legacy: {
      source: 'trip_result',
      payload: {
        plan: trip.plan,
        campsites: trip.campsites,
        gas_stations: trip.gas_stations,
        route_pois: trip.route_pois,
        timeline: trip.timeline,
        builder_state: trip.builder_state,
      },
    },
  });
}

export function waypointFromSavedEntity(entity: SavedEntityV1, day = 1): Waypoint {
  return {
    day: Math.max(1, day),
    name: entity.title,
    type: entity.kind === 'activity' ? 'bookable_experience' : 'waypoint',
    description: entity.summary || '',
    land_type: entity.category || entity.kind,
    notes: entity.note || '',
    lat: entity.coordinates?.lat,
    lng: entity.coordinates?.lng,
    verified_source: entity.source,
    needs_review: entity.needsEnrichment ?? false,
    verification_note: entity.sourceUrl || entity.bookingUrl || '',
  };
}

const STARTER_LOGISTICS: Logistics = {
  vehicle_recommendation: 'Review road surfaces and access against your vehicle before departure.',
  fuel_strategy: 'Add fuel stops after setting the route and distance.',
  water_strategy: 'Carry water for the drive and confirm refill options before departure.',
  permits_needed: 'Check current land manager rules, permits, and closures.',
  best_season: 'Check current weather, fire conditions, and seasonal closures.',
};

export function starterTripResult(document: TripDocumentV2, entity: SavedEntityV1): TripResult {
  const waypoint = waypointFromSavedEntity(entity, 1);
  return {
    trip_id: document.id,
    plan: {
      trip_name: document.title,
      overview: document.summary || `A trip built around ${entity.title}.`,
      duration_days: 1,
      states: document.regions,
      total_est_miles: 0,
      waypoints: [waypoint],
      daily_itinerary: [{
        day: 1,
        title: entity.title,
        description: 'Set your starting point, route, and overnight stops.',
        est_miles: 0,
        road_type: 'To be planned',
        highlights: [entity.title],
      }],
      logistics: STARTER_LOGISTICS,
    },
    campsites: [],
    gas_stations: [],
    updated_at: document.updatedAt,
    version: document.revision,
  };
}

export function addSavedEntityToTripResult(trip: TripResult, entity: SavedEntityV1, day?: number): TripResult {
  const duplicate = trip.plan.waypoints.some(waypoint => {
    if (waypoint.name.trim().toLowerCase() === entity.title.trim().toLowerCase()) return true;
    if (!entity.coordinates || waypoint.lat == null || waypoint.lng == null) return false;
    return Math.abs(Number(waypoint.lat) - entity.coordinates.lat) < 0.0001
      && Math.abs(Number(waypoint.lng) - entity.coordinates.lng) < 0.0001;
  });
  if (duplicate) return trip;
  const targetDay = day ?? trip.plan.waypoints.reduce((latest, waypoint) => Math.max(latest, Number(waypoint.day) || 1), 1);
  return {
    ...trip,
    plan: { ...trip.plan, waypoints: [...trip.plan.waypoints, waypointFromSavedEntity(entity, targetDay)] },
    updated_at: Date.now(),
  };
}
