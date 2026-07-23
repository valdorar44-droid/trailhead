import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedRetainedScrollOffset,
  createMapVisualRefreshCoordinator,
  mapLocationWatchShouldRun,
  mapVisualWorkShouldRun,
  screenIsActive,
  visualWorkRequestIsCurrent,
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
  assert.equal(mapVisualWorkShouldRun(false, true, true), false);
  assert.equal(mapVisualWorkShouldRun(false, false, true), false);
  assert.equal(mapLocationWatchShouldRun(false, true), true);
});

test('visual work requests cannot commit across blur and refocus generations', () => {
  assert.equal(visualWorkRequestIsCurrent(true, 4, 4), true);
  assert.equal(visualWorkRequestIsCurrent(false, 4, 4), false);
  assert.equal(visualWorkRequestIsCurrent(true, 5, 4), false);
});

test('retained Map runs exactly one visual refresh for each refocus', () => {
  const bounds = { n: 40.1, s: 39.9, e: -109.8, w: -110.2 };
  const movedBounds = { ...bounds, e: -109.7 };
  const coordinator = createMapVisualRefreshCoordinator(true, 0);

  assert.equal(coordinator.resume(bounds, 0, 0), false, 'initial mount is not a refocus');
  assert.equal(coordinator.region(bounds, 0, 0), true);

  coordinator.transition(false, 1);
  assert.equal(coordinator.region(bounds, 1, 10), false, 'blur cancels visual commits');
  coordinator.transition(true, 2);
  assert.equal(coordinator.hasPendingResume(), true);
  coordinator.transition(true, 2);
  assert.equal(coordinator.hasPendingResume(), true, 'rerenders do not consume or duplicate the pending refresh');
  assert.equal(coordinator.resume(bounds, 2, 100), true);
  assert.equal(coordinator.resume(bounds, 2, 101), false, 'the fallback timer commits once');
  assert.equal(coordinator.region(bounds, 2, 200), false, 'an equivalent late native region event is deduplicated');
  assert.equal(coordinator.region(movedBounds, 2, 220), true, 'real camera movement still refreshes');

  coordinator.transition(false, 3);
  coordinator.transition(true, 4);
  coordinator.transition(false, 5);
  assert.equal(coordinator.resume(bounds, 4, 300), false, 'blur before the timer fires cancels the resume');

  coordinator.transition(true, 6);
  assert.equal(coordinator.resume(bounds, 5, 400), false, 'stale asynchronous bounds cannot commit');
  assert.equal(coordinator.region(bounds, 6, 410), true, 'a native event wins over the pending fallback');
  assert.equal(coordinator.resume(bounds, 6, 420), false);
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
