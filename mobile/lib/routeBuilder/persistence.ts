import type { CampReusePolicy, RouteStyleMode, TripShapeMode } from '@/lib/api';

const STOP_TYPES = ['start', 'fuel', 'waypoint', 'camp', 'motel'] as const;
const STOP_SOURCES = ['search', 'camp', 'gas', 'poi', 'map'] as const;
const ROUTE_POINT_TYPES = ['side_stop', 'through', 'break'] as const;
const ROUTE_SHAPE_ROLES = ['start', 'destination', 'outbound_anchor', 'return_anchor', 'overnight', 'side_stop'] as const;

type PersistedRecord = Record<string, unknown>;

export type PersistedRouteBuilderStop = PersistedRecord & {
  id: string;
  day: number;
  name: string;
  lat: number;
  lng: number;
  type: 'start' | 'fuel' | 'waypoint' | 'camp' | 'motel';
  description: string;
  land_type: string;
  source?: 'search' | 'camp' | 'gas' | 'poi' | 'map';
  routePointType?: 'side_stop' | 'through' | 'break';
  routeShapeRole?: 'start' | 'destination' | 'outbound_anchor' | 'return_anchor' | 'overnight' | 'side_stop';
  routeProgressMi?: number;
  persistence_policy?: 'canonical' | 'durable_external' | 'temporary';
  temporary_use_only?: boolean;
  search_provider?: string;
  provider_result_id?: string;
  source_attribution?: string;
  camp?: PersistedRecord;
  gas?: PersistedRecord;
  poi?: PersistedRecord;
  campWindowStart?: number;
  campWindowEnd?: number;
  campWindowLabel?: string;
};

export type PersistedRouteBuilderState = {
  stops: PersistedRouteBuilderStop[];
  days?: number[];
  routeStyle?: RouteStyleMode;
  tripShapeMode?: TripShapeMode;
  driveHoursPerDay?: string;
  plannedDays?: string;
  tripBuildMode?: 'recommended' | 'blank';
  distanceMode?: 'hours' | 'miles';
  targetMiles?: string;
  restDays?: number[];
  dayDriveTargets?: Record<number, string>;
  activePlaceFilters?: string[];
  campPreferenceMode?: 'public' | 'developed' | 'rv' | 'private' | 'any';
  campPhotoOnly?: boolean;
  campCadenceMode?: 'nightly' | 'alternate' | 'manual';
  campReusePolicy?: CampReusePolicy;
};

type PersistedStopIdentity = {
  id?: unknown;
  day?: unknown;
  lat?: unknown;
  lng?: unknown;
  type?: unknown;
  camp?: unknown;
  gas?: unknown;
  poi?: unknown;
};

function record(value: unknown): PersistedRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PersistedRecord
    : null;
}

function persistedPlaceRecord(value: unknown): PersistedRecord | null {
  const source = record(value);
  if (!source) return null;
  const id = source.id;
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()) return null;
  for (const coordinate of ['lat', 'lng'] as const) {
    if (!(coordinate in source)) continue;
    const parsed = finiteNumber(source[coordinate]);
    if (parsed == null || (coordinate === 'lat' ? Math.abs(parsed) > 90 : Math.abs(parsed) > 180)) return null;
  }
  return source;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown, max = 30): number | null {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  const integer = Math.round(parsed);
  return integer >= 1 && integer <= max ? integer : null;
}

function positiveNumberString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? String(value).trim() : undefined;
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(value.map(item => positiveInteger(item)).filter((item): item is number => item != null)))
    .sort((a, b) => a - b);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)))
    .slice(0, 64);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined;
}

function persistedStop(value: unknown, index: number): PersistedRouteBuilderStop | null {
  const source = record(value);
  if (!source) return null;
  const lat = finiteNumber(source.lat);
  const lng = finiteNumber(source.lng);
  const day = positiveInteger(source.day);
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const type = enumValue(source.type, STOP_TYPES);
  if (lat == null || lng == null || day == null || !name || !type) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const description = typeof source.description === 'string' ? source.description : '';
  const landType = typeof source.land_type === 'string' && source.land_type.trim()
    ? source.land_type.trim()
    : type === 'fuel' || type === 'motel' ? 'town' : type === 'camp' ? 'camp' : 'route';
  const id = typeof source.id === 'string' && source.id.trim()
    ? source.id.trim()
    : `restored_${index}_${lat.toFixed(5)}_${lng.toFixed(5)}`;
  const campWindowStart = finiteNumber(source.campWindowStart);
  const campWindowEnd = finiteNumber(source.campWindowEnd);
  const routeProgressMi = finiteNumber(source.routeProgressMi);

  return {
    ...source,
    id,
    day,
    name,
    lat,
    lng,
    type,
    description,
    land_type: landType,
    source: enumValue(source.source, STOP_SOURCES),
    routePointType: enumValue(source.routePointType, ROUTE_POINT_TYPES),
    routeShapeRole: enumValue(source.routeShapeRole, ROUTE_SHAPE_ROLES),
    routeProgressMi: routeProgressMi != null && routeProgressMi >= 0 ? routeProgressMi : undefined,
    persistence_policy: enumValue(source.persistence_policy, ['canonical', 'durable_external', 'temporary']),
    temporary_use_only: typeof source.temporary_use_only === 'boolean' ? source.temporary_use_only : undefined,
    search_provider: typeof source.search_provider === 'string' ? source.search_provider.slice(0, 40) : undefined,
    provider_result_id: typeof source.provider_result_id === 'string' ? source.provider_result_id.slice(0, 200) : undefined,
    source_attribution: typeof source.source_attribution === 'string' ? source.source_attribution.slice(0, 200) : undefined,
    camp: persistedPlaceRecord(source.camp) ?? undefined,
    gas: persistedPlaceRecord(source.gas) ?? undefined,
    poi: persistedPlaceRecord(source.poi) ?? undefined,
    campWindowStart: campWindowStart ?? undefined,
    campWindowEnd: campWindowEnd ?? undefined,
    campWindowLabel: typeof source.campWindowLabel === 'string' ? source.campWindowLabel : undefined,
  };
}

export function readPersistedRouteBuilderState(value: unknown): PersistedRouteBuilderState | null {
  const source = record(value);
  if (!source) return null;
  const dayDriveTargetsSource = record(source.dayDriveTargets);
  const dayDriveTargets = dayDriveTargetsSource
    ? Object.fromEntries(Object.entries(dayDriveTargetsSource).flatMap(([dayValue, target]) => {
        const day = positiveInteger(dayValue);
        const hours = positiveNumberString(target, 24);
        return day != null && hours ? [[day, hours]] : [];
      }))
    : undefined;

  return {
    stops: Array.isArray(source.stops)
      ? source.stops.map(persistedStop).filter((stop): stop is PersistedRouteBuilderStop => !!stop)
      : [],
    days: numberArray(source.days),
    routeStyle: enumValue(source.routeStyle, ['direct', 'balanced', 'wild']),
    tripShapeMode: persistedTripShape(source) ?? undefined,
    driveHoursPerDay: positiveNumberString(source.driveHoursPerDay, 24),
    plannedDays: positiveNumberString(source.plannedDays, 30),
    tripBuildMode: enumValue(source.tripBuildMode, ['recommended', 'blank']),
    distanceMode: enumValue(source.distanceMode, ['hours', 'miles']),
    targetMiles: positiveNumberString(source.targetMiles, 5000),
    restDays: numberArray(source.restDays),
    dayDriveTargets,
    activePlaceFilters: stringArray(source.activePlaceFilters),
    campPreferenceMode: enumValue(source.campPreferenceMode, ['public', 'developed', 'rv', 'private', 'any']),
    campPhotoOnly: typeof source.campPhotoOnly === 'boolean' ? source.campPhotoOnly : undefined,
    campCadenceMode: enumValue(source.campCadenceMode, ['nightly', 'alternate', 'manual']),
    campReusePolicy: enumValue(source.campReusePolicy, ['different_each_night', 'same_camp_window', 'manual']),
  };
}

function canonicalPlaceId(value: PersistedStopIdentity): string | null {
  for (const [kind, nested] of [['gas', value.gas], ['poi', value.poi], ['camp', value.camp]] as const) {
    const nestedRecord = record(nested);
    const id = nestedRecord?.id;
      if ((typeof id === 'string' || typeof id === 'number') && String(id).trim()) return `${kind}:${String(id).trim()}`;
  }
  return null;
}

export function samePersistedStopIdentity(a: PersistedStopIdentity, b: PersistedStopIdentity): boolean {
  const aDay = positiveInteger(a.day);
  const bDay = positiveInteger(b.day);
  if (aDay == null || bDay == null || aDay !== bDay) return false;
  const aId = canonicalPlaceId(a);
  const bId = canonicalPlaceId(b);
  if (aId && bId && aId === bId) return true;
  if (aId && bId) return false;
  if (typeof a.type === 'string' && typeof b.type === 'string' && a.type !== b.type) return false;
  const aLat = finiteNumber(a.lat);
  const aLng = finiteNumber(a.lng);
  const bLat = finiteNumber(b.lat);
  const bLng = finiteNumber(b.lng);
  return aLat != null
    && aLng != null
    && bLat != null
    && bLng != null
    && Math.abs(aLat - bLat) < 0.0008
    && Math.abs(aLng - bLng) < 0.0008;
}

export function mergePersistedRouteStops<T extends PersistedStopIdentity>(preferred: readonly T[], fallback: readonly T[]): T[] {
  const merged = [...preferred];
  for (const stop of fallback) {
    if (!merged.some(existing => samePersistedStopIdentity(existing, stop))) merged.push(stop);
  }
  return merged;
}

export function persistedTripShape(builderState: unknown): TripShapeMode | null {
  if (!builderState || typeof builderState !== 'object' || Array.isArray(builderState)) return null;
  const candidate = (builderState as Record<string, unknown>).tripShapeMode;
  return candidate === 'one_way' || candidate === 'loop' || candidate === 'there_and_back'
    ? candidate
    : null;
}
