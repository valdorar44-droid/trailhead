import {
  mergePersistedRouteStops,
  readPersistedRouteBuilderState,
  samePersistedStopIdentity,
} from '../persistence';

function assertPersistenceContract(condition: boolean, message: string) {
  if (!condition) throw new Error(`Route Builder persistence contract failed: ${message}`);
}

const restored = readPersistedRouteBuilderState({
  stops: [
    {
      id: 'start-1', day: 1, name: 'Moab', lat: 38.5733, lng: -109.5498, type: 'start',
      description: 'Saved start', land_type: 'town', routeShapeRole: 'start',
    },
    {
      id: 'tour-1', day: 2, name: 'Canyon tour', lat: 38.61, lng: -109.59, type: 'waypoint',
      description: 'Saved tour', land_type: 'experience', source: 'poi', routePointType: 'side_stop',
      poi: { id: 'tour-1', name: 'Canyon tour', lat: 38.61, lng: -109.59, type: 'attraction', booking_url: 'https://example.com/tour' },
    },
    {
      id: 'fuel-1', day: 2, name: 'Fuel stop', lat: 38.7, lng: -109.7, type: 'fuel',
      description: 'Saved fuel', land_type: 'town', source: 'gas', routePointType: 'side_stop',
      gas: { id: 'station-1', name: 'Fuel stop', lat: 38.7, lng: -109.7, price: 3.79 },
    },
    {
      id: 'camp-1', day: 3, name: 'River camp', lat: 38.8, lng: -109.8, type: 'camp',
      description: 'Saved camp', land_type: 'BLM', source: 'camp',
      camp: { id: 'camp-1', name: 'River camp', lat: 38.8, lng: -109.8, photo_url: 'https://example.com/camp.jpg' },
    },
    { id: 'broken', day: 3, name: 'Broken stop', lat: 'not-a-number', lng: -110, type: 'camp' },
  ],
  days: [3, 1, 2, 2],
  routeStyle: 'wild',
  tripShapeMode: 'there_and_back',
  driveHoursPerDay: '6',
  plannedDays: '3',
  tripBuildMode: 'blank',
  distanceMode: 'miles',
  targetMiles: '215',
  restDays: [2],
  dayDriveTargets: { 1: '5', 3: 7 },
  activePlaceFilters: ['fuel', 'water', 'fuel'],
  campPreferenceMode: 'private',
  campPhotoOnly: true,
  campCadenceMode: 'manual',
  campReusePolicy: 'same_camp_window',
});

assertPersistenceContract(restored?.stops.length === 4, 'malformed stops are dropped without discarding valid stops');
assertPersistenceContract(restored?.days?.join('|') === '1|2|3', 'route days are restored in order');
assertPersistenceContract(restored?.routeStyle === 'wild' && restored.distanceMode === 'miles', 'route settings are restored');
assertPersistenceContract(restored?.targetMiles === '215' && restored.dayDriveTargets?.[3] === '7', 'drive targets are restored');
assertPersistenceContract(restored?.campPreferenceMode === 'private' && restored.campPhotoOnly === true, 'camp settings are restored');
assertPersistenceContract(
  (restored?.stops[1].poi as { booking_url?: string } | undefined)?.booking_url === 'https://example.com/tour',
  'nested tour metadata is preserved',
);
assertPersistenceContract((restored?.stops[2].gas as { price?: number } | undefined)?.price === 3.79, 'nested fuel metadata is preserved');
assertPersistenceContract(
  (restored?.stops[3].camp as { photo_url?: string } | undefined)?.photo_url === 'https://example.com/camp.jpg',
  'nested camp metadata is preserved',
);

const sameNameFuelStops = mergePersistedRouteStops<{
  id: string;
  day: number;
  name: string;
  lat: number;
  lng: number;
  type: string;
  gas?: { id: string };
}>([], [
  { id: 'fuel-a', day: 1, name: 'Shell', lat: 38.2, lng: -110.1, type: 'fuel', gas: { id: 'station-a' } },
  { id: 'fuel-b', day: 1, name: 'Shell', lat: 38.8, lng: -110.7, type: 'fuel', gas: { id: 'station-b' } },
]);

assertPersistenceContract(sameNameFuelStops.length === 2, 'same-name fuel stops at different locations remain distinct');
assertPersistenceContract(
  samePersistedStopIdentity(
    sameNameFuelStops[0],
    { id: 'legacy-a', day: 1, lat: 40, lng: -112, type: 'fuel', gas: { id: 'station-a' } },
  ),
  'canonical provider ids identify saved stops',
);
assertPersistenceContract(
  !samePersistedStopIdentity(
    sameNameFuelStops[0],
    { id: 'return-a', day: 3, lat: 38.2, lng: -110.1, type: 'fuel', gas: { id: 'station-a' } },
  ),
  'the same provider visited on a different day remains a separate route occurrence',
);
assertPersistenceContract(
  !samePersistedStopIdentity(
    sameNameFuelStops[0],
    { id: 'other-station', day: 1, lat: 38.2001, lng: -110.1001, type: 'fuel', gas: { id: 'station-b' } },
  ),
  'different provider ids are not merged solely by proximity',
);
assertPersistenceContract(
  !samePersistedStopIdentity(
    { id: 'camp-near-fuel', day: 1, lat: 38.2, lng: -110.1, type: 'camp' },
    { id: 'fuel-near-camp', day: 1, lat: 38.2001, lng: -110.1001, type: 'fuel' },
  ),
  'co-located stops with different route roles remain distinct',
);
assertPersistenceContract(
  mergePersistedRouteStops(sameNameFuelStops, [
    { id: 'legacy-near-a', day: 1, name: 'Different label', lat: 38.2001, lng: -110.1001, type: 'fuel' },
  ]).length === 2,
  'coordinate and day matching removes a legacy duplicate',
);

const durableExternal = readPersistedRouteBuilderState({
  stops: [{
    id: 'durable-place',
    day: 1,
    name: 'Moab Information Center',
    lat: 38.5734,
    lng: -109.5499,
    type: 'waypoint',
    description: 'Saved stop',
    land_type: 'route',
    source: 'search',
    persistence_policy: 'durable_external',
    temporary_use_only: false,
    search_provider: 'geoapify',
    provider_result_id: '51abc123',
    source_attribution: 'OpenStreetMap contributors',
  }],
});
assertPersistenceContract(
  durableExternal?.stops[0].persistence_policy === 'durable_external'
    && durableExternal.stops[0].provider_result_id === '51abc123'
    && durableExternal.stops[0].source_attribution === 'OpenStreetMap contributors',
  'resolved external destination identity and attribution survive route draft reload',
);

console.log('Route Builder persistence contract passed.');
