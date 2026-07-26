import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalCampgroundSearchResultPinV2,
  isCanonicalCampgroundSearchResultV2,
} from '../explore';
import type { SearchResultV2 } from '../types';

function result(overrides: Partial<SearchResultV2> = {}): SearchResultV2 {
  return {
    result_id: 'camp-result',
    canonical_place_id: 'camp:ridb:232446',
    title: 'Indian Creek Campground',
    subtitle: 'Canyonlands area',
    kind: 'campground',
    categories: ['camping', 'campground'],
    coordinates: { lat: 38.235, lng: -109.51 },
    detail_ref: 'camp:ridb:232446',
    provenance: {
      provider: 'trailhead',
      source_label: 'Recreation.gov',
      temporary_use_only: false,
    },
    persistence_policy: 'canonical',
    score: 99,
    match_reason: 'exact',
    ...overrides,
  };
}

test('canonical Recreation.gov camp results route to a campground selection', () => {
  const selected = result();
  assert.equal(isCanonicalCampgroundSearchResultV2(selected), true);
  assert.deepEqual(canonicalCampgroundSearchResultPinV2(selected), {
    id: 'camp:ridb:232446',
    name: 'Indian Creek Campground',
    lat: 38.235,
    lng: -109.51,
    tags: ['camping', 'campground'],
    land_type: 'Campground',
    description: 'Canyonlands area',
    reservable: true,
    url: '',
    ada: false,
    provider_place_id: 'camp:ridb:232446',
    place_id: 'camp:ridb:232446',
    source: 'trailhead',
    verified_source: 'Recreation.gov',
    source_badge: 'Recreation.gov',
  });
});

test('canonical camp category works even when the general kind is place', () => {
  assert.equal(isCanonicalCampgroundSearchResultV2(result({
    kind: 'place',
    categories: ['rv_park'],
  })), true);
});

test('temporary provider results remain source results rather than canonical camps', () => {
  const temporary = result({
    canonical_place_id: null,
    persistence_policy: 'temporary',
    provenance: {
      provider: 'mapbox',
      source_label: 'Search result',
      temporary_use_only: true,
    },
  });
  assert.equal(isCanonicalCampgroundSearchResultV2(temporary), false);
  assert.equal(canonicalCampgroundSearchResultPinV2(temporary), null);
});

test('canonical camp without coordinates stays unresolved until detail lookup', () => {
  const noCoordinates = result({ coordinates: null });
  assert.equal(isCanonicalCampgroundSearchResultV2(noCoordinates), true);
  assert.equal(canonicalCampgroundSearchResultPinV2(noCoordinates), null);
});
