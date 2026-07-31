import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TrailDiscoveryItemV2 } from '../api';
import {
  completeTrailDiscoveryItems,
  isTrailDiscoveryDestinationResult,
  mergeTrailDiscoveryItems,
  trailDiscoveryDestinationRef,
  trailDiscoveryResultLabel,
  trailDiscoveryResponseIsCurrent,
} from '../trailDiscoveryWorkspace';
import type { SearchResultV2 } from '../searchV2';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceSource = readFileSync(join(mobileRoot, 'components/explore/ExploreTrailDiscoveryWorkspace.tsx'), 'utf8');

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

function searchResult(kind: string, categories: string[] = []): SearchResultV2 {
  return {
    result_id: `result:${kind}`,
    title: 'Yosemite National Park',
    kind,
    categories,
    coordinates: { lat: 37.8651, lng: -119.5383 },
    provenance: { provider: 'trailhead', source_label: 'Trailhead', temporary_use_only: false },
    persistence_policy: 'canonical',
    score: 1,
    match_reason: 'exact',
  };
}

test('result labels distinguish complete routes from map-only records', () => {
  assert.equal(trailDiscoveryResultLabel(0, 113, false), '113 map records');
  assert.equal(trailDiscoveryResultLabel(1, 113, false), '1 route');
  assert.equal(trailDiscoveryResultLabel(0, 0, true), 'Finding trails');
});

test('destination suggestions accept parks and reject trail or service results', () => {
  assert.equal(isTrailDiscoveryDestinationResult(searchResult('national_park', ['park'])), true);
  assert.equal(isTrailDiscoveryDestinationResult(searchResult('trail', ['hiking'])), false);
  assert.equal(isTrailDiscoveryDestinationResult(searchResult('poi', ['fuel'])), false);
});

test('destination references prefer canonical identity', () => {
  const result = { ...searchResult('park'), canonical_place_id: 'nps:yose', detail_ref: 'provider:yose' };
  assert.equal(trailDiscoveryDestinationRef(result), 'nps:yose');
});

test('workspace preserves list offset across a focus-gated Map return', () => {
  assert.match(workspaceSource, /listOffsetRef = useRef\(0\)/);
  assert.match(workspaceSource, /restorePendingRef = useRef\(false\)/);
  assert.match(workspaceSource, /restorePendingRef\.current = listOffsetRef\.current > 0/);
  assert.match(workspaceSource, /setRetainedListOffset\(listOffsetRef\.current\)/);
  assert.match(workspaceSource, /if \(!visible \|\| restorePendingRef\.current\) return;/);
  assert.match(workspaceSource, /contentOffset=\{\{ x: 0, y: retainedListOffset \}\}/);
  assert.match(workspaceSource, /onContentSizeChange=\{restoreListOffset\}/);
  assert.match(workspaceSource, /scrollToOffset\(\{ offset: listOffsetRef\.current, animated: false \}\)/);
  assert.match(workspaceSource, /prepareMapReturn\(\);\s+onOpenMap\(request\)/);
  assert.match(workspaceSource, /prepareMapReturn\(\);\s+onSelectTrail\(trail\)/);
});
