import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginMapRecentViewportRestoreV1,
  canCommitMapRecentViewportRestoreV1,
  claimExplicitMapCameraV1,
  commitMapRecentViewportRestoreV1,
  initialMapRecentViewportRestoreGateV1,
} from '../mapRecentViewportRestore';

test('a cached viewport may commit when no newer camera command exists', () => {
  const initial = initialMapRecentViewportRestoreGateV1();
  const generation = beginMapRecentViewportRestoreV1(initial);
  const committed = commitMapRecentViewportRestoreV1(initial, generation);

  assert.equal(committed.apply, true);
  assert.equal(committed.state.resolvedBy, 'cached');
});

test('an explicit camera command invalidates an in-flight cached restore', () => {
  const initial = initialMapRecentViewportRestoreGateV1();
  const staleGeneration = beginMapRecentViewportRestoreV1(initial);
  const explicit = claimExplicitMapCameraV1(initial);

  assert.equal(canCommitMapRecentViewportRestoreV1(explicit, staleGeneration), false);
  assert.equal(commitMapRecentViewportRestoreV1(explicit, staleGeneration).apply, false);
  assert.equal(explicit.resolvedBy, 'explicit');
});

test('a resolved explicit camera remains authoritative over later cached attempts', () => {
  const explicit = claimExplicitMapCameraV1(initialMapRecentViewportRestoreGateV1());
  const laterGeneration = beginMapRecentViewportRestoreV1(explicit);

  assert.equal(commitMapRecentViewportRestoreV1(explicit, laterGeneration).apply, false);
});

test('a stale generation cannot commit after another restore generation is claimed', () => {
  const initial = initialMapRecentViewportRestoreGateV1();
  const staleGeneration = beginMapRecentViewportRestoreV1(initial);
  const next = claimExplicitMapCameraV1(initial);

  assert.notEqual(next.generation, staleGeneration);
  assert.equal(canCommitMapRecentViewportRestoreV1(next, staleGeneration), false);
});

test('a deferred cached read loses when a map-ready explicit command lands first', async () => {
  let state = initialMapRecentViewportRestoreGateV1();
  let releaseStorageRead!: () => void;
  const storageRead = new Promise<void>(resolve => {
    releaseStorageRead = resolve;
  });
  const restore = (async () => {
    const generation = beginMapRecentViewportRestoreV1(state);
    await storageRead;
    return commitMapRecentViewportRestoreV1(state, generation);
  })();

  state = claimExplicitMapCameraV1(state);
  releaseStorageRead();

  const committed = await restore;
  assert.equal(committed.apply, false);
  assert.equal(committed.state.resolvedBy, 'explicit');
});
