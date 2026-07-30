import assert from 'node:assert/strict';
import {
  shouldNotifyRegionGestureBreakaway,
  shouldNotifyTrackingModeBreakaway,
} from '../nativeMapCameraEvents';

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

assert.equal(
  shouldNotifyRegionGestureBreakaway({
    nativeUserEvent: true,
    nowMs: 1_200,
    programmaticUntilMs: 2_000,
  }),
  false,
  'a Recenter region event cannot release ownership even if RNMapbox carries a user flag',
);

assert.equal(
  shouldNotifyRegionGestureBreakaway({
    nativeUserEvent: true,
    nowMs: 2_100,
    programmaticUntilMs: 0,
  }),
  true,
  'a real map gesture remains eligible after touch clears the programmatic interval',
);

assert.equal(
  shouldNotifyRegionGestureBreakaway({
    nativeUserEvent: false,
    nowMs: 2_100,
    programmaticUntilMs: 0,
  }),
  false,
  'an ordinary camera event never becomes a gesture merely because time passed',
);

console.log('native map camera event tests passed');
