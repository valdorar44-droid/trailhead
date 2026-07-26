import type { SearchRequestV2 } from './types';

type ServiceRuleV2 = {
  pattern: RegExp;
  categories: string[];
  radiusMeters: number;
};

const SERVICE_RULES_V2: readonly ServiceRuleV2[] = [
  {
    pattern: /\b(?:gas stations?|gas|fuel|petrol|diesel)\b/i,
    categories: ['fuel', 'gas_station', 'service_station'],
    radiusMeters: 30_000,
  },
  {
    pattern: /\b(?:drinking water|potable water|water fill(?:ing)?(?: station)?)\b/i,
    categories: ['drinking_water', 'potable_water', 'water_fill'],
    radiusMeters: 40_000,
  },
  {
    pattern: /\b(?:grocer(?:y|ies)|grocery stores?|supermarkets?)\b/i,
    categories: ['grocery', 'grocery_store', 'market', 'supermarket', 'supplies'],
    radiusMeters: 30_000,
  },
  {
    pattern: /\b(?:rv\s+)?dump stations?\b/i,
    categories: ['dump', 'dump_station', 'rv_dump_station', 'waste_disposal'],
    radiusMeters: 50_000,
  },
  {
    pattern: /\b(?:auto|car|vehicle)?\s*(?:repair|mechanics?|service shops?)\b/i,
    categories: ['repair', 'mechanic', 'auto_repair', 'car_repair', 'vehicle_repair', 'parts'],
    radiusMeters: 40_000,
  },
  {
    pattern: /\b(?:parking|parking lots?)\b/i,
    categories: ['parking', 'parking_lot'],
    radiusMeters: 25_000,
  },
];

const EXPLICIT_LOCALITY_RE = /\b(?:near|around|in|at|by|close\s+to)\s+(.+?)\s*$/i;
const CURRENT_LOCATION_TERMS = new Set(['me', 'my location', 'current location', 'here']);

function normalizeQualifier(value: string) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function inferServiceSearchRequestV2(request: SearchRequestV2): SearchRequestV2 {
  if ((request.intent ?? 'any') !== 'any' || (request.categories?.length ?? 0) > 0) {
    return request;
  }
  const rule = SERVICE_RULES_V2.find(item => item.pattern.test(request.query));
  if (!rule) return request;

  const locality = normalizeQualifier(
    EXPLICIT_LOCALITY_RE.exec(request.query)?.[1] ?? '',
  );
  const hasNamedLocality = Boolean(locality && !CURRENT_LOCATION_TERMS.has(locality));
  const canUseNearbyCenter = (request.scope ?? 'global') === 'global'
    && Boolean(request.center)
    && !hasNamedLocality;

  return {
    ...request,
    intent: 'service',
    categories: [...rule.categories],
    ...(canUseNearbyCenter
      ? { scope: 'nearby' as const, radius_meters: rule.radiusMeters }
      : {}),
  };
}
