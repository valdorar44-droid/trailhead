import assert from 'node:assert/strict';
import test from 'node:test';
import type { BookableExperience } from '../api';
import {
  buildPendingRouteActivityOffer,
  routeActivityDay,
  routeActivityPlace,
} from '../routeActivityOffer';

function experience(overrides: Partial<BookableExperience> = {}): BookableExperience {
  return {
    id: 'viator-1',
    source: 'viator',
    source_id: 'product-1',
    source_badge: 'Viator',
    title: 'Canyon sunset drive',
    lat: 38.5733,
    lng: -109.5498,
    booking_url: 'https://www.viator.com/tours/example',
    route_anchor: { day: 2, name: 'Moab' },
    ...overrides,
  };
}

test('publishes only real, bookable Viator results with route coordinates', () => {
  const offer = buildPendingRouteActivityOffer('trip-1', [
    experience(),
    experience({ id: 'organic-1', source_id: 'organic-1', source: 'osm', source_badge: 'OpenStreetMap' }),
    experience({ id: 'no-location', source_id: 'no-location', lat: null }),
    experience({ id: 'no-link', source_id: 'no-link', booking_url: undefined, affiliate_url: undefined, source_url: undefined }),
  ], 1234);

  assert.ok(offer);
  assert.equal(offer.createdAt, 1234);
  assert.deepEqual(offer.experiences.map(item => item.id), ['viator-1']);
});

test('returns no invitation when the provider response has no usable result', () => {
  assert.equal(buildPendingRouteActivityOffer('trip-1', [
    experience({ source: 'organic', source_badge: 'Nearby place' }),
  ]), null);
});

test('uses a valid affiliate link when another provider URL is malformed', () => {
  const offer = buildPendingRouteActivityOffer('trip-1', [experience({
    booking_url: 'viator-product',
    affiliate_url: 'https://partner.example.com/viator-product',
  })]);
  assert.ok(offer);
  assert.equal(routeActivityPlace(offer.experiences[0])?.booking_url, 'https://partner.example.com/viator-product');
});

test('converts the booked activity into a route-ready place on its matched day', () => {
  const selected = experience({ rating: 4.9, review_count: 310 });
  const place = routeActivityPlace(selected);

  assert.ok(place);
  assert.equal(place.source, 'viator');
  assert.equal(place.type, 'attraction');
  assert.equal(place.lat, selected.lat);
  assert.equal(place.booking_url, selected.booking_url);
  assert.equal(routeActivityDay(selected, 1), 2);
});

test('uses the route match day from the route-search contract', () => {
  const selected = experience({
    provider: { id: 'viator', name: 'Viator' },
    route_match: {
      anchor_name: 'Canyonlands',
      day: 3,
      leg_index: 2,
      detour_mi: 1.4,
      matched_by: 'geometry',
    },
    route_anchor: { day: 1, name: 'Legacy anchor' },
  });

  const offer = buildPendingRouteActivityOffer('trip-1', [selected], 1234);

  assert.ok(offer);
  assert.equal(offer.experiences[0].provider?.name, 'Viator');
  assert.equal(offer.experiences[0].route_match?.detour_mi, 1.4);
  assert.equal(routeActivityDay(offer.experiences[0], 1), 3);
});
