import assert from 'node:assert/strict';
import {
  assertAuthoritativeWorktreeClean,
  porcelainV1ZChanges,
  unauthorizedReleaseChanges,
} from './release-worktree.mjs';

assert.deepEqual(porcelainV1ZChanges(' M mobile/app.tsx\0?? .cursor/state.json\0'), [
  { status: ' M', path: 'mobile/app.tsx' },
  { status: '??', path: '.cursor/state.json' },
]);

assert.deepEqual(
  unauthorizedReleaseChanges(' M dashboard/explore_serving_index_v2.json\0?? .cursor/state.json\0'),
  [],
);

assert.throws(
  () => assertAuthoritativeWorktreeClean(' M mobile/app.tsx\0'),
  /mobile\/app\.tsx/,
);

assert.doesNotThrow(() => assertAuthoritativeWorktreeClean(
  ' M dashboard/explore_serving_index_v2.json\0?? .cursor/state.json\0',
));

assert.deepEqual(
  porcelainV1ZChanges('R  mobile/new.tsx\0mobile/old.tsx\0'),
  [
    { status: 'R ', path: 'mobile/new.tsx' },
    { status: 'R :source', path: 'mobile/old.tsx' },
  ],
);

console.log('Release worktree guard tests passed.');
