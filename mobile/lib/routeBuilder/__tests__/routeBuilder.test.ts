import {
  buildRouteLocationsForShape,
  buildRouteBuilderSession,
  computeDaySegmentsFromRouteGeometry,
  computeTripReadiness,
  filterDurableNavigationStops,
  rebalanceAfterCampSelection,
  ROUTE_BUILDER_AUDIT_MATRIX,
} from '@/lib/routeBuilder';
import { normalizeTrailheadRouteBuilderDraft } from '@/lib/copilotCapabilities';
import { computeOfflineReadiness } from '@/lib/offlineReadiness';

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
  { day: 1, name: 'Day 1 overnight area', lat: 38, lng: -110, type: 'waypoint', source: 'map', routeShapeRole: 'outbound_anchor' },
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
assertRouteBuilderContract(
  computeDaySegmentsFromRouteGeometry({
    geometry: {
      coords: [[-109.5498, 38.5733], [-121.8081, 36.2704], [-109.5498, 38.5733]],
      totalDistanceMi: 1400,
      totalDurationHours: 32,
      source: 'provider',
      confidence: 'high',
    },
    days: [1, 2, 3, 4, 5],
    defaultMaxDriveHours: 8,
    shape: 'there_and_back',
  }).some(segment => segment.routeShapeRole === 'return'),
  'there-and-back day role segmentation',
);

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

const session = buildRouteBuilderSession({
  intent: {
    shape: 'there_and_back',
    routeStyle: 'wild',
    campReusePolicy: 'same_camp_window',
    days: [1, 2],
    maxDriveHoursPerDay: 5,
  },
  stops: [
    { day: 1, name: 'Moab', lat: moab.lat, lng: moab.lng, type: 'start', routeShapeRole: 'start' },
    { day: 1, name: 'Day 1 overnight area', lat: 38, lng: -110, type: 'waypoint', source: 'map', routeShapeRole: 'outbound_anchor' },
    { day: 2, name: 'Big Sur', lat: bigSur.lat, lng: bigSur.lng, type: 'waypoint', routeShapeRole: 'destination' },
  ],
  geometry: {
    coords: [[-109.5498, 38.5733], [-121.8081, 36.2704], [-109.5498, 38.5733]],
    totalDistanceMi: 1400,
    totalDurationHours: 32,
    source: 'provider',
    confidence: 'medium',
    engine: 'osrm-fallback',
  },
  dayNeedsOvernight: day => day === 1,
});
assertRouteBuilderContract(session.temporaryAnchors.length === 1, 'session tracks temporary anchors');
assertRouteBuilderContract(session.issues.some(issue => issue.code === 'provider_route_low_confidence'), 'session flags fallback routing');
assertRouteBuilderContract(!session.navigationReady, 'temporary anchor blocks navigation readiness');

const rebalanced = rebalanceAfterCampSelection({
  selectedDay: 1,
  selectedCamp: { day: 1, name: 'Selected Camp', lat: 38, lng: -110, type: 'camp' },
  finalStop: { day: 4, name: 'Big Sur', lat: bigSur.lat, lng: bigSur.lng, type: 'waypoint' },
  stops: [
    { day: 1, name: 'Moab', lat: moab.lat, lng: moab.lng, type: 'start', routeShapeRole: 'start' },
    { day: 1, name: 'Selected Camp', lat: 38, lng: -110, type: 'camp' },
    { day: 2, name: 'Day 2 overnight area', lat: 37, lng: -112, type: 'waypoint', source: 'map', routeShapeRole: 'outbound_anchor' },
    { day: 3, name: 'Day 3 overnight area', lat: 36.5, lng: -118, type: 'waypoint', source: 'map', routeShapeRole: 'outbound_anchor' },
    { day: 4, name: 'Big Sur', lat: bigSur.lat, lng: bigSur.lng, type: 'waypoint', routeShapeRole: 'destination' },
  ],
});
const updatedDayTwo = rebalanced.find(stop => stop.day === 2 && /overnight area/i.test(stop.name));
assertRouteBuilderContract(!!updatedDayTwo && updatedDayTwo.lat !== 37 && /Updated after selecting/i.test((updatedDayTwo as { description?: string }).description ?? ''), 'selected camp rebalances downstream targets');
assertRouteBuilderContract(rebalanced.some(stop => stop.day === 1 && stop.type === 'camp' && stop.name === 'Selected Camp'), 'selected camp remains day endpoint');

const thereBackRebalanced = rebalanceAfterCampSelection({
  selectedDay: 3,
  selectedCamp: { day: 3, name: 'Turnaround Camp', lat: 37.1, lng: -116.2, type: 'camp', routeShapeRole: 'overnight' },
  finalStop: { day: 7, name: 'Moab return', lat: moab.lat, lng: moab.lng, type: 'start', routeShapeRole: 'return_anchor' },
  stops: [
    { day: 1, name: 'Moab', lat: moab.lat, lng: moab.lng, type: 'start', routeShapeRole: 'start' },
    { day: 3, name: 'Turnaround Camp', lat: 37.1, lng: -116.2, type: 'camp', routeShapeRole: 'overnight' },
    { day: 4, name: 'Day 4 overnight area', lat: 36.7, lng: -117.5, type: 'waypoint', source: 'map', routeShapeRole: 'outbound_anchor' },
    { day: 5, name: 'Day 5 overnight area', lat: 37.4, lng: -114, type: 'waypoint', source: 'map', routeShapeRole: 'outbound_anchor' },
    { day: 7, name: 'Moab return', lat: moab.lat, lng: moab.lng, type: 'start', routeShapeRole: 'return_anchor' },
  ],
});
assertRouteBuilderContract(
  thereBackRebalanced.some(stop => stop.day === 4 && stop.lng !== -117.5),
  'there-and-back rebalances return days after camp selection',
);

const noRouteSession = buildRouteBuilderSession({
  intent: {
    shape: 'one_way',
    routeStyle: 'balanced',
    campReusePolicy: 'different_each_night',
    days: [1],
  },
  stops: [
    { day: 1, name: 'Moab', lat: moab.lat, lng: moab.lng, type: 'start' },
    { day: 1, name: 'Big Sur', lat: bigSur.lat, lng: bigSur.lng, type: 'waypoint' },
  ],
  geometry: { coords: [], totalDistanceMi: 0, totalDurationHours: 0, source: 'none', confidence: 'none' },
  dayNeedsOvernight: () => false,
});
assertRouteBuilderContract(!noRouteSession.navigationReady && noRouteSession.issues.some(issue => issue.code === 'provider_route_missing'), 'no-route state blocks navigation readiness');

const offline = computeOfflineReadiness({
  points: [moab, bigSur],
  getMapState: id => ({ status: id === 'ut' || id === 'ca' ? 'complete' : 'idle' }),
  getRoutingState: id => ({ status: id === 'ut' ? 'complete' : 'idle' }),
  getContourState: () => ({ status: 'idle' }),
  getTrailState: () => ({ status: 'idle' }),
  placesReady: true,
});
assertRouteBuilderContract(offline.regionIds.includes('ut') && offline.regionIds.includes('ca'), 'offline readiness finds route regions');
assertRouteBuilderContract(!offline.ready && offline.rows.some(row => row.key === 'navigation' && !row.ready), 'offline readiness reports missing downloads');

assertRouteBuilderContract(ROUTE_BUILDER_AUDIT_MATRIX.some(item => /Moab to Big Sur/.test(item) && /there and back/.test(item)), 'Moab to Big Sur audit coverage');
assertRouteBuilderContract(ROUTE_BUILDER_AUDIT_MATRIX.some(item => /wild but safe/.test(item) && /high-clearance/.test(item)), 'copilot rough-road audit coverage');

const normalizedDraft = normalizeTrailheadRouteBuilderDraft({
  start: 'Moab',
  destination: 'Big Sur',
  days: 5,
  routeStyle: 'wild_but_safe',
  campPreference: 'primitive',
  roadPreference: 'high_clearance',
  riskTolerance: 'wild_but_safe',
  poiPreferences: ['park', 'monument', 'trailhead', 'invalid'],
  handoff: 'scout_review',
  scoutSummary: {
    message: 'Route scout ready for review.',
    totalMiles: 951.4,
    reviewDays: [2],
    lockedStopCount: 2,
    dayPlans: [
      { day: 1, title: 'Day 1 overnight', status: 'locked', campName: 'Castle Rock Campground', campStatus: 'locked', campMeta: 'BLM campground' },
      { day: 5, title: 'Day 5 Big Sur camp', status: 'review', campName: 'Big Sur review area', campStatus: 'review', reviewNotes: ['Verify final camp near Big Sur.'] },
    ],
  },
});
assertRouteBuilderContract(normalizedDraft.routeStyle === 'wild', 'copilot draft maps wild_but_safe route style');
assertRouteBuilderContract(normalizedDraft.campPreference === 'public', 'copilot draft maps primitive to public camp preference');
assertRouteBuilderContract(normalizedDraft.roadPreference === 'high_clearance', 'copilot draft keeps road preference');
assertRouteBuilderContract(normalizedDraft.riskTolerance === 'wild_but_safe', 'copilot draft keeps risk tolerance');
assertRouteBuilderContract((normalizedDraft.poiPreferences || []).join('|') === 'park|monument|trailhead', 'copilot draft filters poi preferences');
assertRouteBuilderContract(normalizedDraft.handoff === 'scout_review', 'copilot draft keeps scout handoff');
assertRouteBuilderContract(normalizedDraft.scoutSummary?.totalMiles === 951, 'copilot draft keeps rounded scout miles');
assertRouteBuilderContract(normalizedDraft.scoutSummary?.dayPlans?.length === 2, 'copilot draft keeps scout day plans');

const establishedDraft = normalizeTrailheadRouteBuilderDraft({
  start: 'Moab',
  destination: 'Big Sur',
  campPreference: 'established',
});
assertRouteBuilderContract(establishedDraft.campPreference === 'developed', 'copilot draft maps established camp preference to developed');

export const routeBuilderContractCases = {
  oneWay,
  loop,
  thereAndBack,
  durableStops,
  daySegments,
  readiness,
  session,
};
