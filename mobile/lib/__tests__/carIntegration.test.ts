import type { TripResult } from '../api';
import {
  buildCarAccountState,
  buildCarNavigationSnapshot,
  type CarOriginalDriveInput,
  type CarTrailFollowInput,
} from '../carIntegration';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`car integration contract failed: ${message}`);
}

const now = 1_800_000_000_000;
const account = buildCarAccountState({ id: 42 }, true, now);
assert(account.accountId === '42', 'signed-in account ID is available to the car app');
assert(account.reportsEnabled, 'reporting is enabled for an unrestricted signed-in account');
assert(!account.copilotEnabled, 'Co-Pilot remains unavailable without Explorer');

const explorerAccount = buildCarAccountState({ id: 42 }, true, now, true);
assert(explorerAccount.copilotEnabled, 'Co-Pilot is available to a signed-in Explorer account');
assert(explorerAccount.copilotDisabledReason === null, 'Explorer Co-Pilot has no disabled reason');

const restricted = buildCarAccountState({
  id: 42,
  reporting_restricted_until: Math.floor(now / 1000) + 300,
}, true, now);
assert(!restricted.reportsEnabled, 'second-based reporting restrictions are honored');
assert(restricted.reportsDisabledReason === 'temporarily_restricted', 'restriction reason is explicit');

const trip = {
  trip_id: 'trip-42',
  plan: {
    trip_name: 'Moab weekend',
    overview: 'Two nights on the trail.',
    duration_days: 2,
    states: ['UT'],
    total_est_miles: 120,
    waypoints: [
      { day: 1, name: 'Moab', type: 'start', description: 'Start', land_type: 'town', lat: 38.5733, lng: -109.5498 },
      { day: 1, name: 'Camp', type: 'camp', description: 'Night one', land_type: 'blm', lat: 38.62, lng: -109.71, route_point_type: 'through' },
      { day: 1, name: 'Scenic detour', type: 'poi', description: 'Optional', land_type: '', lat: 38.61, lng: -109.68, route_point_type: 'side_stop' },
      { day: 2, name: 'Missing coordinate', type: 'stop', description: '', land_type: '' },
    ],
    daily_itinerary: [],
    logistics: {
      vehicle_recommendation: '',
      fuel_strategy: '',
      water_strategy: '',
      permits_needed: '',
      best_season: '',
    },
    timeline: {
      schema_version: 1,
      days: [],
      offline_readiness: {
        map: true,
        navigation: true,
        places: false,
        topo: true,
        trails: true,
        trip_download: true,
        message: 'Places still need a download.',
      },
    },
  },
  campsites: [],
  gas_stations: [],
  route_geometry: {
    coords: [
      [-109.5498, 38.5733],
      [-109.62, 38.59],
      [-109.71, 38.62],
    ],
    steps: [
      { type: 'depart', modifier: 'straight', name: 'Main Street', distance: 100, duration: 12, lat: 38.5733, lng: -109.5498 },
      { type: 'turn', modifier: 'right', name: 'Sand Flats Road', distance: 2100, duration: 240, instruction: 'Turn right onto Sand Flats Road' },
    ],
    legs: [[
      { type: 'depart', modifier: 'straight', name: 'Main Street', distance: 100, duration: 12 },
    ]],
    totalDistance: 2200,
    totalDuration: 252,
    source: 'trailhead',
  },
} as TripResult;

const road = buildCarNavigationSnapshot({
  trip,
  account,
  mapboxAccessToken: 'pk.trailhead-public-map-token',
}, null, now);
assert(road.schemaVersion === 1, 'schema is versioned');
assert(road.updatedAt === now, 'snapshot timestamp uses the supplied clock');
assert(road.navigation?.mode === 'road_preview', 'saved road routes use road preview mode');
assert(road.navigation?.coords.length === 3, 'all stored road geometry is handed to the car app');
assert(road.navigation?.coords[1][0] === -109.62, 'road geometry order and precision are preserved');
assert(road.navigation?.steps[1]?.distanceM === 2100, 'maneuver distance is normalized to metres');
assert(road.navigation?.steps[1]?.durationS === 240, 'maneuver duration is normalized to seconds');
assert(road.navigation?.totalDistanceM === 2200, 'persisted route distance remains authoritative');
assert(road.navigation?.totalDurationS === 252, 'persisted route duration remains authoritative');
assert(road.stops.length === 2, 'only stops with valid coordinates are exposed');
assert(!road.stops.some(stop => stop.name === 'Scenic detour'), 'optional side stops cannot block route arrival order');
assert(road.stops[1]?.routePointType === 'through', 'stop routing intent is preserved');
assert(road.offlineReadiness.status === 'needs_download', 'partial offline coverage is not labeled ready');
assert(road.offlineReadiness.places === false, 'each real offline readiness flag is retained');
assert(road.mapboxAccessToken === 'pk.trailhead-public-map-token', 'the public map token is available to the native map renderer');

const trailCoords: [number, number][] = [
  [-109.71, 38.62],
  [-109.7123456, 38.6234567],
  [-109.72, 38.63],
];
const trailFollow: CarTrailFollowInput = {
  mode: 'trail_follow_active',
  trailId: 'fins-things',
  title: 'Fins and Things',
  summary: 'Follow the selected line.',
  coords: trailCoords,
  steps: [
    { type: 'depart', modifier: 'straight', name: 'Fins and Things', distance: 0, duration: 0 },
    { type: 'continue', modifier: 'straight', name: 'Follow route', distance: 5000, duration: 3600 },
  ],
  totalDistanceM: 5000,
  totalDurationS: 3600,
  offlineReady: true,
  offlineMessage: 'Trail is saved for offline follow.',
};
const trail = buildCarNavigationSnapshot({ trip, account }, trailFollow, now + 1);
assert(trail.navigation?.mode === 'trail_follow_active', 'active Trail Follow mode replaces the road preview');
assert(trail.navigation?.routeId === 'trail:fins-things', 'Trail Follow has a stable route identity');
assert(JSON.stringify(trail.navigation?.coords) === JSON.stringify(trailCoords), 'Trail Follow keeps the exact selected coordinates');
assert(trail.navigation?.steps.length === 2, 'Trail Follow maneuvers are persisted');
assert(trail.stops.length === 0, 'Trail Follow does not inherit stops from an unrelated road trip');
assert(trail.offlineReadiness.navigation === true, 'the persisted Trail Follow line is navigation-ready');
assert(trail.offlineReadiness.trails === true, 'saved trail readiness is retained');

const trailPreview = buildCarNavigationSnapshot({ trip, account }, {
  ...trailFollow,
  mode: 'trail_follow_preview',
}, now + 2);
assert(trailPreview.navigation?.mode === 'trail_follow_preview', 'Trail Follow preview remains distinct from active guidance');

const originalDrive: CarOriginalDriveInput = {
  packId: 'original-moab',
  version: 1,
  manifestId: 'manifest-moab-v1',
  title: 'Moab: Canyons to the Sky',
  summary: '11 stories · audio plays on your phone',
  coords: trailCoords,
  totalDistanceM: 104_569,
  totalDurationS: 14_400,
  offlineReady: true,
  offlineMessage: 'Original route and stories are saved on this phone.',
};
const original = buildCarNavigationSnapshot({ trip, account }, trailFollow, now + 3, originalDrive);
assert(original.navigation?.mode === 'original_drive_active', 'an active Original has an explicit car display mode');
assert(original.navigation?.routeId === 'original:original-moab:v1:manifest-moab-v1', 'the Original car route is version pinned');
assert(original.navigation?.source === 'trailhead_original', 'the car snapshot preserves first-party provenance');
assert(JSON.stringify(original.navigation?.coords) === JSON.stringify(trailCoords), 'the exact authored Original route is shown in the car');
assert(original.navigation?.steps.length === 1, 'the car receives display guidance without fabricated turns');
assert(original.navigation?.steps[0]?.instruction === 'Continue on the Original route', 'the car does not invent turn instructions');
assert(original.stops.length === 0, 'story triggers never become distracting car arrival stops');
assert(original.offlineReadiness.status === 'ready', 'a verified Original is marked ready for car display');
assert(original.offlineReadiness.map === true, 'the verified Original map bundle is retained');
assert(original.offlineReadiness.navigation === true, 'the authored route is available offline');

const serialized = JSON.stringify(trail);
assert(!serialized.includes('Bearer'), 'snapshot never contains a bearer credential');
assert(!serialized.includes('secret-auth-token'), 'snapshot never contains an account credential');
assert(!serialized.includes('@'), 'snapshot does not expose the account email');

const signedOut = buildCarNavigationSnapshot({
  trip: null,
  account: buildCarAccountState({ id: 42 }, false, now),
}, null, now);
assert(signedOut.account.accountId == null, 'signed-out snapshots do not expose the former account ID');
assert(!signedOut.account.reportsEnabled, 'signed-out reporting is disabled');
assert(signedOut.navigation == null, 'a missing active trip does not manufacture a route');

console.log('car integration tests passed');
