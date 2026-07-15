#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const layout = source('app/(tabs)/_layout.tsx');
const tabBar = source('components/trips/TripsTabBar.tsx');
const switcher = source('components/plan/PlanWorkspaceSwitcher.tsx');
const plan = source('app/(tabs)/plan.tsx');
const routeBuilder = source('app/(tabs)/route-builder.tsx');
const map = source('app/(tabs)/map.tsx');
const routeBuildProgress = source('components/map/RouteBuildProgressSheet.tsx');
const routeActivityOffer = source('components/routeBuilder/RouteActivityOfferSheet.tsx');
const routeActivityLogic = source('lib/routeActivityOffer.ts');
const trips = source('app/(tabs)/trips.tsx');
const guide = source('app/(tabs)/guide.tsx');
const profile = source('app/(tabs)/profile.tsx');
const api = source('lib/api.ts');

assert(
  tabBar.includes("const VISIBLE_ROUTE_NAMES = ['guide', 'plan', 'map', 'report', 'profile'] as const"),
  'bottom navigation keeps Explore, Plan, Map, Reports, and Profile in order',
);
assert(tabBar.includes("const PLAN_CHILD_ROUTES = new Set(['route-builder', 'trips'])"),
  'Route Builder and Trips keep Plan selected in bottom navigation');
assert(
  tabBar.includes('export function tripsTabBarWebClearance(bottomInset: number)')
    && tabBar.includes('TAB_BAR_CONTENT_HEIGHT + Math.max(bottomInset, TAB_BAR_WEB_BOTTOM_PADDING)')
    && routeActivityOffer.includes("Platform.OS === 'web'")
    && routeActivityOffer.includes('tripsTabBarWebClearance(bottomInset)')
    && routeActivityOffer.includes('footerInset + 12'),
  'Tour prompt, search, results, and booking actions stay above the fixed web navigation',
);
assert(layout.includes('name="report"') && layout.includes("title: 'Reports'"),
  'Reports remains a visible first-class tab');
assert(layout.includes('name="route-builder"') && layout.includes('name="trips"') && layout.match(/href: null/g)?.length >= 3,
  'Route Builder and Trips remain hidden child routes rather than duplicate bottom tabs');

for (const label of ['Trip Planner', 'Route Builder', 'Trips']) {
  assert(switcher.includes(`label: '${label}'`), `Plan workspace includes ${label}`);
}
assert(switcher.includes('onSelect?:') && switcher.includes('if (onSelect) onSelect('),
  'Route Builder can guard workspace changes before navigation');
assert(switcher.includes('styles.activeIndicator') && switcher.includes('borderBottomWidth: 1'),
  'Plan navigation uses flat underlined tabs');
assert(!switcher.includes("from '@expo/vector-icons'"),
  'Plan navigation does not use decorative workspace icons');
assert(plan.includes('<PlanWorkspaceSwitcher active="assisted"'),
  'Trip Planner exposes the Plan navigation');
assert(
  routeBuilder.includes("setPendingRouteExit({ kind: 'workspace', href })")
    && routeBuilder.includes('savePendingRouteChanges')
    && routeBuilder.includes('Discard changes'),
  'Route Builder protects unfinished routes when switching Plan destinations',
);
assert(routeBuilder.includes("useState<RouteTabMode>('wizard')"),
  'Route Builder opens on the approved five-step setup');
assert(routeBuilder.includes("if (routeBuilderIntent !== 'edit-active'")
    && routeBuilder.includes('importedTripId === activeTrip.trip_id'),
  'Route Builder imports the active trip only for an explicit edit request');
assert(!routeBuilder.includes("setRouteTabMode('hub')") && !routeBuilder.includes("if (routeTabMode === 'hub')"),
  'Route Builder never returns to the retired hub');
assert(
  routeBuilder.includes('setTabBarHidden(buildingFramework || stops.length >= 2 || keyboardVisible)')
    && routeBuilder.includes('const dockMarginBottom = keyboardVisible ? 10 + bottomInset : 94 + bottomInset'),
  'Route Builder keeps setup controls clear of global tabs and hides them during the full-screen route scan',
);
assert(!routeBuilder.includes('opacity: wizardFade') && !routeBuilder.includes('translateY: wizardSlide'),
  'Route Builder setup cannot remain dimmed by an interrupted entrance animation');
assert(
  routeBuilder.includes('const routeSetupIsPristine = !hasBaseRoute')
    && routeBuilder.match(/if \(routeSetupIsPristine\)/g)?.length >= 2,
  'Route Builder bypasses leave confirmation for untouched setup',
);
const tourStopBuilder = routeBuilder.match(/function routeStopForTour[\s\S]*?\n  \}/)?.[0] ?? '';
assert(
  tourStopBuilder.includes("routePointType: 'break'")
    && !tourStopBuilder.includes("routePointType: 'side_stop'"),
  'A booked tour is a required route waypoint rather than an optional side stop',
);
assert(
  routeBuilder.includes('const poi = routeActivityPlace(tour)')
    && routeBuilder.includes('trailingLabel="ADD"')
    && !routeBuilder.includes("trailingLabel={tour.booking_url || tour.affiliate_url || tour.source_url ? 'OPEN' : 'ADD'}"),
  'Route Builder validates a tour location before routing it and labels inline tour actions honestly',
);
assert(
  routeBuilder.includes('api.saveTripWithToken(')
    && routeBuilder.includes('sourceTripIsStillCurrent')
    && routeBuilder.includes('requireRouteGeometry'),
  'Booked-tour route writes bind the account, guard the trip revision, and require fresh geometry',
);
const bookedTourWriteStart = routeBuilder.indexOf('async function addBookedTourToRoute(');
const bookedTourWriteEnd = routeBuilder.indexOf('\n  function addPlace(', bookedTourWriteStart);
const bookedTourWrite = bookedTourWriteStart >= 0 && bookedTourWriteEnd > bookedTourWriteStart
  ? routeBuilder.slice(bookedTourWriteStart, bookedTourWriteEnd)
  : '';
assert(
  routeActivityLogic.includes("source === 'destination_centroid'")
    && routeActivityLogic.includes("precision === 'approximate'")
    && routeActivityLogic.includes('experience.route_stop_eligible === false')
    && routeActivityLogic.includes('!routeActivityHasExactCoordinates(experience)'),
  'Approximate Viator coordinates cannot become route stops',
);
assert(
  routeActivityOffer.includes('routeActivityHasExactCoordinates(experience)')
    && routeActivityOffer.includes("selectedHasExactCoordinates ? 'add' : 'bookmark-outline'")
    && routeActivityOffer.includes("adding ? 'Saving' : 'Save to trip'"),
  'Tour detour copy and the booking confirmation action reflect whether an exact route stop is available',
);
assert(
  bookedTourWrite.includes('if (!stop) {')
    && bookedTourWrite.includes('const bookingOnlyTrip = buildTrip(stops, days)')
    && bookedTourWrite.includes('bookedTour,')
    && map.includes('if (!place) {')
    && map.includes('so your route is unchanged.'),
  'Route Builder and Map retain the booking without rerouting when a meeting point is unavailable',
);
assert(
  bookedTourWrite.includes('const alreadyOnRoute = routeAlreadyHasTour(stops, stop)')
    && bookedTourWrite.includes('const nextStops = alreadyOnRoute ? stops : [...stops, stop]')
    && bookedTourWrite.includes('bookedTour,\n      alreadyOnRoute,'),
  'A booked tour already on the route still backfills its booking details without rerouting',
);
const persistedBuilderStateStart = routeBuilder.indexOf('function buildPersistedBuilderState(');
const persistedBuilderStateEnd = routeBuilder.indexOf('\n  function buildTrip(', persistedBuilderStateStart);
const persistedBuilderState = persistedBuilderStateStart >= 0 && persistedBuilderStateEnd > persistedBuilderStateStart
  ? routeBuilder.slice(persistedBuilderStateStart, persistedBuilderStateEnd)
  : '';
const commitTripStart = routeBuilder.indexOf('async function commitTrip(');
const commitTripEnd = routeBuilder.indexOf('\n  async function saveRoute(', commitTripStart);
const commitTrip = commitTripStart >= 0 && commitTripEnd > commitTripStart
  ? routeBuilder.slice(commitTripStart, commitTripEnd)
  : '';
assert(
  persistedBuilderState.includes('return mergeRouteActivityBooking({')
    && persistedBuilderState.includes('}, bookedTour, activeTrip?.builder_state)')
    && commitTrip.includes('buildPersistedBuilderState(inputStops, inputDays, bookedTourToPersist)')
    && commitTrip.includes('builder_state: builderState'),
  'Route Builder serializes confirmed tours into builder_state and preserves earlier bookings',
);
const geometryMatchTolerances = [...routeBuilder.matchAll(
  /routeGeometryMatchesWaypointsInOrder\([\s\S]*?,\s*(\d+)\s*\)/g,
)].map(match => Number(match[1]));
assert(
  geometryMatchTolerances.length >= 4 && geometryMatchTolerances.every(tolerance => tolerance === 250),
  'Route Builder only reuses route geometry that passes the strict 250 m waypoint check',
);
assert(
  routeBuilder.includes('ROUTE_SAVE_GEOMETRY_TIMEOUT_MS')
    && routeBuilder.includes('coalesceAdjacentRoutableStops(navStops)')
    && routeBuilder.includes('geometryDeferred'),
  'Route Builder bounds its final reroute and leaves a retryable draft without stale geometry',
);
assert(
  routeBuilder.includes("...(geometry.steps?.length ? { steps: geometry.steps } : {})")
    && routeBuilder.includes("...(geometry.legs?.length ? { legs: geometry.legs } : {})")
    && routeBuilder.includes("...(knownGoodGeometry.steps?.length ? { steps: knownGoodGeometry.steps } : {})"),
  'Route Builder preserves provider maneuvers and legs in saved route geometry',
);
assert(
  routeBuilder.includes('existingVersion = activeTrip?.trip_id === outputTripId')
    && routeBuilder.includes('reconcileBackendTrip(await backendSave)'),
  'Route Builder carries the saved revision into edits and reconciles the backend revision',
);
const closeSaveStart = routeBuilder.indexOf('async function saveCloseAndStartNewRoute()');
const closeSaveEnd = routeBuilder.indexOf('\n  function discardCloseAndStartNewRoute()', closeSaveStart);
const closeSave = closeSaveStart >= 0 && closeSaveEnd > closeSaveStart
  ? routeBuilder.slice(closeSaveStart, closeSaveEnd)
  : '';
assert(
  closeSave.includes('const savedTrip = await api.saveTripWithToken(')
    && closeSave.includes('const closeSaveIsCurrent = accountRequestIsCurrent(')
    && closeSave.includes('Number(savedTrip.version ?? 0) > submittedVersion')
    && closeSave.includes('await applyBackendAcknowledgedActiveTrip(savedTripForHistory)')
    && !closeSave.includes('setActiveTrip(savedTripForHistory)'),
  'Route Builder close save adopts the backend revision only for the current account-bound draft',
);
const setupDestinationStart = routeBuilder.indexOf('async function addDestinationFromSetup(');
const setupDestinationEnd = routeBuilder.indexOf('\n  function straightRouteSpine(', setupDestinationStart);
const setupDestination = setupDestinationStart >= 0 && setupDestinationEnd > setupDestinationStart
  ? routeBuilder.slice(setupDestinationStart, setupDestinationEnd)
  : '';
const spineStart = routeBuilder.indexOf('async function buildRouteSpine(');
const spineEnd = routeBuilder.indexOf('\n  async function buildSavedRouteGeometry(', spineStart);
const spine = spineStart >= 0 && spineEnd > spineStart ? routeBuilder.slice(spineStart, spineEnd) : '';
assert(
  routeBuilder.includes('addDestinationFromSetup(false, requestId)')
    && setupDestination.includes('routeBuildRequestSignal(requestId)')
    && setupDestination.includes('geocodePlaces(startQ, signal)')
    && setupDestination.includes('geocodePlaces(q, signal)')
    && setupDestination.indexOf('if (!requestIsCurrent()) return null;') < setupDestination.indexOf('setStops(next)'),
  'Route Builder setup geocoding cannot mutate a stopped or replaced build session',
);
assert(
  api.includes('signal?: AbortSignal;')
    && api.includes('if (options.signal) return run();')
    && api.includes('if (requestOptions.signal) return run();'),
  'Route Builder geocoding and map resolution can bypass shared request caching with a build AbortSignal',
);
assert(
  routeBuilder.includes('buildRouteSpine(first, last, requestId)')
    && spine.includes('routeBuildRequestSignal(requestId)')
    && spine.includes('buildBridgeRoute(')
    && spine.includes('signal,')
    && spine.indexOf('if (!requestIsCurrent()) return null;') < spine.indexOf('setRouteGeometry(geometry)'),
  'Route Builder initial route spine is abortable and guards geometry writes by build session',
);
assert(
  routeBuilder.includes('const currentSession = useStore.getState().routeBuildSession;')
    && routeBuilder.includes('currentSession?.requestId === requestId) setBuildingFramework(false)'),
  'A stopped Route Builder session cannot clear the replacement session loading state',
);
assert(
  map.includes("chooseRouteBuildActivities(routeBuildSession.requestId, 'skip')")
    && routeActivityOffer.includes('Skip tours')
    && routeBuildProgress.includes('Skip tours')
    && !routeActivityOffer.includes('Cancel trip setup')
    && !routeBuildProgress.includes('Cancel trip setup'),
  'Closing the post-save tour step finishes the trip without cancelling it',
);
const discoveryStart = routeBuilder.indexOf('async function runDiscovery(');
const discoveryEnd = routeBuilder.indexOf('\n  async function discover()', discoveryStart);
const discovery = discoveryStart >= 0 && discoveryEnd > discoveryStart
  ? routeBuilder.slice(discoveryStart, discoveryEnd)
  : '';
assert(
  discovery.includes('clearTimeout(discoveryRetryTimerRef.current)')
    && discovery.includes('const discoveryRequestId = ++discoveryRequestRef.current')
    && discovery.includes('discoveryRequestRef.current === discoveryRequestId')
    && discovery.includes('if (!requestIsCurrent()) return;\n            runDiscovery(tab, target, leg, { focusMap: false, retryingLive: true })'),
  'A new discovery request cancels and invalidates stale delayed Viator retries',
);
assert(
  routeBuilder.includes('discoveryRequestRef.current += 1;')
    && routeBuilder.includes('if (discoveryRetryTimerRef.current) clearTimeout(discoveryRetryTimerRef.current);'),
  'Route Builder cancels delayed discovery work when the screen unmounts',
);
const getRouteToursStart = api.indexOf('getRouteTours:');
const getRouteToursEnd = api.indexOf('\n  getRentalOffers:', getRouteToursStart);
const getRouteTours = getRouteToursStart >= 0 && getRouteToursEnd > getRouteToursStart
  ? api.slice(getRouteToursStart, getRouteToursEnd)
  : '';
assert(
  getRouteTours.includes("req<ExploreExperiencesResponse>('/api/tours/route'")
    && !getRouteTours.includes('isLocalWebProductionApi()'),
  'An explicit route-tour search reaches Viator during local web QA',
);

for (const copy of ['Where are you headed?', 'City, park, or trailhead', 'Saved places', 'Recent']) {
  assert(plan.includes(copy), `Trip Planner includes ${copy}`);
}
for (const removedCopy of [
  'Assisted planning',
  'Tell Trailhead',
  'WORKING ON IT',
  '>PLANNER<',
  'start a new conversation',
  'Ready for leg 2!',
  'Report planner response',
]) {
  assert(!plan.includes(removedCopy), `Trip Planner removes ${removedCopy}`);
}
assert(plan.includes('{messages.length > 0 && ('),
  'Trip Planner keeps the conversation composer off the destination-first welcome view');
const conversationFailurePhase = plan.match(
  /plannerFailureMessage\(e, 'conversation'\)[\s\S]{0,180}setPlanPhase\('([^']+)'\)/,
)?.[1];
assert(conversationFailurePhase === 'chatting',
  'A failed planning conversation remains retryable and cannot enable trip building');
assert(
  plan.includes("? 'Trip changes' : 'Trip request'")
    && plan.includes("? 'Send trip changes' : 'Send trip request'"),
  'Trip Planner composer labels describe the current request for assistive technology',
);

assert(profile.includes("intent: 'new'"),
  'Profile new-route actions explicitly open a fresh Route Builder flow');
assert(guide.includes("intent: 'edit-active'"),
  'seeded Explore trips explicitly open the active trip in Route Builder');
assert(routeBuilder.includes("routeBuilderIntent === 'edit-active'") && routeBuilder.includes("routeBuilderIntent !== 'new'"),
  'Route Builder consumes edit-active and new navigation intents');
const cleanNewRoute = routeBuilder.match(/function beginCleanNewRoute\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
const startNewRoute = routeBuilder.match(/function startNewRoute\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
assert(
  cleanNewRoute.includes('resetRouteDraft()')
    && !cleanNewRoute.includes('setActiveTrip(null)')
    && startNewRoute.includes('beginCleanNewRoute()')
    && !startNewRoute.includes('setShowNewRouteConfirm'),
  'New-route intent opens a clean setup without clearing the current active trip',
);
assert(!trips.includes('tripsEnabled'),
  'Trips local workspace is not hidden behind the former bottom-tab flag');
assert(trips.includes('<PlanWorkspaceSwitcher active="trips"'),
  'Trips includes the shared Plan navigation');

if (failures.length) {
  console.error('Plan workspace regression audit failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Plan workspace regression audit passed.');
