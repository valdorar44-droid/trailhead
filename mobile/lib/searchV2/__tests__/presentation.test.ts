import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exploreSearchCategoriesForCategory,
  exploreSearchIntentForCategory,
} from '../explore';
import {
  offlineSearchResultsV2,
  searchPlaceIsTemporary,
  searchResultV2ToDisplayPlace,
  searchResultV2ToLegacyPlace,
  searchV2ShouldShowEmptyState,
} from '../presentation';
import type { SearchResultV2 } from '../types';

test('empty search copy waits for the controller to settle the displayed query', () => {
  const settledEmpty = {
    displayedQuery: 'Arches',
    settledQuery: 'Arches',
    status: 'ready' as const,
    isEnriching: false,
    resultCount: 0,
  };
  assert.equal(searchV2ShouldShowEmptyState(settledEmpty), true);
  assert.equal(searchV2ShouldShowEmptyState({
    ...settledEmpty,
    settledQuery: 'Moab',
  }), false, 'an old ready state cannot flash empty after a new keystroke');
  assert.equal(searchV2ShouldShowEmptyState({
    ...settledEmpty,
    status: 'loading',
  }), false);
  assert.equal(searchV2ShouldShowEmptyState({
    ...settledEmpty,
    isEnriching: true,
  }), false);
  assert.equal(searchV2ShouldShowEmptyState({
    ...settledEmpty,
    resultCount: 1,
  }), false);
  assert.equal(searchV2ShouldShowEmptyState({
    ...settledEmpty,
    displayedQuery: 'A',
    settledQuery: 'A',
  }), false);
});

test('offline matches are immediate, stable and ranked without changing server order', () => {
  const results = offlineSearchResultsV2({ query: 'moab camp', surface: 'map', scope: 'offline', limit: 4 }, [
    { id: '2', name: 'Camp outside Moab', lat: 38.5, lng: -109.6, type: 'camp' },
    { id: '1', name: 'Moab Camp', lat: 38.6, lng: -109.5, type: 'camp', source_label: 'Trailhead' },
    { id: '3', name: 'Unrelated place', lat: 40, lng: -110, type: 'place' },
  ], 'map');
  assert.deepEqual(results.map(result => result.result_id), ['offline:1', 'offline:2']);
  assert.equal(results[0].persistence_policy, 'canonical');
  assert.equal(results[0].provenance.temporary_use_only, false);
});

test('offline matches honor intent, categories, and durable facets', () => {
  const places = [
    {
      id: 'trail-1', name: 'Juniper Loop', lat: 38.6, lng: -109.5,
      type: 'trail', category: 'forest_road', difficulty: 'Moderate',
      surface: 'Dirt', activities: ['Hiking'], verified: true,
    },
    {
      id: 'camp-1', name: 'Juniper Camp', lat: 38.61, lng: -109.51,
      type: 'camp', subtype: 'Primitive campground', verified: true,
    },
  ];
  const trails = offlineSearchResultsV2({
    query: 'Juniper', intent: 'trail', categories: ['forest_road'],
    filters: {
      difficulty: ['moderate'], surface: 'dirt', activity: 'hiking',
      provider: 'trailhead', verified: true,
    },
  }, places, 'map');
  assert.deepEqual(trails.map(result => result.result_id), ['offline:trail-1']);
  assert.ok(trails[0].categories.includes('hiking'));

  const camps = offlineSearchResultsV2({
    query: 'Juniper', intent: 'camp', categories: ['campground'],
  }, places, 'map');
  assert.deepEqual(camps.map(result => result.result_id), ['offline:camp-1']);

  const unavailableFacet = offlineSearchResultsV2({
    query: 'Juniper', filters: { surface: 'paved' },
  }, [places[1]], 'map');
  assert.deepEqual(unavailableFacet, [], 'missing stored facet data cannot become a positive match');
});

test('Route Editor mixed search keeps every useful downloaded stop kind', () => {
  const results = offlineSearchResultsV2({
    query: 'Mesa',
    surface: 'route_editor',
    scope: 'global',
    intent: 'any',
    limit: 10,
  }, [
    { id: 'camp-1', name: 'Mesa Camp', lat: 38.6, lng: -109.5, type: 'camp' },
    { id: 'trailhead-1', name: 'Mesa Trailhead', lat: 38.61, lng: -109.51, type: 'trailhead' },
    { id: 'fuel-1', name: 'Mesa Fuel', lat: 38.62, lng: -109.52, type: 'fuel' },
    { id: 'service-1', name: 'Mesa Repair', lat: 38.63, lng: -109.53, type: 'mechanic' },
    { id: 'destination-1', name: 'Mesa Verde', lat: 37.23, lng: -108.46, type: 'destination' },
  ], 'route_editor');

  assert.deepEqual(new Set(results.map(result => result.result_id)), new Set([
    'offline:camp-1',
    'offline:trailhead-1',
    'offline:fuel-1',
    'offline:service-1',
    'offline:destination-1',
  ]));
});

test('every Explore selector category is accepted by the same offline intent taxonomy', () => {
  const selectors = [
    'all', 'camp', 'glamping', 'huts', 'trails', 'trailheads', 'views', 'peaks',
    'waterfalls', 'springs', 'climb', 'water', 'scenic', 'parks', 'land', 'fuel',
    'resupply', 'things', 'guided', 'tours', 'nearby',
  ];
  for (const selector of selectors) {
    const intent = exploreSearchIntentForCategory(selector);
    const categories = exploreSearchCategoriesForCategory(selector);
    const candidates = categories?.length ? categories : [intent === 'destination' ? 'park' : 'poi'];
    for (const category of candidates) {
      const results = offlineSearchResultsV2({
        query: 'Selector',
        intent,
        categories: categories?.length ? [category] : undefined,
      }, [{
        id: `${selector}:${category}`,
        name: 'Selector result',
        lat: 38,
        lng: -109,
        type: category,
        category,
      }], 'explore');
      assert.equal(
        results.length,
        1,
        `${selector} / ${intent} must accept Explore facet ${category}`,
      );
    }
  }
});

test('offline nearby and bounds searches compute distance and exclude outside rows', () => {
  const places = [
    { id: 'near', name: 'Mesa Camp', lat: 38.574, lng: -109.55, type: 'camp' },
    { id: 'far', name: 'Mesa Camp Far', lat: 39.4, lng: -109.55, type: 'camp' },
  ];
  const nearby = offlineSearchResultsV2({
    query: 'Mesa Camp', scope: 'nearby', center: { lat: 38.573, lng: -109.55 },
    radius_meters: 2_000,
  }, places, 'explore');
  assert.deepEqual(nearby.map(result => result.result_id), ['offline:near']);
  assert.ok((nearby[0].distance_meters || 0) > 100);
  assert.ok((nearby[0].distance_meters || Infinity) < 120);

  const bounded = offlineSearchResultsV2({
    query: 'Mesa Camp', bounds: { west: -109.6, south: 38.5, east: -109.5, north: 38.7 },
  }, places, 'explore');
  assert.deepEqual(bounded.map(result => result.result_id), ['offline:near']);

  assert.deepEqual(offlineSearchResultsV2({
    query: 'Mesa Camp', scope: 'route', route_ref: 'trip:1',
  }, places, 'explore'), [], 'rows without route projection are not claimed as on-route');
});

test('presentation adapter rejects unresolved coordinates and keeps stable identity', () => {
  const unresolved: SearchResultV2 = {
    result_id: 'missing', title: 'Missing', kind: 'place', categories: [], provenance: { provider: 'trailhead', source_label: 'Place', temporary_use_only: false }, persistence_policy: 'canonical', score: 1, match_reason: 'exact',
  };
  assert.equal(searchResultV2ToLegacyPlace(unresolved), null);
  const display = searchResultV2ToDisplayPlace(unresolved);
  assert.equal(display.name, 'Missing');
  assert.equal(display.result_id, 'missing');
  assert.equal(display.lat, undefined);
  assert.equal(display.resolution_required, true);
  const place = searchResultV2ToLegacyPlace({
    result_id: 'result-1', canonical_place_id: 'place-1', title: 'Mesa Arch', subtitle: 'Canyonlands', kind: 'trailhead', categories: ['scenic'], coordinates: { lat: 38.389, lng: -109.868 }, provenance: { provider: 'trailhead', source_label: 'Trailhead', temporary_use_only: false }, persistence_policy: 'canonical', score: 10, match_reason: 'exact',
  });
  assert.equal(place?.id, 'place-1');
  assert.equal(place?.result_id, 'result-1');
  assert.equal(place?.summary, 'Canyonlands');
  assert.equal(place?.persistence_policy, 'canonical');
  assert.equal(place?.temporary_use_only, false);
});

test('presentation keeps temporary provider policy through display and legacy adapters', () => {
  const temporary: SearchResultV2 = {
    result_id: 'mapbox:moab',
    title: 'Moab',
    kind: 'place',
    categories: ['destination'],
    coordinates: { lat: 38.5733, lng: -109.5498 },
    detail_ref: 'provider:mapbox:moab:0123456789abcdef0123456789abcdef',
    provenance: {
      provider: 'mapbox',
      source_label: 'Mapbox search',
      provider_result_id: 'mapbox:moab',
      temporary_use_only: true,
    },
    persistence_policy: 'temporary',
    score: 1,
    match_reason: 'provider fallback',
  };
  const display = searchResultV2ToDisplayPlace(temporary);
  const legacy = searchResultV2ToLegacyPlace(temporary);
  assert.equal(display.persistence_policy, 'temporary');
  assert.equal(display.temporary_use_only, true);
  assert.equal(display.provider_result_id, 'mapbox:moab');
  assert.equal(display.detail_ref, temporary.detail_ref);
  assert.equal(searchPlaceIsTemporary(display), true);
  assert.equal(searchPlaceIsTemporary(legacy), true);
});

test('a resolved route destination is durable and retains required attribution', () => {
  const durable: SearchResultV2 = {
    result_id: 'geoapify:51abc123',
    title: 'Moab Information Center',
    subtitle: '25 E Center Street, Moab, Utah',
    kind: 'destination',
    categories: ['amenity', 'tourism.information'],
    coordinates: { lat: 38.5734, lng: -109.5499 },
    provenance: {
      provider: 'geoapify',
      source_label: 'Place',
      provider_result_id: '51abc123',
      attribution: 'OpenStreetMap contributors',
      temporary_use_only: false,
    },
    persistence_policy: 'durable_external',
    score: 1,
    match_reason: 'explicit_selection',
  };
  const display = searchResultV2ToDisplayPlace(durable);
  const legacy = searchResultV2ToLegacyPlace(durable);
  assert.equal(display.resolution_required, false);
  assert.equal(legacy?.persistence_policy, 'durable_external');
  assert.equal(legacy?.temporary_use_only, false);
  assert.equal(legacy?.provider_result_id, '51abc123');
  assert.equal(legacy?.source_attribution, 'OpenStreetMap contributors');
  assert.equal(searchPlaceIsTemporary(legacy), false);
});
