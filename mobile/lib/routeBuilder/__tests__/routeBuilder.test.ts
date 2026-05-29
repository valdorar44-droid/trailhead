import {
  buildRouteLocationsForShape,
  computeDaySegmentsFromRouteGeometry,
  computeTripReadiness,
  filterDurableNavigationStops,
  ROUTE_BUILDER_AUDIT_MATRIX,
} from '@/lib/routeBuilder';

const moab = { lat: 38.5733, lng: -109.5498 };
const bigSur = { lat: 36.2704, lng: -121.8081 };

function assertRouteBuilderContract(condition: boolean, message: string) {
  if (!condition) throw new Error(`Route Builder contract failed: ${message}`);
}

const oneWay = buildRouteLocationsForShape({ shape: 'one_way', start: moab, destination: bigSur });
assertRouteBuilderContract(oneWay.length === 2 && oneWay[0].role === 'start' && oneWay[1].role === 'destination', 'one-way location expansion');

const loop = buildRouteLocationsForShape({ shape: 'loop', start: moab, destination: bigSur });
assertRouteBuilderContract(loop.length === 5 && loop.some(loc => loc.role === 'outbound_anchor') && loop.some(loc => loc.role === 'return_anchor'), 'loop location expansion');

const thereAndBack = buildRouteLocationsForShape({ shape: 'there_and_back', start: moab, destination: bigSur });
assertRouteBuilderContract(thereAndBack.length === 3 && thereAndBack[2].role === 'return_anchor', 'there-and-back location expansion');

const durableStops = filterDurableNavigationStops([
  { day: 1, name: 'Moab', lat: moab.lat, lng: moab.lng, type: 'start', routeShapeRole: 'start' },
  { day: 1, name: 'Day 1 camp search area', lat: 38, lng: -110, type: 'waypoint', source: 'map', routeShapeRole: 'outbound_anchor' },
  { day: 1, name: 'Fuel', lat: 38.2, lng: -110.1, type: 'fuel' },
  { day: 1, name: 'Viewpoint', lat: 38.3, lng: -110.2, type: 'waypoint', routePointType: 'side_stop' },
  { day: 2, name: 'Camp', lat: 37.9, lng: -111, type: 'camp' },
]);
assertRouteBuilderContract(durableStops.map(stop => stop.name).join('|') === 'Moab|Fuel|Camp', 'durable stop filtering');

const daySegments = computeDaySegmentsFromRouteGeometry({
  geometry: {
    coords: [[-109.5498, 38.5733], [-115, 37.5], [-121.8081, 36.2704]],
    totalDistanceMi: 700,
    totalDurationHours: 16,
    source: 'provider',
    confidence: 'high',
  },
  days: [1, 2, 3, 4],
  defaultMaxDriveHours: 5,
});
assertRouteBuilderContract(daySegments.length === 4 && daySegments[0].providerDistanceMi === 175, 'provider day segmentation');

const readiness = computeTripReadiness({
  stops: durableStops,
  geometry: {
    coords: [[-109.5498, 38.5733], [-121.8081, 36.2704]],
    totalDistanceMi: 700,
    totalDurationHours: 16,
    source: 'provider',
    confidence: 'high',
  },
  daySegments,
  days: [1, 2],
  dayNeedsOvernight: day => day === 1,
  fuelRangeMi: 300,
});
assertRouteBuilderContract(readiness.tasks.some(task => task.label === 'Fuel' && task.level === 'warn'), 'fuel readiness warning');

assertRouteBuilderContract(ROUTE_BUILDER_AUDIT_MATRIX.some(item => /Moab to Big Sur/.test(item) && /there and back/.test(item)), 'Moab to Big Sur audit coverage');

export const routeBuilderContractCases = {
  oneWay,
  loop,
  thereAndBack,
  durableStops,
  daySegments,
  readiness,
};
