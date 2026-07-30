import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrailDiscoveryItemV2 } from '../api';
import {
  completeTrailDiscoveryItems,
  mergeTrailDiscoveryItems,
  trailDiscoveryResponseIsCurrent,
} from '../trailDiscoveryWorkspace';

function item(id: string, geometry_status: TrailDiscoveryItemV2['geometry_status'] = 'complete'): TrailDiscoveryItemV2 {
  return {
    version: 2,
    id,
    primary_trail_id: id,
    name: id,
    kind: geometry_status === 'point' ? 'trailhead' : 'trail',
    center: { lat: 38, lng: -109 },
    geometry_status,
    activities: [],
    permitted_uses: [],
    facts: {},
    trailheads: [],
    media: [],
    sources: [],
    freshness: {},
    capabilities: { details: true, save: true, navigate: false, highlight: false, preview: false, download: false, build_route: false },
    detail_ref: `/api/trails/v2/${id}`,
  };
}

test('pagination preserves server order and removes duplicate identities', () => {
  const merged = mergeTrailDiscoveryItems([item('a'), item('b')], [item('b'), item('c')], true);
  assert.deepEqual(merged.map(value => value.id), ['a', 'b', 'c']);
});

test('a stale response cannot commit after a newer request', () => {
  assert.equal(trailDiscoveryResponseIsCurrent(3, 4), false);
  assert.equal(trailDiscoveryResponseIsCurrent(4, 4), true);
});

test('primary list eligibility requires complete geometry', () => {
  assert.deepEqual(
    completeTrailDiscoveryItems([item('route'), item('fragment', 'partial'), item('point', 'point')]).map(value => value.id),
    ['route'],
  );
});
