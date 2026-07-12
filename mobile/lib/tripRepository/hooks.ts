import { useSyncExternalStore } from 'react';
import type { SavedEntityKind, TripRepositorySnapshot, TripStatus } from './types';

type RepositoryStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TripRepositorySnapshot;
};

export function createTripRepositoryHooks(store: RepositoryStore) {
  function useTripRepositorySnapshot(): TripRepositorySnapshot {
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  }

  function useTrips(options: { includeArchived?: boolean; status?: TripStatus | TripStatus[] } = {}) {
    const snapshot = useTripRepositorySnapshot();
    const statuses = options.status == null
      ? null
      : new Set(Array.isArray(options.status) ? options.status : [options.status]);
    return snapshot.trips.filter(trip => {
      if (!options.includeArchived && trip.status === 'archived') return false;
      return !statuses || statuses.has(trip.status);
    });
  }

  function useSavedEntities(kind?: SavedEntityKind | SavedEntityKind[]) {
    const snapshot = useTripRepositorySnapshot();
    if (!kind) return snapshot.savedEntities;
    const kinds = new Set(Array.isArray(kind) ? kind : [kind]);
    return snapshot.savedEntities.filter(entity => kinds.has(entity.kind));
  }

  function useTripRepositorySyncStatus() {
    return useTripRepositorySnapshot().sync;
  }

  return { useTripRepositorySnapshot, useTrips, useSavedEntities, useTripRepositorySyncStatus };
}
