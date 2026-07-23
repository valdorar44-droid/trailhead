import type { CoordinatedSheetKind, SheetIdentity } from './sheetCoordinator';

export const CAMPGROUND_SHEET_PARITY_MODULES = [
  'photos',
  'booking',
  'site_types',
  'site_counts',
  'rig_suitability',
  'mobile_coverage',
  'weather',
  'activities',
  'comments',
  'source_reviews',
  'field_reports',
  'edits',
  'reporting',
  'coordinates',
  'official_links',
] as const;

export type CampgroundSheetParityModule = typeof CAMPGROUND_SHEET_PARITY_MODULES[number];

export const TRAIL_SHEET_PARITY_MODULES = [
  'photos',
  'route_facts',
  'weather',
  'nearby',
  'community_reports',
  'downloads',
  'preview_3d',
  'route_builder',
  'edits',
  'reporting',
] as const;

export const COMMUNITY_REPORT_SHEET_PARITY_MODULES = [
  'notes',
  'nearby',
  'coordinates',
  'navigation',
  'saving',
  'voting',
  'edits',
  'photos',
  'field_review',
  'reporting',
] as const;

export const EXPLORE_HUB_SHEET_PARITY_MODULES = [
  'see',
  'do',
  'stay',
  'visitor_information',
  'trails',
  'fees',
  'alerts',
  'weather',
  'calendar',
  'maps',
  'nearby',
  'official_sources',
  'campgrounds',
  'guided_tours',
] as const;

export type PlaceSheetParityModule =
  | CampgroundSheetParityModule
  | typeof TRAIL_SHEET_PARITY_MODULES[number]
  | typeof COMMUNITY_REPORT_SHEET_PARITY_MODULES[number]
  | typeof EXPLORE_HUB_SHEET_PARITY_MODULES[number];

export type PlaceSheetSource = {
  id?: string | number | null;
  place_id?: string | number | null;
  provider_place_id?: string | number | null;
  feature_id?: string | number | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  type?: string | null;
  subtype?: string | null;
  land_type?: string | null;
  source?: string | null;
  source_label?: string | null;
  source_badge?: string | null;
  verified_source?: string | null;
  persistence_policy?: string | null;
};

export type PlaceSheetModel<T extends PlaceSheetSource = PlaceSheetSource> = {
  identity: SheetIdentity;
  title: string;
  subtitle: string;
  testID: string;
  source: T;
  parityModules: readonly PlaceSheetParityModule[];
};

export function adaptGenericPlaceSheet<T extends PlaceSheetSource>(place: T): PlaceSheetModel<T> {
  const kind = classifySheetKind(place);
  return makeModel(kind, place, []);
}

export function adaptCampgroundSheet<T extends PlaceSheetSource>(camp: T): PlaceSheetModel<T> {
  return makeModel('camp', camp, CAMPGROUND_SHEET_PARITY_MODULES);
}

export function adaptTrailSheet<T extends PlaceSheetSource>(trail: T): PlaceSheetModel<T> {
  return makeModel(classifySheetKind(trail) === 'trailhead' ? 'trailhead' : 'trail', trail, TRAIL_SHEET_PARITY_MODULES);
}

export function adaptCommunityReportSheet<T extends PlaceSheetSource>(report: T): PlaceSheetModel<T> {
  return makeModel('community_report', report, COMMUNITY_REPORT_SHEET_PARITY_MODULES);
}

export function adaptExploreHubSheet<T extends PlaceSheetSource>(hub: T): PlaceSheetModel<T> {
  return makeModel('explore_hub', hub, EXPLORE_HUB_SHEET_PARITY_MODULES);
}

export function stablePlaceSheetEntityId(kind: CoordinatedSheetKind, source: PlaceSheetSource): string {
  const providerId = source.id ?? source.place_id ?? source.provider_place_id ?? source.feature_id;
  if (providerId != null && String(providerId).trim()) return `${kind}:${String(providerId).trim()}`;
  const lat = Number(source.lat);
  const lng = Number(source.lng);
  const coordinateKey = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat.toFixed(5)}:${lng.toFixed(5)}`
    : 'unknown';
  return `${kind}:${slug(source.name || kind)}:${coordinateKey}`;
}

export function isCanonicalSearchPlaceSheetSource(source: PlaceSheetSource | null | undefined): boolean {
  if (!source) return false;
  if (String(source.source || '').toLowerCase() !== 'trailhead_search') return false;
  if (String(source.persistence_policy || '').toLowerCase() !== 'canonical') return false;
  return [source.id, source.place_id, source.provider_place_id]
    .some(value => /^(place|trail|trailhead|camp):/i.test(String(value || '').trim()));
}

function makeModel<T extends PlaceSheetSource>(
  kind: CoordinatedSheetKind,
  source: T,
  parityModules: readonly PlaceSheetParityModule[],
): PlaceSheetModel<T> {
  const entityId = stablePlaceSheetEntityId(kind, source);
  const fallbackTitle = kind === 'camp'
    ? 'Campground'
    : kind === 'trailhead'
      ? 'Trailhead'
      : kind === 'trail'
        ? 'Trail'
        : kind === 'community_report'
          ? 'Report'
          : kind === 'explore_hub'
            ? 'Explore'
            : 'Place';
  const title = cleanText(source.name) || fallbackTitle;
  const subtitle = cleanText(
    source.source_label
      || source.source_badge
      || source.verified_source
      || source.subtype
      || source.land_type
      || source.type,
  ) || fallbackTitle;
  return {
    identity: { kind, entityId },
    title,
    subtitle,
    testID: `place-sheet-${kind}-${slug(entityId)}`,
    source,
    parityModules,
  };
}

function classifySheetKind(source: PlaceSheetSource): CoordinatedSheetKind {
  const type = `${source.type || ''} ${source.subtype || ''}`.toLowerCase();
  if (/\b(camp|campground|campsite|rv park)\b/.test(type)) return 'camp';
  if (/\btrailhead\b/.test(type)) return 'trailhead';
  if (/\btrail\b/.test(type)) return 'trail';
  return 'place';
}

function cleanText(value: unknown): string {
  const text = String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!text) return '';
  return text.replace(/\b\w/g, character => character.toUpperCase());
}

function slug(value: unknown): string {
  return String(value || 'entity')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'entity';
}
