import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../components/explore/ExploreDetailSheet.tsx'),
  'utf8',
);

test('Explore child and main lists do not receive controlled content offsets', () => {
  assert.doesNotMatch(source, /contentOffset=\{\{[^}]*detailNavigation\.(?:child|main)ScrollY/);
  assert.match(source, /childScrollYRef\.current = event\.nativeEvent\.contentOffset\.y/);
  assert.match(source, /mainScrollYRef\.current = event\.nativeEvent\.contentOffset\.y/);
});

test('Explore scroll restoration runs on navigation transitions instead of async enrichment renders', () => {
  assert.match(source, /\[activeModule, place\.id, selectedItemKey\]/);
  assert.doesNotMatch(source, /\[activeModule,[^\]]*detailNavigation\.(?:child|main)ScrollY/);
});
