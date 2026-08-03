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
  assert.doesNotMatch(source, /\[activeModule,[^\]]*detailDataRevision/);
});

test('Explore module and child navigation expose stable automation paths', () => {
  assert.match(source, /testID=\{`explore\.detail\.module-\$\{module\.key\}`\}/);
  assert.match(source, /testID=\{`explore\.detail\.item-\$\{exploreDetailTestIdToken/);
  assert.match(source, /testID="explore\.detail\.child-back"/);
});

test('Explore uses explicit source-driven empty and unavailable states without filler', () => {
  assert.match(source, /testID="explore\.detail\.module-unavailable"/);
  assert.match(source, /testID="explore\.detail\.module-unavailable-back"/);
  assert.match(source, />This section is no longer listed\.</);
  assert.match(source, /'No sights listed\.'/);
  assert.match(source, /'No activities listed\.'/);
  assert.match(source, /'No stays listed\.'/);
  assert.match(source, />Weather unavailable\.</);
  assert.doesNotMatch(source, /Check closer to your trip/);
  assert.doesNotMatch(source, /Check back closer to your trip/);
});

test('Explore does not append parent Why Go copy below a populated sights list', () => {
  assert.match(source, /seeItems\.length === 0 && !!place\.profile\?\.why_it_matters/);
});
