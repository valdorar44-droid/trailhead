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

const layout = source('app/_layout.tsx');
const store = source('lib/store.ts');
const profile = source('app/(tabs)/profile.tsx');
const map = source('app/(tabs)/map.tsx');
const nativeMap = source('components/NativeMap/index.tsx');
const webMap = source('components/NativeMap/index.web.tsx');
const api = source('lib/api.ts');
const offlineRoutes = source('lib/offlineRoutes.ts');
const routeWeatherCache = source('lib/routeWeather.ts');

assert(layout.includes("if (Platform.OS === 'web')") && layout.includes("typeof setColorScheme === 'function'"),
  'theme application guards web and missing Appearance APIs');
assert(layout.includes('document.documentElement.style.colorScheme = themeMode'),
  'web receives the selected color-scheme hint without calling the native Appearance API');

const signOutStart = store.indexOf('signOut: async () => {');
const signOutEnd = store.indexOf('clearAuthAndLocalData: async () => {', signOutStart);
const signOut = signOutStart >= 0 && signOutEnd > signOutStart ? store.slice(signOutStart, signOutEnd) : '';
assert(signOut.includes("sd('trailhead_token')") && signOut.includes('user: null'),
  'sign-out clears account credentials');
assert(signOut.includes('eraseLegacyAccountData()') && signOut.includes('await Promise.all'),
  'sign-out clears durable account data before completing');
const profileSignOutStart = profile.indexOf('async function signOutFromDevice()');
const profileSignOutEnd = profile.indexOf('async function deleteAccountAndClearDevice()', profileSignOutStart);
const profileSignOut = profileSignOutStart >= 0 && profileSignOutEnd > profileSignOutStart
  ? profile.slice(profileSignOutStart, profileSignOutEnd)
  : '';
const localClearAt = profileSignOut.indexOf('const localClear =');
const cancelTripSyncAt = profileSignOut.indexOf('await cancelTripRepositorySync()');
const cancelTripMirrorAt = profileSignOut.indexOf('await cancelActiveTripMirror()');
const eraseTripsAt = profileSignOut.indexOf('await eraseTripRepositoryScope(accountId)');
const stopLocationAt = profileSignOut.indexOf('await stopAccountBackgroundLocation()');
const removePushAt = profileSignOut.indexOf('await removeAccountPushToken(authToken)');
assert(localClearAt >= 0
  && localClearAt < cancelTripSyncAt
  && cancelTripSyncAt < cancelTripMirrorAt
  && cancelTripMirrorAt < eraseTripsAt
  && eraseTripsAt < stopLocationAt
  && stopLocationAt < removePushAt,
  'Profile invalidates private memory before disconnecting sync, repository data, location, and push');
assert(!profileSignOut.includes('You are still signed in'),
  'sign-out cleanup failures do not claim the invalidated session remains active');
const registerStart = profile.indexOf("if (view === 'register')");
const registerEnd = profile.indexOf('\n  return (', registerStart);
const register = registerStart >= 0 && registerEnd > registerStart ? profile.slice(registerStart, registerEnd) : '';
assert(register.includes('style={s.authBackButton}') && register.includes("onPress={() => setView('main')}"),
  'Create Account can return to Profile');

const dockHandlerStart = map.indexOf('function handleTrailGuideDockPress()');
const dockHandlerEnd = map.indexOf('function handleTrailGuideDockLongPress()', dockHandlerStart);
const dockHandler = dockHandlerStart >= 0 && dockHandlerEnd > dockHandlerStart ? map.slice(dockHandlerStart, dockHandlerEnd) : '';
assert(dockHandler.indexOf('if (extremeCopilotUnavailable)') >= 0 &&
  dockHandler.indexOf('if (extremeCopilotUnavailable)') < dockHandler.indexOf('setPaywallVisible(true)'),
  'Co-Pilot handles connection and service failures before upgrade prompts');
assert(map.includes('extremeConfigLoadFailed') && map.includes('extremeConfig.kill_switch') && map.includes('!extremeConfig.beta_active'),
  'Co-Pilot distinguishes connection, kill-switch, and entitlement states');
assert(!map.includes('preview rebuild required for voice'),
  'Co-Pilot does not expose preview-build wording');
const locationStart = map.indexOf('async function ensureCopilotLocation()');
const locationEnd = map.indexOf('function currentCopilotDestination', locationStart);
const locationFlow = locationStart >= 0 && locationEnd > locationStart ? map.slice(locationStart, locationEnd) : '';
assert(locationFlow.includes('setShowLocDisclosure(false)') && !locationFlow.includes('setShowLocDisclosure(true)'),
  'denied location access does not reopen the disclosure in a loop');
assert(locationFlow.includes('permission.canAskAgain === false') && locationFlow.includes('Linking.openSettings()'),
  'permanently denied native location access offers a Settings recovery path');
assert(map.includes("setLocPermissionState(permission?.status === 'denied' ? 'denied' : 'undetermined')")
  && map.includes('location_permission: locPermissionState'),
  'Co-Pilot context retains an explicit denied location state');
assert(map.includes('<Text style={s.locDisclosureDenyText}>Not now</Text>'),
  'Map location disclosure can be dismissed without granting access');
const centerLocationStart = map.indexOf('async function centerMapOnUser()');
const centerLocationEnd = map.indexOf('function closeSafeWaterMode()', centerLocationStart);
const centerLocation = centerLocationStart >= 0 && centerLocationEnd > centerLocationStart ? map.slice(centerLocationStart, centerLocationEnd) : '';
assert(centerLocation.includes("resolved.status === 'unavailable'") && !centerLocation.includes('Location is not available yet.'),
  'Locate preserves permission-denial guidance and only replaces genuine GPS-fix failures');

const trailReportAuthStart = map.indexOf('function ensureTrailReportSignedIn()');
const trailReportAuthEnd = map.indexOf('function openTrailFieldReportComposer()', trailReportAuthStart);
const trailReportAuth = trailReportAuthStart >= 0 && trailReportAuthEnd > trailReportAuthStart
  ? map.slice(trailReportAuthStart, trailReportAuthEnd)
  : '';
const trailReportSubmitStart = map.indexOf('async function submitTrailFieldReport()');
const trailReportSubmitEnd = map.indexOf('// ── Stable map HTML', trailReportSubmitStart);
const trailReportSubmit = trailReportSubmitStart >= 0 && trailReportSubmitEnd > trailReportSubmitStart
  ? map.slice(trailReportSubmitStart, trailReportSubmitEnd)
  : '';
assert(trailReportAuth.includes('if (user) return true') && trailReportAuth.includes("router.push('/(tabs)/profile')"),
  'signed-out trail reports route to Profile before opening the composer');
assert(trailReportSubmit.indexOf('ensureTrailReportSignedIn()') >= 0 &&
  trailReportSubmit.indexOf('ensureTrailReportSignedIn()') < trailReportSubmit.indexOf('api.submitTrailFieldReport'),
  'trail report submission repeats the account preflight before the API call');
assert((map.match(/onPress=\{openTrailFieldReportComposer\}/g) ?? []).length >= 2,
  'trail report entry points share the signed-in composer guard');

const routeActivityAddStart = map.indexOf('onAdd={async experience => {', map.indexOf('<RouteActivityOfferSheet'));
const routeActivityAddEnd = map.indexOf('\n        }}\n      />', routeActivityAddStart);
const routeActivityAdd = routeActivityAddStart >= 0 && routeActivityAddEnd > routeActivityAddStart
  ? map.slice(routeActivityAddStart, routeActivityAddEnd)
  : '';
const rebuildGeometryStart = map.indexOf('async function rebuildTripRouteGeometry(');
const rebuildGeometryEnd = map.indexOf('\n  function addPlaceToActiveTripDay(', rebuildGeometryStart);
const rebuildGeometry = rebuildGeometryStart >= 0 && rebuildGeometryEnd > rebuildGeometryStart
  ? map.slice(rebuildGeometryStart, rebuildGeometryEnd)
  : '';
const normalPlaceAddStart = map.indexOf('function addPlaceToActiveTripDay(');
const normalPlaceAddEnd = map.indexOf('\n  useEffect(() => {', normalPlaceAddStart);
const normalPlaceAdd = normalPlaceAddStart >= 0 && normalPlaceAddEnd > normalPlaceAddStart
  ? map.slice(normalPlaceAddStart, normalPlaceAddEnd)
  : '';
const placeUndoStart = map.indexOf('function showPlaceAddedAlert(');
const placeUndoEnd = map.indexOf('\n  function clearCurrentRouteGeometry(', placeUndoStart);
const placeUndo = placeUndoStart >= 0 && placeUndoEnd > placeUndoStart
  ? map.slice(placeUndoStart, placeUndoEnd)
  : '';
assert(
  rebuildGeometry.includes('steps: geometry.steps ?? []')
    && rebuildGeometry.includes('legs: geometry.legs ?? []'),
  'Map route-activity reroutes retain provider maneuver steps and leg boundaries',
);
assert(
  map.includes('const savedRouteIsCurrent = Array.isArray(activeTrip.route_geometry?.coords)')
    && map.includes('if (!savedRouteIsCurrent) {\n      setRouteSteps([]);\n      setRouteLegs([]);'),
  'Trip refresh does not clear maneuvers from a current saved route',
);
assert(
  normalPlaceAdd.includes('version: activeTrip.version')
    && !normalPlaceAdd.includes('version: (activeTrip.version ?? 0) + 1')
    && normalPlaceAdd.includes('const writeSnapshot = mapTripWriteSnapshot(nextTrip, operationId)')
    && normalPlaceAdd.includes('reconcileMapTripWrite(writeSnapshot, savedTrip)'),
  'Map place additions send the current server revision and reconcile the returned revision',
);
assert(
  placeUndo.includes('version: currentTrip.version')
    && placeUndo.includes("'route_activity_undo'")
    && placeUndo.includes('reconcileMapTripWrite(undoSnapshot, savedTrip)'),
  'Map place undo writes from the latest reconciled revision and adopts the server result',
);
assert(
  routeActivityAdd.includes('const requestEpoch = accountStorage.epoch()')
    && routeActivityAdd.includes('committedTripIsStillCurrent')
    && routeActivityAdd.includes('api.saveTripWithToken('),
  'Map booking confirmation binds the account and guards the trip revision across awaited writes',
);
assert(
  routeActivityAdd.includes("saveRouteGeometry(committedTrip.trip_id, rebuiltGeometry, { syncBackend: false })")
    && routeActivityAdd.includes("'route_activity',\n                requestToken"),
  'Map booking confirmation uses one account-bound backend trip write',
);
assert(
  routeActivityAdd.includes('builder_state: mergeRouteActivityBooking(')
    && routeActivityAdd.includes('preparedTrip.builder_state,')
    && routeActivityAdd.includes('bookedTour,')
    && routeActivityAdd.includes('currentTrip.builder_state,')
    && routeActivityAdd.includes('committedTrip.builder_state ?? null'),
  'Map booking confirmation merges the tour into builder_state before local and backend persistence',
);
assert(
  routeActivityAdd.includes('tripAlreadyHasRouteActivityStop(currentTrip, place, day)')
    && routeActivityAdd.includes('const rebuiltGeometry = alreadyOnRoute\n            ? null')
    && routeActivityAdd.includes("title: alreadyOnRoute ? 'Tour saved' : undefined")
    && routeActivityAdd.includes('const savedTrip = await api.saveTripWithToken(')
    && routeActivityAdd.includes('reconcileMapTripWrite(committedSnapshot, savedTrip)'),
  'Existing Viator route stops still persist their booking without rebuilding the route',
);
assert(api.includes('const requestToken = await resolveLegacyTripSaveToken(')
  && api.includes('}, requestToken);')
  && api.includes('saveTripWithToken:'),
  'Trip persistence can bind the credential captured with an account-scoped operation');

const copilotSaveStart = map.indexOf("if (type === 'saveTrip')");
const copilotSaveEnd = map.indexOf("\n    setQuickToast('Copilot staged context", copilotSaveStart);
const copilotSave = copilotSaveStart >= 0 && copilotSaveEnd > copilotSaveStart
  ? map.slice(copilotSaveStart, copilotSaveEnd)
  : '';
assert(
  copilotSave.includes('if (requestAccountId == null || !requestToken)')
    && copilotSave.includes('await saveOfflineTrip(tripToSave)')
    && copilotSave.includes('const snapshot = mapTripWriteSnapshot(')
    && copilotSave.includes('const savedTrip = await api.saveTripWithToken(')
    && copilotSave.includes('await reconcileMapTripWrite(snapshot, savedTrip)'),
  'Copilot trip save stays local without an account and reconciles the returned server revision when signed in',
);

const saveRouteGeometryStart = offlineRoutes.indexOf('export async function saveRouteGeometry(');
const saveRouteGeometryEnd = offlineRoutes.indexOf('\nexport async function loadRouteGeometry(', saveRouteGeometryStart);
const saveRouteGeometry = saveRouteGeometryStart >= 0 && saveRouteGeometryEnd > saveRouteGeometryStart
  ? offlineRoutes.slice(saveRouteGeometryStart, saveRouteGeometryEnd)
  : '';
const explicitRouteGeometrySyncAt = saveRouteGeometry.indexOf('if (options.syncBackend === true)');
const routeGeometryNetworkAt = saveRouteGeometry.indexOf('api.saveTripGeometry(');
assert(
  saveRouteGeometry.includes('options: { syncBackend?: boolean } = {}')
    && explicitRouteGeometrySyncAt >= 0
    && routeGeometryNetworkAt > explicitRouteGeometrySyncAt
    && (saveRouteGeometry.match(/api\.saveTripGeometry\(/g) ?? []).length === 1,
  'Route geometry remains a local cache unless a caller explicitly requests backend sync',
);

const saveTripGeometryStart = api.indexOf('saveTripGeometry: async (');
const saveTripGeometryEnd = api.indexOf('\n\n  submitReport:', saveTripGeometryStart);
const saveTripGeometry = saveTripGeometryStart >= 0 && saveTripGeometryEnd > saveTripGeometryStart
  ? api.slice(saveTripGeometryStart, saveTripGeometryEnd)
  : '';
const saveTripGeometryTokenAt = saveTripGeometry.indexOf('const token = await getToken()');
const saveTripGeometryAnonymousReturnAt = saveTripGeometry.indexOf('if (!token) return null');
const saveTripGeometryRequestAt = saveTripGeometry.indexOf('reqWithToken<TripResult>');
assert(
  saveTripGeometryTokenAt >= 0
    && saveTripGeometryAnonymousReturnAt > saveTripGeometryTokenAt
    && saveTripGeometryRequestAt > saveTripGeometryAnonymousReturnAt,
  'Anonymous route-geometry saves return before making a network request',
);

const explorerLedgerStart = api.indexOf('logExplorerLedger: async (');
const explorerLedgerEnd = api.indexOf('\n  logExtremeLedger:', explorerLedgerStart);
const explorerLedger = explorerLedgerStart >= 0 && explorerLedgerEnd > explorerLedgerStart
  ? api.slice(explorerLedgerStart, explorerLedgerEnd)
  : '';
const extremeLedgerStart = api.indexOf('logExtremeLedger: async (');
const extremeLedgerEnd = api.indexOf('\n  authorizeExplorerNavigation:', extremeLedgerStart);
const extremeLedger = extremeLedgerStart >= 0 && extremeLedgerEnd > extremeLedgerStart
  ? api.slice(extremeLedgerStart, extremeLedgerEnd)
  : '';
for (const [name, ledger] of [['Explorer', explorerLedger], ['Extreme', extremeLedger]]) {
  const tokenAt = ledger.indexOf('const token = await getToken()');
  const anonymousReturnAt = ledger.indexOf('if (!token) return { ok: false, event_id: 0 }');
  const requestAt = ledger.indexOf('reqWithToken<');
  assert(
    tokenAt >= 0 && anonymousReturnAt > tokenAt && requestAt > anonymousReturnAt,
    `${name} ledger events return locally when no account token exists`,
  );
}

const routeWeatherStart = api.indexOf('getRouteWeather: (');
const routeWeatherEnd = api.indexOf('\n  buildRoute:', routeWeatherStart);
const routeWeather = routeWeatherStart >= 0 && routeWeatherEnd > routeWeatherStart
  ? api.slice(routeWeatherStart, routeWeatherEnd)
  : '';
assert(
  routeWeather.includes("req<RouteWeatherResult>('/api/weather/route'")
    && !routeWeather.includes('isLocalWebProductionApi()')
    && !routeWeather.includes('isLocalManualTripId(')
    && !routeWeather.includes('Promise.resolve('),
  'Manual trips request route weather during localhost web QA',
);
const routeWeatherEffectStart = map.indexOf('// Load cached route weather whenever the active trip changes.');
const routeWeatherEffectEnd = map.indexOf('// Keep refs in sync', routeWeatherEffectStart);
const routeWeatherEffect = routeWeatherEffectStart >= 0 && routeWeatherEffectEnd > routeWeatherEffectStart
  ? map.slice(routeWeatherEffectStart, routeWeatherEffectEnd)
  : '';
assert(
  routeWeatherEffect.includes('routeWeatherCacheFileName(tripId, weatherUnitMode, routeWeatherSignature)')
    && routeWeatherEffect.includes('[activeTrip?.trip_id, routeWeatherSignature, weatherUnitMode]')
    && routeWeatherCache.includes('waypoint_signature: waypointSignature'),
  'Route weather disk caches are keyed and validated by units and waypoint identity',
);
assert(
  routeWeatherEffect.indexOf('setCachedWeather(weather);') >= 0
    && routeWeatherEffect.indexOf('setCachedWeather(weather);') < routeWeatherEffect.indexOf('FileSystem.writeAsStringAsync('),
  'A successful route-weather response renders before best-effort disk persistence',
);

const nativeMapRenderStart = map.indexOf('<NativeMap');
const nativeMapRenderEnd = map.indexOf('onMapReady={() => {', nativeMapRenderStart);
const nativeMapRender = nativeMapRenderStart >= 0 && nativeMapRenderEnd > nativeMapRenderStart
  ? map.slice(nativeMapRenderStart, nativeMapRenderEnd)
  : '';
for (const prop of ['camps', 'gas', 'pois', 'waterNavLines', 'waterSpotCards', 'reports', 'communityPins']) {
  assert(
    nativeMapRender.includes(`${prop}={mapMissionVisible`),
    `Route preview suppresses ${prop} while retaining route waypoints`,
  );
}

assert(nativeMap.includes("slot: 'bottom'") && nativeMap.includes('belowLayerID: publicLandBelowLayerID'),
  'native public-land raster is positioned below route overlays');
assert(webMap.includes("? 'trailhead-web-route-casing' : undefined"),
  'web public-land raster is inserted below the route casing');
assert(
  webMap.includes('fitCoordinates: (coords: [number, number][]')
    && webMap.includes('fitCoordinates: (coords, padding =')
    && webMap.includes('[Math.min(...lngs), Math.min(...lats)]')
    && webMap.includes('[Math.max(...lngs), Math.max(...lats)]'),
  'web map exposes the same route-framing handle as the native map',
);
assert(
  map.includes("if (typeof fitCoordinates === 'function')")
    && map.includes('fitCoordinates.call(nativeMapRef.current'),
  'map route framing tolerates older preview handles during an OTA transition',
);
assert(
  map.includes('const isFinalDay = day.day === tripOverviewDays.length;')
    && map.includes("isFinalDay && !hasOvernight ? 'FINISH'")
    && map.includes("? 'Trip ends here'")
    && map.includes('!isFinalDay || hasOvernight ? ('),
  'The route overview does not invent an overnight or camp action on the final day',
);
assert(
  map.includes("accessibilityLabel=\"Preview trip\"")
    && map.includes("source: 'trail_builder'")
    && map.includes('skipDirected: true')
    && map.includes("flyoverMode: 'trail_builder'"),
  'The trip overview play action uses stable route-only playback',
);
assert(
  map.includes('const abortStaleMissionStart = () => {')
    && map.includes('if (mapMissionOperationRef.current === missionOperation) stopMapMissionBrief();')
    && (map.match(/return abortStaleMissionStart\(\);/g) ?? []).length >= 5
    && map.includes('if (missionRunningRef.current) stopMapMissionBriefRef.current();'),
  'Stale flyover startup and trip replacement restore the map surface',
);
assert(
  map.includes('const missionChromeRight = Math.max(62, windowWidth - topChromeLeft - 420);')
    && map.includes('top: mapControlsTop,')
    && map.includes('style={[s.mapMissionBriefTop, missionChromeStyle]}'),
  'Flyover captions use the map lane below the persistent search bar',
);

if (failures.length) {
  console.error('Profile/map regression audit failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Profile/map regression audit passed.');
