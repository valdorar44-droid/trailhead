import type { TrailDiscoveryItemV2 } from './api';
import type { SearchResultV2 } from './searchV2';

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

export function trailDiscoveryResultLabel(routeCount: number, mapRecordCount: number, loading: boolean) {
  if (loading) return 'Finding trails';
  if (routeCount > 0) return `${routeCount} ${routeCount === 1 ? 'route' : 'routes'}`;
  if (mapRecordCount > 0) return `${mapRecordCount} map ${mapRecordCount === 1 ? 'record' : 'records'}`;
  return 'No trails found';
}

export function isTrailDiscoveryDestinationResult(result: SearchResultV2) {
  const values = [result.kind, ...(result.categories || [])]
    .map(value => String(value || '').toLowerCase().replace(/[_-]+/g, ' '));
  const text = values.join(' ');
  if (/\btrail|trailhead|camp|campsite|fuel|service\b/.test(text)) return false;
  return /\bpark|national park|state park|city|town|village|region|destination|protected area|administrative|place\b/.test(text);
}

export function trailDiscoveryDestinationRef(result: SearchResultV2) {
  return result.canonical_place_id || result.detail_ref || result.result_id;
}
