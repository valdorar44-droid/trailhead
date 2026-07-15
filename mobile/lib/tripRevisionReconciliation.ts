import type { TripResult } from './api';
import type { TripDocumentV2 } from './tripRepository';

export type TripRevisionReconciliationSnapshot = {
  accountEpoch: number;
  accountId: string | null;
  ownerScope: string;
  tripId: string;
  expectedDocumentRevision: number;
  activeTrip: TripResult;
};

export type TripRevisionReconciliationCurrent = {
  accountEpoch: number;
  accountId: string | null;
  ownerScope: string;
  activeTrip: TripResult | null;
  document: TripDocumentV2 | null;
};

function revision(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function coalesceTripRevisionReconciliation(
  existing: TripRevisionReconciliationSnapshot | undefined,
  candidate: TripRevisionReconciliationSnapshot,
): TripRevisionReconciliationSnapshot | null {
  if (
    existing
    && existing.activeTrip === candidate.activeTrip
    && existing.accountEpoch === candidate.accountEpoch
    && String(existing.accountId ?? '') === String(candidate.accountId ?? '')
    && existing.ownerScope === candidate.ownerScope
    && existing.tripId === candidate.tripId
  ) return existing;
  const activeRevision = revision(candidate.activeTrip.version);
  return activeRevision == null || activeRevision === candidate.expectedDocumentRevision
    ? candidate
    : null;
}

export function tripRevisionCanReconcile(
  snapshot: TripRevisionReconciliationSnapshot,
  current: TripRevisionReconciliationCurrent,
  savedDocument: TripDocumentV2,
) {
  const activeRevision = revision(snapshot.activeTrip.version);
  return current.accountEpoch === snapshot.accountEpoch
    && String(current.accountId ?? '') === String(snapshot.accountId ?? '')
    && current.ownerScope === snapshot.ownerScope
    && snapshot.activeTrip.trip_id === snapshot.tripId
    && (activeRevision == null || activeRevision === snapshot.expectedDocumentRevision)
    && current.activeTrip === snapshot.activeTrip
    && current.activeTrip?.trip_id === snapshot.tripId
    && savedDocument.id === snapshot.tripId
    && savedDocument.revision > snapshot.expectedDocumentRevision
    && current.document === savedDocument;
}

export function tripWithReconciledRevision(
  trip: TripResult,
  savedDocument: TripDocumentV2,
): TripResult {
  const currentUpdatedAt = Number(trip.updated_at);
  const savedUpdatedAt = Number(savedDocument.updatedAt);
  return {
    ...trip,
    version: savedDocument.revision,
    updated_at: Math.max(
      Number.isFinite(currentUpdatedAt) ? currentUpdatedAt : 0,
      Number.isFinite(savedUpdatedAt) ? savedUpdatedAt : 0,
    ) || Date.now(),
  };
}
