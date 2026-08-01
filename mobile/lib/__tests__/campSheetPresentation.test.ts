import assert from 'node:assert/strict';
import test from 'node:test';

import { kirchFlatSourceItemV1, kirchFlatStoredDetailV1 } from '../__fixtures__/kirchFlatCampground';
import { campgroundSheetPresentationV1 } from '../campSheetPresentation';
import type { CampsiteDetail, CampsitePin } from '../api';

test('exact Kirch Flat source item and stored detail produce one stable presentation', () => {
  const peek = campgroundSheetPresentationV1(kirchFlatSourceItemV1);
  const full = campgroundSheetPresentationV1(kirchFlatSourceItemV1, kirchFlatStoredDetailV1);

  assert.equal(peek.title, 'Kirch Flat Group Campground');
  assert.equal(peek.sourceLabel, 'US Forest Service');
  assert.equal(peek.siteType, 'Campground');
  assert.equal(peek.inventory, 'Reservable');
  assert.equal(peek.fee, 'Reservable');
  assert.equal(peek.photos.length, 1);

  assert.equal(full.title, peek.title);
  assert.equal(full.sourceLabel, peek.sourceLabel);
  assert.equal(full.photos.length, 1);
  assert.equal(full.summary, kirchFlatSourceItemV1.description);
  assert.ok(full.features.includes('Toilets'));
  assert.ok(full.features.includes('Reservable'));
});

test('malformed provider arrays normalize to safe empty lists without changing identity', () => {
  const malformed = {
    ...kirchFlatStoredDetailV1,
    amenities: { value: 'toilets' },
    activities: 'fishing',
    campsites: { one: true },
    photos: { url: 'https://example.test/not-an-array.jpg' },
    site_types: 0,
    tags: null,
  } as unknown as CampsiteDetail;
  const pin = {
    ...kirchFlatSourceItemV1,
    tags: 'campground' as unknown as string[],
    photos: { url: 'https://example.test/not-an-array.jpg' } as unknown as string[],
  } as CampsitePin;

  const presentation = campgroundSheetPresentationV1(pin, malformed);
  assert.equal(presentation.title, 'Kirch Flat Group Campground');
  assert.equal(presentation.sourceLabel, 'US Forest Service');
  assert.equal(presentation.photos.length, 1);
  assert.equal(presentation.photos[0]?.url, kirchFlatSourceItemV1.photo_url);
  assert.deepEqual(presentation.activities, []);
  assert.deepEqual(presentation.siteTypes, ['Campground']);
});
