import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adaptCampgroundSheet,
  adaptCommunityReportSheet,
  adaptExploreHubSheet,
  adaptGenericPlaceSheet,
  adaptTrailSheet,
  CAMPGROUND_SHEET_PARITY_MODULES,
  cleanPlaceSheetDisplayText,
  COMMUNITY_REPORT_SHEET_PARITY_MODULES,
  EXPLORE_HUB_SHEET_PARITY_MODULES,
  isCanonicalSearchPlaceSheetSource,
  isPlaceSheetSummaryRedundant,
  stablePlaceSheetEntityId,
  TRAIL_SHEET_PARITY_MODULES,
} from '../placeSheetAdapters';

test('generic place identity remains stable across enrichment updates', () => {
  const source = { id: 'nps:arches', name: 'Arches National Park', lat: 38.733, lng: -109.592, type: 'park', source_label: 'National Park Service' };
  const before = adaptGenericPlaceSheet(source);
  const after = adaptGenericPlaceSheet({ ...source, rating: 4.9, source_label: 'national_park_service' } as typeof source & { rating: number });
  assert.deepEqual(before.identity, after.identity);
  assert.equal(after.subtitle, 'National Park Service');
  assert.match(after.testID, /^place-sheet-place-/);
});

test('official display types keep their authored sentence case', () => {
  const sight = adaptGenericPlaceSheet({
    id: 'explore:place:nps-child:yose:places:anderson-cabin',
    name: 'Anderson Cabin',
    type: 'attraction',
    display_type: 'Place to see',
    source_label: 'National Park Service',
  });
  const visitorCenter = adaptGenericPlaceSheet({
    id: 'explore:place:nps-child:yose:visitorcenters:big-oak-flat-information-station',
    name: 'Big Oak Flat Information Station',
    type: 'visitor_center',
    display_type: 'Visitor Center',
    source_label: 'National Park Service',
  });
  assert.equal(sight.subtitle, 'Place to see');
  assert.equal(visitorCenter.subtitle, 'Visitor Center');
  assert.equal(cleanPlaceSheetDisplayText('place_to_see'), 'Place To See');
});

test('a summary is redundant only when full details extend the same text', () => {
  assert.equal(isPlaceSheetSummaryRedundant(
    'The information station has a wilderness permit desk.',
    'The information station has a wilderness permit desk. It is wheelchair accessible.',
  ), true);
  assert.equal(isPlaceSheetSummaryRedundant(
    'Winter activities include skiing and snowshoeing.',
    'Open December through March.',
  ), false);
  assert.equal(isPlaceSheetSummaryRedundant('Same useful text.', 'Same useful text.'), false);
});

test('trail adapter preserves trailhead identity instead of switching shells after enrichment', () => {
  const trailhead = { id: 'th-12', name: 'Devils Garden Trailhead', type: 'trailhead', source_label: 'National Park Service' };
  const before = adaptTrailSheet(trailhead);
  const after = adaptTrailSheet({ ...trailhead, subtitle: 'Parking and access' } as typeof trailhead & { subtitle: string });
  assert.equal(before.identity.kind, 'trailhead');
  assert.deepEqual(after.identity, before.identity);
  assert.equal(after.title, 'Devils Garden Trailhead');
  assert.deepEqual(after.parityModules, TRAIL_SHEET_PARITY_MODULES);
});

test('community report and Explore hub use distinct stable shells', () => {
  const report = adaptCommunityReportSheet({ id: 81, name: 'Washout reported', type: 'road_condition' });
  const hub = adaptExploreHubSheet({ id: 'nps:cany', name: 'Canyonlands National Park', source_label: 'National Park Service' });
  assert.equal(report.identity.kind, 'community_report');
  assert.equal(report.subtitle, 'Road Condition');
  assert.deepEqual(report.parityModules, COMMUNITY_REPORT_SHEET_PARITY_MODULES);
  assert.equal(hub.identity.kind, 'explore_hub');
  assert.equal(hub.subtitle, 'National Park Service');
  assert.deepEqual(hub.parityModules, EXPLORE_HUB_SHEET_PARITY_MODULES);
  assert.notDeepEqual(report.identity, hub.identity);
});

test('coordinate fallback is deterministic and separates entity kinds', () => {
  const source = { name: 'Mesa View', lat: 38.123456, lng: -109.654321 };
  assert.equal(stablePlaceSheetEntityId('place', source), 'place:mesa-view:38.12346:-109.65432');
  assert.equal(stablePlaceSheetEntityId('camp', source), 'camp:mesa-view:38.12346:-109.65432');
});

test('canonical Search V2 place identity is protected during sheet enrichment', () => {
  assert.equal(isCanonicalSearchPlaceSheetSource({
    id: 'place:nps:yell',
    place_id: 'place:nps:yell',
    source: 'trailhead_search',
    persistence_policy: 'canonical',
    type: 'park',
  }), true);
  assert.equal(isCanonicalSearchPlaceSheetSource({
    id: 'provider:mapbox:place.yellowstone',
    source: 'mapbox',
    persistence_policy: 'temporary',
    type: 'place',
  }), false);
});

test('campground adapter preserves the full release-gate module contract', () => {
  const camp = { id: 'camp-42', name: 'Juniper Campground', type: 'campground', source_badge: 'National Park Service' };
  const model = adaptCampgroundSheet(camp);
  assert.equal(model.identity.kind, 'camp');
  assert.equal(model.source, camp);
  assert.deepEqual(model.parityModules, CAMPGROUND_SHEET_PARITY_MODULES);
  assert.deepEqual(model.parityModules, [
    'photos', 'booking', 'site_types', 'site_counts', 'rig_suitability', 'mobile_coverage', 'weather',
    'activities', 'comments', 'source_reviews', 'field_reports', 'edits', 'reporting', 'coordinates', 'official_links',
  ]);
});
