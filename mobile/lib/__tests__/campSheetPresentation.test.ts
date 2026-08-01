import assert from 'node:assert/strict';
import test from 'node:test';

import {
  kirchFlatSourceItemV1,
  kirchFlatStoredDetailV1,
  portalDispersedSourceItemV1,
} from '../__fixtures__/kirchFlatCampground';
import { campgroundSheetPresentationV1 } from '../campSheetPresentation';
import type { CampsiteDetail, CampsitePin } from '../api';

test('exact Kirch Flat source item and stored detail produce one stable presentation', () => {
  const peek = campgroundSheetPresentationV1(kirchFlatSourceItemV1);
  const full = campgroundSheetPresentationV1(kirchFlatSourceItemV1, kirchFlatStoredDetailV1);

  assert.equal(peek.title, 'Kirch Flat Group Campground');
  assert.equal(peek.sourceLabel, 'US Forest Service');
  assert.equal(peek.siteType, 'Group Campground');
  assert.equal(peek.inventory, 'Reservable');
  assert.equal(peek.fee, 'Reservable');
  assert.equal(peek.photos.length, 1);
  assert.equal(peek.bookingUrl, kirchFlatSourceItemV1.booking_url);
  assert.equal(peek.primaryLinkUrl, kirchFlatSourceItemV1.booking_url);

  assert.equal(full.title, peek.title);
  assert.equal(full.sourceLabel, peek.sourceLabel);
  assert.equal(full.photos.length, 1);
  assert.equal(full.summary, kirchFlatSourceItemV1.description);
  assert.ok(full.features.includes('Toilets'));
  assert.ok(full.features.includes('Reservable'));
  assert.equal(full.bookingUrl, kirchFlatStoredDetailV1.booking_url);
  assert.equal(full.primaryLinkUrl, kirchFlatStoredDetailV1.booking_url);
});

test('source-named dispersed camps are classified without discarding the generic source type', () => {
  const presentation = campgroundSheetPresentationV1(portalDispersedSourceItemV1);

  assert.equal(presentation.title, 'Portal Dispersed Camp');
  assert.equal(presentation.siteType, 'Dispersed Camping');
  assert.deepEqual(presentation.siteTypes, ['Dispersed Camping', 'Campground']);
  assert.equal(presentation.primaryLinkUrl, portalDispersedSourceItemV1.official_url);
});

test('booking is the primary campground link while the official source remains available', () => {
  const presentation = campgroundSheetPresentationV1({
    ...kirchFlatSourceItemV1,
    official_url: 'https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45570',
    booking_url: 'https://www.recreation.gov/camping/campgrounds/10182463',
  });

  assert.equal(presentation.bookingUrl, 'https://www.recreation.gov/camping/campgrounds/10182463');
  assert.equal(presentation.officialUrl, 'https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45570');
  assert.equal(presentation.primaryLinkUrl, presentation.bookingUrl);
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
  assert.deepEqual(presentation.siteTypes, ['Group Campground', 'Campground']);
});
