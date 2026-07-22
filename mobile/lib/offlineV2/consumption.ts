import type { OfflineArtifactKind } from './types';

const consumed = new Map<string, Set<OfflineArtifactKind>>();
const listeners = new Set<(ownerScope: string) => void>();

function key(ownerScope: string, bundleId: string, revision: string) {
  return `${ownerScope}\u0000${bundleId}\u0000${revision}`;
}

export function markOfflineV2ArtifactsConsumed(
  ownerScope: string,
  bundleId: string,
  revision: string,
  kinds: readonly OfflineArtifactKind[],
) {
  const id = key(ownerScope, bundleId, revision);
  const next = consumed.get(id) ?? new Set<OfflineArtifactKind>();
  kinds.forEach(kind => next.add(kind));
  consumed.set(id, next);
  listeners.forEach(listener => listener(ownerScope));
}

export function offlineV2ArtifactsConsumed(
  ownerScope: string,
  bundleId: string,
  revision: string,
  kinds: readonly OfflineArtifactKind[],
) {
  const current = consumed.get(key(ownerScope, bundleId, revision));
  return Boolean(current && kinds.every(kind => current.has(kind)));
}

export function clearOfflineV2ConsumptionScope(ownerScope: string) {
  const prefix = `${ownerScope}\u0000`;
  for (const id of consumed.keys()) {
    if (id.startsWith(prefix)) consumed.delete(id);
  }
  listeners.forEach(listener => listener(ownerScope));
}

export function subscribeOfflineV2Consumption(listener: (ownerScope: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
