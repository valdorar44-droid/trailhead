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

assert(nativeMap.includes("slot: 'bottom'") && nativeMap.includes('belowLayerID: publicLandBelowLayerID'),
  'native public-land raster is positioned below route overlays');
assert(webMap.includes("? 'trailhead-web-route-casing' : undefined"),
  'web public-land raster is inserted below the route casing');

if (failures.length) {
  console.error('Profile/map regression audit failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Profile/map regression audit passed.');
