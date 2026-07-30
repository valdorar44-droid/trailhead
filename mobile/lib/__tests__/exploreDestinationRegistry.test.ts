import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPLORE_PRIMARY_DESTINATIONS,
  destinationCapabilitiesForModules,
  primaryExploreDestinationForCategory,
  visibleExploreCategoryLabel,
  visibleExplorePrimaryCategory,
} from '../exploreDestinationRegistry';

test('Explore exposes five stable primary destinations', () => {
  assert.deepEqual(
    EXPLORE_PRIMARY_DESTINATIONS.map(item => item.label),
    ['Trails', 'Camps', 'Parks & Land', 'Scenic', 'Guided'],
  );
  assert.equal(visibleExplorePrimaryCategory('trails'), true);
  assert.equal(visibleExplorePrimaryCategory('things'), false);
  assert.equal(visibleExploreCategoryLabel('things'), null);
});

test('legacy Things stays a compatibility alias without becoming visible', () => {
  assert.equal(primaryExploreDestinationForCategory('things').key, 'scenic');
  assert.equal(primaryExploreDestinationForCategory('land').key, 'parks_land');
  assert.equal(primaryExploreDestinationForCategory('tours').key, 'guided');
});

test('destination capabilities are source-module driven and deterministic', () => {
  assert.deepEqual(
    destinationCapabilitiesForModules(['trails', 'fees', 'alerts', 'map']),
    ['overview', 'official_sources', 'trails', 'fees_permits', 'alerts_conditions', 'map'],
  );
});
