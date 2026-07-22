import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { OsmPoi } from '../../api';
import type { SearchV2Client } from '../../searchV2/client';
import { SearchV2SessionController } from '../../searchV2/session';
import {
  isOfflineV2CampPin,
  offlineV2CampPinToDetail,
  offlineV2PlaceToCampPin,
} from '../campDetail';
import {
  filterDownloadedSearchResultsV2,
  OFFLINE_SEARCH_INDEX_PAGE_SIZE_V2,
  offlineInstallationRevisionV2,
  offlineSearchIndexRowsToResults,
  resolveDownloadedSearchResultPoi,
  searchDownloadedOfflineIndexesV2,
} from '../offlineSearchPresentation';
import { trailGeometryRepresentativePointV2 } from '../trailGeometry';

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function main() {
  const richCamp = {
    id: 'osm_camp_node_100',
    name: 'Juniper Camp',
    lat: 38.61,
    lng: -109.57,
    type: 'camp',
    subtype: 'Primitive campground',
    source: 'trailhead_offline_v2',
    source_label: 'OpenStreetMap',
    source_badge: 'OpenStreetMap',
    description: 'A durable downloaded campground.',
    address: 'County Road 12',
    tags: ['primitive'],
    amenities: ['Vault toilets'],
    site_types: ['Tent', 'Primitive'],
    camp_types: ['Developed'],
    activities: ['Hiking', 'Stargazing'],
    campsite_count: 18,
    campsites_count: 18,
    campsites: [{
      id: 'site-a1', name: 'A1', type: 'Tent', loop: 'Juniper',
      max_people: '8', equipment_length: '28 ft', surface: 'Gravel',
      accessible: true, availability: 'available',
    }],
    max_rig_length: '35 ft',
    max_vehicle_length: '40 ft',
    max_trailer_length: '30 ft',
    max_rv_length: '38 ft',
    rig_suitability: 'Check individual sites',
    vehicle_suitability: 'Passenger vehicles and RVs',
    rig_types: ['Travel trailer'],
    vehicle_types: ['Car', 'Truck'],
    cost: '$20',
    ada: true,
    access_notes: 'Two miles of maintained gravel.',
    bail_out_notes: 'Return to County Road 12.',
    stay_limit: '14 nights',
    reservation_notes: 'Some sites are first come, first served.',
    photo_url: 'https://unlicensed.example.test/camp.jpg',
    photos: ['https://unlicensed.example.test/camp.jpg'],
    reservable: true,
    official_url: 'https://example.gov/juniper',
    booking_url: 'https://reserve.example.gov/juniper',
    reservations: {
      reservation_url: 'https://reserve.example.gov/juniper',
      reservable: true,
      required: false,
      availability: '3 sites left',
    },
    weather: { temperature: 80 },
    reports: [{ body: 'current report' }],
    current_availability: 'available',
    closures: ['temporary closure'],
  } as OsmPoi & Record<string, unknown>;

  const rows = offlineSearchIndexRowsToResults(
    [[{
      result_id: richCamp.id,
      canonical_place_id: richCamp.id,
      title: richCamp.name,
      subtitle: richCamp.subtype,
      kind: 'camp',
      lat: richCamp.lat,
      lng: richCamp.lng,
    }]],
    'map',
    10,
  );
  assert.equal(rows[0].canonical_place_id, richCamp.id);

  let networkCalls = 0;
  const unavailableClient: SearchV2Client = {
    async suggest() { networkCalls += 1; throw new Error('network must not run'); },
    async results() { networkCalls += 1; throw new Error('network must not run'); },
    async resolve() { networkCalls += 1; throw new Error('network must not run'); },
  };
  const session = new SearchV2SessionController({
    client: unavailableClient,
    context: { surface: 'map', scope: 'offline' },
    offlineProvider: () => rows,
    createSessionId: () => 'offline-search-session',
  });
  session.setQuery('Juniper');
  await flush();
  const result = session.getState().results[0];
  assert.ok(result);
  const selected = await session.resolveResult(result.result_id);
  assert.equal(networkCalls, 0, 'a coordinate-bearing offline row never calls resolve transport');
  assert.ok(selected);

  const downloaded = resolveDownloadedSearchResultPoi(selected!, [richCamp]);
  assert.equal(downloaded, richCamp, 'the pressed FTS row rejoins its complete downloaded document');
  const pin = offlineV2PlaceToCampPin(downloaded!);
  assert.ok(pin && isOfflineV2CampPin(pin));
  const detail = offlineV2CampPinToDetail(pin!);
  const durable = detail as typeof detail & Record<string, unknown>;

  assert.deepEqual(detail.site_types, ['Tent', 'Primitive']);
  assert.deepEqual(durable.camp_types, ['Developed']);
  assert.deepEqual(detail.activities, ['Hiking', 'Stargazing']);
  assert.equal(detail.campsites_count, 18);
  assert.equal(durable.campsite_count, 18);
  assert.equal(detail.campsites?.[0]?.id, 'site-a1');
  assert.equal('availability' in (detail.campsites?.[0] || {}), false);
  assert.equal(durable.max_rig_length, '35 ft');
  assert.equal(durable.max_vehicle_length, '40 ft');
  assert.equal(durable.max_trailer_length, '30 ft');
  assert.equal(durable.max_rv_length, '38 ft');
  assert.equal(durable.rig_suitability, 'Check individual sites');
  assert.equal(durable.vehicle_suitability, 'Passenger vehicles and RVs');
  assert.deepEqual(durable.rig_types, ['Travel trailer']);
  assert.deepEqual(durable.vehicle_types, ['Car', 'Truck']);
  assert.equal(detail.cost, '$20');
  assert.equal(detail.ada, true);
  assert.equal(pin?.photo_url, undefined);
  assert.deepEqual(detail.photos, []);
  assert.equal(detail.access_notes, 'Two miles of maintained gravel.');
  assert.equal(detail.bail_out_notes, 'Return to County Road 12.');
  assert.equal(detail.stay_limit, '14 nights');
  assert.equal(detail.reservation_notes, 'Some sites are first come, first served.');
  assert.deepEqual(durable.reservations, {
    reservation_url: 'https://reserve.example.gov/juniper',
    reservable: true,
    required: false,
  });
  for (const liveOnly of ['weather', 'reports', 'current_availability', 'closures', 'availability']) {
    assert.equal(liveOnly in durable, false, `${liveOnly} must remain online-only`);
  }

  const thinCanonical = {
    id: richCamp.id,
    name: richCamp.name,
    lat: richCamp.lat,
    lng: richCamp.lng,
    type: 'camp',
    subtype: 'Primitive campground',
    source: 'trailhead_offline_v2',
    source_label: 'Downloaded',
    site_types: ['Tent', 'Primitive'],
    raw: { category: 'campground', verified: true },
  } as OsmPoi & Record<string, unknown>;
  const mergedDownload = resolveDownloadedSearchResultPoi(selected!, [thinCanonical], [richCamp]);
  assert.ok(mergedDownload);
  assert.notEqual(mergedDownload, thinCanonical);
  assert.equal(mergedDownload?.source, 'trailhead_offline_v2', 'canonical identity wins');
  assert.equal(mergedDownload?.booking_url, richCamp.booking_url, 'legacy downloaded booking detail remains additive');
  assert.equal((mergedDownload as typeof richCamp).max_rig_length, '35 ft');
  assert.deepEqual((mergedDownload as typeof richCamp).photos, richCamp.photos);
  assert.deepEqual((mergedDownload as typeof richCamp).weather, richCamp.weather, 'stored legacy detail is retained for existing sheets');
  const mergedCampDetail = offlineV2CampPinToDetail(offlineV2PlaceToCampPin(mergedDownload!)!);
  assert.equal('weather' in (mergedCampDetail as typeof mergedCampDetail & Record<string, unknown>), false);
  assert.deepEqual(mergedCampDetail.photos, [], 'unlicensed legacy URLs are not promoted into V2 media claims');

  const filtered = filterDownloadedSearchResultsV2({
    query: 'Juniper', intent: 'camp', categories: ['campground'], scope: 'nearby',
    center: { lat: 38.6, lng: -109.57 }, radius_meters: 5_000,
    filters: { verified: true }, limit: 10,
  }, rows, [thinCanonical], [richCamp]);
  assert.equal(filtered.length, 1);
  assert.ok((filtered[0].distance_meters || 0) > 1_000);
  assert.ok(filtered[0].categories.includes('campground'));

  const crossingBounds = { west: -109.8, south: 38.4, east: -109.4, north: 38.8 };
  const crossingGeometry = {
    type: 'LineString',
    coordinates: [[-110.2, 38.6], [-109.1, 38.6]],
  };
  const crossingPoint = trailGeometryRepresentativePointV2(crossingGeometry, crossingBounds);
  assert.ok(crossingPoint, 'a segment crossing the bundle has an in-bounds representative point');
  assert.ok(crossingPoint![0] >= crossingBounds.west && crossingPoint![0] <= crossingBounds.east);
  assert.ok(crossingPoint![1] >= crossingBounds.south && crossingPoint![1] <= crossingBounds.north);
  const crossingTrail = {
    id: 'trail-crossing-box', name: 'Crossing Trail',
    lat: crossingPoint![1], lng: crossingPoint![0], type: 'trail',
    source: 'trailhead_offline_v2', offline_entity_kind: 'trail_profile',
    raw: { category: 'trail' },
  } as OsmPoi & { offline_entity_kind: 'trail_profile' };
  const crossingResults = offlineSearchIndexRowsToResults([[{
    result_id: crossingTrail.id,
    canonical_place_id: crossingTrail.id,
    title: crossingTrail.name,
    kind: 'trail',
    // The immutable FTS row retains the canonical anchor, which can be outside.
    lat: 37,
    lng: -111,
  }]], 'map', 10);
  const crossingFiltered = filterDownloadedSearchResultsV2({
    query: 'Crossing', intent: 'trail', bounds: crossingBounds, limit: 10,
  }, crossingResults, [crossingTrail]);
  assert.equal(crossingFiltered.length, 1);
  assert.deepEqual(crossingFiltered[0].coordinates, {
    lat: crossingTrail.lat,
    lng: crossingTrail.lng,
  }, 'search distance and opening use the in-bounds geometry point');
  assert.equal(
    resolveDownloadedSearchResultPoi(crossingFiltered[0], [crossingTrail]),
    crossingTrail,
    'the crossing trail rejoins its canonical downloaded document',
  );

  const decoyRows = Array.from({ length: 600 }, (_, index) => ({
    result_id: `decoy-${String(index).padStart(3, '0')}`,
    canonical_place_id: `decoy-${String(index).padStart(3, '0')}`,
    title: `Juniper ${String(index).padStart(3, '0')}`,
    subtitle: 'Generic place', kind: 'place', lat: 38.5, lng: -109.5,
  }));
  const validBeyondFirstPage = {
    result_id: 'camp-after-decoys', canonical_place_id: 'camp-after-decoys',
    title: 'Juniper Camp', subtitle: 'Campground', kind: 'campground',
    lat: 38.6, lng: -109.6,
  };
  const indexedDocuments = [
    ...decoyRows.map(row => ({
      id: row.result_id, name: row.title, lat: row.lat, lng: row.lng,
      type: 'poi', source: 'trailhead_offline_v2', raw: { category: 'place' },
    } as OsmPoi)),
    {
      id: validBeyondFirstPage.result_id, name: validBeyondFirstPage.title,
      lat: validBeyondFirstPage.lat, lng: validBeyondFirstPage.lng,
      type: 'camp', source: 'trailhead_offline_v2', activities: ['Hiking'],
      difficulty: 'Moderate', surface: 'Gravel',
      raw: {
        category: 'campground', activities: ['Hiking'],
        difficulty: 'Moderate', surface: 'Gravel',
      },
    } as OsmPoi,
  ];
  const pagedRows = [...decoyRows, validBeyondFirstPage];
  const offsets: number[] = [];
  const beyondFifty = await searchDownloadedOfflineIndexesV2({
    request: {
      query: 'Juniper', intent: 'camp', categories: ['campground'],
      filters: { activity: 'hiking', difficulty: 'moderate', surface: 'gravel' }, limit: 1,
    },
    surface: 'explore', indexes: [{ path: 'memory://index' }], canonical: indexedDocuments,
    queryIndex: async input => {
      offsets.push(input.offset);
      return pagedRows.slice(input.offset, input.offset + input.limit);
    },
  });
  assert.deepEqual(beyondFifty.map(item => item.canonical_place_id), ['camp-after-decoys']);
  assert.deepEqual(
    offsets,
    Array.from({ length: 13 }, (_, index) => index * OFFLINE_SEARCH_INDEX_PAGE_SIZE_V2),
    'a valid filtered result after 600 decoys is not starved by the old 500-row cap',
  );

  const globallyRankedDocuments = [
    {
      id: 'bundle-a-far', name: 'Juniper Far', lat: 39.5, lng: -109.5,
      type: 'camp', source: 'trailhead_offline_v2', raw: { category: 'campground' },
    },
    {
      id: 'bundle-b-exact', name: 'Juniper', lat: 38.7, lng: -109.5,
      type: 'camp', source: 'trailhead_offline_v2', raw: { category: 'campground' },
    },
    {
      id: 'bundle-b-near', name: 'Juniper Nearby', lat: 38.501, lng: -109.5,
      type: 'camp', source: 'trailhead_offline_v2', raw: { category: 'campground' },
    },
  ] as OsmPoi[];
  const queriedIndexes: string[] = [];
  const globallyRanked = await searchDownloadedOfflineIndexesV2({
    request: {
      query: 'Juniper', intent: 'camp', center: { lat: 38.5, lng: -109.5 }, limit: 3,
    },
    surface: 'explore',
    indexes: [{ path: 'bundle-a' }, { path: 'bundle-b' }],
    canonical: globallyRankedDocuments,
    queryIndex: async input => {
      queriedIndexes.push(input.path);
      if (input.path === 'bundle-a') {
        return [{
          result_id: 'bundle-a-far', canonical_place_id: 'bundle-a-far',
          title: 'Juniper Far', kind: 'campground', lat: 39.5, lng: -109.5, rank: -100,
        }];
      }
      return [
        {
          result_id: 'bundle-b-near', canonical_place_id: 'bundle-b-near',
          title: 'Juniper Nearby', kind: 'campground', lat: 38.501, lng: -109.5, rank: -1,
        },
        {
          result_id: 'bundle-b-exact', canonical_place_id: 'bundle-b-exact',
          title: 'Juniper', kind: 'campground', lat: 38.7, lng: -109.5, rank: -0.5,
        },
      ];
    },
  });
  assert.deepEqual(queriedIndexes, ['bundle-a', 'bundle-b']);
  assert.deepEqual(
    globallyRanked.map(item => item.canonical_place_id),
    ['bundle-b-exact', 'bundle-b-near', 'bundle-a-far'],
    'exact title wins globally, then current-region distance wins before BM25',
  );

  const wrappedWestRows = [
    ...Array.from({ length: 55 }, (_, index) => ({
      result_id: `wrapped-decoy-${index}`, canonical_place_id: `wrapped-decoy-${index}`,
      title: `Island ${index}`, subtitle: 'Generic place', kind: 'place', lat: 0, lng: -175,
    })),
    {
      result_id: 'wrapped-camp', canonical_place_id: 'wrapped-camp', title: 'Island Camp',
      subtitle: 'Campground', kind: 'campground', lat: 0, lng: -175,
    },
  ];
  const wrappedEastRows = [{
    result_id: 'wrapped-exact', canonical_place_id: 'wrapped-exact', title: 'Island',
    subtitle: 'Campground', kind: 'campground', lat: 0, lng: 175, rank: -0.1,
  }];
  const wrappedRows = [...wrappedWestRows, ...wrappedEastRows];
  const wrappedDocuments = wrappedRows.map(row => ({
    id: row.result_id, name: row.title, lat: row.lat, lng: row.lng,
    type: row.result_id === 'wrapped-camp' || row.result_id === 'wrapped-exact' ? 'camp' : 'poi',
    source: 'trailhead_offline_v2',
    raw: {
      category: row.result_id === 'wrapped-camp' || row.result_id === 'wrapped-exact'
        ? 'campground'
        : 'place',
    },
  } as OsmPoi));
  const queriedBounds: Array<[number, number, number]> = [];
  const wrapped = await searchDownloadedOfflineIndexesV2({
    request: {
      query: 'Island', intent: 'camp', limit: 2,
      bounds: { west: 170, south: -5, east: -170, north: 5 },
    },
    surface: 'map', indexes: [{ path: 'memory://wrapped' }], canonical: wrappedDocuments,
    queryIndex: async input => {
      queriedBounds.push([input.bounds?.west ?? 0, input.bounds?.east ?? 0, input.offset]);
      const source = input.bounds?.west === -180 ? wrappedWestRows : wrappedEastRows;
      return source.slice(input.offset, input.offset + input.limit);
    },
  });
  assert.deepEqual(wrapped.map(item => item.canonical_place_id), ['wrapped-exact', 'wrapped-camp']);
  assert.deepEqual(queriedBounds, [[170, 180, 0], [-180, -170, 0], [-180, -170, 50]]);

  const cappedOffsets: number[] = [];
  const capped = await searchDownloadedOfflineIndexesV2({
    request: { query: 'No camp', intent: 'camp', limit: 1 },
    surface: 'map', indexes: [{ path: 'memory://capped' }], canonical: indexedDocuments,
    scan_cap_per_partition: 100,
    queryIndex: async input => {
      cappedOffsets.push(input.offset);
      return Array.from({ length: input.limit }, (_, index) => ({
        result_id: `cap-${input.offset + index}`, canonical_place_id: `cap-${input.offset + index}`,
        title: 'No camp', kind: 'place', lat: 1, lng: 1,
      }));
    },
  });
  assert.deepEqual(capped, []);
  assert.deepEqual(cappedOffsets, [0, 50], 'the hard scan cap bounds dense filtered-out queries');

  const categoryTrailPlace = {
    id: 'place-category-trail', name: 'Scenic route note', lat: 38, lng: -109,
    type: 'trail', source: 'trailhead_offline_v2', offline_entity_kind: 'place',
  } as OsmPoi & { offline_entity_kind: 'place' };
  const categoryTrailResolved = resolveDownloadedSearchResultPoi({
    result_id: 'offline-v2:place-category-trail', canonical_place_id: 'place-category-trail',
  }, [categoryTrailPlace]);
  assert.equal(categoryTrailResolved?.offline_entity_kind, 'place');

  const installationA = {
    bundle_id: 'b', revision: '2', manifest_sha256: 'B'.repeat(64),
    installed_at_ms: 20, verified_at_ms: 21,
  };
  const installationB = {
    bundle_id: 'a', revision: '1', manifest_sha256: 'A'.repeat(64),
    installed_at_ms: 10, verified_at_ms: 11,
  };
  const revision = offlineInstallationRevisionV2([installationA, installationB]);
  assert.equal(revision, offlineInstallationRevisionV2([installationB, installationA]));
  assert.notEqual(revision, offlineInstallationRevisionV2([
    installationA,
    { ...installationB, installed_at_ms: 12 },
  ]));
  assert.equal(offlineInstallationRevisionV2([]), 'empty');

  const mapSource = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const guideSource = readFileSync('app/(tabs)/guide.tsx', 'utf8');
  const catalogSource = readFileSync('lib/offlineV2/expoCatalog.ts', 'utf8');
  const sqliteSource = readFileSync('lib/offlineV2/sqliteIndex.ts', 'utf8');
  assert.match(catalogSource, /searchDownloadedOfflineIndexesV2\(\{/);
  assert.match(catalogSource, /offline_entity_kind: fallbackType === 'trail' \? 'trail_profile' : 'place'/);
  assert.match(catalogSource, /trailGeometryRepresentativePointV2\(feature\.geometry, manifest\.bounds\)/);
  assert.match(sqliteSource, /LIMIT \? OFFSET \?/);
  assert.match(sqliteSource, /d\.title, d\.result_id/);
  assert.match(mapSource, /resolveDownloadedSearchResultPoi\([\s\S]*offlineV2Catalog\.places[\s\S]*offlinePlacePois/);
  assert.match(mapSource, /setCampDetail\(offlineV2CampPinToDetail\(downloadedCamp\)\)/);
  assert.match(guideSource, /accountInventoryRequiresCleanup\([\s\S]*previousExploreAccountInventoryScopeRef\.current/);
  assert.match(guideSource, /exploreSearchOwnerIsCurrent[\s\S]*exploreSearchOwnerScopeKey === exploreAccountInventoryScope\.key/);
  assert.match(guideSource, /accountStorage\.isCleaning\(\)[\s\S]*accountStorage\.subscribe/);
  assert.match(guideSource, /exploreOfflineInventoryRef\.current = nextInventory;[\s\S]*refreshOffline\(\)/);
  assert.match(guideSource, /offlineEntityKind === 'trail_profile'/);

  console.log('Offline V2 catalog/search/camp preservation tests passed.');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
