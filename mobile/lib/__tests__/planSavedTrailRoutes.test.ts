import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfflineTrail } from '../offlineTrails';
import { ownerTrailRouteForSavedEntity, ownerTrailRoutesBySavedEntityId } from '../planSavedTrailRoutes';
import { createSavedEntity } from '../tripRepository/core';

function route(id: string, owner = true): OfflineTrail {
  return {
    id,
    trail: {
      id: id.replace(/^captured:/, ''),
      name: 'Island loop',
      subtitle: '',
      type: 'trail',
      source: 'trip',
      lat: 38.5,
      lng: -109.5,
      score: 1,
      support: {
        campsNearby: 0,
        fuelNearby: 0,
        waterNearby: 0,
        reportsNearby: 0,
        offlineReady: true,
        readinessLabel: 'Saved',
      },
    },
    geometry: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[-109.5, 38.5], [-109.49, 38.51]] },
      }],
    },
    savedAt: 1,
    source: 'manual',
    ...(owner ? {
      ownerRouteOrigin: 'builder' as const,
      builder: {
        schemaVersion: 1 as const,
        mode: 'points' as const,
        activity: 'hike' as const,
        anchors: [[-109.5, 38.5], [-109.49, 38.51]] as const,
        redo: [] as const,
      },
    } : {}),
  };
}

test('matches the captured Saved item to its account-owned offline route', () => {
  const item = createSavedEntity({
    id: 'captured:pinned:123',
    kind: 'place',
    title: 'Island loop',
  });
  assert.equal(ownerTrailRouteForSavedEntity(item, [route('captured:pinned:123')])?.id, item.id);
});

test('does not expose sharing for downloaded catalog trails or unrelated places', () => {
  const catalogTrail = createSavedEntity({ id: 'trail:nps:42', kind: 'trail', title: 'Official trail' });
  const camp = createSavedEntity({ id: 'camp:42', kind: 'camp', title: 'Camp' });
  assert.equal(ownerTrailRouteForSavedEntity(catalogTrail, [route('trail:nps:42', false)]), null);
  assert.equal(ownerTrailRouteForSavedEntity(camp, [route('camp:42')]), null);
});

test('maps only matched owner routes and keeps stable Saved item IDs', () => {
  const captured = createSavedEntity({ id: 'captured:pinned:123', kind: 'place', title: 'Island loop' });
  const official = createSavedEntity({ id: 'trail:nps:42', kind: 'trail', title: 'Official trail' });
  const matches = ownerTrailRoutesBySavedEntityId(
    [captured, official],
    [route('captured:pinned:123'), route('trail:nps:42', false)],
  );
  assert.deepEqual([...matches.keys()], ['captured:pinned:123']);
});
