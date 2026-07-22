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
  offlineSearchIndexRowsToResults,
  resolveDownloadedSearchResultPoi,
} from '../offlineSearchPresentation';

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

  const mapSource = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const catalogSource = readFileSync('lib/offlineV2/expoCatalog.ts', 'utf8');
  assert.match(catalogSource, /offlineSearchIndexRowsToResults\(rows\.map\(group => group\.rows\), surface, limit\)/);
  assert.match(mapSource, /resolveDownloadedSearchResultPoi\([\s\S]*offlineV2Catalog\.places[\s\S]*offlinePlacePois/);
  assert.match(mapSource, /setCampDetail\(offlineV2CampPinToDetail\(downloadedCamp\)\)/);

  console.log('Offline V2 catalog/search/camp preservation tests passed.');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
