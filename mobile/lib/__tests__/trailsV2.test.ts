import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { TrailDiscoveryItemV2, TrailSystemV2 } from '../api';
import { featureFromPoi } from '../trailEngine';
import { hydrateTrailFeatureFromSystem, trailDiscoveryItemToFeature, trailSelectionMatches, trailSystemGeometry } from '../trailsV2';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mapSource = readFileSync(join(mobileRoot, 'app/(tabs)/map.tsx'), 'utf8');
const nativeMapSource = readFileSync(join(mobileRoot, 'components/NativeMap/index.tsx'), 'utf8');

const support = {
  campsNearby: 0,
  fuelNearby: 0,
  waterNearby: 0,
  reportsNearby: 0,
  offlineReady: false,
  readinessLabel: 'Download map',
};

function item(overrides: Partial<TrailDiscoveryItemV2> = {}): TrailDiscoveryItemV2 {
  return {
    version: 2,
    id: 'trail:usfs:rim',
    primary_trail_id: 'trail:usfs:rim',
    name: 'Rim Trail',
    kind: 'trail',
    center: { lat: 38, lng: -109 },
    geometry_status: 'complete',
    geometry_revision: 'sha256:abc',
    activities: ['Hiking'],
    permitted_uses: ['Hiking'],
    facts: { distance_mi: 0, elevation_gain_ft: 0, route_shape: 'Loop' },
    trailheads: [{ name: 'Rim Trailhead', lat: 38, lng: -109, source: 'US Forest Service' }],
    media: [],
    sources: [{ label: 'US Forest Service', kind: 'official' }],
    freshness: { checked_at: 123 },
    capabilities: { details: true, save: true, navigate: true, highlight: true, preview: true, download: true, build_route: true },
    detail_ref: '/api/trails/v2/trail:usfs:rim',
    preview_ref: '/api/trails/v2/trail:usfs:rim/preview',
    ...overrides,
  };
}

test('discovery adapter keeps stable identity and genuine zero facts', () => {
  const feature = trailDiscoveryItemToFeature(item(), support);

  assert.equal(feature.id, 'trail:usfs:rim');
  assert.equal(feature.profile_id, 'trail:usfs:rim');
  assert.equal(feature.system_v2_id, 'trail:usfs:rim');
  assert.equal(feature.length_mi, 0);
  assert.equal(feature.facts_v2?.elevation_gain_ft, 0);
  assert.deepEqual(feature.trailheads_v2, [{ name: 'Rim Trailhead', lat: 38, lng: -109, source: 'US Forest Service' }]);
  assert.equal(feature.subtitle, '0 mi · Loop · Hiking');
  assert.equal(feature.photo_url, null);
});

test('Community trust survives discovery and full-system hydration', () => {
  const community = {
    contributor_handle: 'ridgewalker',
    approved_contributions: 2,
    reviewed: true,
    source_verified: false,
  };
  const feature = trailDiscoveryItemToFeature(item({
    catalog: 'community',
    community,
  }), support);
  assert.equal(feature.catalog, 'community');
  assert.deepEqual(feature.community, community);

  const system = {
    ...item({ catalog: 'community', community }),
    member_trail_ids: ['trail:usfs:rim'],
    geometry: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-109, 38], [-109.1, 38.1]] } }],
    },
  } as TrailSystemV2;
  const hydrated = hydrateTrailFeatureFromSystem({ ...feature, community: undefined }, system);
  assert.equal(hydrated.catalog, 'community');
  assert.deepEqual(hydrated.community, community);
  assert.match(mapSource, /selectedTrail\.catalog === 'community' \? selectedTrail\.community : undefined/);
  assert.match(mapSource, /Community route[\s\S]*Reviewed route[\s\S]*Not source-verified/);
  assert.match(mapSource, /Verified trails use official corroboration\./);
});

test('missing facts stay absent instead of becoming zero or generic copy', () => {
  const feature = trailDiscoveryItemToFeature(item({
    geometry_status: 'point',
    facts: {},
    activities: [],
    capabilities: { details: true, save: true, navigate: true, highlight: false, preview: false, download: false, build_route: false },
  }), support);

  assert.equal(feature.length_mi, undefined);
  assert.equal(feature.difficulty, undefined);
  assert.equal(feature.subtitle, 'US Forest Service');
  assert.equal(feature.summary, undefined);
});

test('only complete resolved geometry can become the selected map route', () => {
  const complete = {
    ...item(),
    member_trail_ids: ['trail:usfs:rim'],
    geometry: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-109, 38], [-109.1, 38.1]] } }],
    },
  } as TrailSystemV2;
  const partial = { ...complete, geometry_status: 'partial' as const, capabilities: { ...complete.capabilities, highlight: false } };

  assert.ok(trailSystemGeometry(complete));
  assert.equal(trailSystemGeometry(partial), null);
  assert.equal(trailSelectionMatches(trailDiscoveryItemToFeature(item(), support), complete), true);
  assert.equal(trailSelectionMatches(trailDiscoveryItemToFeature(item({ geometry_revision: 'sha256:old' }), support), complete), false);
});

test('search POIs keep canonical Trail System identity and hydrate only a matching system', () => {
  const feature = featureFromPoi({
    id: 'search:brumley',
    name: 'Brumley Arch Trail',
    lat: 38.121,
    lng: -109.326,
    type: 'trail',
    source: 'trailhead_search',
    system_v2_id: 'trail:usfs:2102352010602',
  }, support, 'trailhead');
  assert.equal(feature?.system_v2_id, 'trail:usfs:2102352010602');

  const system = {
    ...item({ id: 'trail:usfs:2102352010602', name: 'Brumley Arch Trail' }),
    member_trail_ids: ['trail:usfs:2102352010602'],
    geometry: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-109.326, 38.121], [-109.32, 38.13]] } }],
    },
  } as TrailSystemV2;
  const hydrated = hydrateTrailFeatureFromSystem(feature!, system);
  assert.equal(hydrated.geometry_status, 'complete');
  assert.equal(hydrated.capabilities_v2?.download, true);
  assert.deepEqual(hydrated.trailheads_v2, system.trailheads);
  assert.equal(hydrateTrailFeatureFromSystem({ ...feature!, system_v2_id: 'trail:other' }, system).geometry_revision, undefined);
});

test('map selection rejects stale systems and mounts the resolved GeoJSON layer', () => {
  assert.match(mapSource, /selectedTrailRef\.current = feature;\s*setSelectedTrail\(feature\)/);
  assert.match(mapSource, /trailSystemSelectionGenerationRef/);
  assert.match(mapSource, /generation !== trailSystemSelectionGenerationRef\.current/);
  assert.match(mapSource, /trailSelectionMatches\(trail, system\)/);
  assert.match(mapSource, /highlightResolvedTrail\(geometry/);
  assert.match(mapSource, /api\.getTrailSystem\(trail\.system_v2_id\)/);
  assert.match(nativeMapSource, /id="trailhead-selected-trail"/);
  assert.match(nativeMapSource, /id="trailhead-selected-trail-finish-diamond"/);
  assert.match(nativeMapSource, /id="trailhead-follow-finish-diamond"/);
  assert.match(nativeMapSource, /textColor: '#F5C84B'/);
  assert.match(nativeMapSource, /lineColor: '#AD5A33'/);
  assert.match(nativeMapSource, /\.\.\.mapboxTopSlotProps/);
});

test('trail cards do not use generic destination photography or inferred v2 difficulty', () => {
  assert.doesNotMatch(mapSource, /TRAIL_FALLBACK_IMAGE/);
  assert.match(mapSource, /trail\.difficulty \|\| \(!trail\.system_v2_id \? trailDifficultyText\(trail\) : ''\)/);
  assert.match(mapSource, /selectedTrail\.system_v2_id \? '' : trailDifficultyText\(selectedTrail\)/);
  assert.match(mapSource, /trail\.capabilities_v2\?\.preview \? 'Preview route' : 'View details'/);
});
