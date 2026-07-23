import assert from 'node:assert/strict';
import {
  getTripRepositoryQaInstrumentation,
  recordTripRepositoryHydrationPage,
  recordTripRepositoryHydrationResult,
  recordTripRepositoryPersist,
  recordTripRepositoryStateFileBytes,
  resetTripRepositoryQaInstrumentationForTests,
} from '../qaInstrumentation';

const scope = 'private-scope-key-that-must-not-be-exported';
resetTripRepositoryQaInstrumentationForTests();

recordTripRepositoryStateFileBytes(scope, 1_024);
recordTripRepositoryPersist(scope, 2_048);
recordTripRepositoryPersist(scope, 4_096);
recordTripRepositoryHydrationPage(scope, 100);
recordTripRepositoryHydrationPage(scope, 40);
recordTripRepositoryHydrationResult(scope, { applied: 115, skipped: 25 });

const snapshot = getTripRepositoryQaInstrumentation(scope);
assert.deepEqual(snapshot, {
  stateFileBytes: 4_096,
  persist: {
    count: 2,
    totalSerializedBytes: 6_144,
    maxSerializedBytes: 4_096,
  },
  hydration: {
    pages: 2,
    items: 140,
    applied: 115,
    skipped: 25,
  },
});
assert.equal(JSON.stringify(snapshot).includes(scope), false);

recordTripRepositoryPersist(scope, Number.POSITIVE_INFINITY);
recordTripRepositoryHydrationPage(scope, -10);
recordTripRepositoryHydrationResult(scope, {
  applied: Number.NaN,
  skipped: Number.POSITIVE_INFINITY,
});
const bounded = getTripRepositoryQaInstrumentation(scope);
assert.equal(bounded.stateFileBytes, 0);
assert.equal(bounded.persist.count, 3);
assert.equal(bounded.persist.totalSerializedBytes, 6_144);
assert.equal(bounded.hydration.pages, 3);
assert.equal(bounded.hydration.items, 140);

resetTripRepositoryQaInstrumentationForTests(scope);
assert.deepEqual(getTripRepositoryQaInstrumentation(scope), {
  stateFileBytes: 0,
  persist: { count: 0, totalSerializedBytes: 0, maxSerializedBytes: 0 },
  hydration: { pages: 0, items: 0, applied: 0, skipped: 0 },
});

console.log('trip repository QA instrumentation tests passed');
