import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  beginTrailSheetHydration,
  completeTrailSheetHydration,
  EMPTY_TRAIL_SHEET_HYDRATION,
  timeoutTrailSheetHydration,
  trailSheetExpandedIsLoading,
} from '../trailSheetHydration';

test('trail sheet stays in one loading state until its current enrichment settles', () => {
  const loading = beginTrailSheetHydration('trail:42:3', 1);
  assert.equal(trailSheetExpandedIsLoading(loading, 'trail:42:3', 1), true);
  const ready = completeTrailSheetHydration(loading, 'trail:42:3', 1);
  assert.equal(ready.status, 'ready');
  assert.equal(trailSheetExpandedIsLoading(ready, 'trail:42:3', 1), false);
});

test('three-second timeout exposes a stable partial sheet instead of a permanent skeleton', () => {
  const loading = beginTrailSheetHydration('trailhead:12:8', 2);
  const partial = timeoutTrailSheetHydration(loading, 'trailhead:12:8', 2);
  assert.equal(partial.status, 'partial');
  assert.equal(trailSheetExpandedIsLoading(partial, 'trailhead:12:8', 2), false);
});

test('stale trail and stale retry completions cannot replace the current sheet', () => {
  const current = beginTrailSheetHydration('trail:b:5', 3);
  assert.equal(completeTrailSheetHydration(current, 'trail:a:4', 3), current);
  assert.equal(completeTrailSheetHydration(current, 'trail:b:5', 2), current);
  assert.equal(timeoutTrailSheetHydration(current, 'trail:a:4', 3), current);
});

test('a new identity is loading before its effect begins', () => {
  assert.equal(trailSheetExpandedIsLoading(EMPTY_TRAIL_SHEET_HYDRATION, 'trail:new:1', 0), true);
});
