import type { TripLibraryItem } from './types';

export function assertTripOperationOwnerScope(item: TripLibraryItem, expectedOwnerScope: string) {
  if (item.document.ownerScope !== expectedOwnerScope) {
    throw new Error('This trip belongs to a different account.');
  }
}
