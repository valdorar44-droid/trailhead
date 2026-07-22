import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialSheetCoordinatorState,
  sheetCoordinatorReducer,
  sheetRequestIsCurrent,
} from '../sheetCoordinator';

test('sheet coordinator keeps the same shell for the same entity', () => {
  const opened = sheetCoordinatorReducer(initialSheetCoordinatorState, {
    type: 'open',
    identity: { kind: 'camp', entityId: 'camp-1' },
    presentation: 'half',
    returnContext: { surface: 'map' },
  });
  const enriched = sheetCoordinatorReducer(opened, {
    type: 'open',
    identity: { kind: 'camp', entityId: 'camp-1' },
  });
  assert.equal(enriched.requestGeneration, opened.requestGeneration);
  assert.equal(enriched.presentation, 'half');
  assert.equal(sheetRequestIsCurrent(enriched, { kind: 'camp', entityId: 'camp-1' }, opened.requestGeneration), true);
});

test('new entity invalidates stale enrichment and close preserves return context', () => {
  const first = sheetCoordinatorReducer(initialSheetCoordinatorState, {
    type: 'open',
    identity: { kind: 'place', entityId: 'one' },
    returnContext: { surface: 'explore', key: 'featured' },
  });
  const second = sheetCoordinatorReducer(first, {
    type: 'open',
    identity: { kind: 'trail', entityId: 'two' },
  });
  assert.equal(sheetRequestIsCurrent(second, { kind: 'place', entityId: 'one' }, first.requestGeneration), false);
  const closed = sheetCoordinatorReducer(second, { type: 'close' });
  assert.equal(closed.current, null);
  assert.deepEqual(closed.returnContext, { surface: 'explore', key: 'featured' });
});
