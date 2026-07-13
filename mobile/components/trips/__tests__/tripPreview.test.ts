import assert from 'node:assert/strict';
import { createSavedEntity, createTripDocument } from '../../../lib/tripRepository/core';
import { TRIP_ITEM_SCHEMA_VERSION } from '../../../lib/tripRepository/types';
import { tripPreviewMedia } from '../tripPreview';

const now = Date.now();
const campsite = createSavedEntity({
  id: 'camp-one',
  kind: 'camp',
  title: 'Camp One',
  coordinates: { lat: 49.91, lng: -97.14 },
  media: [{ kind: 'image', url: 'https://images.example.test/camp-one.jpg' }],
});
const trip = createTripDocument({
  id: 'photo-route-trip',
  title: 'Photo route trip',
  items: [
    {
      schemaVersion: TRIP_ITEM_SCHEMA_VERSION,
      id: 'first-stop',
      entityId: campsite.id,
      kind: 'camp',
      title: campsite.title,
      day: 1,
      order: 0,
      coordinates: campsite.coordinates,
      createdAt: now,
      updatedAt: now,
    },
  ],
  route: {
    coordinates: [
      [-97.14, 49.91],
      [-96.82, 50.02],
    ],
  },
});

const preview = tripPreviewMedia(trip, new Map([[campsite.id, campsite]]));
assert.equal(preview.imageUrl, campsite.media[0].url, 'linked saved media should be the first preview choice');
assert.deepEqual(
  preview.pins.map(pin => [pin.lat, pin.lng]),
  [[49.91, -97.14], [50.02, -96.82]],
  'stored stops and route geometry should produce deterministic preview pins without duplicates',
);

const factsPreview = tripPreviewMedia(createTripDocument({
  id: 'facts-photo-trip',
  title: 'Facts photo trip',
  items: [{
    schemaVersion: TRIP_ITEM_SCHEMA_VERSION,
    id: 'photo-stop',
    kind: 'place',
    title: 'Photo stop',
    day: 1,
    order: 0,
    facts: { hero_image_url: 'https://images.example.test/photo-stop.jpg' },
    createdAt: now,
    updatedAt: now,
  }],
}), new Map());
assert.equal(factsPreview.imageUrl, 'https://images.example.test/photo-stop.jpg');

const nestedLegacyPreview = tripPreviewMedia(createTripDocument({
  id: 'nested-legacy-trip',
  title: 'Nested legacy trip',
  legacy: {
    source: 'legacy_v1',
    payload: {
      payload: {
        legacy_v1: {
          payload: {
            campsites: [{
              id: 'legacy-camp',
              name: 'Legacy camp',
              lat: 36.1069,
              lng: -112.1129,
              photo_url: 'https://images.example.test/legacy-camp.jpg',
            }],
            route_geometry: {
              coords: [
                [-112.1129, 36.1069],
                [-111.9871, 36.2103],
              ],
            },
          },
        },
      },
    },
  },
}), new Map());
assert.equal(
  nestedLegacyPreview.imageUrl,
  'https://images.example.test/legacy-camp.jpg',
  'older wrapped trip payloads should retain their campsite image',
);
assert.deepEqual(
  nestedLegacyPreview.pins.map(pin => [pin.lat, pin.lng]),
  [[36.1069, -112.1129], [36.2103, -111.9871]],
  'older wrapped trip payloads should retain their place and route preview',
);

const emptyPreview = tripPreviewMedia(createTripDocument({
  id: 'topo-fallback-trip',
  title: 'Topo fallback trip',
}), new Map());
assert.equal(emptyPreview.imageUrl, undefined);
assert.deepEqual(emptyPreview.pins, []);

console.log('trip preview media contracts passed');
