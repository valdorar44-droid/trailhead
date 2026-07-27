import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { accountStorage, beginAccountStorageCleanup, endAccountStorageCleanup } from './storage';
import type { User, TripResult, Report, CampsitePin, OsmPoi, TrailProfile } from './api';
import type { PendingRouteActivityOffer } from './routeActivityOffer';
import {
  cancelRouteBuildSessionState,
  cancelRouteBuildActivitySearch,
  closeAllRouteBuildRequests,
  closeRouteBuildRequest,
  createRouteBuildSession,
  openRouteBuildRequest,
  resolveRouteBuildActivityChoice,
  updateRouteBuildSessionState,
  type RouteBuildSession,
  type RouteBuildSessionPatch,
  type RouteBuildActivityChoice,
  type StartRouteBuildSessionInput,
} from './routeBuildSession';
import {
  acknowledgeTripRepositoryLegacyTrip,
  createSavedEntity,
  getSavedEntity,
  getTrip,
  getTripRepositorySnapshot,
  listTrips,
  removeEntity,
  saveEntity,
  subscribeTripRepository,
  upsertTrip,
  type SavedEntityV1,
  type SavedEntityKind,
  type TripDocumentV2,
} from './tripRepository';
import { canonicalSavedEntityId, tripDocumentFromTripResult } from './tripCompatibility';
import { saveOfflineTrip } from './offlineTrips';
import { tripWriteBarrierPending } from './tripWriteBarrier';
import { preserveOmittedServerLegacy } from './tripRepository/compactSync';
import {
  legacyTripSaveContextIsCurrent,
  type LegacyTripSaveContext,
} from './legacyTripSaveContext';
import {
  buildCarAccountState,
  clearCarNavigationSnapshot,
  syncCarNavigationSnapshot,
} from './carIntegration';
import {
  clearCarReportSession,
  requestCarReportFlush,
  setCarReportSession,
} from 'expo-trailhead-car-reports';
import { TRAILHEAD_API_BASE } from './apiBase';
import {
  tabBarIsHidden,
  updateTabBarHiddenReasons,
  type TabBarHiddenReasons,
} from './tabBarVisibilityState';
import type { OfflineManagerReturnContext } from './planLibraryPresentation';

let accountLocalWriteBlockDepth = 0;
let accountLocalWriteTail: Promise<unknown> = Promise.resolve();
let accountLocalCleanupTail: Promise<unknown> = Promise.resolve();
let pendingAuthPersistence: { token: string; user: User } | null = null;

function accountLocalWrite<T>(operation: () => Promise<T>): Promise<T | undefined> {
  if (accountLocalWriteBlockDepth > 0) return Promise.resolve(undefined);
  const result = accountLocalWriteTail.then(operation);
  accountLocalWriteTail = result.catch(() => undefined);
  return result;
}

function accountLocalMutationAllowed() {
  return accountLocalWriteBlockDepth === 0;
}

export async function prepareAccountLocalDataErase() {
  accountLocalWriteBlockDepth += 1;
  await accountLocalWriteTail.catch(() => undefined);
}

export function resumeAccountLocalWrites() {
  accountLocalWriteBlockDepth = Math.max(0, accountLocalWriteBlockDepth - 1);
  if (accountLocalWriteBlockDepth > 0) return;
  const pending = pendingAuthPersistence;
  pendingAuthPersistence = null;
  if (pending) {
    accountSet('trailhead_token', pending.token);
    accountSet('trailhead_user', JSON.stringify(pending.user));
    void syncCarNavigationSnapshot({
      trip: useStore.getState().activeTrip,
      account: buildCarAccountState(pending.user, Boolean(pending.token), Date.now(), useStore.getState().hasPlan),
      mapboxAccessToken: useStore.getState().mapboxToken,
    }).catch(() => {});
    void setCarReportSession(pending.user.id, pending.token, TRAILHEAD_API_BASE).catch(() => false);
  }
}

function serializeAccountLocalCleanup<T>(operation: () => Promise<T>): Promise<T> {
  const result = accountLocalCleanupTail.then(operation, operation);
  accountLocalCleanupTail = result.catch(() => undefined);
  return result;
}

// File-based trip storage — no 2KB SecureStore limit
const TRIP_FILE = () => `${FileSystem.documentDirectory}active_trip.json`;
const saveTripFile = (trip: TripResult) => accountLocalWrite(
  () => FileSystem.writeAsStringAsync(TRIP_FILE(), JSON.stringify(trip)),
).catch(() => {});
const loadTripFile  = async (): Promise<TripResult | null> => {
  try { const raw = await FileSystem.readAsStringAsync(TRIP_FILE()); return JSON.parse(raw); } catch { return null; }
};
const deleteTripFile = () => accountLocalWrite(
  () => FileSystem.deleteAsync(TRIP_FILE(), { idempotent: true }),
).catch(() => {});
const RIG_FILE = () => `${FileSystem.documentDirectory}rig_profile.json`;
const saveRigFile = (rig: RigProfile) => accountLocalWrite(
  () => FileSystem.writeAsStringAsync(RIG_FILE(), JSON.stringify(rig)),
).catch(() => {});
const loadRigFile = async (): Promise<RigProfile | null> => {
  try { const raw = await FileSystem.readAsStringAsync(RIG_FILE()); return JSON.parse(raw); } catch { return null; }
};
const deleteRigFile = () => accountLocalWrite(
  () => FileSystem.deleteAsync(RIG_FILE(), { idempotent: true }),
).catch(() => {});
const PLAN_KEY = 'trailhead_plan';

// Keep all keychain items on this device only — prevents iOS from prompting
// "Sign into Apple account" to sync with iCloud Keychain.
const KCO = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const hasWebStorage = () => typeof window !== 'undefined' && !!window.localStorage;
const ss = (key: string, val: string) => {
  if (hasWebStorage()) {
    window.localStorage.setItem(key, val);
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(key, val, KCO);
};
const sg = (key: string) => {
  if (hasWebStorage()) return Promise.resolve(window.localStorage.getItem(key));
  return SecureStore.getItemAsync(key, KCO);
};
const sd = (key: string) => {
  if (hasWebStorage()) {
    window.localStorage.removeItem(key);
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(key, KCO);
};
const accountSet = (key: string, value: string) => accountLocalWrite(() => ss(key, value));
const newSessionId = () => 'sess_' + Math.random().toString(36).slice(2, 12);
const ACCOUNT_LOCAL_KEYS = [
  'trailhead_rig',
  'trailhead_history',
  'trailhead_favorites',
  'trailhead_active_trip',
  'trailhead_active_route',
  'trailhead_saved_places',
  'trailhead_saved_explore_places_v1',
  'trailhead_water_spots',
  'trailhead_catch_logs',
  'trailhead_water_routes',
  'trailhead_marker_groups',
  'trailhead_search_history',
  'trailhead_booked_tours_v1',
  'trailhead_checklist',
  'trailhead_copilot_route_builder_draft_v1',
  'trailhead_report_queue_v1',
  'trailhead_alert_seen',
  'trailhead_alert_prefs',
  'trailhead_push_token',
  'trailhead_map_recent_viewport_v1',
  'trailhead_welcome_setup_prefs_v1',
  'trailhead_welcome_setup_status_v1',
];
const ANONYMOUS_LEGACY_STASH_KEY = 'trailhead_anonymous_legacy_stash_v1';
const ANONYMOUS_LEGACY_STASH_DIR = 'anonymous_legacy_stash_v1';
const PRIVATE_DIRECTORIES = ['offline_trips', 'offline_routes', 'offline_place_packs', 'offline_trails', 'routes'];

function isPrivateRootFile(name: string) {
  return name === 'active_trip.json'
    || /^car_navigation_snapshot\.json(?:\.(?:tmp|bak))?$/i.test(name)
    || name === 'rig_profile.json'
    || name === 'last_background_location.json'
    || name === 'notified_wps.json'
    || name === 'gpx_import_batches.json'
    || /^weather_.+\.json$/i.test(name)
    || /^route_weather_v2_.+\.json$/i.test(name)
    || /^guide_.+\.json$/i.test(name)
    || /^trip_ai_.+\.json$/i.test(name)
    || /\.gpx$/i.test(name);
}

async function erasePrivateFiles() {
  const root = FileSystem.documentDirectory;
  if (!root) return;
  const rootEntries = await FileSystem.readDirectoryAsync(root);
  const privateFiles = rootEntries.filter(isPrivateRootFile);
  await Promise.all([
    ...PRIVATE_DIRECTORIES.map(name => FileSystem.deleteAsync(`${root}${name}/`, { idempotent: true })),
    ...privateFiles.map(name => FileSystem.deleteAsync(`${root}${name}`, { idempotent: true })),
  ]);
}

async function eraseLegacyAccountData() {
  await Promise.all([
    ...ACCOUNT_LOCAL_KEYS.map(key => sd(key)),
    ...(hasWebStorage() ? [] : [erasePrivateFiles()]),
  ]);
}

type AnonymousLegacyStash = {
  schemaVersion: 1;
  values: Record<string, string>;
  entries: string[];
};

async function readAccountLocalValues() {
  const pairs = await Promise.all(ACCOUNT_LOCAL_KEYS.map(async key => [key, await sg(key)] as const));
  return Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair[1] != null));
}

async function stashAnonymousLegacyData() {
  const values = await readAccountLocalValues();
  if (hasWebStorage()) {
    if (!window.localStorage.getItem(ANONYMOUS_LEGACY_STASH_KEY)) {
      window.localStorage.setItem(ANONYMOUS_LEGACY_STASH_KEY, JSON.stringify({ schemaVersion: 1, values, entries: [] }));
    }
    await Promise.all(ACCOUNT_LOCAL_KEYS.map(key => sd(key)));
    return;
  }

  const root = FileSystem.documentDirectory;
  if (!root) return;
  const stashRoot = `${root}${ANONYMOUS_LEGACY_STASH_DIR}/`;
  const existing = await FileSystem.getInfoAsync(stashRoot);
  if (!existing.exists) {
    const rootEntries = await FileSystem.readDirectoryAsync(root);
    const entries = rootEntries.filter(name => PRIVATE_DIRECTORIES.includes(name) || isPrivateRootFile(name));
    await FileSystem.makeDirectoryAsync(stashRoot, { intermediates: true });
    const manifest: AnonymousLegacyStash = { schemaVersion: 1, values, entries };
    await FileSystem.writeAsStringAsync(`${stashRoot}manifest.json`, JSON.stringify(manifest));
    const moved: string[] = [];
    try {
      for (const name of entries) {
        await FileSystem.moveAsync({ from: `${root}${name}`, to: `${stashRoot}${name}` });
        moved.push(name);
      }
    } catch (error) {
      for (const name of moved.reverse()) {
        await FileSystem.moveAsync({ from: `${stashRoot}${name}`, to: `${root}${name}` }).catch(() => {});
      }
      await FileSystem.deleteAsync(stashRoot, { idempotent: true }).catch(() => {});
      throw error;
    }
  }
  await Promise.all(ACCOUNT_LOCAL_KEYS.map(key => sd(key)));
}

async function restoreAnonymousLegacyData() {
  if (hasWebStorage()) {
    const raw = window.localStorage.getItem(ANONYMOUS_LEGACY_STASH_KEY);
    if (!raw) return false;
    const stash = JSON.parse(raw) as AnonymousLegacyStash;
    await Promise.all(Object.entries(stash.values ?? {}).map(([key, value]) => ss(key, value)));
    window.localStorage.removeItem(ANONYMOUS_LEGACY_STASH_KEY);
    return true;
  }

  const root = FileSystem.documentDirectory;
  if (!root) return false;
  const stashRoot = `${root}${ANONYMOUS_LEGACY_STASH_DIR}/`;
  const manifestPath = `${stashRoot}manifest.json`;
  const manifestInfo = await FileSystem.getInfoAsync(manifestPath);
  if (!manifestInfo.exists) return false;
  const stash = JSON.parse(await FileSystem.readAsStringAsync(manifestPath)) as AnonymousLegacyStash;
  await Promise.all(Object.entries(stash.values ?? {}).map(([key, value]) => ss(key, value)));
  for (const name of stash.entries ?? []) {
    const source = `${stashRoot}${name}`;
    if (!(await FileSystem.getInfoAsync(source)).exists) continue;
    await FileSystem.deleteAsync(`${root}${name}`, { idempotent: true }).catch(() => {});
    await FileSystem.moveAsync({ from: source, to: `${root}${name}` });
  }
  await FileSystem.deleteAsync(stashRoot, { idempotent: true });
  return true;
}

async function hasAnonymousLegacyStash() {
  if (hasWebStorage()) return Boolean(window.localStorage.getItem(ANONYMOUS_LEGACY_STASH_KEY));
  const root = FileSystem.documentDirectory;
  if (!root) return false;
  return (await FileSystem.getInfoAsync(`${root}${ANONYMOUS_LEGACY_STASH_DIR}/manifest.json`)).exists;
}

function mirrorSavedEntity(input: {
  id: string;
  title: string;
  kind: SavedEntityKind;
  lat?: number;
  lng?: number;
  summary?: string;
  category?: string;
  note?: string;
  source?: string;
  sourceUrl?: string;
  media?: Array<{ url: string; kind: 'image'; credit?: string; caption?: string; source?: string }>;
  facts?: Record<string, unknown>;
}) {
  const id = canonicalSavedEntityId(input.id, 'place');
  const existing = getSavedEntity(id);
  const coordinates = Number.isFinite(input.lat) && Number.isFinite(input.lng)
    ? { lat: Number(input.lat), lng: Number(input.lng) }
    : undefined;
  const next = createSavedEntity({
    ...(existing ?? {}),
    id,
    title: input.title,
    kind: input.kind,
    coordinates,
    summary: input.summary,
    category: input.category,
    note: input.note,
    source: input.source,
    sourceUrl: input.sourceUrl,
    media: input.media ?? existing?.media ?? [],
    facts: { ...(existing?.facts ?? {}), ...(input.facts ?? {}) },
    createdAt: existing?.createdAt,
  });
  saveEntity(next, existing ? { expectedRevision: existing.revision } : undefined).catch(() => {});
}

function removeMirroredEntity(id: string) {
  const canonicalId = canonicalSavedEntityId(id, 'place');
  const existing = getSavedEntity(canonicalId);
  if (existing) removeEntity(existing.id, { expectedRevision: existing.revision }).catch(() => {});
}

function savedPlaceKind(place: SavedPlace): SavedEntityKind {
  if (place.icon === 'camp') return 'camp';
  if (place.icon === 'water') return 'water';
  if (place.icon === 'fuel') return 'fuel';
  if (place.trailId) return 'trail';
  return 'place';
}

function legacyCampFromEntity(entity: SavedEntityV1): CampsitePin {
  const legacy = entity.facts?.legacy && typeof entity.facts.legacy === 'object'
    ? entity.facts.legacy as Partial<CampsitePin>
    : {};
  return {
    ...legacy,
    id: entity.id,
    name: entity.title,
    lat: entity.coordinates?.lat ?? Number(legacy.lat ?? 0),
    lng: entity.coordinates?.lng ?? Number(legacy.lng ?? 0),
    tags: Array.isArray(legacy.tags) ? legacy.tags : [],
    land_type: entity.category || legacy.land_type || 'Camp',
    description: entity.summary || entity.note || legacy.description || '',
    photos: entity.media.map(item => ({ url: item.url, credit: item.credit, caption: item.caption, source: item.source })),
    reservable: Boolean(entity.bookingUrl || legacy.reservable),
    booking_url: entity.bookingUrl || legacy.booking_url,
    url: entity.sourceUrl || legacy.url || '',
    official_url: entity.sourceUrl || legacy.official_url,
    source_badge: entity.source || legacy.source_badge,
    ada: Boolean(legacy.ada),
  };
}

function legacySavedPlaceFromEntity(entity: SavedEntityV1): SavedPlace {
  const icon: SavedPlace['icon'] = entity.kind === 'camp'
    ? 'camp'
    : entity.kind === 'water'
      ? 'water'
      : entity.kind === 'fuel'
        ? 'fuel'
        : 'pin';
  return {
    id: entity.id,
    name: entity.title,
    lat: entity.coordinates?.lat ?? 0,
    lng: entity.coordinates?.lng ?? 0,
    icon,
    note: entity.note || entity.summary,
    trailId: entity.kind === 'trail' ? entity.sourceId || entity.id : undefined,
    sourceLabel: entity.source,
    createdAt: entity.createdAt,
  };
}

let activeTripMirrorTimer: ReturnType<typeof setTimeout> | null = null;
let activeTripMirrorWrite: Promise<void> | null = null;
let activeTripMirrorGeneration = 0;
let pendingActiveTripMirror: TripResult | null | undefined;
let pendingPreviousTripId: string | null = null;
let pendingActiveTripOwnerScope: string | null = null;

function sameTripItem(left: TripDocumentV2['items'][number], right: TripDocumentV2['items'][number]) {
  if (left.entityId && right.entityId && left.entityId === right.entityId) return true;
  if (left.title.trim().toLowerCase() !== right.title.trim().toLowerCase()) return false;
  if (!left.coordinates || !right.coordinates) return true;
  return Math.abs(left.coordinates.lat - right.coordinates.lat) < 0.0001
    && Math.abs(left.coordinates.lng - right.coordinates.lng) < 0.0001;
}

function mergeActiveTripDocument(current: TripDocumentV2, converted: TripDocumentV2): TripDocumentV2 {
  const items = converted.items.map(item => {
    const existing = current.items.find(candidate => sameTripItem(candidate, item));
    return existing ? { ...item, id: existing.id, entityId: existing.entityId, createdAt: existing.createdAt } : item;
  });
  return {
    ...current,
    ...converted,
    ownerScope: current.ownerScope,
    revision: current.revision,
    items,
    notes: current.notes,
    bookings: converted.bookings.length ? converted.bookings : current.bookings,
    alerts: current.alerts,
    offline: { ...current.offline, ...converted.offline },
    legacy: preserveOmittedServerLegacy(current.legacy, converted.legacy),
    createdAt: current.createdAt,
    archivedAt: undefined,
  };
}

async function writeActiveTripMirror(
  trip: TripResult | null,
  previousTripId: string | null,
  ownerScope: string,
  generation: number,
) {
  const stillCurrent = () => (
    generation === activeTripMirrorGeneration
    && getTripRepositorySnapshot().initialized
    && getTripRepositorySnapshot().ownerScope === ownerScope
  );
  if (!stillCurrent()) return;
  if (trip && tripWriteBarrierPending(trip.trip_id)) {
    scheduleActiveTripMirror(trip, previousTripId);
    return;
  }
  if (!trip) {
    if (!previousTripId) return;
    const previous = getTrip(previousTripId);
    if (previous?.status === 'active' && stillCurrent()) {
      await upsertTrip({ ...previous, status: 'draft' }, { expectedRevision: previous.revision }).catch(() => {});
    }
    return;
  }

  for (const other of listTrips({ includeArchived: true })) {
    if (!stillCurrent()) return;
    if (other.id !== trip.trip_id && other.status === 'active') {
      await upsertTrip({ ...other, status: 'draft' }, { expectedRevision: other.revision }).catch(() => {});
    }
  }
  const converted = tripDocumentFromTripResult(trip);
  const current = getTrip(converted.id);
  const next = current ? mergeActiveTripDocument(current, converted) : converted;
  if (!stillCurrent()) return;
  try {
    await upsertTrip(next, current ? { expectedRevision: current.revision } : undefined);
  } catch {
    if (!stillCurrent()) return;
    const latest = getTrip(converted.id);
    if (latest) {
      await upsertTrip(mergeActiveTripDocument(latest, converted), { expectedRevision: latest.revision }).catch(() => {});
    }
  }
}

function scheduleActiveTripMirror(trip: TripResult | null, previousTripId: string | null) {
  const snapshot = getTripRepositorySnapshot();
  const generation = ++activeTripMirrorGeneration;
  pendingActiveTripMirror = trip;
  pendingPreviousTripId = previousTripId;
  pendingActiveTripOwnerScope = snapshot.initialized ? snapshot.ownerScope : null;
  if (activeTripMirrorTimer) clearTimeout(activeTripMirrorTimer);
  activeTripMirrorTimer = setTimeout(() => {
    activeTripMirrorTimer = null;
    const pending = pendingActiveTripMirror;
    const previous = pendingPreviousTripId;
    const ownerScope = pendingActiveTripOwnerScope;
    pendingActiveTripMirror = undefined;
    pendingPreviousTripId = null;
    pendingActiveTripOwnerScope = null;
    if (pending === undefined || !ownerScope || generation !== activeTripMirrorGeneration) return;
    const write = writeActiveTripMirror(pending, previous, ownerScope, generation).catch(() => {});
    activeTripMirrorWrite = write;
    void write.finally(() => {
      if (activeTripMirrorWrite === write) activeTripMirrorWrite = null;
    });
  }, trip ? 250 : 0);
}

export async function cancelActiveTripMirror() {
  activeTripMirrorGeneration += 1;
  if (activeTripMirrorTimer) clearTimeout(activeTripMirrorTimer);
  activeTripMirrorTimer = null;
  pendingActiveTripMirror = undefined;
  pendingPreviousTripId = null;
  pendingActiveTripOwnerScope = null;
  const running = activeTripMirrorWrite;
  if (running) await running.catch(() => {});
}

export function captureLegacyTripSaveContext(): LegacyTripSaveContext {
  const repository = getTripRepositorySnapshot();
  const accountId = useStore.getState().user?.id;
  return {
    accountEpoch: accountStorage.epoch(),
    accountId: accountId == null ? null : String(accountId),
    ownerScope: repository.ownerScope,
    repositoryInitialized: repository.initialized,
  };
}

export function legacyTripSaveContextStillCurrent(context: LegacyTripSaveContext) {
  return legacyTripSaveContextIsCurrent(context, captureLegacyTripSaveContext());
}

export function queueCurrentActiveTripMirror(tripId?: string, context?: LegacyTripSaveContext) {
  if (context && !legacyTripSaveContextStillCurrent(context)) return false;
  const current = useStore.getState().activeTrip;
  if (!current || (tripId && current.trip_id !== tripId)) return false;
  scheduleActiveTripMirror(current, current.trip_id);
  return true;
}

export function queueActiveTripMirrorIfChanged(
  submittedTrip: TripResult,
  context?: LegacyTripSaveContext,
) {
  if (context && !legacyTripSaveContextStillCurrent(context)) return false;
  const current = useStore.getState().activeTrip;
  if (!current || current.trip_id !== submittedTrip.trip_id || current === submittedTrip) return false;
  scheduleActiveTripMirror(current, current.trip_id);
  return true;
}

export async function acknowledgeBackendTripRevision(
  submittedTrip: TripResult,
  acknowledgedTrip: TripResult,
  context: LegacyTripSaveContext,
) {
  if (!legacyTripSaveContextStillCurrent(context)) {
    return { record: null, applied: false, ignoredAsStale: true } as const;
  }
  if (!submittedTrip.trip_id || acknowledgedTrip.trip_id !== submittedTrip.trip_id) {
    return { record: null, applied: false, ignoredAsStale: true } as const;
  }
  const acknowledgedRevision = Number(acknowledgedTrip.version);
  if (!Number.isInteger(acknowledgedRevision) || acknowledgedRevision < 1) {
    return { record: null, applied: false, ignoredAsStale: true } as const;
  }
  const snapshot = getTripRepositorySnapshot();
  if (!snapshot.initialized || snapshot.ownerScope !== context.ownerScope) {
    return { record: null, applied: false, ignoredAsStale: true } as const;
  }
  const converted = tripDocumentFromTripResult(acknowledgedTrip);
  const current = getTrip(converted.id);
  const merged = current ? mergeActiveTripDocument(current, converted) : converted;
  return acknowledgeTripRepositoryLegacyTrip({
    ...merged,
    ownerScope: snapshot.ownerScope,
    revision: acknowledgedRevision,
  }, Number(submittedTrip.version) || undefined);
}

export async function applyBackendAcknowledgedActiveTrip(trip: TripResult) {
  useStore.getState().setActiveTrip(trip, false, { mirrorRepository: false });
  await saveOfflineTrip(trip);
}

export interface SavedPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  icon: 'star' | 'camp' | 'flag' | 'water' | 'fuel' | 'pin';
  groupId?: string;
  note?: string;
  trailId?: string;
  geometryRef?: string;
  sourceLabel?: string;
  createdAt: number;
}

export interface ExploreMapSelection {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type?: string;
  displayType?: string;
  category?: string;
  region?: string;
  summary?: string;
  note?: string;
  imageUrl?: string;
  photos?: { url?: string; credit?: string; caption?: string; source?: string; license?: string }[];
  sourceLabel?: string;
  sourceUrl?: string;
  officialUrl?: string;
  freshnessLabel?: string;
  relatedContext?: {
    places?: OsmPoi[];
    things_to_do?: OsmPoi[];
    things_to_see?: OsmPoi[];
    visitor_centers?: OsmPoi[];
    trails?: TrailProfile[];
    campgrounds_nearby?: CampsitePin[];
    trip_services?: OsmPoi[];
  };
}

export interface WaterSpot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'structure' | 'access' | 'spot' | 'saved';
  depthRangeFt?: { min?: number; max?: number; source?: string };
  structure?: string[];
  speciesTargets?: string[];
  source?: string;
  sourceConfidence?: string;
  note?: string;
  createdAt: number;
}

export interface CatchLog {
  id: string;
  species: string;
  count: number;
  lengthIn?: number;
  weightLb?: number;
  baitLure?: string;
  technique?: string;
  depthFt?: number;
  waterTempF?: number;
  weatherSnapshot?: string;
  solunarSnapshot?: string;
  photoUri?: string | null;
  notes?: string;
  privacy: 'private';
  lat?: number;
  lng?: number;
  spotId?: string;
  routeId?: string;
  createdAt: number;
}

export interface WaterRoute {
  id: string;
  name: string;
  start: { lat: number; lng: number; name: string };
  end: { lat: number; lng: number; name: string };
  geometry: [number, number][];
  distanceMi: number;
  etaMinutes: number;
  conflicts: Array<{ kind: string; severity: string; note: string }>;
  sourceConfidence: string;
  chartSource?: string;
  liveOfflineGaps?: string[];
  disclaimer: string;
  createdAt: number;
}

export interface MarkerGroup {
  id: string;
  name: string;
  color: string;
  icon: string;
  visible: boolean;
  createdAt: number;
}

export interface SearchHistoryItem {
  name: string;
  lat: number;
  lng: number;
  searchedAt: number;
}

export interface TourTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
  updatedAt: number;
}

export interface RigProfile {
  nickname?: string;
  vehicle_type: string;
  year: string;
  make: string;
  model: string;
  trim?: string;
  drive: string;
  has_low_range?: boolean;
  lift_in: string;
  suspension?: string;
  tire_size?: string;
  tire_diameter_in?: string;
  tire_type?: string;
  full_size_spare?: boolean;
  spare_count?: string;
  ground_clearance_in: string;
  length_ft: string;
  width_in?: string;
  height_ft?: string;
  wheelbase_in?: string;
  approach_angle_deg?: string;
  departure_angle_deg?: string;
  breakover_angle_deg?: string;
  fuel_range_miles?: string;
  fuel_mpg?: string;
  tank_capacity_gal?: string;
  water_capacity_gal?: string;
  payload_lbs?: string;
  has_winch?: boolean;
  winch_lbs?: string;
  locking_diffs?: string;
  has_skids?: boolean;
  has_rack?: boolean;
  has_recovery_points?: boolean;
  has_traction_boards?: boolean;
  has_air_compressor?: boolean;
  has_rock_sliders?: boolean;
  max_trail_difficulty?: string;
  max_water_depth_in?: string;
  avoid_narrow_trails?: boolean;
  avoid_body_damage?: boolean;
  is_towing?: boolean;
  trailer_length_ft?: string;
  tow_capacity_lbs?: string;
}

export interface TripHistoryItem {
  trip_id: string;
  trip_name: string;
  states: string[];
  duration_days: number;
  est_miles: number;
  planned_at: number;
}

export type WeatherUnitMode = 'auto' | 'imperial' | 'metric';

interface AppState {
  user: User | null;
  token: string | null;
  authHydrated: boolean;
  activeTrip: TripResult | null;
  rigProfile: RigProfile | null;
  tripHistory: TripHistoryItem[];
  themeMode: 'light' | 'dark';
  weatherUnitMode: WeatherUnitMode;
  userLoc: { lat: number; lng: number } | null;
  mapboxToken: string;
  sessionId: string;
  liveReports: Report[];
  cachedRegions: string[];
  favoriteCamps: CampsitePin[];
  savedPlaces: SavedPlace[];
  waterSpots: WaterSpot[];
  catchLogs: CatchLog[];
  waterRoutes: WaterRoute[];
  markerGroups: MarkerGroup[];
  searchHistory: SearchHistoryItem[];
  offlineTripIds: string[];
  activeTripFromCache: boolean;
  pendingSavedTrailId: string | null;
  pendingRouteFlyover: { runId: number; source: 'route_builder' } | null;
  pendingNavigatePlace: { lat: number; lng: number; name: string } | null;
  pendingMapSelection:
    | { kind: 'camp'; camp: CampsitePin }
    | { kind: 'place'; place: SavedPlace }
    | { kind: 'trail'; trail: SavedPlace }
    | { kind: 'explorePlace'; place: ExploreMapSelection }
    | null;
  pendingStartCopilotVoice: boolean;
  pendingOpenOfflineModal: boolean;
  pendingOfflineTrip: TripResult | null;
  pendingOfflineReturnContext: OfflineManagerReturnContext;
  pendingRouteActivityOffer: PendingRouteActivityOffer | null;
  routeBuildSession: RouteBuildSession | null;
  tabBarHidden: boolean;
  tabBarHiddenReasons: TabBarHiddenReasons;
  hasPlan: boolean;
  planExpiresAt: number | null;
  guidedTourRunId: number;
  guidedTourActive: boolean;
  welcomePromptRunId: number;
  welcomeSetupRunId: number;
  tourTargets: Record<string, TourTargetRect>;
  setAuth: (token: string, user: User) => void;
  setAuthHydrated: (hydrated: boolean) => void;
  signOut: () => Promise<void>;
  clearAuthAndLocalData: () => Promise<void>;
  setActiveTrip: (
    trip: TripResult | null,
    fromCache?: boolean,
    options?: { mirrorRepository?: boolean },
  ) => void;
  setTabBarHidden: (hidden: boolean, reason?: string) => void;
  setRigProfile: (rig: RigProfile) => void;
  addTripToHistory: (item: TripHistoryItem) => void;
  removeTripFromHistory: (tripId: string) => void;
  removeTripsFromHistory: (tripIds: string[], expectedOwnerScope: string) => Promise<void>;
  setThemeMode: (mode: 'light' | 'dark') => void;
  setWeatherUnitMode: (mode: WeatherUnitMode) => void;
  setUserLoc: (loc: { lat: number; lng: number } | null) => void;
  setMapboxToken: (token: string) => void;
  setSessionId: (id: string) => void;
  addLiveReport: (report: Report) => void;
  setLiveReports: (reports: Report[]) => void;
  addCachedRegion: (label: string) => void;
  removeCachedRegion: (label: string) => void;
  toggleFavorite: (camp: CampsitePin) => void;
  addSavedPlace: (p: SavedPlace) => void;
  removeSavedPlace: (id: string) => void;
  addWaterSpot: (spot: WaterSpot) => void;
  removeWaterSpot: (id: string) => void;
  addCatchLog: (log: CatchLog) => void;
  removeCatchLog: (id: string) => void;
  addWaterRoute: (route: WaterRoute) => void;
  removeWaterRoute: (id: string) => void;
  addMarkerGroup: (g: MarkerGroup) => void;
  updateMarkerGroup: (id: string, updates: Partial<MarkerGroup>) => void;
  removeMarkerGroup: (id: string) => void;
  addSearchHistory: (item: SearchHistoryItem) => void;
  clearSearchHistory: () => void;
  setOfflineTripIds: (ids: string[]) => void;
  setPendingSavedTrailId: (id: string | null) => void;
  setPendingRouteFlyover: (request: AppState['pendingRouteFlyover']) => void;
  setPendingNavigatePlace: (place: { lat: number; lng: number; name: string } | null) => void;
  setPendingMapSelection: (selection: AppState['pendingMapSelection']) => void;
  setPendingStartCopilotVoice: (start: boolean) => void;
  setPendingOpenOfflineModal: (open: boolean) => void;
  setPendingOfflineTrip: (trip: TripResult | null) => void;
  setPendingOfflineReturnContext: (context: OfflineManagerReturnContext) => void;
  setPendingRouteActivityOffer: (offer: PendingRouteActivityOffer | null) => void;
  startRouteBuildSession: (input: StartRouteBuildSessionInput) => void;
  updateRouteBuildSession: (requestId: string, patch: RouteBuildSessionPatch) => void;
  cancelRouteBuildSession: (requestId?: string) => void;
  clearRouteBuildSession: (requestId?: string) => void;
  chooseRouteBuildActivities: (requestId: string, choice: Exclude<RouteBuildActivityChoice, 'pending'>) => void;
  setPlan: (active: boolean, expiresAt?: number | null) => void;
  startGuidedTour: () => void;
  setGuidedTourActive: (active: boolean) => void;
  startWelcomePrompt: () => void;
  startWelcomeSetup: () => void;
  setTourTarget: (key: string, rect: Omit<TourTargetRect, 'updatedAt'> | null) => void;
  restoreActiveTrip: () => Promise<void>;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  token: null,
  authHydrated: false,
  activeTrip: null,
  rigProfile: null,
  tripHistory: [],
  themeMode: 'light',
  weatherUnitMode: 'auto',
  userLoc: null,
  mapboxToken: '',
  sessionId: 'sess_' + Math.random().toString(36).slice(2, 12),
  liveReports: [],
  cachedRegions: [],
  favoriteCamps: [],
  savedPlaces: [],
  waterSpots: [],
  catchLogs: [],
  waterRoutes: [],
  markerGroups: [],
  searchHistory: [],
  offlineTripIds: [],
  activeTripFromCache: false,
  pendingSavedTrailId: null,
  pendingRouteFlyover: null,
  pendingNavigatePlace: null,
  pendingMapSelection: null,
  pendingStartCopilotVoice: false,
  pendingOpenOfflineModal: false,
  pendingOfflineTrip: null,
  pendingOfflineReturnContext: null,
  pendingRouteActivityOffer: null,
  routeBuildSession: null,
  tabBarHidden: false,
  tabBarHiddenReasons: {},
  hasPlan: false,
  planExpiresAt: null,
  guidedTourRunId: 0,
  guidedTourActive: false,
  welcomePromptRunId: 0,
  welcomeSetupRunId: 0,
  tourTargets: {},

  setAuth: (token, user) => {
    if (accountLocalWriteBlockDepth > 0) pendingAuthPersistence = { token, user };
    else {
      accountSet('trailhead_token', token);
      accountSet('trailhead_user', JSON.stringify(user));
    }
    set((state) => ({
      token, user,
      activeTrip: state.activeTrip,
      rigProfile: state.rigProfile,
      tripHistory: state.tripHistory,
      favoriteCamps: state.favoriteCamps,
    }));
    if (accountLocalWriteBlockDepth === 0) {
      void syncCarNavigationSnapshot({
        trip: useStore.getState().activeTrip,
        account: buildCarAccountState(user, Boolean(token), Date.now(), useStore.getState().hasPlan),
        mapboxAccessToken: useStore.getState().mapboxToken,
      }).catch(() => {});
      void setCarReportSession(user.id, token, TRAILHEAD_API_BASE)
        .then(() => requestCarReportFlush())
        .catch(() => false);
    }
  },

  setAuthHydrated: (hydrated) => set({ authHydrated: hydrated }),

  signOut: async () => {
    closeAllRouteBuildRequests();
    pendingAuthPersistence = null;
    const writesDrained = prepareAccountLocalDataErase();
    const externalWritesDrained = beginAccountStorageCleanup();
    const carSnapshotCleared = clearCarNavigationSnapshot().catch(() => {});
    const carReportSessionCleared = clearCarReportSession(true).catch(() => false);
    const freshSession = newSessionId();
    set({
      token: null,
      user: null,
      activeTrip: null,
      activeTripFromCache: false,
      rigProfile: null,
      tripHistory: [],
      favoriteCamps: [],
      savedPlaces: [],
      waterSpots: [],
      catchLogs: [],
      waterRoutes: [],
      markerGroups: [],
      searchHistory: [],
      offlineTripIds: [],
      pendingSavedTrailId: null,
      pendingRouteFlyover: null,
      pendingNavigatePlace: null,
      pendingMapSelection: null,
      pendingStartCopilotVoice: false,
      pendingOpenOfflineModal: false,
      pendingOfflineTrip: null,
      pendingOfflineReturnContext: null,
      pendingRouteActivityOffer: null,
      routeBuildSession: null,
      tabBarHidden: false,
      tabBarHiddenReasons: {},
      userLoc: null,
      sessionId: freshSession,
      hasPlan: false,
      planExpiresAt: null,
    });
    await serializeAccountLocalCleanup(async () => {
      await Promise.all([writesDrained, externalWritesDrained, carSnapshotCleared, carReportSessionCleared]);
      try {
        await Promise.all([
          sd('trailhead_token'),
          sd('trailhead_user'),
          eraseLegacyAccountData(),
          sd(PLAN_KEY),
          sd('trailhead_iap_pending'),
          ss('trailhead_session', freshSession),
        ]);
      } finally {
        endAccountStorageCleanup();
        resumeAccountLocalWrites();
      }
    });
  },

  clearAuthAndLocalData: async () => {
    closeAllRouteBuildRequests();
    pendingAuthPersistence = null;
    const writesDrained = prepareAccountLocalDataErase();
    const externalWritesDrained = beginAccountStorageCleanup();
    const carSnapshotCleared = clearCarNavigationSnapshot().catch(() => {});
    const carReportSessionCleared = clearCarReportSession(true).catch(() => false);
    const freshSession = newSessionId();
    set({
      token: null,
      user: null,
      activeTrip: null,
      activeTripFromCache: false,
      rigProfile: null,
      tripHistory: [],
      favoriteCamps: [],
      savedPlaces: [],
      waterSpots: [],
      catchLogs: [],
      waterRoutes: [],
      markerGroups: [],
      searchHistory: [],
      offlineTripIds: [],
      pendingSavedTrailId: null,
      pendingRouteFlyover: null,
      pendingNavigatePlace: null,
      pendingMapSelection: null,
      pendingStartCopilotVoice: false,
      pendingOpenOfflineModal: false,
      pendingOfflineTrip: null,
      pendingOfflineReturnContext: null,
      pendingRouteActivityOffer: null,
      routeBuildSession: null,
      tabBarHidden: false,
      tabBarHiddenReasons: {},
      userLoc: null,
      sessionId: freshSession,
      hasPlan: false,
      planExpiresAt: null,
    });
    await serializeAccountLocalCleanup(async () => {
      await Promise.all([writesDrained, externalWritesDrained, carSnapshotCleared, carReportSessionCleared]);
      try {
        await Promise.all([
          sd('trailhead_token'),
          sd('trailhead_user'),
          eraseLegacyAccountData(),
          sd(PLAN_KEY),
          sd('trailhead_iap_pending'),
          ss('trailhead_session', freshSession),
        ]);
      } finally {
        endAccountStorageCleanup();
        resumeAccountLocalWrites();
      }
    });
  },

  setActiveTrip: (trip, fromCache = false, options) => {
    if (!accountLocalMutationAllowed()) return;
    const previousTripId = useStore.getState().activeTrip?.trip_id ?? null;
    if (trip) saveTripFile(trip);
    else {
      deleteTripFile();
      sd('trailhead_active_trip');
      sd('trailhead_active_route');
    }
    set({ activeTrip: trip, activeTripFromCache: fromCache });
    const current = useStore.getState();
    void syncCarNavigationSnapshot({
      trip,
      account: buildCarAccountState(current.user, Boolean(current.token), Date.now(), current.hasPlan),
      mapboxAccessToken: current.mapboxToken,
    }).catch(() => {});
    if (options?.mirrorRepository !== false) scheduleActiveTripMirror(trip, previousTripId);
  },

  setTabBarHidden: (hidden, reason = 'legacy') => set(state => {
    const tabBarHiddenReasons = updateTabBarHiddenReasons(state.tabBarHiddenReasons ?? {}, reason, hidden);
    return {
      tabBarHiddenReasons,
      tabBarHidden: tabBarIsHidden(tabBarHiddenReasons),
    };
  }),

  setRigProfile: (rig) => {
    if (!accountLocalMutationAllowed()) return;
    accountSet('trailhead_rig', JSON.stringify(rig));
    saveRigFile(rig);
    set({ rigProfile: rig });
  },

  addTripToHistory: (item) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = [item, ...state.tripHistory.filter(t => t.trip_id !== item.trip_id)];
      accountSet('trailhead_history', JSON.stringify(updated));
      return { tripHistory: updated };
    });
  },

  removeTripFromHistory: (tripId) => {
    if (!accountLocalMutationAllowed()) return;
    const activeWasRemoved = useStore.getState().activeTrip?.trip_id === tripId;
    set((state) => {
      const updated = state.tripHistory.filter(t => t.trip_id !== tripId);
      accountSet('trailhead_history', JSON.stringify(updated));
      return { tripHistory: updated };
    });
    if (activeWasRemoved) useStore.getState().setActiveTrip(null);
  },

  removeTripsFromHistory: async (tripIds, expectedOwnerScope) => {
    const ids = new Set(tripIds.map(id => String(id || '').trim()).filter(Boolean));
    if (ids.size === 0) return;
    let removedActiveTripId: string | null = null;
    const completed = await accountLocalWrite(async () => {
      if (getTripRepositorySnapshot().ownerScope !== expectedOwnerScope) {
        throw new Error('The active account changed while trips were being removed.');
      }
      const state = useStore.getState();
      const updated = state.tripHistory.filter(item => !ids.has(item.trip_id));
      const activeWasRemoved = Boolean(state.activeTrip?.trip_id && ids.has(state.activeTrip.trip_id));
      removedActiveTripId = activeWasRemoved ? state.activeTrip?.trip_id ?? null : null;
      useStore.setState({ tripHistory: updated });
      await ss('trailhead_history', JSON.stringify(updated));
      if (getTripRepositorySnapshot().ownerScope !== expectedOwnerScope) {
        throw new Error('The active account changed while trips were being removed.');
      }
      return true;
    });
    if (completed !== true) {
      throw new Error('Trip history is unavailable while account data is changing.');
    }
    if (
      removedActiveTripId &&
      getTripRepositorySnapshot().ownerScope === expectedOwnerScope &&
      useStore.getState().activeTrip?.trip_id === removedActiveTripId
    ) {
      useStore.getState().setActiveTrip(null);
    }
  },

  setThemeMode: (mode) => {
    ss('trailhead_theme', mode);
    set({ themeMode: mode });
  },
  setWeatherUnitMode: (mode) => {
    const clean = mode === 'imperial' || mode === 'metric' ? mode : 'auto';
    ss('trailhead_weather_units', clean);
    set({ weatherUnitMode: clean });
  },

  setUserLoc: (loc) => {
    if (!accountLocalMutationAllowed()) return;
    set({ userLoc: loc });
  },
  setMapboxToken: (token) => {
    set({ mapboxToken: token });
    const current = useStore.getState();
    void syncCarNavigationSnapshot({
      trip: current.activeTrip,
      account: buildCarAccountState(current.user, Boolean(current.token), Date.now(), current.hasPlan),
      mapboxAccessToken: token,
    }).catch(() => {});
  },
  addLiveReport: (report) => set(state => ({
    liveReports: [report, ...state.liveReports.filter(r => r.id !== report.id)].slice(0, 100),
  })),
  setLiveReports: (reports) => set({ liveReports: reports }),
  addCachedRegion: (label) => set(state => {
    const updated = [label, ...state.cachedRegions.filter(r => r !== label)].slice(0, 20);
    ss('trailhead_cached_regions', JSON.stringify(updated));
    return { cachedRegions: updated };
  }),
  removeCachedRegion: (label) => set(state => {
    const updated = state.cachedRegions.filter(r => r !== label);
    ss('trailhead_cached_regions', JSON.stringify(updated));
    return { cachedRegions: updated };
  }),
  setSessionId: (id) => {
    ss('trailhead_session', id);
    set({ sessionId: id });
  },

  setOfflineTripIds: (ids) => { if (accountLocalMutationAllowed()) set({ offlineTripIds: ids }); },
  setPendingSavedTrailId: (id) => { if (accountLocalMutationAllowed()) set({ pendingSavedTrailId: id }); },
  setPendingRouteFlyover: (request) => { if (accountLocalMutationAllowed()) set({ pendingRouteFlyover: request }); },
  setPendingNavigatePlace: (place) => { if (accountLocalMutationAllowed()) set({ pendingNavigatePlace: place }); },
  setPendingMapSelection: (selection) => { if (accountLocalMutationAllowed()) set({ pendingMapSelection: selection }); },
  setPendingStartCopilotVoice: (start) => { if (accountLocalMutationAllowed()) set({ pendingStartCopilotVoice: start }); },
  setPendingOpenOfflineModal: (open) => { if (accountLocalMutationAllowed()) set({ pendingOpenOfflineModal: open }); },
  setPendingOfflineTrip: (trip) => { if (accountLocalMutationAllowed()) set({ pendingOfflineTrip: trip }); },
  setPendingOfflineReturnContext: (context) => { if (accountLocalMutationAllowed()) set({ pendingOfflineReturnContext: context }); },
  setPendingRouteActivityOffer: (offer) => {
    if (!accountLocalMutationAllowed()) return;
    set(state => {
      const session = state.routeBuildSession;
      const linkedSession = offer
        && session
        && session.tripId === offer.tripId
        && session.status !== 'cancelled'
        && session.status !== 'failed'
        ? {
            ...session,
            activityOfferTripId: offer.tripId,
            activityOfferCreatedAt: offer.createdAt,
            updatedAt: Date.now(),
          }
        : session;
      return { pendingRouteActivityOffer: offer, routeBuildSession: linkedSession };
    });
  },
  startRouteBuildSession: (input) => {
    if (!accountLocalMutationAllowed()) return;
    const previous = useStore.getState().routeBuildSession;
    if (previous?.status === 'running') closeRouteBuildRequest(previous.requestId, true);
    openRouteBuildRequest(input.requestId);
    set({ routeBuildSession: createRouteBuildSession(input) });
  },
  updateRouteBuildSession: (requestId, patch) => {
    if (!accountLocalMutationAllowed()) return;
    set(state => {
      const next = updateRouteBuildSessionState(state.routeBuildSession, requestId, patch);
      if (next?.requestId === requestId && next.status !== 'running') closeRouteBuildRequest(requestId);
      return next === state.routeBuildSession ? state : { routeBuildSession: next };
    });
  },
  cancelRouteBuildSession: (requestId) => {
    const current = useStore.getState().routeBuildSession;
    if (!current || (requestId && current.requestId !== requestId)) return;
    closeRouteBuildRequest(current.requestId, true);
    set(state => ({ routeBuildSession: cancelRouteBuildSessionState(state.routeBuildSession, requestId) }));
  },
  clearRouteBuildSession: (requestId) => {
    const current = useStore.getState().routeBuildSession;
    if (!current || (requestId && current.requestId !== requestId)) return;
    closeRouteBuildRequest(current.requestId, true);
    set({ routeBuildSession: null });
  },
  chooseRouteBuildActivities: (requestId, choice) => {
    const current = useStore.getState().routeBuildSession;
    if (!current
      || current.requestId !== requestId
      || current.status !== 'running'
      || current.phase !== 'activities') return;
    if (current.activityChoice === 'browse' && choice === 'skip') {
      cancelRouteBuildActivitySearch(requestId);
      set({ routeBuildSession: { ...current, activityChoice: 'skip', updatedAt: Date.now() } });
      return;
    }
    if (current.activityChoice !== 'pending') return;
    set({ routeBuildSession: { ...current, activityChoice: choice, updatedAt: Date.now() } });
    resolveRouteBuildActivityChoice(requestId, choice);
  },
  setPlan: (active, expiresAt = null) => {
    if (!accountLocalMutationAllowed()) return;
    sd(PLAN_KEY);
    set({ hasPlan: active, planExpiresAt: expiresAt });
    const current = useStore.getState();
    void syncCarNavigationSnapshot({
      trip: current.activeTrip,
      account: buildCarAccountState(current.user, Boolean(current.token), Date.now(), active),
      mapboxAccessToken: current.mapboxToken,
    }).catch(() => {});
  },
  startGuidedTour: () => set(state => ({ guidedTourRunId: state.guidedTourRunId + 1, guidedTourActive: true })),
  setGuidedTourActive: (active) => set({ guidedTourActive: active }),
  startWelcomePrompt: () => set(state => ({ welcomePromptRunId: state.welcomePromptRunId + 1 })),
  startWelcomeSetup: () => set(state => ({ welcomeSetupRunId: state.welcomeSetupRunId + 1 })),
  setTourTarget: (key, rect) => set((state) => {
    const next = { ...state.tourTargets };
    if (!rect) delete next[key];
    else next[key] = { ...rect, updatedAt: Date.now() };
    return { tourTargets: next };
  }),

  restoreActiveTrip: async () => {
    if (!accountLocalMutationAllowed()) return;
    const trip = await loadTripFile();
    if (trip && accountLocalMutationAllowed()) set({ activeTrip: trip });
  },

  toggleFavorite: (camp) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
    const exists = state.favoriteCamps.some(f => f.id === camp.id);
    const updated = exists
      ? state.favoriteCamps.filter(f => f.id !== camp.id)
      : [camp, ...state.favoriteCamps];
    if (exists) {
      removeMirroredEntity(camp.id);
    } else {
      const photos = (camp.photos ?? []).flatMap(photo => {
        if (typeof photo === 'string') return photo ? [{ url: photo, kind: 'image' as const }] : [];
        return photo?.url ? [{ url: photo.url, kind: 'image' as const, credit: photo.credit, caption: photo.caption, source: photo.source }] : [];
      });
      mirrorSavedEntity({
        id: camp.id,
        title: camp.name,
        kind: 'camp',
        lat: camp.lat,
        lng: camp.lng,
        summary: camp.description,
        category: camp.land_type || 'Camp',
        source: camp.source_badge || camp.verified_source || camp.source,
        sourceUrl: camp.official_url || camp.url,
        media: photos,
        facts: { reservable: camp.reservable, booking_url: camp.booking_url, amenities: camp.amenities },
      });
    }
      return { favoriteCamps: updated };
    });
  },

  addSavedPlace: (p) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
    const updated = [p, ...state.savedPlaces.filter(x => x.id !== p.id)];
    const kind = savedPlaceKind(p);
    mirrorSavedEntity({
      id: p.id,
      title: p.name,
      kind,
      lat: p.lat,
      lng: p.lng,
      summary: p.note,
      category: p.icon,
      note: p.note,
      source: p.sourceLabel,
      facts: { trail_id: p.trailId, geometry_ref: p.geometryRef },
    });
      return { savedPlaces: updated };
    });
  },
  removeSavedPlace: (id) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = state.savedPlaces.filter(x => x.id !== id);
      removeMirroredEntity(id);
      return { savedPlaces: updated };
    });
  },

  addWaterSpot: (spot) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = [spot, ...state.waterSpots.filter(x => x.id !== spot.id)];
      accountSet('trailhead_water_spots', JSON.stringify(updated));
      mirrorSavedEntity({
        id: spot.id,
        title: spot.name,
        kind: 'water',
        lat: spot.lat,
        lng: spot.lng,
        category: spot.kind,
        note: spot.note,
        source: spot.source,
        facts: { depth_range_ft: spot.depthRangeFt, structure: spot.structure, species: spot.speciesTargets },
      });
      return { waterSpots: updated };
    });
  },
  removeWaterSpot: (id) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = state.waterSpots.filter(x => x.id !== id);
      accountSet('trailhead_water_spots', JSON.stringify(updated));
      removeMirroredEntity(id);
      return { waterSpots: updated };
    });
  },

  addCatchLog: (log) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = [log, ...state.catchLogs.filter(x => x.id !== log.id)].slice(0, 1000);
      accountSet('trailhead_catch_logs', JSON.stringify(updated));
      return { catchLogs: updated };
    });
  },
  removeCatchLog: (id) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = state.catchLogs.filter(x => x.id !== id);
      accountSet('trailhead_catch_logs', JSON.stringify(updated));
      return { catchLogs: updated };
    });
  },

  addWaterRoute: (route) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = [route, ...state.waterRoutes.filter(x => x.id !== route.id)].slice(0, 100);
      accountSet('trailhead_water_routes', JSON.stringify(updated));
      return { waterRoutes: updated };
    });
  },
  removeWaterRoute: (id) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = state.waterRoutes.filter(x => x.id !== id);
      accountSet('trailhead_water_routes', JSON.stringify(updated));
      return { waterRoutes: updated };
    });
  },

  addMarkerGroup: (g) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = [...state.markerGroups, g];
      accountSet('trailhead_marker_groups', JSON.stringify(updated));
      return { markerGroups: updated };
    });
  },
  updateMarkerGroup: (id, updates) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = state.markerGroups.map(g => g.id === id ? { ...g, ...updates } : g);
      accountSet('trailhead_marker_groups', JSON.stringify(updated));
      return { markerGroups: updated };
    });
  },
  removeMarkerGroup: (id) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const updated = state.markerGroups.filter(g => g.id !== id);
      accountSet('trailhead_marker_groups', JSON.stringify(updated));
      return { savedPlaces: state.savedPlaces.filter(p => p.groupId !== id), markerGroups: updated };
    });
  },

  addSearchHistory: (item) => {
    if (!accountLocalMutationAllowed()) return;
    set((state) => {
      const deduped = state.searchHistory.filter(h => h.name !== item.name);
      const updated = [item, ...deduped].slice(0, 30);
      accountSet('trailhead_search_history', JSON.stringify(updated));
      return { searchHistory: updated };
    });
  },
  clearSearchHistory: () => {
    if (!accountLocalMutationAllowed()) return;
    accountLocalWrite(() => sd('trailhead_search_history'));
    set({ searchHistory: [] });
  },
}));

// Account-local state is restored only after RootLayout resolves who owns it.
export async function restoreLegacyAccountState() {
  try {
    const [rigRaw, historyRaw, favRaw, activeTripRaw, planRaw, savedPlacesRaw,
           waterSpotsRaw, catchLogsRaw, waterRoutesRaw, markerGroupsRaw, searchHistoryRaw] = await Promise.all([
      sg('trailhead_rig'),
      sg('trailhead_history'),
      sg('trailhead_favorites'),
      sg('trailhead_active_trip'),
      sg(PLAN_KEY),
      sg('trailhead_saved_places'),
      sg('trailhead_water_spots'),
      sg('trailhead_catch_logs'),
      sg('trailhead_water_routes'),
      sg('trailhead_marker_groups'),
      sg('trailhead_search_history'),
    ]);
    const patch: Partial<AppState> = {};
    const rigFromFile = !rigRaw ? await loadRigFile() : null;
    if (rigRaw) {
      const rig = JSON.parse(rigRaw) as RigProfile;
      patch.rigProfile = rig;
      saveRigFile(rig);
    } else if (rigFromFile) {
      patch.rigProfile = rigFromFile;
      accountSet('trailhead_rig', JSON.stringify(rigFromFile));
    }
    if (historyRaw) patch.tripHistory = JSON.parse(historyRaw);
    if (favRaw) patch.favoriteCamps = JSON.parse(favRaw);
    if (savedPlacesRaw) patch.savedPlaces = JSON.parse(savedPlacesRaw);
    if (waterSpotsRaw) patch.waterSpots = JSON.parse(waterSpotsRaw);
    if (catchLogsRaw) patch.catchLogs = JSON.parse(catchLogsRaw);
    if (waterRoutesRaw) patch.waterRoutes = JSON.parse(waterRoutesRaw);
    if (markerGroupsRaw) patch.markerGroups = JSON.parse(markerGroupsRaw);
    if (searchHistoryRaw) patch.searchHistory = JSON.parse(searchHistoryRaw);
    if (planRaw) sd(PLAN_KEY);
    const tripFromFile = await loadTripFile();
    if (tripFromFile) {
      patch.activeTrip = tripFromFile;
      patch.activeTripFromCache = true;
    } else if (activeTripRaw) {
      try {
        const trip = JSON.parse(activeTripRaw);
        patch.activeTrip = trip;
        patch.activeTripFromCache = true;
        saveTripFile(trip);
      } catch {}
    }
    if (Object.keys(patch).length > 0) useStore.setState(patch);
    const current = useStore.getState();
    void syncCarNavigationSnapshot({
      trip: current.activeTrip,
      account: buildCarAccountState(current.user, Boolean(current.token), Date.now(), current.hasPlan),
      mapboxAccessToken: current.mapboxToken,
    }).catch(() => {});
  } catch {}
}

function clearLegacyAccountStateFromMemory() {
  closeAllRouteBuildRequests();
  useStore.setState({
    activeTrip: null,
    activeTripFromCache: false,
    rigProfile: null,
    tripHistory: [],
    favoriteCamps: [],
    savedPlaces: [],
    waterSpots: [],
    catchLogs: [],
    waterRoutes: [],
    markerGroups: [],
    searchHistory: [],
    offlineTripIds: [],
    pendingSavedTrailId: null,
    pendingRouteFlyover: null,
    pendingNavigatePlace: null,
    pendingMapSelection: null,
    pendingStartCopilotVoice: false,
    pendingOpenOfflineModal: false,
    pendingOfflineTrip: null,
    pendingOfflineReturnContext: null,
    pendingRouteActivityOffer: null,
    routeBuildSession: null,
    userLoc: null,
  });
}

export async function separateAnonymousLegacyState() {
  const writesDrained = prepareAccountLocalDataErase();
  const externalWritesDrained = beginAccountStorageCleanup();
  const carSnapshotCleared = clearCarNavigationSnapshot().catch(() => {});
  await cancelActiveTripMirror();
  await serializeAccountLocalCleanup(async () => {
    await Promise.all([writesDrained, externalWritesDrained, carSnapshotCleared]);
    try {
      await stashAnonymousLegacyData();
      clearLegacyAccountStateFromMemory();
      const current = useStore.getState();
      await syncCarNavigationSnapshot({
        trip: null,
        account: buildCarAccountState(current.user, Boolean(current.token), Date.now(), current.hasPlan),
        mapboxAccessToken: current.mapboxToken,
      }).catch(() => {});
    } finally {
      endAccountStorageCleanup();
      resumeAccountLocalWrites();
    }
  });
}

export async function restoreSeparatedAnonymousLegacyState(_clearCurrent = false) {
  return serializeAccountLocalCleanup(async () => {
    const hasStash = await hasAnonymousLegacyStash();
    if (!hasStash && !_clearCurrent) return false;
    const externalWritesDrained = beginAccountStorageCleanup();
    const carSnapshotCleared = _clearCurrent
      ? clearCarNavigationSnapshot().catch(() => {})
      : Promise.resolve();
    const carReportSessionCleared = _clearCurrent
      ? clearCarReportSession(true).catch(() => false)
      : Promise.resolve(false);
    await Promise.all([
      prepareAccountLocalDataErase(),
      externalWritesDrained,
      carSnapshotCleared,
      carReportSessionCleared,
    ]);
    try {
      await eraseLegacyAccountData();
      clearLegacyAccountStateFromMemory();
      if (!hasStash) return false;
      const restored = await restoreAnonymousLegacyData();
      if (restored) await restoreLegacyAccountState();
      return restored;
    } finally {
      endAccountStorageCleanup();
      resumeAccountLocalWrites();
    }
  });
}

// Device preferences and downloaded map regions do not belong to an account.
void (async () => {
  try {
    const [themeRaw, weatherUnitsRaw, sessionRaw, cachedRegionsRaw] = await Promise.all([
      sg('trailhead_theme'),
      sg('trailhead_weather_units'),
      sg('trailhead_session'),
      sg('trailhead_cached_regions'),
    ]);
    const patch: Partial<AppState> = {
      themeMode: themeRaw === 'dark' ? 'dark' : 'light',
      weatherUnitMode: weatherUnitsRaw === 'imperial' || weatherUnitsRaw === 'metric' ? weatherUnitsRaw : 'auto',
    };
    if (cachedRegionsRaw) patch.cachedRegions = JSON.parse(cachedRegionsRaw);
    if (sessionRaw) patch.sessionId = sessionRaw;
    else await ss('trailhead_session', useStore.getState().sessionId);
    useStore.setState(patch);
  } catch {}
})();

let mirroredLibrarySignature = '';
subscribeTripRepository(() => {
  const snapshot = getTripRepositorySnapshot();
  if (!snapshot.initialized) return;
  const signature = `${snapshot.ownerScope}:${snapshot.savedEntities.map(entity => `${entity.id}:${entity.revision}`).join('|')}`;
  if (signature === mirroredLibrarySignature) return;
  mirroredLibrarySignature = signature;
  const camps = snapshot.savedEntities
    .filter(entity => entity.kind === 'camp' && entity.coordinates)
    .map(legacyCampFromEntity);
  const places = snapshot.savedEntities
    .filter(entity => entity.kind !== 'camp' && entity.coordinates)
    .map(legacySavedPlaceFromEntity);
  useStore.setState({ favoriteCamps: camps, savedPlaces: places });
  sd('trailhead_favorites');
  sd('trailhead_saved_places');
});
