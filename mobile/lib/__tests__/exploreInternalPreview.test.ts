import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const apiSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../api.ts'), 'utf8');

test('internal Explore data header is build-scoped and authenticated', () => {
  assert.match(apiSource, /EXPO_PUBLIC_EXPLORE_DATA_PREVIEW/);
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
