import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const guideSource = readFileSync(join(mobileRoot, 'app/(tabs)/guide.tsx'), 'utf8');
const detailSource = readFileSync(join(mobileRoot, 'components/explore/ExploreDetailSheet.tsx'), 'utf8');
const listSource = readFileSync(join(mobileRoot, 'components/explore/ExploreDestinationTrailList.tsx'), 'utf8');

test('destination hubs request verified canonical trails with stable destination identity', () => {
  assert.match(guideSource, /api\.discoverTrailSystems\(\{/);
  assert.match(guideSource, /destinationRef: place\.id/);
  assert.match(guideSource, /catalog: 'verified'/);
  assert.match(guideSource, /trail\.geometry_status !== 'complete'/);
  assert.match(guideSource, /exploreDestinationTrailGenerationRef\.current\[place\.id\] !== generation/);
});

test('destination trail cards reuse Trail Discovery identity and shared Map sheets', () => {
  assert.match(listSource, /<TrailDiscoveryCard/);
  assert.match(listSource, /onSelectTrail\(trail\)/);
  assert.match(guideSource, /suspendSelectedExploreForMap\(\);\s+openTrailDiscoveryItem\(item\)/);
  assert.match(guideSource, /trailSystemId: item\.id/);
  assert.match(detailSource, /if \(key === 'trails'\) \{\s+onTabChange\('trails'\)/);
});

test('legacy sourced trail areas remain a data-parity fallback for one preview cycle', () => {
  assert.match(detailSource, /const legacyTrailArea =/);
  assert.match(detailSource, /fallback=\{legacyTrailArea\}/);
  assert.match(detailSource, /<ExploreTrailArea place=\{place\}/);
});

test('destination trail presentation contains no speculative metrics or provider copy', () => {
  assert.doesNotMatch(listSource, /confidence|check local rules|provider|generated|artificial intelligence/i);
  assert.match(listSource, /No mapped trails listed/);
  assert.match(listSource, /Verified routes/);
});
