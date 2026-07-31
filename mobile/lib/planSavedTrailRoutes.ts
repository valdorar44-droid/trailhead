import type { OfflineTrail } from './offlineTrails';
import type { SavedEntityV1 } from './tripRepository';
import { inferOwnedTrailRouteOrigin } from './trailRouteSharing';

function cleanIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function savedTrailIdentifiers(item: SavedEntityV1): Set<string> {
  const facts = item.facts ?? {};
  return new Set([
    cleanIdentifier(item.id),
    cleanIdentifier(item.sourceId),
    cleanIdentifier(facts.trail_id),
    cleanIdentifier(facts.offline_trail_id),
  ].filter(Boolean));
}

function isOwnerRoute(trail: OfflineTrail): boolean {
  try {
    inferOwnedTrailRouteOrigin(trail);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saved Trail Builder routes are mirrored into the Plan library with the same
 * `captured:*` identifier as their account-scoped OfflineTrail record. Older
 * trail entities can instead carry the local trail ID in sourceId or facts.
 */
export function ownerTrailRouteForSavedEntity(
  item: SavedEntityV1,
  routes: readonly OfflineTrail[],
): OfflineTrail | null {
  if (item.kind !== 'trail' && !item.id.startsWith('captured:')) return null;
  const identifiers = savedTrailIdentifiers(item);
  if (!identifiers.size) return null;
  return routes.find(route => {
    if (!isOwnerRoute(route)) return false;
    return identifiers.has(route.id)
      || identifiers.has(route.trail.id)
      || identifiers.has(`captured:${route.trail.id}`);
  }) ?? null;
}

export function ownerTrailRoutesBySavedEntityId(
  items: readonly SavedEntityV1[],
  routes: readonly OfflineTrail[],
): ReadonlyMap<string, OfflineTrail> {
  const matches = new Map<string, OfflineTrail>();
  for (const item of items) {
    const route = ownerTrailRouteForSavedEntity(item, routes);
    if (route) matches.set(item.id, route);
  }
  return matches;
}
