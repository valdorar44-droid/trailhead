import assert from 'node:assert/strict';
import test from 'node:test';
import type { BookableExperience } from '../api';
import {
  bookedTourFromRouteActivity,
  buildCommittedRouteActivityOffer,
  buildPendingRouteActivityOffer,
  mergeRouteActivityBooking,
  nextRouteActivityPollDelayMs,
  routeActivityDay,
  routeActivityPlace,
  routeActivityPollWindowMs,
  tripAlreadyHasRouteActivityStop,
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
    coordinate_source: 'product',
    coordinate_precision: 'product',
    route_stop_eligible: true,
    booking_url: 'https://www.viator.com/tours/example',
    route_anchor: { day: 2, name: 'Moab' },
    ...overrides,
  };
}

test('publishes real, bookable Viator results even before an exact meeting point is available', () => {
  const offer = buildPendingRouteActivityOffer('trip-1', [
    experience(),
    experience({ id: 'organic-1', source_id: 'organic-1', source: 'osm', source_badge: 'OpenStreetMap' }),
    experience({ id: 'no-location', source_id: 'no-location', lat: null }),
    experience({ id: 'no-link', source_id: 'no-link', booking_url: undefined, affiliate_url: undefined, source_url: undefined }),
  ], 1234);

  assert.ok(offer);
  assert.equal(offer.createdAt, 1234);
  assert.deepEqual(offer.experiences.map(item => item.id), ['viator-1', 'no-location']);
});

test('returns no invitation when the provider response has no usable result', () => {
  assert.equal(buildPendingRouteActivityOffer('trip-1', [
    experience({ source: 'organic', source_badge: 'Nearby place' }),
  ]), null);
});

test('does not publish route activities until the saved trip is active', () => {
  assert.equal(buildCommittedRouteActivityOffer('new-trip', 'old-trip', [experience()]), null);

  const offer = buildCommittedRouteActivityOffer('new-trip', 'new-trip', [experience()], 2345);
  assert.ok(offer);
  assert.equal(offer.tripId, 'new-trip');
  assert.equal(offer.createdAt, 2345);
});

test('uses a valid affiliate link when another provider URL is malformed', () => {
  const offer = buildPendingRouteActivityOffer('trip-1', [experience({
    booking_url: 'viator-product',
    affiliate_url: 'https://partner.viator.com/viator-product',
  })]);
  assert.ok(offer);
  assert.equal(routeActivityPlace(offer.experiences[0])?.booking_url, 'https://partner.viator.com/viator-product');
});

test('rejects insecure and unrelated booking links', () => {
  assert.equal(buildPendingRouteActivityOffer('trip-1', [
    experience({ booking_url: 'http://www.viator.com/tours/example' }),
    experience({ id: 'lookalike', source_id: 'lookalike', booking_url: 'https://viator.example.com/tours/example' }),
    experience({ id: 'phishing', source_id: 'phishing', booking_url: 'https://example.com/viator' }),
  ]), null);
});

test('does not infer Viator from unrelated provider wording', () => {
  assert.equal(buildPendingRouteActivityOffer('trip-1', [experience({
    source: 'catalog',
    source_badge: 'Not Viator inventory',
  })]), null);
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

test('keeps approximate activity bookings without creating a fabricated route stop', () => {
  const approximate = experience({
    coordinate_source: 'destination_centroid',
    coordinate_precision: 'approximate',
    route_stop_eligible: false,
  });

  assert.ok(buildPendingRouteActivityOffer('trip-1', [approximate]));
  assert.ok(bookedTourFromRouteActivity(approximate));
  assert.equal(routeActivityPlace(approximate), null);
});

test('keeps a booking when coordinates are missing', () => {
  const missing = experience({
    lat: null,
    lng: null,
    coordinate_source: '',
    coordinate_precision: '',
    route_stop_eligible: false,
  });

  assert.ok(buildPendingRouteActivityOffer('trip-1', [missing]));
  assert.ok(bookedTourFromRouteActivity(missing));
  assert.equal(routeActivityPlace(missing), null);
});

test('accepts exact coordinates retained by a legacy cached Viator product', () => {
  const legacy = experience({
    coordinate_source: undefined,
    coordinate_precision: undefined,
    route_stop_eligible: undefined,
    raw: { lat: 38.5733, lng: -109.5498 },
  });

  assert.ok(routeActivityPlace(legacy));
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

test('keeps polling through the provider search deadline', () => {
  assert.equal(routeActivityPollWindowMs(), 130_000);
  assert.equal(routeActivityPollWindowMs(20), 25_000);
  assert.equal(nextRouteActivityPollDelayMs(0, 0, 25_000), 4_500);
  assert.equal(nextRouteActivityPollDelayMs(12, 24_000, 25_000), 1_000);
  assert.equal(nextRouteActivityPollDelayMs(12, 25_000, 25_000), null);
});

test('records an affiliate booking separately from its route stop', () => {
  const booked = bookedTourFromRouteActivity(experience({
    region: 'Moab',
    country: 'United States',
    duration_label: '3 hours',
    summary: 'Sunset drive through the canyon.',
    cancellation_summary: 'Free cancellation up to 24 hours before departure.',
    hero_image_url: 'https://images.example.com/tour.jpg',
    price_from: '89.00',
    currency: 'USD',
  }), '2026-07-14T12:00:00.000Z');

  assert.ok(booked);
  assert.equal(booked.id, 'viator:product-1');
  assert.equal(booked.location, 'Moab, United States');
  assert.equal(booked.detailsUrl, 'https://www.viator.com/tours/example');
  assert.equal(booked.imageUrl, 'https://images.example.com/tour.jpg');
  assert.equal(booked.calendarNote, '3 hours · Sunset drive through the canyon.');
  assert.equal(booked.bookedAt, '2026-07-14T12:00:00.000Z');
  assert.equal(booked.totalPrice, undefined, 'a starting price is not the amount the traveler paid');
});

test('keeps confirmed bookings in the trip builder state across route saves', () => {
  const first = bookedTourFromRouteActivity(experience(), '2026-07-14T12:00:00.000Z');
  const second = bookedTourFromRouteActivity(experience({
    id: 'viator-2',
    source_id: 'product-2',
    title: 'Canyon stargazing tour',
  }), '2026-07-15T12:00:00.000Z');
  assert.ok(first);
  assert.ok(second);

  const merged = mergeRouteActivityBooking(
    { stops: [], booked_tours: [first] },
    second,
    { bookings: [first] },
  );

  assert.deepEqual((merged.bookings as Array<{ id: string }>).map(item => item.id), [second.id, first.id]);
  assert.equal('booked_tours' in merged, false);
});

test('recognizes an activity that is already a routed stop', () => {
  const place = routeActivityPlace(experience());
  assert.ok(place);
  const trip = {
    plan: {
      waypoints: [{
        day: 2,
        name: place.name,
        type: 'waypoint',
        description: '',
        land_type: 'Viator',
        lat: place.lat + 0.0002,
        lng: place.lng,
        route_point_type: 'break' as const,
      }],
    },
    route_pois: [],
  } as any;

  assert.equal(tripAlreadyHasRouteActivityStop(trip, place, 2), true);
  assert.equal(tripAlreadyHasRouteActivityStop(trip, place, 1), false);
  trip.plan.waypoints[0].route_point_type = 'side_stop';
  assert.equal(tripAlreadyHasRouteActivityStop(trip, place, 2), false);

  trip.route_pois = [{
    ...place,
    id: `viator:${place.provider_place_id}`,
    recommended_day: 2,
    route_point_type: 'side_stop',
  }];
  assert.equal(
    tripAlreadyHasRouteActivityStop(trip, { ...place, lat: place.lat + 1 }, 2),
    true,
    'an existing trip place still records the booking instead of silently returning',
  );
});
