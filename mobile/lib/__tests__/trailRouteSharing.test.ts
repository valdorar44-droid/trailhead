import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfflineTrail } from '../offlineTrails';
import {
  canonicalCoordinatesFromOfflineTrail,
  cropCanonicalTrailCoordinates,
  offlineTrailFromRecordingForPrivacyReview,
  offlineTrailFromSharedRoute,
  prepareOfflineTrailForSharing,
  sharedTrailTokenFromUrl,
  sharedTrailUrlFromToken,
  trailRouteIdempotencyKey,
} from '../trailRouteSharing';

const TOKEN = 'A'.repeat(43);

function trail(geometry: GeoJSON.Geometry, overrides: Partial<OfflineTrail> = {}): OfflineTrail {
  return {
    id: 'local-1',
    trail: {
      id: 'local-1', name: 'Mesa route', lat: 38.5, lng: -109.6, type: 'trail', source: 'trip',
      subtitle: 'Saved route', score: 1, activities: ['mixed'],
      support: { campsNearby: 0, fuelNearby: 0, waterNearby: 0, reportsNearby: 0, offlineReady: true, readinessLabel: 'Ready' },
    },
    geometry: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          timestamp: 'private', altitude: 1500, speed: 8, accuracy: 2,
          heading: 90, device_id: 'private-device', hidden_waypoints: [{ name: 'Home' }],
          route_shape: 'out-and-back',
        },
        geometry,
      }],
    },
    savedAt: 10,
    source: 'manual',
    ownerRouteOrigin: 'builder',
    ...overrides,
  };
}

test('sharing upload contains canonical coordinates and no local recording or device metadata', () => {
  const prepared = prepareOfflineTrailForSharing(trail({
    type: 'LineString',
    coordinates: [[-109.6, 38.5, 1500], [-109.59, 38.51, 1510], [-109.58, 38.52, 1520]],
  }), { start: 0, finish: 1 });
  assert.deepEqual(prepared.payload.geometry.coordinates, [[-109.6, 38.5], [-109.59, 38.51], [-109.58, 38.52]]);
  assert.equal(prepared.payload.activity, 'mixed_use');
  assert.deepEqual(prepared.payload.permitted_uses, []);
  const serialized = JSON.stringify(prepared.payload);
  for (const prohibited of ['timestamp', 'altitude', 'speed', 'accuracy', 'heading', 'device', 'waypoint', 'private-device']) {
    assert.equal(serialized.toLowerCase().includes(prohibited), false, prohibited);
  }
});

test('recording privacy conversion copies only valid latitude and longitude', () => {
  const converted = offlineTrailFromRecordingForPrivacyReview({
    recordingId: 'rec-1',
    trailName: 'Recorded loop',
    savedAt: 100,
    points: [
      { lat: 38.5, lng: -109.6, timestampMs: 1, altitudeM: 1500, speedMps: 4, accuracyM: 2 },
      { lat: 38.51, lng: -109.59, timestampMs: 2, altitudeM: 1510, headingDeg: 80 },
    ],
  });
  assert.equal(converted.ownerRouteOrigin, 'recording');
  assert.deepEqual(canonicalCoordinatesFromOfflineTrail(converted), [[-109.6, 38.5], [-109.59, 38.51]]);
  const uploaded = JSON.stringify(prepareOfflineTrailForSharing(converted, { start: 0, finish: 1 }).payload);
  for (const prohibited of ['timestamp', 'altitude', 'speed', 'accuracy', 'heading']) {
    assert.equal(uploaded.toLowerCase().includes(prohibited), false, prohibited);
  }
});

test('invalid and disconnected geometry fails closed', () => {
  assert.throws(() => canonicalCoordinatesFromOfflineTrail(trail({
    type: 'LineString', coordinates: [[-109.6, 38.5], [999, 38.6]],
  })), /invalid point/i);
  assert.throws(() => canonicalCoordinatesFromOfflineTrail(trail({
    type: 'MultiLineString',
    coordinates: [[[-109.6, 38.5], [-109.59, 38.51]], [[-108, 37], [-107.9, 37.1]]],
  })), /disconnected/i);
  assert.deepEqual(canonicalCoordinatesFromOfflineTrail(trail({
    type: 'MultiLineString',
    coordinates: [[[-109.6, 38.5], [-109.59, 38.51]], [[-109.59, 38.51], [-109.58, 38.52]]],
  })), [[-109.6, 38.5], [-109.59, 38.51], [-109.58, 38.52]]);
});

test('crop uses cumulative distance interpolation for sparse and two-point lines', () => {
  const source = [[0, 0], [0.001, 0], [0.011, 0]] as const;
  const cropped = cropCanonicalTrailCoordinates(source, { start: 0.5, finish: 0.75 });
  assert.equal(cropped.length, 2);
  assert.ok(Math.abs(cropped[0][0] - 0.0055) < 0.00001);
  assert.ok(Math.abs(cropped[1][0] - 0.00825) < 0.00001);
  const twoPoint = cropCanonicalTrailCoordinates([[0, 0], [0.01, 0]], { start: 0.2, finish: 0.8 });
  assert.deepEqual(twoPoint, [[0.002, 0], [0.008, 0]]);
});

test('only exact HTTPS and custom-scheme fragment links expose a token', () => {
  assert.equal(sharedTrailUrlFromToken(TOKEN), `https://gettrailhead.app/app/trails/shared#token=${TOKEN}`);
  assert.equal(sharedTrailTokenFromUrl(`https://gettrailhead.app/app/trails/shared#token=${TOKEN}`), TOKEN);
  assert.equal(sharedTrailTokenFromUrl(`trailhead://app/trails/shared#token=${TOKEN}`), TOKEN);
  assert.equal(sharedTrailTokenFromUrl(`https://evil.example/app/trails/shared#token=${TOKEN}`), '');
  assert.equal(sharedTrailTokenFromUrl(`https://gettrailhead.app/app/trails/shared?token=${TOKEN}`), '');
  assert.equal(sharedTrailTokenFromUrl(`https://gettrailhead.app/app/trails/shared/${TOKEN}`), '');
  assert.equal(sharedTrailTokenFromUrl('https://gettrailhead.app/app/trails/%E0%A4%A'), '');
});

test('mutation idempotency changes with crop or remote revision material', () => {
  const request = { ownerScope: '1:account:a', localRouteId: 'local-1', localRevision: 10 };
  assert.notEqual(
    trailRouteIdempotencyKey(request, 'update', 'crop:0:1:revision:1'),
    trailRouteIdempotencyKey(request, 'update', 'crop:0.1:1:revision:1'),
  );
  assert.notEqual(
    trailRouteIdempotencyKey(request, 'share', 'remote:1'),
    trailRouteIdempotencyKey(request, 'share', 'remote:2'),
  );
});

test('recipient local copy contains no bearer token or owner sharing mapping', () => {
  const copy = offlineTrailFromSharedRoute({
    version: 1,
    shared_route_id: 'route-1',
    route_revision: 2,
    share_revision: 3,
    origin: 'builder',
    title: 'Shared route',
    geometry: { type: 'LineString', coordinates: [[-109.6, 38.5], [-109.59, 38.51]] },
    geometry_revision: 2,
    geometry_sha256: 'abc',
  });
  assert.equal(copy.sharing, undefined);
  assert.equal(JSON.stringify(copy).includes(TOKEN), false);
});
