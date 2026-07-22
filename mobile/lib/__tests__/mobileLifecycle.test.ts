import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedRetainedScrollOffset,
  mapLocationWatchShouldRun,
  mapVisualWorkShouldRun,
  screenIsActive,
} from '../screenActivityState';
import { completeLegacyMapSearch } from '../legacyMapSearchPolicy';
import { subscriptionManagementUrl } from '../subscriptionManagement';
import {
  tabBarIsHidden,
  updateTabBarHiddenReasons,
  type TabBarHiddenReasons,
} from '../tabBarVisibilityState';

test('screen activity requires both focus and a foreground app', () => {
  assert.equal(screenIsActive(true, 'active'), true);
  assert.equal(screenIsActive(false, 'active'), false);
  assert.equal(screenIsActive(true, 'background'), false);
  assert.equal(screenIsActive(true, 'inactive'), false);
});

test('retained scroll offsets stay valid when asynchronously loaded content shrinks', () => {
  assert.equal(boundedRetainedScrollOffset(640, 1600, 800), 640);
  assert.equal(boundedRetainedScrollOffset(2400, 1600, 800), 800);
  assert.equal(boundedRetainedScrollOffset(900, 500, 800), 0);
  assert.equal(boundedRetainedScrollOffset(Number.NaN, 1600, 800), 0);
});

test('idle Map sensing pauses on blur/background while active navigation continues', () => {
  const focusedForeground = screenIsActive(true, 'active');
  const blurredForeground = screenIsActive(false, 'active');
  const focusedBackground = screenIsActive(true, 'background');

  assert.equal(mapLocationWatchShouldRun(focusedForeground, false), true);
  assert.equal(mapLocationWatchShouldRun(blurredForeground, false), false);
  assert.equal(mapLocationWatchShouldRun(focusedBackground, false), false);
  assert.equal(mapLocationWatchShouldRun(blurredForeground, true), true);
  assert.equal(mapLocationWatchShouldRun(focusedBackground, true), true);
});

test('hidden Map pauses visual layers without stopping the navigation runtime', () => {
  assert.equal(mapVisualWorkShouldRun(true, true, false), true);
  assert.equal(mapVisualWorkShouldRun(false, true, false), false);
  assert.equal(mapVisualWorkShouldRun(false, true, true), true);
  assert.equal(mapVisualWorkShouldRun(false, false, true), false);
  assert.equal(mapLocationWatchShouldRun(false, true), true);
});

test('legacy Map search preserves server order and requires explicit selection', () => {
  const serverRanked = [
    { id: 'best-match', distanceKm: 42 },
    { id: 'nearer-but-second', distanceKm: 2 },
  ];

  const completion = completeLegacyMapSearch(serverRanked);

  assert.deepEqual(completion.results.map(result => result.id), ['best-match', 'nearer-but-second']);
  assert.notEqual(completion.results, serverRanked);
  assert.equal(completion.selected, null);
});

test('tab-bar reasons are independent across mounted screens', () => {
  let reasons: TabBarHiddenReasons = {};
  reasons = updateTabBarHiddenReasons(reasons, 'map', true);
  reasons = updateTabBarHiddenReasons(reasons, 'route-builder', true);
  reasons = updateTabBarHiddenReasons(reasons, 'map', false);

  assert.equal(tabBarIsHidden(reasons), true);
  assert.deepEqual(reasons, { 'route-builder': true });

  reasons = updateTabBarHiddenReasons(reasons, 'route-builder', false);
  assert.equal(tabBarIsHidden(reasons), false);
});

test('subscription management uses the correct platform store', () => {
  assert.match(subscriptionManagementUrl('android'), /^https:\/\/play\.google\.com\/store\/account\/subscriptions\?/);
  assert.match(subscriptionManagementUrl('android'), /package=com\.trailhead\.app/);
  assert.equal(subscriptionManagementUrl('ios'), 'https://apps.apple.com/account/subscriptions');
});
