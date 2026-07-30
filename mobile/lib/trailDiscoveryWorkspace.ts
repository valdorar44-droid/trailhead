import type { TrailDiscoveryItemV2 } from './api';

export function mergeTrailDiscoveryItems(
  current: TrailDiscoveryItemV2[],
  incoming: TrailDiscoveryItemV2[],
  append: boolean,
) {
  const ordered = append ? [...current, ...incoming] : [...incoming];
  const seen = new Set<string>();
  return ordered.filter(item => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function trailDiscoveryResponseIsCurrent(expectedGeneration: number, activeGeneration: number) {
  return expectedGeneration === activeGeneration;
}

export function completeTrailDiscoveryItems(items: TrailDiscoveryItemV2[]) {
  return items.filter(item => item.geometry_status === 'complete');
}
