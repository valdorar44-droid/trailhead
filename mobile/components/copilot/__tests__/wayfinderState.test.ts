import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRAILHEAD_WAYFINDER_STATES,
  resolveWayfinderVisualState,
  shouldAnimateWayfinderEntry,
} from '../wayfinderState';

test('every supported state resolves to a visual state', () => {
  for (const state of TRAILHEAD_WAYFINDER_STATES) {
    assert.ok(resolveWayfinderVisualState(state));
  }
});

test('idle remains static while active voice states use a one-shot transition', () => {
  assert.equal(shouldAnimateWayfinderEntry('idle'), false);
  assert.equal(shouldAnimateWayfinderEntry('listening'), true);
  assert.equal(shouldAnimateWayfinderEntry('userSpeaking'), true);
  assert.equal(shouldAnimateWayfinderEntry('thinking'), true);
  assert.equal(shouldAnimateWayfinderEntry('speaking'), true);
});

test('flyover presence states retain distinct semantics', () => {
  assert.equal(resolveWayfinderVisualState('building'), 'thinking');
  assert.equal(resolveWayfinderVisualState('flying'), 'flying');
  assert.equal(resolveWayfinderVisualState('warning'), 'warning');
  assert.equal(resolveWayfinderVisualState('paused'), 'paused');
  assert.equal(resolveWayfinderVisualState('complete'), 'complete');
});
