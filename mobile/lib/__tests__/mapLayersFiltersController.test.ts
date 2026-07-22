import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialMapLayersFiltersState,
  mapLayersFiltersReducer,
  resolveLayersFiltersEntry,
} from '../mapLayersFiltersController';

test('every layers and filters shortcut opens the same canonical surface', () => {
  for (const entry of ['layers', 'filters', 'styles', 'legend', 'camps', 'places', 'weather'] as const) {
    const resolved = resolveLayersFiltersEntry(entry);
    assert.equal(resolved.surface, 'layers_filters');
  }
  assert.equal(resolveLayersFiltersEntry('layers').section, 'map-content');
  assert.equal(resolveLayersFiltersEntry('camps').section, 'camps');
  assert.equal(resolveLayersFiltersEntry('weather').section, 'weather-layers');
});

test('opening a section retains one source of truth and closing clears only presentation', () => {
  const opened = mapLayersFiltersReducer(initialMapLayersFiltersState, {
    type: 'open',
    entry: 'places',
    returnContext: 'map_drawer',
  });
  assert.equal(opened.visible, true);
  assert.equal(opened.activeSection, 'places');
  assert.equal(opened.returnContext, 'map_drawer');
  const legend = mapLayersFiltersReducer(opened, { type: 'open_legend' });
  assert.equal(legend.legendVisible, true);
  assert.equal(legend.visible, true);
  const closed = mapLayersFiltersReducer(legend, { type: 'close_legend' });
  assert.equal(closed.legendVisible, false);
  assert.equal(closed.visible, true);
});
