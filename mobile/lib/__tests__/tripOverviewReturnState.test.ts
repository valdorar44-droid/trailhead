import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldRestoreTripOverviewFromMission,
  tripOverviewReturnState,
} from '../tripOverviewReturnState';

test('3D preview snapshots the exact trip overview presentation', () => {
  assert.deepEqual(
    tripOverviewReturnState({ panelCollapsed: false, selectedDay: 3, scrollOffset: 428.5 }),
    { expanded: true, selectedDay: 3, scrollOffset: 428.5 },
  );
  assert.deepEqual(
    tripOverviewReturnState({ panelCollapsed: true, selectedDay: null, scrollOffset: -12 }),
    { expanded: false, selectedDay: null, scrollOffset: 0 },
  );
});

test('hardware Back restores only an active trip-builder preview', () => {
  assert.equal(shouldRestoreTripOverviewFromMission({
    missionVisible: true,
    flyoverMode: 'trail_builder',
    hasActiveTrip: true,
  }), true);
  assert.equal(shouldRestoreTripOverviewFromMission({
    missionVisible: true,
    flyoverMode: 'copilot',
    hasActiveTrip: true,
  }), false);
  assert.equal(shouldRestoreTripOverviewFromMission({
    missionVisible: false,
    flyoverMode: 'trail_builder',
    hasActiveTrip: true,
  }), false);
});
