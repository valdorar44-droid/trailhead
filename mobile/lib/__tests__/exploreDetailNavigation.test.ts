import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExploreSourcePackItem } from '../api';
import {
  createExploreDetailNavigationState,
  exploreDetailBackAction,
  exploreDetailNavigationReducer,
} from '../exploreDetailNavigation';

const yosemiteOverlook: ExploreSourcePackItem = {
  source_id: 'nps:yose:tunnel-view',
  title: 'Tunnel View',
  kind: 'scenic_viewpoint',
  description: 'A signed viewpoint overlooking Yosemite Valley.',
  lat: 37.7156,
  lng: -119.6768,
};

test('NPS module, child, search, and scroll state survive a main-map round trip', () => {
  let state = createExploreDetailNavigationState('nps:yose', 'see');
  state = exploreDetailNavigationReducer(state, { type: 'set_search', value: 'valley' });
  state = exploreDetailNavigationReducer(state, { type: 'set_scroll', surface: 'main', y: 421.5 });
  state = exploreDetailNavigationReducer(state, { type: 'select_item', item: yosemiteOverlook });
  state = exploreDetailNavigationReducer(state, { type: 'set_scroll', surface: 'child', y: 276 });

  // Suspending the Android Modal to show the main map must not dispatch a reset.
  const restored = state;
  assert.equal(restored.placeId, 'nps:yose');
  assert.equal(restored.activeModule, 'see');
  assert.equal(restored.selectedItem?.source_id, 'nps:yose:tunnel-view');
  assert.equal(restored.placeSearch, 'valley');
  assert.equal(restored.mainScrollY, 421.5);
  assert.equal(restored.childScrollY, 276);

  const list = exploreDetailNavigationReducer(restored, { type: 'select_item', item: null });
  assert.equal(list.selectedItem, null);
  assert.equal(list.mainScrollY, 421.5);
  assert.equal(list.childScrollY, 0);
});

test('opening a different module resets child context without changing the park identity', () => {
  let state = createExploreDetailNavigationState('nps:yell', 'summary');
  state = exploreDetailNavigationReducer(state, { type: 'select_item', item: yosemiteOverlook });
  state = exploreDetailNavigationReducer(state, { type: 'set_scroll', surface: 'main', y: 120 });
  state = exploreDetailNavigationReducer(state, { type: 'set_scroll', surface: 'child', y: 80 });
  state = exploreDetailNavigationReducer(state, { type: 'open_module', module: 'weather' });

  assert.equal(state.placeId, 'nps:yell');
  assert.equal(state.activeModule, 'weather');
  assert.equal(state.selectedItem, null);
  assert.equal(state.mainScrollY, 0);
  assert.equal(state.childScrollY, 0);
});

test('scroll positions are finite and non-negative', () => {
  let state = createExploreDetailNavigationState('nps:grca', 'see');
  state = exploreDetailNavigationReducer(state, { type: 'set_scroll', surface: 'main', y: -20 });
  state = exploreDetailNavigationReducer(state, { type: 'set_scroll', surface: 'child', y: Number.NaN });

  assert.equal(state.mainScrollY, 0);
  assert.equal(state.childScrollY, 0);
});

test('system Back follows child to module to Overview before closing the hub', () => {
  let state = createExploreDetailNavigationState('nps:yell', 'trails');
  state = exploreDetailNavigationReducer(state, { type: 'select_item', item: yosemiteOverlook });

  const childBack = exploreDetailBackAction(state);
  assert.deepEqual(childBack, { type: 'select_item', item: null });
  state = exploreDetailNavigationReducer(state, childBack!);
  assert.equal(state.activeModule, 'trails');
  assert.equal(state.selectedItem, null);

  const moduleBack = exploreDetailBackAction(state);
  assert.deepEqual(moduleBack, { type: 'open_module', module: null });
  state = exploreDetailNavigationReducer(state, moduleBack!);
  assert.equal(state.activeModule, null);

  assert.equal(exploreDetailBackAction(state), null);
});
