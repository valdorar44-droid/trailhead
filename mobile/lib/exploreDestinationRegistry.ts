import type { ExploreCategoryKey } from '@/components/explore/exploreDisplay';
import type { ExploreDetailModuleKey } from './exploreDetailNavigation';

export type ExplorePrimaryDestinationKey =
  | 'trails'
  | 'camps'
  | 'parks_land'
  | 'scenic'
  | 'guided';

export type ExploreDestinationCapability =
  | 'overview'
  | 'map'
  | 'scenic_places'
  | 'activities'
  | 'trails'
  | 'camps'
  | 'visitor_information'
  | 'fees_permits'
  | 'alerts_conditions'
  | 'events_tours'
  | 'nearby_services'
  | 'official_sources';

export type ExplorePrimaryDestination = {
  key: ExplorePrimaryDestinationKey;
  category: ExploreCategoryKey;
  label: string;
  icon: string;
  aliases: readonly ExploreCategoryKey[];
};

export const EXPLORE_PRIMARY_DESTINATIONS: readonly ExplorePrimaryDestination[] = [
  { key: 'trails', category: 'trails', label: 'Trails', icon: 'walk-outline', aliases: ['trailheads'] },
  { key: 'camps', category: 'camp', label: 'Camps', icon: 'bonfire-outline', aliases: ['glamping', 'huts'] },
  { key: 'parks_land', category: 'parks', label: 'Parks & Land', icon: 'map-outline', aliases: ['land'] },
  { key: 'scenic', category: 'scenic', label: 'Scenic', icon: 'binoculars-outline', aliases: ['views', 'waterfalls', 'peaks', 'springs', 'climb', 'water', 'things'] },
  { key: 'guided', category: 'guided', label: 'Guided', icon: 'ticket-outline', aliases: ['tours'] },
] as const;

export const EXPLORE_VISIBLE_PRIMARY_CATEGORIES = EXPLORE_PRIMARY_DESTINATIONS.map(
  destination => destination.category,
) as readonly ExploreCategoryKey[];

const MODULE_CAPABILITY: Partial<Record<ExploreDetailModuleKey, ExploreDestinationCapability>> = {
  see: 'scenic_places',
  do: 'activities',
  stay: 'camps',
  visitor: 'visitor_information',
  trails: 'trails',
  amenities: 'nearby_services',
  fees: 'fees_permits',
  alerts: 'alerts_conditions',
  calendar: 'events_tours',
  weather: 'alerts_conditions',
  map: 'map',
  story: 'overview',
  nearby: 'nearby_services',
};

export function primaryExploreDestinationForCategory(
  category: ExploreCategoryKey,
): ExplorePrimaryDestination {
  return EXPLORE_PRIMARY_DESTINATIONS.find(
    destination => destination.category === category || destination.aliases.includes(category),
  ) ?? EXPLORE_PRIMARY_DESTINATIONS[3];
}

export function visibleExplorePrimaryCategory(category: ExploreCategoryKey): boolean {
  return EXPLORE_VISIBLE_PRIMARY_CATEGORIES.includes(category);
}

export function destinationCapabilitiesForModules(
  moduleKeys: readonly ExploreDetailModuleKey[],
): ExploreDestinationCapability[] {
  const capabilities = new Set<ExploreDestinationCapability>(['overview', 'official_sources']);
  for (const key of moduleKeys) {
    const capability = MODULE_CAPABILITY[key];
    if (capability) capabilities.add(capability);
  }
  return [...capabilities];
}

export function visibleExploreCategoryLabel(category: ExploreCategoryKey): string | null {
  if (category === 'things' || category === 'tours') return null;
  const destination = EXPLORE_PRIMARY_DESTINATIONS.find(item => item.category === category);
  return destination?.label ?? null;
}
