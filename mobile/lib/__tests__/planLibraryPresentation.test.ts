import assert from 'node:assert/strict';
import {
  planDownloadsReturnRequest,
  planLibraryRefreshMode,
  planLibraryRequestIsCurrent,
} from '../planLibraryPresentation';

assert.equal(planLibraryRefreshMode('', 'account:1'), 'loading');
assert.equal(planLibraryRefreshMode('account:1', 'account:1'), 'silent');
assert.equal(planLibraryRefreshMode('account:1', 'account:2'), 'loading');

assert.equal(planLibraryRequestIsCurrent({
  requestSequence: 3,
  currentSequence: 3,
  requestOwnerScope: 'account:1',
  currentOwnerScope: 'account:1',
}), true);
assert.equal(planLibraryRequestIsCurrent({
  requestSequence: 2,
  currentSequence: 3,
  requestOwnerScope: 'account:1',
  currentOwnerScope: 'account:1',
}), false);
assert.equal(planLibraryRequestIsCurrent({
  requestSequence: 3,
  currentSequence: 3,
  requestOwnerScope: 'account:1',
  currentOwnerScope: 'account:2',
}), false);

assert.deepEqual(
  planDownloadsReturnRequest({ source: 'plan', section: 'downloads', scrollY: 418.6 }, 'dismiss'),
  { pathname: '/(tabs)/trips', section: 'downloads', scrollY: 419 },
);
assert.equal(
  planDownloadsReturnRequest({ source: 'plan', section: 'downloads', scrollY: 419 }, 'open_map'),
  null,
);
assert.deepEqual(
  planDownloadsReturnRequest({ source: 'plan', section: 'downloads', scrollY: -20 }, 'dismiss'),
  { pathname: '/(tabs)/trips', section: 'downloads', scrollY: 0 },
);
assert.equal(planDownloadsReturnRequest(null, 'dismiss'), null);

console.log('PASS plan library presentation state');
