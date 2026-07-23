import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPLORE_DETAIL_MODULE_ORDER,
  exploreDetailDataRevision,
  mergeExploreDetailModuleRegistry,
  type ExploreDetailModuleRegistrySnapshot,
} from '../exploreDetailModuleRegistry';
import type { ExploreDetailModuleKey } from '../exploreDetailNavigation';

type Module = { key: ExploreDetailModuleKey; detail: string };

function snapshot(
  modules: Module[],
  dataRevision = 'r1',
): ExploreDetailModuleRegistrySnapshot<Module> {
  return { placeId: 'place:nps:yose', dataRevision, modules };
}

test('same-revision enrichment adds richness without dropping an existing module', () => {
  const initial = snapshot([
    { key: 'see', detail: '3 places' },
    { key: 'stay', detail: 'Loading stays' },
    { key: 'map', detail: 'Open route' },
  ]);
  const enriched = mergeExploreDetailModuleRegistry(initial, snapshot([
    { key: 'see', detail: '4 places' },
    { key: 'map', detail: 'Open route' },
    { key: 'weather', detail: 'Forecast' },
  ]));

  assert.deepEqual(enriched.modules.map(module => module.key), ['see', 'stay', 'weather', 'map']);
  assert.equal(enriched.modules.find(module => module.key === 'see')?.detail, '4 places');
  assert.equal(enriched.modules.find(module => module.key === 'stay')?.detail, 'Loading stays');
});

test('a new source revision may remove a module but retains canonical order', () => {
  const previous = snapshot([
    { key: 'stay', detail: '2 stays' },
    { key: 'see', detail: '4 places' },
  ]);
  const revised = mergeExploreDetailModuleRegistry(previous, snapshot([
    { key: 'map', detail: 'Open route' },
    { key: 'see', detail: '2 places' },
  ], 'r2'));

  assert.deepEqual(revised.modules.map(module => module.key), ['see', 'map']);
});

test('module order and data revision are deterministic', () => {
  assert.deepEqual(EXPLORE_DETAIL_MODULE_ORDER, [
    'see', 'do', 'stay', 'visitor', 'trails', 'amenities', 'fees', 'alerts',
    'calendar', 'weather', 'map', 'story', 'nearby',
  ]);
  assert.equal(exploreDetailDataRevision({ source_pack: { revision: 'pack-42' } }), 'pack-42');
  assert.equal(exploreDetailDataRevision({ id: 'legacy' }), 'legacy');
});
