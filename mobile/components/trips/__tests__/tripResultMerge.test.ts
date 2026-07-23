import assert from 'node:assert/strict';
import type {
  Campsite,
  DayPlan,
  GasStation,
  TripResult,
} from '../../../lib/api';
import { mergeCanonicalAndLegacyTripResults } from '../tripResultMerge';

const logistics = {
  vehicle_recommendation: 'Legacy vehicle detail',
  fuel_strategy: 'Legacy fuel detail',
  water_strategy: 'Legacy water detail',
  permits_needed: 'Legacy permit detail',
  best_season: 'Legacy season detail',
};

function result(overrides: Partial<TripResult> & { trip_id: string }): TripResult {
  return {
    plan: overrides.plan ?? {
      trip_name: 'Trip',
      overview: 'Overview',
      duration_days: 1,
      states: [],
      total_est_miles: 0,
      waypoints: [],
      daily_itinerary: [],
      logistics,
    },
    campsites: overrides.campsites ?? [],
    gas_stations: overrides.gas_stations ?? [],
    ...overrides,
    trip_id: overrides.trip_id,
  };
}

const richLegacyDay = {
  day: 1,
  title: 'Old title',
  description: 'Old summary',
  est_miles: 87,
  road_type: 'Gravel and paved',
  highlights: ['Old stop'],
  service_window: 'Miles 21–55',
  weather_snapshot: { status: 'review' },
} as DayPlan & Record<string, unknown>;
const removedLegacyDay = {
  day: 2,
  title: 'Removed day',
  description: 'Removed summary',
  est_miles: 25,
  road_type: 'Paved',
  highlights: ['Removed stop'],
} as DayPlan;

const legacyCamp = {
  id: 'legacy-camp-id',
  name: 'Desert Camp',
  lat: 38.5,
  lng: -109.7,
  reservable: true,
  description: 'Shaded sites with vault toilets',
  url: 'https://example.test/desert-camp',
  recommended_day: 1,
  site_types: ['Tent', 'RV'],
  max_rig_length: '35 ft',
} as Campsite & Record<string, unknown>;
const removedLegacyCamp = {
  id: 'removed-camp',
  name: 'Removed Camp',
  lat: 38.1,
  lng: -109.1,
  reservable: false,
  description: 'No longer on this trip',
  url: '',
} as Campsite;
const legacyFuel = {
  id: 'legacy-fuel',
  name: 'Moab Fuel',
  lat: 38.5733,
  lng: -109.5498,
  fuel_types: 'Regular, diesel',
  address: '100 Main Street',
  price: 3.82,
  price_source: 'Station board',
} as GasStation;

const legacy = result({
  trip_id: 'legacy-id',
  plan: {
    trip_name: 'Old title',
    overview: 'Detailed legacy overview',
    duration_days: 2,
    states: ['Old region'],
    total_est_miles: 112,
    waypoints: [{
      day: 1,
      name: 'Removed stop',
      type: 'place',
      description: 'No longer current',
      land_type: 'place',
    }],
    daily_itinerary: [richLegacyDay, removedLegacyDay],
    logistics,
    route_preferences: { route_style: 'wild' },
    planner_warnings: ['Legacy warning with source detail'],
  },
  campsites: [legacyCamp, removedLegacyCamp],
  gas_stations: [legacyFuel],
  route_geometry: {
    coords: [[-109.8, 38.4], [-109.7, 38.5]],
    totalDistance: 180_000,
    source: 'legacy route',
  },
  route_pois: [{ id: 1, name: 'Rich route POI' } as never],
  timeline: {
    schema_version: 1,
    days: [{ day: 1, title: 'Rich timeline', events: [] }],
  },
  audio_guide: { intro: 'legacy-audio.mp3' },
  builder_state: {
    notes: ['Legacy note'],
    booked_tours: [{ id: 'booking-1', confirmation: 'kept-private' }],
    packing_list: ['Water', 'Recovery gear'],
    bailout: { reviewed: true },
  },
  updated_at: 10,
  version: 2,
});

const canonical = result({
  trip_id: 'canonical-id',
  plan: {
    trip_name: 'Canyons to the Sky',
    overview: 'Current canonical summary',
    duration_days: 2,
    states: ['Utah'],
    total_est_miles: 104,
    waypoints: [
      {
        day: 1,
        name: 'Desert Camp',
        type: 'camp',
        description: 'Current stop copy',
        land_type: 'camp',
        lat: 38.5,
        lng: -109.7,
      },
      {
        day: 2,
        name: 'Grand View Point',
        type: 'place',
        description: 'Current second stop',
        land_type: 'place',
      },
    ],
    daily_itinerary: [
      {
        day: 1,
        title: 'Current day one',
        description: 'Current day summary',
        est_miles: 0,
        road_type: 'Review route',
        highlights: ['Desert Camp'],
      },
      {
        day: 3,
        title: 'New day three',
        description: 'New canonical day',
        est_miles: 12,
        road_type: 'Paved',
        highlights: ['Grand View Point'],
      },
    ],
    logistics: {
      ...logistics,
      fuel_strategy: 'Generic canonical placeholder',
    },
  },
  campsites: [
    {
      id: 'canonical-camp-id',
      name: 'Desert Camp',
      lat: 38.5,
      lng: -109.7,
      reservable: false,
      description: '',
      url: '',
      recommended_day: 2,
    },
    {
      id: 'new-camp',
      name: 'New Camp',
      lat: 38.8,
      lng: -109.4,
      reservable: false,
      description: 'Added from canonical items',
      url: '',
    },
  ],
  gas_stations: [{
    id: 'canonical-fuel',
    name: 'Moab Fuel',
    lat: 38.5733,
    lng: -109.5498,
    fuel_types: '',
    address: '',
    recommended_day: 2,
  }],
  route_geometry: {
    coords: [[-109.9, 38.3], [-109.4, 38.8]],
    totalDistance: 167_000,
    source: 'canonical V2',
  },
  builder_state: {
    notes: [],
    bookings: [],
    canonical_flag: true,
  },
  updated_at: 20,
  version: 7,
});

const legacyBefore = structuredClone(legacy);
const canonicalBefore = structuredClone(canonical);
const merged = mergeCanonicalAndLegacyTripResults(canonical, legacy);

assert.equal(merged.trip_id, 'canonical-id');
assert.equal(merged.plan.trip_name, 'Canyons to the Sky');
assert.equal(merged.plan.overview, 'Current canonical summary');
assert.deepEqual(merged.plan.states, ['Utah']);
assert.deepEqual(merged.plan.waypoints, canonical.plan.waypoints, 'canonical items own stop membership');
assert.equal(merged.plan.total_est_miles, 104);
assert.deepEqual(merged.route_geometry, canonical.route_geometry, 'canonical route wins');
assert.equal(merged.updated_at, 20);
assert.equal(merged.version, 7);

assert.deepEqual(
  merged.plan.daily_itinerary.map(day => day.day),
  [1, 3],
  'canonical day membership adds and removes rows',
);
const mergedDayOne = merged.plan.daily_itinerary[0] as DayPlan & Record<string, unknown>;
assert.equal(mergedDayOne.title, 'Current day one');
assert.equal(mergedDayOne.description, 'Current day summary');
assert.deepEqual(mergedDayOne.highlights, ['Desert Camp']);
assert.equal(mergedDayOne.est_miles, 87);
assert.equal(mergedDayOne.road_type, 'Gravel and paved');
assert.equal(mergedDayOne.service_window, 'Miles 21–55');
assert.deepEqual(mergedDayOne.weather_snapshot, { status: 'review' });

assert.equal(merged.campsites.length, 2, 'canonical campsites own membership');
assert.equal(merged.campsites[0].id, 'canonical-camp-id');
assert.equal(merged.campsites[0].recommended_day, 2);
assert.equal(merged.campsites[0].description, legacyCamp.description);
assert.equal(merged.campsites[0].url, legacyCamp.url);
assert.deepEqual((merged.campsites[0] as Campsite & Record<string, unknown>).site_types, ['Tent', 'RV']);
assert.equal((merged.campsites[0] as Campsite & Record<string, unknown>).max_rig_length, '35 ft');
assert.equal(merged.campsites.some(camp => camp.id === 'removed-camp'), false);
assert.equal(merged.campsites[1].id, 'new-camp');

assert.equal(merged.gas_stations.length, 1);
assert.equal(merged.gas_stations[0].id, 'canonical-fuel');
assert.equal(merged.gas_stations[0].fuel_types, legacyFuel.fuel_types);
assert.equal(merged.gas_stations[0].address, legacyFuel.address);
assert.equal(merged.gas_stations[0].price, legacyFuel.price);
assert.equal(merged.gas_stations[0].recommended_day, 2);

assert.deepEqual(merged.route_pois, legacy.route_pois);
assert.deepEqual(merged.timeline, legacy.timeline);
assert.deepEqual(merged.audio_guide, legacy.audio_guide);
assert.deepEqual(merged.plan.route_preferences, legacy.plan.route_preferences);
assert.deepEqual(merged.plan.planner_warnings, legacy.plan.planner_warnings);
assert.deepEqual(merged.plan.logistics, legacy.plan.logistics);
assert.deepEqual(merged.builder_state?.notes, ['Legacy note']);
assert.deepEqual(merged.builder_state?.bookings, legacy.builder_state?.booked_tours);
assert.deepEqual(merged.builder_state?.booked_tours, legacy.builder_state?.booked_tours);
assert.deepEqual(merged.builder_state?.packing_list, ['Water', 'Recovery gear']);
assert.deepEqual(merged.builder_state?.bailout, { reviewed: true });
assert.equal(merged.builder_state?.canonical_flag, true);

const canonicalBuilderContent = mergeCanonicalAndLegacyTripResults({
  ...canonical,
  builder_state: {
    notes: ['Current note'],
    bookings: [{ id: 'current-booking' }],
  },
}, legacy);
assert.deepEqual(canonicalBuilderContent.builder_state?.notes, ['Current note']);
assert.deepEqual(canonicalBuilderContent.builder_state?.bookings, [{ id: 'current-booking' }]);
assert.deepEqual(canonicalBuilderContent.builder_state?.packing_list, ['Water', 'Recovery gear']);

const blankCanonicalOverview = mergeCanonicalAndLegacyTripResults({
  ...canonical,
  plan: { ...canonical.plan, overview: '' },
}, legacy);
assert.equal(
  blankCanonicalOverview.plan.overview,
  '',
  'an explicitly cleared canonical summary does not resurrect legacy copy',
);

const clearedCanonical = mergeCanonicalAndLegacyTripResults(result({
  trip_id: 'canonical-id',
  plan: {
    ...canonical.plan,
    states: [],
    total_est_miles: 0,
    waypoints: [],
    daily_itinerary: [],
  },
  campsites: [],
  gas_stations: [],
  route_geometry: undefined,
}), legacy);
assert.deepEqual(clearedCanonical.plan.states, [], 'empty canonical regions do not resurrect legacy regions');
assert.deepEqual(clearedCanonical.plan.waypoints, [], 'empty canonical items do not resurrect legacy items');
assert.deepEqual(clearedCanonical.plan.daily_itinerary, [], 'empty canonical days do not resurrect legacy days');
assert.equal(clearedCanonical.plan.total_est_miles, 0, 'cleared canonical route does not retain legacy mileage');
assert.deepEqual(clearedCanonical.campsites, [], 'empty canonical camp membership remains empty');
assert.deepEqual(clearedCanonical.gas_stations, [], 'empty canonical fuel membership remains empty');
assert.equal(clearedCanonical.route_geometry, undefined, 'cleared canonical route does not resurrect legacy geometry');

assert.deepEqual(legacy, legacyBefore, 'legacy input remains immutable');
assert.deepEqual(canonical, canonicalBefore, 'canonical input remains immutable');
