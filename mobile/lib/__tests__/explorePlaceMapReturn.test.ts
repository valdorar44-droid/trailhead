import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureExplorePlaceMapReturnV1,
  explorePlaceMapReturnMatchesV1,
  explorePlaceSemanticTypeV1,
} from '../explorePlaceMapReturn';

test('Explore map return is bound to the exact selected child identity', () => {
  const snapshot = captureExplorePlaceMapReturnV1('nps:place:hot-water-cascade');
  assert.deepEqual(snapshot, { sheetEntityId: 'explore:nps:place:hot-water-cascade' });
  assert.equal(
    explorePlaceMapReturnMatchesV1(snapshot, 'explore:nps:place:hot-water-cascade'),
    true,
  );
  assert.equal(
    explorePlaceMapReturnMatchesV1(snapshot, 'explore:nps:place:another-child'),
    false,
  );
  assert.equal(captureExplorePlaceMapReturnV1('  '), null);
});

test('Explore map handoff prefers the semantic category over generic source kind', () => {
  assert.deepEqual(
    explorePlaceSemanticTypeV1({ kind: 'place', category: 'Waterfall' }),
    { type: 'waterfall', displayType: 'Waterfall' },
  );
  assert.deepEqual(
    explorePlaceSemanticTypeV1({ kind: 'visitor_center' }),
    { type: 'visitor center', displayType: 'Visitor Center' },
  );
  assert.deepEqual(explorePlaceSemanticTypeV1({}), {
    type: 'place',
    displayType: 'Place',
  });
});
