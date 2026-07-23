import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAP_OVERLAY_REGISTRY,
  MAP_TOOL_REGISTRY,
  mapLayerRegistryHasUniqueKeys,
  mapLayerRegistrySnapshot,
} from '../mapLayerRegistry';

test('the consolidated registry preserves every working gallery key in order', () => {
  assert.deepEqual(mapLayerRegistrySnapshot(), {
    styles: ['topo', 'satellite', 'hybrid', 'light', 'city', 'contrast', 'desert', 'snow', 'dark', 'red'],
    mapboxStyles: ['outdoors', 'standard', 'standard_satellite', 'streets', 'navigation_day', 'navigation_night', 'dawn', 'dusk', 'night', 'satellite_streets'],
    overlays: ['3d', 'lands', 'usgs', 'pois', 'trails', 'nautical', 'fire', 'ava', 'radar', 'mvum'],
    tools: ['globe_terrain', 'search_box', 'directions', 'traffic', 'weather'],
  });
  assert.equal(mapLayerRegistryHasUniqueKeys(), true);
});

test('every overlay and tool declares honest availability and offline metadata', () => {
  for (const item of [...MAP_OVERLAY_REGISTRY, ...MAP_TOOL_REGISTRY]) {
    assert.ok(item.label.trim(), `${item.key} needs a label`);
    assert.ok(item.sourceLabel.trim(), `${item.key} needs a source label`);
    assert.ok(item.freshness, `${item.key} needs freshness metadata`);
    assert.ok(item.offlineCapability, `${item.key} needs offline metadata`);
    assert.ok(item.legend, `${item.key} needs legend metadata`);
  }

  const overlays = Object.fromEntries(MAP_OVERLAY_REGISTRY.map(item => [item.key, item]));
  assert.equal(overlays.fire.offlineCapability, 'online_only');
  assert.equal(overlays.radar.offlineCapability, 'online_only');
  assert.equal(overlays.ava.offlineCapability, 'online_only');
  assert.equal(overlays.trails.offlineCapability, 'downloaded');
  assert.equal(overlays.lands.offlineCapability, 'downloaded');
  assert.equal(overlays.nautical.offlineCapability, 'partial');
});
