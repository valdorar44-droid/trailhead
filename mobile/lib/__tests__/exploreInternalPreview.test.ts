import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeCuratedExplorePlaces } from '../../components/explore/curatedExplorePlaces';

const apiSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../api.ts'), 'utf8');
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
  assert.match(apiSource, /X-Trailhead-Explore-Preview'\] = 'internal'/);
});

test('ordinary API requests do not receive the Explore preview header', () => {
  const guardedAssignment = apiSource.match(
    /if \(token && EXPLORE_INTERNAL_DATA_PREVIEW[\s\S]+?X-Trailhead-Explore-Preview'\] = 'internal';[\s\S]+?\}/,
  );
  assert.ok(guardedAssignment);
  assert.doesNotMatch(
    apiSource.slice(guardedAssignment.index! + guardedAssignment[0].length),
    /X-Trailhead-Explore-Preview'\] = 'internal'/,
  );
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
