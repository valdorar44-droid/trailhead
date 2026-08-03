import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BACKGROUND_LOCATION_PROMINENT_DISCLOSURE,
  navigationBackgroundStartStep,
} from '../navigationLocationDisclosure';

const mapSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../app/(tabs)/map.tsx'),
  'utf8',
);

test('the disclosure names precise location, background use, closed-app use, stopping, and advertising', () => {
  assert.match(BACKGROUND_LOCATION_PROMINENT_DISCLOSURE, /collects precise location data/i);
  assert.match(BACKGROUND_LOCATION_PROMINENT_DISCLOSURE, /working in the background/i);
  assert.match(BACKGROUND_LOCATION_PROMINENT_DISCLOSURE, /app is closed or not in use/i);
  assert.match(BACKGROUND_LOCATION_PROMINENT_DISCLOSURE, /stops when you end it/i);
  assert.match(BACKGROUND_LOCATION_PROMINENT_DISCLOSURE, /does not use location for advertising/i);
});

test('background updates cannot start before foreground and background permission', () => {
  assert.equal(navigationBackgroundStartStep({
    platform: 'ios', foregroundGranted: false, backgroundGranted: false, alreadyActive: false,
  }), 'foreground_denied');
  assert.equal(navigationBackgroundStartStep({
    platform: 'ios', foregroundGranted: true, backgroundGranted: false, alreadyActive: false,
  }), 'request_background');
  assert.equal(navigationBackgroundStartStep({
    platform: 'ios', foregroundGranted: true, backgroundGranted: true, alreadyActive: false,
  }), 'start_background');
  assert.equal(navigationBackgroundStartStep({
    platform: 'ios', foregroundGranted: true, backgroundGranted: true, alreadyActive: true,
  }), 'already_active');
});

test('the Expo background task remains unsupported on Android and web', () => {
  for (const platform of ['android', 'web']) {
    assert.equal(navigationBackgroundStartStep({
      platform, foregroundGranted: true, backgroundGranted: true, alreadyActive: false,
    }), 'unsupported');
  }
});

test('navigation renders the disclosure before the only background-start action', () => {
  assert.match(mapSource, /testID="map\.navigation-location-disclosure"/);
  assert.match(mapSource, />Agree &amp; continue</);
  assert.match(mapSource, /testID="map\.navigation-location-disclosure\.not-now"/);
  assert.match(mapSource, /const result = await startNavigationBackgroundLocation\(\)/);
  const navigationModeEffect = mapSource.slice(
    mapSource.indexOf('navRef.current.active = navMode'),
    mapSource.indexOf('useTabBarVisibility(', mapSource.indexOf('navRef.current.active = navMode')),
  );
  assert.doesNotMatch(
    navigationModeEffect,
    /startNavigationBackgroundLocation\(/,
    'navMode must show the disclosure instead of starting background updates',
  );
  assert.match(navigationModeEffect, /setNavigationLocationDisclosureMode/);
  assert.doesNotMatch(mapSource, /Location is only used while the app is open/);
});
