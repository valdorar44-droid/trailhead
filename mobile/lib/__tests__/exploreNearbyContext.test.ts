import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveExploreNearbySearchCenter,
  serviceDestinationQueryFromExploreQuery,
} from '../exploreNearbyContext';

const destination = { lat: 38.5733, lng: -109.5498, name: 'Moab' };
const location = { lat: 49.8951, lng: -97.1384, name: 'Current location' };

test('fuel searches use the selected destination instead of GPS', () => {
  assert.deepEqual(
    resolveExploreNearbySearchCenter('fuel', true, destination, location),
    { ...destination, source: 'destination' },
  );
});

test('ordinary destination text is retained for service searches', () => {
  assert.equal(serviceDestinationQueryFromExploreQuery('Moab', 'fuel'), 'Moab');
  assert.equal(serviceDestinationQueryFromExploreQuery('fuel near Moab', 'fuel'), 'Moab');
  assert.equal(serviceDestinationQueryFromExploreQuery('Moab supplies', 'resupply'), 'Moab');
  assert.deepEqual(
    resolveExploreNearbySearchCenter('fuel', true, destination, null),
    { ...destination, source: 'destination' },
  );
});

test('category words are not treated as destinations', () => {
  assert.equal(serviceDestinationQueryFromExploreQuery('Fuel', 'fuel'), null);
  assert.equal(serviceDestinationQueryFromExploreQuery('Supplies', 'resupply'), null);
  assert.equal(serviceDestinationQueryFromExploreQuery('Trails', 'fuel'), null);
  assert.equal(serviceDestinationQueryFromExploreQuery('Moab', 'trails'), null);
});

test('supplies searches work from a selected destination without GPS', () => {
  assert.deepEqual(
    resolveExploreNearbySearchCenter('resupply', true, destination, null),
    { ...destination, source: 'destination' },
  );
});

test('nearby browsing and stale destination context fall back to GPS', () => {
  assert.deepEqual(
    resolveExploreNearbySearchCenter('all', true, destination, location),
    { ...location, source: 'location' },
  );
  assert.deepEqual(
    resolveExploreNearbySearchCenter('fuel', false, destination, location),
    { ...location, source: 'location' },
  );
});
