import assert from 'node:assert/strict';
import test from 'node:test';

import type { TripResult } from '../api';
import { createTripDocument } from '../tripRepository/core';
import type { TripDocumentV2 } from '../tripRepository/types';
import {
  coalesceTripRevisionReconciliation,
  tripRevisionCanReconcile,
  tripWithReconciledRevision,
  type TripRevisionReconciliationCurrent,
  type TripRevisionReconciliationSnapshot,
} from '../tripRevisionReconciliation';

function trip(version = 4): TripResult {
  return {
    trip_id: 'trip-1',
    plan: {
      trip_name: 'Desert loop',
      overview: '',
      duration_days: 1,
      states: ['UT'],
      total_est_miles: 10,
      waypoints: [],
      daily_itinerary: [],
      logistics: {
        vehicle_recommendation: '',
        fuel_strategy: '',
        water_strategy: '',
        permits_needed: '',
        best_season: '',
      },
    },
    campsites: [],
    gas_stations: [],
    updated_at: 1_000,
    version,
  };
}

function document(revision: number): TripDocumentV2 {
  return {
    ...createTripDocument({ id: 'trip-1', title: 'Desert loop', status: 'active' }),
    ownerScope: 'account:12',
    revision,
    updatedAt: 2_000,
  };
}

function fixture() {
  const activeTrip = trip();
  const savedDocument = document(5);
  const snapshot: TripRevisionReconciliationSnapshot = {
    accountEpoch: 7,
    accountId: '12',
    ownerScope: 'account:12',
    tripId: 'trip-1',
    expectedDocumentRevision: 4,
    activeTrip,
  };
  const current: TripRevisionReconciliationCurrent = {
    accountEpoch: 7,
    accountId: '12',
    ownerScope: 'account:12',
    activeTrip,
    document: savedDocument,
  };
  return { activeTrip, savedDocument, snapshot, current };
}

test('reconciles an acknowledged canonical revision without replacing trip content', () => {
  const { activeTrip, savedDocument, snapshot, current } = fixture();
  assert.equal(tripRevisionCanReconcile(snapshot, current, savedDocument), true);
  const reconciled = tripWithReconciledRevision(activeTrip, savedDocument);
  assert.equal(reconciled.version, 5);
  assert.equal(reconciled.updated_at, 2_000);
  assert.equal(reconciled.plan, activeTrip.plan);
});

test('rejects stale account, trip, active-write, and repository snapshots', () => {
  const { savedDocument, snapshot, current } = fixture();
  assert.equal(tripRevisionCanReconcile(snapshot, { ...current, accountEpoch: 8 }, savedDocument), false);
  assert.equal(tripRevisionCanReconcile(snapshot, { ...current, accountId: '13' }, savedDocument), false);
  assert.equal(tripRevisionCanReconcile(snapshot, { ...current, ownerScope: 'account:13' }, savedDocument), false);
  assert.equal(tripRevisionCanReconcile(snapshot, { ...current, activeTrip: trip(4) }, savedDocument), false);
  assert.equal(tripRevisionCanReconcile(snapshot, { ...current, activeTrip: { ...snapshot.activeTrip, trip_id: 'trip-2' } }, savedDocument), false);
  assert.equal(tripRevisionCanReconcile(snapshot, { ...current, document: document(5) }, savedDocument), false);
  assert.equal(tripRevisionCanReconcile(snapshot, current, { ...savedDocument, revision: 4 }), false);
});

test('allows a released active trip without a version but rejects a known mismatched version', () => {
  const { savedDocument, snapshot, current } = fixture();
  const versionless = { ...snapshot.activeTrip, version: undefined };
  const versionlessSnapshot = { ...snapshot, activeTrip: versionless };
  assert.equal(
    tripRevisionCanReconcile(versionlessSnapshot, { ...current, activeTrip: versionless }, savedDocument),
    true,
  );

  const stale = trip(3);
  const staleSnapshot = { ...snapshot, activeTrip: stale };
  assert.equal(tripRevisionCanReconcile(staleSnapshot, { ...current, activeTrip: stale }, savedDocument), false);
});

test('coalesces consecutive note revisions against the original active trip', () => {
  const { activeTrip, snapshot } = fixture();
  const secondMutation = {
    ...snapshot,
    expectedDocumentRevision: 5,
    activeTrip,
  };
  const coalesced = coalesceTripRevisionReconciliation(snapshot, secondMutation);
  assert.equal(coalesced, snapshot);

  const latestDocument = document(6);
  assert.equal(tripRevisionCanReconcile(snapshot, {
    accountEpoch: 7,
    accountId: '12',
    ownerScope: 'account:12',
    activeTrip,
    document: latestDocument,
  }, latestDocument), true);
});
