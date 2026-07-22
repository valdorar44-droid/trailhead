import assert from 'node:assert/strict';
import test from 'node:test';
import { offlineSearchResultsV2, searchResultV2ToDisplayPlace, searchResultV2ToLegacyPlace } from '../presentation';
import type { SearchResultV2 } from '../types';

test('offline matches are immediate, stable and ranked without changing server order', () => {
  const results = offlineSearchResultsV2({ query: 'moab camp', surface: 'map', scope: 'offline', limit: 4 }, [
    { id: '2', name: 'Camp outside Moab', lat: 38.5, lng: -109.6, type: 'camp' },
    { id: '1', name: 'Moab Camp', lat: 38.6, lng: -109.5, type: 'camp', source_label: 'Trailhead' },
    { id: '3', name: 'Unrelated place', lat: 40, lng: -110, type: 'place' },
  ], 'map');
  assert.deepEqual(results.map(result => result.result_id), ['offline:1', 'offline:2']);
  assert.equal(results[0].persistence_policy, 'canonical');
  assert.equal(results[0].provenance.temporary_use_only, false);
});

test('presentation adapter rejects unresolved coordinates and keeps stable identity', () => {
  const unresolved: SearchResultV2 = {
    result_id: 'missing', title: 'Missing', kind: 'place', categories: [], provenance: { provider: 'trailhead', source_label: 'Place', temporary_use_only: false }, persistence_policy: 'canonical', score: 1, match_reason: 'exact',
  };
  assert.equal(searchResultV2ToLegacyPlace(unresolved), null);
  const display = searchResultV2ToDisplayPlace(unresolved);
  assert.equal(display.name, 'Missing');
  assert.equal(display.result_id, 'missing');
  assert.equal(display.lat, undefined);
  assert.equal(display.resolution_required, true);
  const place = searchResultV2ToLegacyPlace({
    result_id: 'result-1', canonical_place_id: 'place-1', title: 'Mesa Arch', subtitle: 'Canyonlands', kind: 'trailhead', categories: ['scenic'], coordinates: { lat: 38.389, lng: -109.868 }, provenance: { provider: 'trailhead', source_label: 'Trailhead', temporary_use_only: false }, persistence_policy: 'canonical', score: 10, match_reason: 'exact',
  });
  assert.equal(place?.id, 'place-1');
  assert.equal(place?.result_id, 'result-1');
  assert.equal(place?.summary, 'Canyonlands');
});
