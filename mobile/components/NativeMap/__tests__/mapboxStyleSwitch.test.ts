import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { mapboxStylePlacementFamily } from '../mapStyle';

test('Mapbox Standard variants use slots while classic styles do not', () => {
  for (const style of ['standard', 'standard_satellite', 'dawn', 'dusk', 'night'] as const) {
    assert.equal(mapboxStylePlacementFamily(style), 'standard-slots');
  }

  for (const style of ['outdoors', 'streets', 'satellite_streets', 'navigation_day', 'navigation_night'] as const) {
    assert.equal(mapboxStylePlacementFamily(style), 'classic');
  }
});

test('NativeMap remounts the RNMapbox surface across slot placement families', () => {
  const source = readFileSync(resolve(process.cwd(), 'components/NativeMap/index.tsx'), 'utf8');

  assert.match(source, /const mapSurfacePlacementKey = isExtremeMapbox/);
  assert.match(source, /key=\{mapSurfacePlacementKey\}/);
  assert.match(source, /const isMapboxStandardStyle = isExtremeMapbox && mapboxPlacementFamily === 'standard-slots'/);
});
