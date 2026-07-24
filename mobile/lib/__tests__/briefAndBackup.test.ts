import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  briefAvailabilityLabel,
  briefEvidenceTimeLabel,
  briefEvidenceStatusLabel,
  briefRouteProgressLabel,
  createBriefAndBackupIdempotencyKey,
  exactSavedTripRevision,
} from '../briefAndBackup';

test('Brief & Backup requires an exact saved trip revision', () => {
  assert.equal(exactSavedTripRevision(4), 4);
  assert.equal(exactSavedTripRevision('4'), 4);
  assert.equal(exactSavedTripRevision(0), null);
  assert.equal(exactSavedTripRevision(undefined), null);
  assert.equal(exactSavedTripRevision(2.5), null);
});

test('one user action can reuse a stable valid idempotency key', () => {
  const input = { tripId: 'trip with spaces/1', tripRevision: 7, now: 1_720_000_000_000, entropy: 'retry-seed' };
  const first = createBriefAndBackupIdempotencyKey(input);
  const retry = createBriefAndBackupIdempotencyKey(input);
  assert.equal(first, retry);
  assert.match(first, /^[a-zA-Z0-9._:-]{8,128}$/);
});

test('unknown route evidence is always presented as Not checked', () => {
  assert.equal(briefEvidenceStatusLabel('not_checked'), 'Not checked');
  assert.equal(briefEvidenceStatusLabel(undefined), 'Not checked');
  assert.equal(briefAvailabilityLabel('unknown'), 'Not checked');
  assert.equal(briefAvailabilityLabel('not_checked'), 'Not checked');
  assert.equal(briefRouteProgressLabel(undefined), 'Not checked');
  assert.equal(briefEvidenceStatusLabel('partially_checked'), 'Partially checked');
  assert.equal(briefEvidenceStatusLabel('observations_found'), 'Evidence found');
  assert.equal(briefEvidenceStatusLabel('references_found'), 'Evidence found');
  assert.equal(briefAvailabilityLabel('limited_service'), 'Limited Service');
  assert.equal(briefRouteProgressLabel(0.42), '42% of route');
});

test('route evidence uses observation time before update time', () => {
  const observed = briefEvidenceTimeLabel('2025-05-04T08:30:00Z', '2026-06-02T00:00:00Z');
  assert.match(observed, /^Observed May 4(?:, 2025)?$/);
  const updated = briefEvidenceTimeLabel(null, '2025-06-02T00:00:00Z');
  assert.match(updated, /^Updated Jun 2(?:, 2025)?$/);
  assert.equal(briefEvidenceTimeLabel('not-a-date', null), '');
});
