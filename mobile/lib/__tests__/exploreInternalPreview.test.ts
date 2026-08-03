import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeCuratedExplorePlaces } from '../../components/explore/curatedExplorePlaces';
import { withExplorePreviewAuthHeaderV1 } from '../explorePreviewAuth';

const apiSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../api.ts'), 'utf8');
const searchAppClientSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../searchV2/appClient.ts'),
  'utf8',
);
const searchReactSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../searchV2/react.ts'),
  'utf8',
);
const guideSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../app/(tabs)/guide.tsx'),
  'utf8',
);
const qaSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../app/qa/telemetry.tsx'),
  'utf8',
);

test('internal Explore data header is build-scoped and authenticated', () => {
  assert.match(apiSource, /EXPO_PUBLIC_EXPLORE_DATA_PREVIEW/);
  assert.match(apiSource, /Updates\.channel === 'preview'/);
  assert.match(apiSource, /token && EXPLORE_INTERNAL_DATA_PREVIEW/);
  assert.match(apiSource, /path\.startsWith\('\/api\/explore\/'\)/);
  assert.match(apiSource, /path\.startsWith\('\/api\/campsites\/'\)/);
  assert.match(apiSource, /path === '\/api\/map-card\/resolve'/);
  assert.match(
    apiSource,
    /resolveMapCard:[\s\S]+?req<MapCardResolveResponse>\(\s*'\/api\/map-card\/resolve'/,
  );
  assert.match(
    apiSource,
    /resolveMapCard:[\s\S]+?if \(EXPLORE_INTERNAL_DATA_PREVIEW\) return run\(\);[\s\S]+?return guardedRequest/,
  );
  assert.match(
    apiSource,
    /getExploreRouteRank:[\s\S]+?if \(EXPLORE_INTERNAL_DATA_PREVIEW\) return run\(\);[\s\S]+?return guardedRequest/,
  );
  assert.match(apiSource, /X-Trailhead-Explore-Preview'\] = 'internal'/);
  assert.match(apiSource, /export async function explorePreviewAuthHeaders/);
  assert.match(searchAppClientSource, /getHeaders: explorePreviewAuthHeaders/);
});

test('ordinary API requests do not receive the Explore preview header', () => {
  const requestGuard = apiSource.match(
    /if \(token && EXPLORE_INTERNAL_DATA_PREVIEW && usesExplorePreviewCatalog\) \{[\s\S]+?X-Trailhead-Explore-Preview'\] = 'internal';[\s\S]+?\}/,
  );
  assert.ok(requestGuard);
  assert.match(apiSource, /withExplorePreviewAuthHeaderV1\(headers, EXPLORE_INTERNAL_DATA_PREVIEW\)/);
  assert.deepEqual(withExplorePreviewAuthHeaderV1({}, true), {});
  assert.deepEqual(
    withExplorePreviewAuthHeaderV1({ Authorization: 'Bearer test' }, false),
    { Authorization: 'Bearer test' },
  );
  assert.deepEqual(
    withExplorePreviewAuthHeaderV1({ Authorization: 'Bearer test' }, true),
    {
      Authorization: 'Bearer test',
      'X-Trailhead-Explore-Preview': 'internal',
    },
  );
});

test('Search drops request-local preview rows when the account storage scope changes', () => {
  assert.match(searchReactSource, /accountStorage\.subscribe/);
  assert.match(searchReactSource, /new SearchV2SessionController/);
  assert.match(searchReactSource, /\[accountEpoch\]/);
  assert.match(searchReactSource, /snapshot\.controller === controller/);
  assert.match(searchReactSource, /controller\.dispose\(\)/);
});

test('Explore waits for auth and sends the hydrated token on its first page', () => {
  assert.match(guideSource, /const authHydrated = useStore\(st => st\.authHydrated\)/);
  assert.match(guideSource, /if \(!authHydrated\) return;/);
  assert.match(
    guideSource,
    /api\.getExploreHome\([\s\S]+?authToken \?\? null,[\s\S]+?\)/,
  );
  assert.match(
    guideSource,
    /\[authHydrated, authToken, exploreCatalogReloadId, updateExploreCatalogPage\]/,
  );
});

test('the authoritative first page owns order and internal review data is not cached', () => {
  assert.match(guideSource, /setExplorePlaces\(current => mergeById\(firstPlaces, current\)\)/);
  assert.match(guideSource, /if \(!firstPage\.internal_preview\?\.enabled\)/);
});

test('admin QA exposes fixed-code Explore preview request evidence', () => {
  assert.match(apiSource, /exploreInternalPreviewDiagnostics/);
  assert.match(apiSource, /\/api\/explore\/qa\/preview-status/);
  assert.match(qaSource, /qa\.explore-preview\.request-code/);
  assert.match(qaSource, /qa\.explore-preview\.data-code/);
  assert.match(qaSource, /qa\.explore-preview\.profile-count/);
});

test('reviewed internal profile wins same-title Explore deduplication', () => {
  const base = {
    id: 'explore:parks:sierra-national-forest',
    category: 'park',
    summary: {
      title: 'Sierra National Forest',
      state: 'CA',
      rank: 10,
      short_description: 'Older generic catalog copy.',
    },
  } as any;
  const reviewed = {
    id: 'place:usfs:9006',
    category: 'forest',
    internal_preview: true,
    summary: {
      title: 'Sierra National Forest',
      state: 'CA',
      rank: -999,
      short_description: 'Reviewed USDA Forest Service description.',
    },
  } as any;

  const matches = mergeCuratedExplorePlaces([base, reviewed])
    .filter(place => place.summary.title === 'Sierra National Forest');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, reviewed.id);
  assert.equal(matches[0].summary.short_description, reviewed.summary.short_description);
});

test('reviewed internal profile replaces stale same-id card content', () => {
  assert.match(
    guideSource,
    /const preferReviewedPreview = Boolean\(place\.internal_preview\) && !Boolean\(previous\.internal_preview\)/,
  );
  assert.match(guideSource, /\.\.\.\(preferReviewedPreview \? place : \{\}\)/);
  assert.match(guideSource, /\{ \.\.\.previous\.summary, \.\.\.place\.summary \}/);
});

test('cached trail enrichment cannot replace reviewed card or sheet identity', () => {
  assert.match(
    guideSource,
    /mergeCuratedExplorePlaces\(explorePlaces\)\.map\(place => \{[\s\S]+?mergeDynamicTrailArea\(place, trailArea\)/,
  );
  assert.match(
    guideSource,
    /function showExploreSheet[\s\S]+?const local = trailArea \? mergeDynamicTrailArea\(place, trailArea\) : place;/,
  );
  assert.match(
    guideSource,
    /const hydrated = trailArea \? mergeDynamicTrailArea\(detail, trailArea\) : detail;/,
  );
  assert.doesNotMatch(
    guideSource,
    /if \(exploreTrailAreasById\[detail\.id\]\) return exploreTrailAreasById\[detail\.id\]/,
  );
});
