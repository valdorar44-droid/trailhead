import assert from 'node:assert/strict';
import { shouldNotifyTrackingModeBreakaway } from '../nativeMapCameraEvents';

assert.equal(
  shouldNotifyTrackingModeBreakaway({
    followUserLocation: false,
    nowMs: 1_200,
    userGestureUntilMs: 0,
    programmaticUntilMs: 2_000,
  }),
  false,
  'a programmatic Recenter transition must not break camera ownership',
);

assert.equal(
  shouldNotifyTrackingModeBreakaway({
    followUserLocation: false,
    nowMs: 2_100,
    userGestureUntilMs: 3_000,
    programmaticUntilMs: 2_000,
  }),
  true,
  'a recent real touch may break away after the programmatic window',
);

assert.equal(
  shouldNotifyTrackingModeBreakaway({
    followUserLocation: true,
    nowMs: 2_100,
    userGestureUntilMs: 3_000,
    programmaticUntilMs: 0,
  }),
  false,
  'tracking-on events never represent a breakaway',
);

assert.equal(
  shouldNotifyTrackingModeBreakaway({
    followUserLocation: false,
    nowMs: 3_100,
    userGestureUntilMs: 3_000,
    programmaticUntilMs: 0,
  }),
  false,
  'an old touch cannot break away a later tracking transition',
);

console.log('native map camera event tests passed');
