export type ExploreNearbyCoordinate = {
  lat: number;
  lng: number;
  name?: string;
};

export type ExploreNearbySearchCenter = ExploreNearbyCoordinate & {
  source: 'destination' | 'location';
};

function validCoordinate(center: ExploreNearbyCoordinate | null | undefined): center is ExploreNearbyCoordinate {
  return !!center
    && Number.isFinite(center.lat)
    && Number.isFinite(center.lng)
    && center.lat >= -90
    && center.lat <= 90
    && center.lng >= -180
    && center.lng <= 180;
}

const SERVICE_DESTINATION_ONLY_TERMS = new Set([
  'fuel',
  'gas',
  'gas station',
  'gas stations',
  'diesel',
  'petrol',
  'service station',
  'service stations',
  'supplies',
  'resupply',
  'grocery',
  'groceries',
  'grocery store',
  'grocery stores',
  'hardware',
  'mechanic',
  'mechanics',
  'repair',
  'parts',
  'food',
  'water',
  'medical',
  'pharmacy',
  'camp',
  'camps',
  'campground',
  'campgrounds',
  'trail',
  'trails',
  'park',
  'parks',
  'waterfall',
  'waterfalls',
  'view',
  'views',
  'tour',
  'tours',
  'guided',
]);

const FUEL_INTENT = '(?:fuel|gas stations?|gas|diesel|petrol|service stations?)';
const RESUPPLY_INTENT = '(?:supplies|resupply|grocer(?:y|ies)|grocery stores?|hardware|mechanics?|repair|parts|food|water|medical|pharmacy)';

function normalizedQuery(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function serviceDestinationQueryFromExploreQuery(query: string, category: string) {
  if (category !== 'fuel' && category !== 'resupply') return null;
  const original = String(query || '').replace(/\s+/g, ' ').trim();
  if (original.length < 2 || SERVICE_DESTINATION_ONLY_TERMS.has(normalizedQuery(original))) return null;

  const intent = category === 'fuel' ? FUEL_INTENT : RESUPPLY_INTENT;
  const leadingIntent = new RegExp(`^${intent}(?:\\s+(?:near|in|around|at))?\\s+`, 'i');
  const trailingIntent = new RegExp(`\\s+(?:nearby\\s+)?${intent}$`, 'i');
  const destination = original
    .replace(leadingIntent, '')
    .replace(trailingIntent, '')
    .replace(/^(?:near|in|around|at)\s+/i, '')
    .trim();
  const normalizedDestination = normalizedQuery(destination);
  if (
    normalizedDestination.length < 2
    || SERVICE_DESTINATION_ONLY_TERMS.has(normalizedDestination)
  ) return null;
  return destination;
}

export function resolveExploreNearbySearchCenter(
  category: string,
  destinationContextActive: boolean,
  destinationCenter: ExploreNearbyCoordinate | null,
  userLocation: ExploreNearbyCoordinate | null,
): ExploreNearbySearchCenter | null {
  const serviceCategory = category === 'fuel' || category === 'resupply';
  if (serviceCategory && destinationContextActive && validCoordinate(destinationCenter)) {
    return { ...destinationCenter, source: 'destination' };
  }
  if (validCoordinate(userLocation)) {
    return { ...userLocation, source: 'location' };
  }
  return null;
}
