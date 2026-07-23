import type { ExploreDetailModuleKey } from './exploreDetailNavigation';

export const EXPLORE_DETAIL_MODULE_ORDER: readonly ExploreDetailModuleKey[] = [
  'see',
  'do',
  'stay',
  'visitor',
  'trails',
  'amenities',
  'fees',
  'alerts',
  'calendar',
  'weather',
  'map',
  'story',
  'nearby',
] as const;

export type ExploreDetailModuleRegistrySnapshot<T extends { key: ExploreDetailModuleKey }> = {
  placeId: string;
  dataRevision: string;
  modules: readonly T[];
};

export function exploreDetailDataRevision(place: unknown): string {
  const source = record(place);
  const pack = record(source.source_pack);
  const revision = firstText(
    source.data_revision,
    source.revision,
    source.updated_at,
    pack.data_revision,
    pack.revision,
    pack.updated_at,
    pack.generated_at,
  );
  return revision || 'legacy';
}

export function mergeExploreDetailModuleRegistry<T extends { key: ExploreDetailModuleKey }>(
  previous: ExploreDetailModuleRegistrySnapshot<T> | null,
  next: ExploreDetailModuleRegistrySnapshot<T>,
): ExploreDetailModuleRegistrySnapshot<T> {
  const sameRevision = previous?.placeId === next.placeId
    && previous.dataRevision === next.dataRevision;
  const byKey = new Map<ExploreDetailModuleKey, T>();

  if (sameRevision) {
    for (const module of previous.modules) byKey.set(module.key, module);
  }
  for (const module of next.modules) byKey.set(module.key, module);

  const modules = EXPLORE_DETAIL_MODULE_ORDER
    .map(key => byKey.get(key))
    .filter((module): module is T => Boolean(module));

  return {
    placeId: next.placeId,
    dataRevision: next.dataRevision,
    modules,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}
