let nextBarrierId = 1;
const pendingBarriers = new Map<string, number>();

export function beginTripWriteBarrier(tripId: string): number {
  const cleanTripId = String(tripId || '').trim();
  if (!cleanTripId) return 0;
  const barrierId = nextBarrierId++;
  pendingBarriers.set(cleanTripId, barrierId);
  return barrierId;
}

export function clearTripWriteBarrier(tripId: string, barrierId: number) {
  const cleanTripId = String(tripId || '').trim();
  if (pendingBarriers.get(cleanTripId) !== barrierId) return false;
  pendingBarriers.delete(cleanTripId);
  return true;
}

export function tripWriteBarrierPending(tripId: string) {
  return pendingBarriers.has(String(tripId || '').trim());
}

export function tripWriteBlockedByOutbox(
  tripId: string,
  outgoingRevision: unknown,
  entries: Array<{ entityType: string; entityId: string; revision?: number }>,
) {
  const cleanTripId = String(tripId || '').trim();
  const revision = Number(outgoingRevision);
  const expectedRevision = Number.isInteger(revision) && revision >= 1 ? revision : 0;
  return entries.some(entry => {
    if (entry.entityType !== 'trip' || entry.entityId !== cleanTripId) return false;
    const entryRevision = Number(entry.revision);
    return !Number.isInteger(entryRevision) || entryRevision < 1 || entryRevision > expectedRevision;
  });
}
