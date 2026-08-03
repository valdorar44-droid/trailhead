import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const sources = {
  guide: readFileSync(join(mobileRoot, 'app', '(tabs)', 'guide.tsx'), 'utf8'),
  placeCard: readFileSync(join(mobileRoot, 'components', 'explore', 'ExplorePlaceCard.tsx'), 'utf8'),
  staticPreview: readFileSync(join(mobileRoot, 'components', 'explore', 'StaticMapboxPreview.tsx'), 'utf8'),
};

function remoteImageTags(source) {
  return [...source.matchAll(/<Image\b[\s\S]*?\/>/g)]
    .map(match => match[0])
    .filter(tag => /source=(?:\{\{\s*uri\s*:|\{exploreImageSource\()/.test(tag));
}

function assertRemoteImagesResize(source, label) {
  const tags = remoteImageTags(source);
  assert.ok(tags.length > 0, `${label} must contain at least one remote Image`);
  tags.forEach((tag, index) => {
    assert.match(
      tag,
      /resizeMethod=["']resize["']/,
      `${label} remote Image ${index + 1} must downsample before Android decodes it`,
    );
  });
}

assertRemoteImagesResize(sources.placeCard, 'ExplorePlaceCard');
assertRemoteImagesResize(sources.staticPreview, 'StaticMapboxPreview');
assertRemoteImagesResize(sources.guide, 'Explore guide direct media');

const startupLoad = sources.guide.match(
  /useEffect\(\(\) => \{\s*if \(!authHydrated\) return;\s*let cancelled = false;\s*const homePageSpec[\s\S]*?\}, \[authHydrated, authToken, exploreCatalogReloadId, updateExploreCatalogPage\]\);/,
)?.[0];
assert.ok(startupLoad, 'Explore startup catalog effect must remain identifiable');
assert.match(startupLoad, /api\.getExploreHome\(/, 'Explore startup must request the compact home page');
assert.doesNotMatch(
  startupLoad,
  /api\.getExploreCatalogIndex\(|hydrateRemainingCatalog|backgroundTimer/,
  'Explore startup must not hydrate catalog pages in the background',
);

const homeLimit = Number(startupLoad.match(/api\.getExploreHome\(\s*\{[\s\S]*?limit:\s*(\d+)/)?.[1]);
assert.ok(
  Number.isInteger(homeLimit) && homeLimit > 0 && homeLimit <= 48,
  `Explore startup page must stay bounded at 48 records or fewer; received ${homeLimit || 'unknown'}`,
);

const paginationLoader = sources.guide.match(
  /async function loadNextExploreCatalogPage\(\) \{[\s\S]*?\n  \}\n\n  function showMoreExplorePlaces/,
)?.[0];
assert.ok(paginationLoader, 'Explore explicit pagination loader must remain identifiable');
assert.match(
  paginationLoader,
  /api\.getExploreCatalogIndex\(/,
  'Additional catalog pages must remain available through explicit pagination',
);

const showMoreHandler = sources.guide.match(
  /function showMoreExplorePlaces\(\) \{[\s\S]*?\n  \}\n\n  function cycleExploreSort/,
)?.[0];
assert.ok(showMoreHandler, 'Explore Show more handler must remain identifiable');
assert.match(
  showMoreHandler,
  /loadNextExploreCatalogPage\(\)/,
  'Only the explicit Show more path should request the next home catalog page',
);

console.log('Explore memory guards passed.');
