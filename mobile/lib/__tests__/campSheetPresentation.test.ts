import assert from 'node:assert/strict';
import test from 'node:test';

import {
  devilsGardenResolvedCampPinV1,
  devilsGardenResolvedSearchResultV2,
  devilsGardenStoredDetailV1,
  kirchFlatSourceItemV1,
  kirchFlatStoredDetailV1,
  portalDispersedSourceItemV1,
} from '../__fixtures__/kirchFlatCampground';
import { normalizeCampDetailArrays } from '../campNearby';
import { campPeekPresentationV1 } from '../campPeekPresentation';
import { campgroundSheetPresentationV1 } from '../campSheetPresentation';
import { searchResultV2ToLegacyPlace } from '../searchV2/presentation';
import type { CampsiteDetail, CampsitePin } from '../api';

test('exact Kirch Flat source item and stored detail produce one stable presentation', () => {
  const peek = campgroundSheetPresentationV1(kirchFlatSourceItemV1);
  const full = campgroundSheetPresentationV1(kirchFlatSourceItemV1, kirchFlatStoredDetailV1);

  assert.equal(peek.title, 'Kirch Flat Group Campground');
  assert.equal(peek.sourceLabel, 'US Forest Service');
  assert.equal(peek.siteType, 'Group Campground');
  assert.equal(peek.inventory, 'Reservable');
  assert.equal(peek.fee, 'Not listed');
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

test('a stored campground fee replaces the Peek placeholder without repeating reservability', () => {
  const full = campgroundSheetPresentationV1(kirchFlatSourceItemV1, {
    ...kirchFlatStoredDetailV1,
    cost: 'Single Site: $10 per night. Group Site: $100 per night',
  });

  assert.equal(full.inventory, 'Reservable');
  assert.equal(full.fee, 'Single Site: $10 per night. Group Site: $100 per night');
  assert.doesNotMatch(full.fee, /Reservable/);
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

test('Devils Garden null provider notices normalize before the full sheet renders', () => {
  const normalized = normalizeCampDetailArrays(devilsGardenStoredDetailV1);

  assert.deepEqual(normalized.provider_notices, []);
  assert.deepEqual(normalized.campsites, []);
  assert.deepEqual(normalized.reviews, []);
  assert.doesNotThrow(() => normalized.provider_notices?.slice(0, 3));
});

test('canonical Devils Garden Search V2 selection produces a primitive-only Peek', () => {
  const searchPlace = searchResultV2ToLegacyPlace(devilsGardenResolvedSearchResultV2);
  assert.ok(searchPlace);
  assert.equal(searchPlace.id, devilsGardenResolvedCampPinV1.id);
  assert.equal(searchPlace.source, 'trailhead_search');

  const sheet = campgroundSheetPresentationV1(devilsGardenResolvedCampPinV1);
  const peek = campPeekPresentationV1({
    entityId: `camp:${devilsGardenResolvedCampPinV1.id}`,
    testID: 'place-sheet-camp-camp-place-ridb-234059',
    title: sheet.title,
    meta: sheet.meta,
    siteType: sheet.siteType,
    inventory: sheet.inventory,
    fee: sheet.fee,
    saved: false,
  });

  assert.deepEqual(peek, {
    entityId: 'camp:place:ridb:234059',
    testID: 'place-sheet-camp-camp-place-ridb-234059',
    title: 'Devils Garden Campground',
    meta: 'Recreation.gov',
    siteType: 'Tent Sites',
    inventory: 'Not listed',
    fee: 'Not listed',
    saved: false,
  });
  assert.ok(Object.values(peek).every(value => ['string', 'boolean'].includes(typeof value)));
});

test('camp Peek rejects nested provider values instead of stringifying them', () => {
  const peek = campPeekPresentationV1({
    entityId: { id: 'place:ridb:234059' },
    testID: ['place-sheet-camp'],
    title: { text: 'Devils Garden Campground' },
    meta: ['Recreation.gov'],
    siteType: null,
    inventory: { count: 51 },
    fee: Number.NaN,
    saved: 'yes',
  });

  assert.deepEqual(peek, {
    entityId: 'camp:campground',
    testID: 'place-sheet-camp-campground',
    title: 'Campground',
    meta: 'Campground',
    siteType: 'Campground',
    inventory: 'Not listed',
    fee: 'Not listed',
    saved: false,
  });
});
