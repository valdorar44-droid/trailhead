import assert from 'node:assert/strict';
import test from 'node:test';

import { tripOverviewReturnState } from '../tripOverviewReturnState';

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
