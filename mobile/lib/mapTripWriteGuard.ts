export type MapTripWriteSnapshot = {
  operationId: number;
  accountEpoch: number;
  accountId: string | null;
  tripId: string;
  expectedVersion: number;
  waypointSignature: string;
};

export type MapTripWriteCurrentState = {
  operationId: number;
  accountEpoch: number;
  accountId: string | null;
  tripId: string | null;
  version: number;
  waypointSignature: string;
};

export function mapTripWriteCanReconcile(
  snapshot: MapTripWriteSnapshot,
  current: MapTripWriteCurrentState,
) {
  return current.operationId === snapshot.operationId
    && current.accountEpoch === snapshot.accountEpoch
    && String(current.accountId ?? '') === String(snapshot.accountId ?? '')
    && current.tripId === snapshot.tripId
    && current.version === snapshot.expectedVersion
    && current.waypointSignature === snapshot.waypointSignature;
}
