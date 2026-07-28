import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const guide = fs.readFileSync(path.join(root, 'app/(tabs)/guide.tsx'), 'utf8');
const map = fs.readFileSync(path.join(root, 'app/(tabs)/map.tsx'), 'utf8');
const trailArea = fs.readFileSync(path.join(root, 'components/explore/ExploreTrailArea.tsx'), 'utf8');

test('Explore trail handoff retains source-backed card facts', () => {
  assert.match(guide, /trailContext:\s*\{[\s\S]*?difficulty: trail\.difficulty[\s\S]*?distanceMi:[\s\S]*?routeType:[\s\S]*?summary:/);
  assert.match(map, /const trailContext = place\.trailContext;[\s\S]*?difficulty: trailContext\?\.difficulty/);
  assert.doesNotMatch(map, /summary: place\.note \|\| 'Trail selected from the map\.'/);
});

test('cross-tab selections wait for the active, ready map before consuming', () => {
  assert.match(map, /!pendingMapSelection \|\| !screenActivity\.isActive \|\| \(useNativeMapSurface && !mapSurfaceReady\)/);
  assert.match(map, /\[mapSurfaceReady, pendingMapSelection, screenActivity\.isActive,/);
});

test('trail hub omits generic picker filler', () => {
  assert.doesNotMatch(trailArea, /Pick by distance, climb, grade, and current access\./);
  assert.doesNotMatch(guide, /fmtMi\(trail\.distance_mi\) \|\| 'Check route'/);
});
