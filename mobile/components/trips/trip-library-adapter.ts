import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { accountStorage } from '@/lib/storage';
import {
  api,
  type Campsite,
  type DayPlan,
  type GasStation,
  type Logistics,
  type SavedRouteGeometryPayload,
  type TripResult,
  type Waypoint,
} from '@/lib/api';
import { deleteOfflineTrip, deleteOfflineTrips, getOfflineTripIndex, loadOfflineTrip, saveOfflineTrip } from '@/lib/offlineTrips';
import { useStore, type TripHistoryItem } from '@/lib/store';
import { tripDocumentFromTripResult } from '@/lib/tripCompatibility';
import {
  archiveTrip,
  deleteDraftTrips,
  deleteTrip,
  duplicateTrip,
  getTrip,
  getTripRepositorySnapshot,
  normalizeTripRepositoryScope,
  saveTripNote,
  deleteTripNote,
  TripRepositoryConflictError,
  upsertTrip,
  type SavedEntityV1,
  type TripDocumentV2,
  type TripNoteInput,
  type TripNoteV1,
  type TripRepositoryUserScope,
} from '@/lib/tripRepository';
import type { TripLibraryFilter, TripLibraryItem, TripLibrarySnapshot } from './types';
import { tripPreviewMedia } from './tripPreview';
import { assertTripOperationOwnerScope } from './tripOperationScope';

type TripLibraryInput = {
  activeTrip: TripResult | null;
};

const DEFAULT_LOGISTICS: Logistics = {
  vehicle_recommendation: 'Review road surfaces and access against your vehicle before departure.',
  fuel_strategy: 'Confirm fuel range and add stops before leaving reliable service.',
  water_strategy: 'Carry water for the drive and confirm refill options before departure.',
  permits_needed: 'Check current land manager rules, permits, and closures.',
  best_season: 'Check current weather, fire conditions, and seasonal closures.',
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  const clean = Number(value);
  return Number.isFinite(clean) ? clean : null;
}

function normalizeTime(value: unknown, fallback = Date.now()) {
  const clean = finiteNumber(value);
  if (clean == null || clean <= 0) return fallback;
  return clean < 10_000_000_000 ? clean * 1000 : clean;
}

function validRouteCoordinates(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(point => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const lng = finiteNumber(point[0]);
    const lat = finiteNumber(point[1]);
    if (lng == null || lat == null || Math.abs(lng) > 180 || Math.abs(lat) > 90) return [];
    return [[lng, lat] as [number, number]];
  });
}

function routeGeometryFromDocument(document: TripDocumentV2): SavedRouteGeometryPayload | undefined {
  const route = record(document.route);
  if (!route) return undefined;
  const candidates = [
    route,
    record(route.route_geometry),
    record(route.routeGeometry),
    record(route.geometry),
    record(route.payload),
  ].filter(Boolean) as Record<string, unknown>[];
  for (const candidate of candidates) {
    const coords = validRouteCoordinates(candidate.coords || candidate.coordinates);
    if (coords.length < 2) continue;
    const totalDistance = finiteNumber(candidate.totalDistance ?? candidate.total_distance ?? candidate.distance_m);
    const totalDuration = finiteNumber(candidate.totalDuration ?? candidate.total_duration ?? candidate.duration_s);
    return {
      coords,
      steps: Array.isArray(candidate.steps) ? candidate.steps : undefined,
      legs: Array.isArray(candidate.legs) ? candidate.legs : undefined,
      totalDistance: totalDistance ?? undefined,
      totalDuration: totalDuration ?? undefined,
      tripId: document.id,
      ts: document.updatedAt,
      source: typeof candidate.source === 'string' ? candidate.source : document.source,
    };
  }
  return undefined;
}

function tripResultFromCandidate(value: unknown, document: TripDocumentV2): TripResult | null {
  const candidate = record(value);
  const plan = record(candidate?.plan);
  if (!candidate || !plan || !Array.isArray(plan.waypoints) || !Array.isArray(plan.daily_itinerary)) return null;
  return {
    ...(candidate as unknown as TripResult),
    trip_id: document.id,
    plan: {
      ...(plan as unknown as TripResult['plan']),
      trip_name: document.title,
      states: Array.isArray(plan.states) ? plan.states.map(String).filter(Boolean) : document.regions,
    },
    campsites: Array.isArray(candidate.campsites) ? candidate.campsites as unknown as Campsite[] : [],
    gas_stations: Array.isArray(candidate.gas_stations) ? candidate.gas_stations as unknown as GasStation[] : [],
    route_geometry: (record(candidate.route_geometry) as unknown as SavedRouteGeometryPayload | null)
      ?? routeGeometryFromDocument(document),
    updated_at: document.updatedAt,
    version: document.revision,
  };
}

function legacyTripResult(document: TripDocumentV2): TripResult | null {
  const payload = document.legacy?.payload;
  const root = record(payload);
  const nested = record(root?.payload);
  const nestedLegacy = record(root?.legacy_v1);
  const nestedLegacyPayload = record(nestedLegacy?.payload);
  for (const candidate of [payload, root?.payload, root?.legacy_v1, nestedLegacy?.payload, nested?.payload, nestedLegacyPayload?.payload]) {
    const trip = tripResultFromCandidate(candidate, document);
    if (trip) return trip;
  }
  return null;
}

function waypointFromDocumentItem(document: TripDocumentV2, index: number): Waypoint {
  const item = document.items[index];
  const legacyWaypoint = record(item.facts?.legacyWaypoint);
  return {
    ...((legacyWaypoint ?? {}) as Partial<Waypoint>),
    day: Math.max(1, Math.round(item.day || 1)),
    name: item.title,
    type: item.kind === 'activity' ? 'bookable_experience' : item.kind,
    description: item.summary || '',
    land_type: item.kind,
    notes: item.note || '',
    lat: item.coordinates?.lat,
    lng: item.coordinates?.lng,
    verified_source: item.source,
    needs_review: document.readiness.status !== 'ready',
    verification_note: item.sourceUrl || item.bookingUrl || '',
  };
}

function milesFromDocument(document: TripDocumentV2, legacy = legacyTripResult(document)) {
  const legacyMiles = finiteNumber(legacy?.plan?.total_est_miles);
  if (legacyMiles != null && legacyMiles >= 0) return legacyMiles;
  const legacySummary = record(document.legacy?.payload);
  const summaryMiles = finiteNumber(legacySummary?.est_miles ?? legacySummary?.total_est_miles);
  if (summaryMiles != null && summaryMiles >= 0) return summaryMiles;
  const route = record(document.route);
  const routeMiles = finiteNumber(route?.totalDistanceMi ?? route?.distance_mi ?? route?.miles);
  if (routeMiles != null && routeMiles >= 0) return routeMiles;
  const routeMeters = finiteNumber(route?.totalDistance ?? route?.total_distance ?? route?.distance_m);
  return routeMeters != null && routeMeters > 0 ? routeMeters / 1609.344 : 0;
}

function tripResultFromDocument(document: TripDocumentV2): TripResult {
  const waypoints = document.items.flatMap((item, index) => (
    item.kind === 'note' ? [] : [waypointFromDocumentItem(document, index)]
  ));
  const dayCount = Math.max(
    1,
    document.days.length,
    ...document.items.map(item => Math.max(1, Math.round(item.day || 1))),
  );
  const daysByNumber = new Map(document.days.map(day => [day.day, day]));
  const dailyItinerary: DayPlan[] = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1;
    const day = daysByNumber.get(dayNumber);
    const highlights = document.items.filter(item => item.day === dayNumber && item.kind !== 'note').map(item => item.title);
    return {
      day: dayNumber,
      title: day?.title || `Day ${dayNumber}`,
      description: day?.summary || (highlights.length ? highlights.join(', ') : 'Route details are ready to be added.'),
      est_miles: 0,
      road_type: 'Review route',
      highlights,
    };
  });
  const campsites: Campsite[] = document.items.flatMap(item => item.kind === 'camp' && item.coordinates ? [{
    id: item.entityId || item.id,
    name: item.title,
    lat: item.coordinates.lat,
    lng: item.coordinates.lng,
    reservable: Boolean(item.bookingUrl),
    description: item.summary || item.note || '',
    url: item.bookingUrl || item.sourceUrl || '',
    recommended_day: item.day,
    verified_source: item.source,
  }] : []);
  const gasStations: GasStation[] = document.items.flatMap(item => item.kind === 'fuel' && item.coordinates ? [{
    id: item.entityId || item.id,
    name: item.title,
    lat: item.coordinates.lat,
    lng: item.coordinates.lng,
    fuel_types: String(item.facts?.fuel_types || ''),
    address: String(item.facts?.address || item.summary || ''),
    recommended_day: item.day,
  }] : []);
  return {
    trip_id: document.id,
    plan: {
      trip_name: document.title,
      overview: document.summary || 'Open the route to review stops, access, and timing.',
      duration_days: dayCount,
      states: document.regions,
      total_est_miles: milesFromDocument(document, null),
      waypoints,
      daily_itinerary: dailyItinerary,
      logistics: DEFAULT_LOGISTICS,
    },
    campsites,
    gas_stations: gasStations,
    route_geometry: routeGeometryFromDocument(document),
    builder_state: {
      notes: document.notes.map(note => note.body),
      bookings: document.bookings,
    },
    updated_at: document.updatedAt,
    version: document.revision,
  };
}

function hasMapDetail(document: TripDocumentV2) {
  return Boolean(routeGeometryFromDocument(document)) || document.items.some(item => item.coordinates);
}

function libraryStatus(document: TripDocumentV2): TripLibraryFilter {
  if (document.status === 'draft') return 'draft';
  if (document.status === 'archived') return 'archived';
  return 'saved';
}

function availabilityMonitorSummary(alerts: Array<Record<string, unknown>>) {
  const monitors: Record<string, unknown>[] = [];
  const otherAlerts: Record<string, unknown>[] = [];
  for (const alert of alerts) {
    const nestedMonitor = record(alert.monitor);
    const type = String(alert.monitor_type || alert.type || alert.kind || '').toLowerCase();
    const isMonitor = Boolean(nestedMonitor)
      || Boolean(alert.monitor_type)
      || type.includes('availability')
      || type.includes('reservation')
      || type.includes('monitor')
      || Boolean(alert.trailhead_place_id && alert.status);
    if (isMonitor) monitors.push(nestedMonitor ?? alert);
    else otherAlerts.push(alert);
  }
  const active = monitors.filter(monitor => String(monitor.status || '').toLowerCase() === 'active').length;
  const failed = monitors.some(monitor => String(monitor.status || '').toLowerCase() === 'failed');
  return {
    active,
    otherAlerts: otherAlerts.length,
    state: active > 0 ? 'active' as const : failed ? 'attention' as const : monitors.length ? 'inactive' as const : null,
  };
}

function itemFromDocument(
  document: TripDocumentV2,
  activeId: string | null,
  offlineIds: Set<string>,
  activeTrip: TripResult | null,
  savedEntitiesById: ReadonlyMap<string, SavedEntityV1>,
): TripLibraryItem {
  const legacy = legacyTripResult(document);
  const monitors = availabilityMonitorSummary(document.alerts);
  const preview = tripPreviewMedia(document, savedEntitiesById);
  return {
    id: document.id,
    name: document.title || 'Untitled trip',
    regions: document.regions,
    days: Math.max(
      document.days.length,
      ...document.days.map(day => day.day),
      ...document.items.map(item => item.day),
      legacy?.plan?.duration_days || 0,
      0,
    ),
    miles: milesFromDocument(document, legacy),
    stopCount: document.items.filter(item => item.kind !== 'note').length || legacy?.plan?.waypoints?.length || 0,
    updatedAt: normalizeTime(document.updatedAt, document.createdAt),
    status: libraryStatus(document),
    isActive: document.id === activeId,
    isOffline: offlineIds.has(document.id),
    detailAvailable: offlineIds.has(document.id) || Boolean(legacy) || hasMapDetail(document),
    bookingCount: document.bookings.length,
    alertCount: monitors.otherAlerts,
    activeMonitorCount: monitors.active,
    monitorState: monitors.state,
    noteCount: document.notes.length + document.items.filter(item => Boolean(item.note?.trim())).length,
    previewImageUrl: preview.imageUrl,
    previewPins: preview.pins,
    document,
    compatibilityTrip: activeTrip?.trip_id === document.id ? activeTrip : undefined,
  };
}

async function reconcileActiveTrip() {
  const activeTrip = useStore.getState().activeTrip;
  if (!activeTrip?.trip_id) return;
  const current = getTrip(activeTrip.trip_id);
  const activeUpdatedAt = normalizeTime(activeTrip.updated_at, 0);
  if (current && activeUpdatedAt <= current.updatedAt) return;
  const converted = tripDocumentFromTripResult(activeTrip);
  if (!current) {
    await upsertTrip(converted);
    return;
  }
  await upsertTrip({
    ...current,
    title: converted.title,
    summary: converted.summary,
    status: 'active',
    regions: converted.regions,
    days: converted.days,
    items: converted.items,
    offline: { ...current.offline, ...converted.offline },
    route: converted.route,
    legacy: converted.legacy,
    archivedAt: undefined,
  }, { expectedRevision: current.revision });
}

export async function initializeTripLibrary(scope?: TripRepositoryUserScope) {
  const expectedScope = normalizeTripRepositoryScope(scope);
  const snapshot = getTripRepositorySnapshot();
  return snapshot.initialized && snapshot.ownerScope === expectedScope;
}

export async function refreshTripLibraryFromSource() {
  await reconcileActiveTrip();
}

export async function loadTripLibrarySnapshot(input: TripLibraryInput): Promise<TripLibrarySnapshot> {
  const [offlineIndex] = await Promise.all([getOfflineTripIndex()]);
  const repository = getTripRepositorySnapshot();
  const offlineIds = new Set(offlineIndex);
  const savedEntitiesById = new Map(repository.savedEntities.map(entity => [entity.id, entity]));
  const documents = [...repository.trips].sort((left, right) => right.updatedAt - left.updatedAt);
  const activeFromStore = input.activeTrip?.trip_id
    ? documents.find(document => document.id === input.activeTrip?.trip_id && document.status !== 'archived')
    : null;
  const activeDocument = activeFromStore ?? documents.find(document => document.status === 'active') ?? null;
  const activeId = activeDocument?.id ?? null;
  const allTrips = documents.map(document => itemFromDocument(
    document,
    activeId,
    offlineIds,
    input.activeTrip,
    savedEntitiesById,
  ));
  const activeTrip = allTrips.find(item => item.isActive) ?? null;
  const trips = allTrips.filter(item => !item.isActive);
  const counts: Record<TripLibraryFilter, number> = { draft: 0, saved: 0, archived: 0 };
  for (const trip of trips) counts[trip.status] += 1;
  return {
    activeTrip,
    trips,
    savedItems: [...repository.savedEntities].sort((left, right) => right.updatedAt - left.updatedAt),
    counts,
  };
}

async function resolveTrip(item: TripLibraryItem): Promise<TripResult> {
  if (item.compatibilityTrip) return item.compatibilityTrip;
  const currentActive = useStore.getState().activeTrip;
  if (currentActive?.trip_id === item.id) return currentActive;
  const offline = await loadOfflineTrip(item.id);
  if (offline) return offline;
  const legacy = legacyTripResult(item.document);
  if (legacy) return legacy;
  if (!hasMapDetail(item.document)) {
    try {
      const remote = await api.getTrip(item.id);
      if (remote?.plan) return { ...remote, trip_id: item.id };
    } catch {
      // Older account records may not have v1 detail. The canonical document is still usable.
    }
  }
  return tripResultFromDocument(item.document);
}

export async function resolveLibraryTrip(item: TripLibraryItem) {
  const operation = captureAccountOperation();
  try {
    freshDocument(item);
    const trip = await resolveTrip(item);
    requireCurrentAccount(operation);
    return trip;
  } catch (error) {
    throw publicTripError(error, 'This trip could not be loaded. Check your connection and try again.');
  }
}

function historyItemFromTrip(trip: TripResult): TripHistoryItem {
  return {
    trip_id: trip.trip_id,
    trip_name: trip.plan?.trip_name || 'Untitled trip',
    states: trip.plan?.states ?? [],
    duration_days: Number(trip.plan?.duration_days ?? 0),
    est_miles: Number(trip.plan?.total_est_miles ?? 0),
    planned_at: Date.now(),
  };
}

function freshDocument(item: TripLibraryItem) {
  const current = getTrip(item.id);
  if (!current) throw new Error('This trip is no longer in your library.');
  if (current.revision !== item.document.revision) {
    throw new TripRepositoryConflictError(item.id, item.document.revision, current.revision);
  }
  return current;
}

function publicTripError(error: unknown, fallback: string) {
  if (error instanceof TripRepositoryConflictError) {
    return new Error('This trip changed while you were viewing it. Refresh and try again.');
  }
  if (error instanceof Error && error.message === 'This trip is no longer in your library.') return error;
  return new Error(fallback);
}

function captureAccountOperation() {
  const accountId = useStore.getState().user?.id;
  const snapshot = getTripRepositorySnapshot();
  const ownerScope = snapshot.ownerScope;
  const expectedOwnerScope = normalizeTripRepositoryScope(accountId);
  if (!snapshot.initialized || ownerScope !== expectedOwnerScope) {
    throw new Error('Your trips are still loading for this account. Try again.');
  }
  return {
    epoch: accountStorage.epoch(),
    ownerScope,
    accountId,
  };
}

function requireCurrentAccount(operation: ReturnType<typeof captureAccountOperation>) {
  if (
    accountStorage.epoch() !== operation.epoch
    || getTripRepositorySnapshot().ownerScope !== operation.ownerScope
    || String(useStore.getState().user?.id ?? '') !== String(operation.accountId ?? '')
  ) throw new Error('The active account changed while this trip was updating.');
}

function currentNoteDocument(document: TripDocumentV2) {
  const current = getTrip(document.id);
  if (!current) throw new Error('This trip is no longer in your library.');
  if (current.revision !== document.revision) {
    throw new TripRepositoryConflictError(document.id, document.revision, current.revision);
  }
  return current;
}

export async function saveLibraryTripNote(document: TripDocumentV2, input: TripNoteInput) {
  const operation = captureAccountOperation();
  try {
    const current = currentNoteDocument(document);
    const existing = input.id ? current.notes.find(note => note.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('This note is no longer available.');
    let saved: TripDocumentV2;
    if (existing?.day != null && input.day == null) {
      const withoutOldNote = await deleteTripNote(current.id, existing.id, { expectedRevision: current.revision });
      requireCurrentAccount(operation);
      try {
        saved = await saveTripNote(current.id, {
          body: input.body,
          entityId: input.entityId ?? existing.entityId,
        }, { expectedRevision: withoutOldNote.revision });
      } catch (error) {
        requireCurrentAccount(operation);
        await saveTripNote(current.id, {
          body: existing.body,
          day: existing.day,
          entityId: existing.entityId,
        }, { expectedRevision: withoutOldNote.revision }).catch(() => {});
        throw error;
      }
    } else {
      saved = await saveTripNote(current.id, input, { expectedRevision: current.revision });
    }
    requireCurrentAccount(operation);
    return saved;
  } catch (error) {
    if (error instanceof Error && error.message === 'This note is no longer available.') throw error;
    throw publicTripError(error, 'This note could not be saved. Try again.');
  }
}

export async function deleteLibraryTripNote(document: TripDocumentV2, note: TripNoteV1) {
  const operation = captureAccountOperation();
  try {
    const current = currentNoteDocument(document);
    if (!current.notes.some(candidate => candidate.id === note.id)) {
      throw new Error('This note is no longer available.');
    }
    const saved = await deleteTripNote(current.id, note.id, { expectedRevision: current.revision });
    requireCurrentAccount(operation);
    return saved;
  } catch (error) {
    if (error instanceof Error && error.message === 'This note is no longer available.') throw error;
    throw publicTripError(error, 'This note could not be deleted. Try again.');
  }
}

export async function openLibraryTrip(item: TripLibraryItem) {
  const operation = captureAccountOperation();
  try {
    freshDocument(item);
    const trip = await resolveTrip(item);
    requireCurrentAccount(operation);
    const previousActiveTrips = getTripRepositorySnapshot().trips.filter(
      document => document.status === 'active' && document.id !== item.id,
    );
    for (const previousActive of previousActiveTrips) {
      await upsertTrip({ ...previousActive, status: 'completed' }, { expectedRevision: previousActive.revision });
      requireCurrentAccount(operation);
    }
    const current = getTrip(item.id);
    if (!current) throw new Error('This trip is no longer in your library.');
    const activeDocument = current.status === 'active' && current.archivedAt == null
      ? current
      : await upsertTrip({ ...current, status: 'active', archivedAt: undefined }, { expectedRevision: current.revision });
    requireCurrentAccount(operation);
    const compatible = {
      ...trip,
      trip_id: activeDocument.id,
      plan: { ...trip.plan, trip_name: activeDocument.title },
      updated_at: activeDocument.updatedAt,
      version: activeDocument.revision,
    };
    useStore.getState().setActiveTrip(compatible, item.isOffline);
    useStore.getState().addTripToHistory(historyItemFromTrip(compatible));
    await saveOfflineTrip(compatible);
    requireCurrentAccount(operation);
    return compatible;
  } catch (error) {
    throw publicTripError(error, 'This trip could not be opened. Check your connection and try again.');
  }
}

export async function duplicateLibraryTrip(item: TripLibraryItem) {
  const operation = captureAccountOperation();
  try {
    const sourceTrip = await resolveTrip(item);
    requireCurrentAccount(operation);
    freshDocument(item);
    const duplicate = await duplicateTrip(item.id, `${item.name} copy`);
    requireCurrentAccount(operation);
    const compatibilityCopy: TripResult = {
      ...(JSON.parse(JSON.stringify(sourceTrip)) as TripResult),
      trip_id: duplicate.id,
      plan: { ...sourceTrip.plan, trip_name: duplicate.title },
      updated_at: Date.now(),
      version: duplicate.revision,
    };
    const enrichedDuplicate = await upsertTrip({
      ...duplicate,
      legacy: { source: 'trip_duplicate_compatibility', payload: compatibilityCopy },
    }, { expectedRevision: duplicate.revision });
    requireCurrentAccount(operation);
    compatibilityCopy.updated_at = enrichedDuplicate.updatedAt;
    compatibilityCopy.version = enrichedDuplicate.revision;
    await saveOfflineTrip(compatibilityCopy);
    requireCurrentAccount(operation);
    useStore.getState().addTripToHistory(historyItemFromTrip(compatibilityCopy));
    return enrichedDuplicate;
  } catch (error) {
    throw publicTripError(error, 'This trip could not be duplicated. Try again.');
  }
}

export async function saveLibraryTrip(item: TripLibraryItem) {
  const operation = captureAccountOperation();
  try {
    const current = freshDocument(item);
    const compatible = await resolveTrip(item);
    requireCurrentAccount(operation);
    const saved = await upsertTrip({ ...current, status: 'completed', archivedAt: undefined }, { expectedRevision: current.revision });
    requireCurrentAccount(operation);
    const savedTrip = { ...compatible, updated_at: saved.updatedAt, version: saved.revision };
    await saveOfflineTrip(savedTrip);
    requireCurrentAccount(operation);
    useStore.getState().addTripToHistory(historyItemFromTrip(savedTrip));
    return saved;
  } catch (error) {
    throw publicTripError(error, 'This trip could not be saved. Try again.');
  }
}

export async function archiveLibraryTrip(item: TripLibraryItem) {
  const operation = captureAccountOperation();
  try {
    const current = freshDocument(item);
    const archived = await archiveTrip(item.id, { expectedRevision: current.revision });
    requireCurrentAccount(operation);
    if (useStore.getState().activeTrip?.trip_id === item.id) useStore.getState().setActiveTrip(null);
    return archived;
  } catch (error) {
    throw publicTripError(error, 'This trip could not be archived. Try again.');
  }
}

export async function restoreLibraryTrip(item: TripLibraryItem) {
  const operation = captureAccountOperation();
  try {
    const current = freshDocument(item);
    const restored = await upsertTrip({ ...current, status: 'completed', archivedAt: undefined }, { expectedRevision: current.revision });
    requireCurrentAccount(operation);
    return restored;
  } catch (error) {
    throw publicTripError(error, 'This trip could not be restored. Try again.');
  }
}

export async function deleteLibraryTrip(item: TripLibraryItem) {
  const operation = captureAccountOperation();
  try {
    assertTripOperationOwnerScope(item, operation.ownerScope);
    const current = freshDocument(item);
    await deleteTrip(item.id, {
      expectedRevision: current.revision,
      expectedOwnerScope: item.document.ownerScope,
    });
    requireCurrentAccount(operation);
    if (useStore.getState().activeTrip?.trip_id === item.id) useStore.getState().setActiveTrip(null);
    await useStore.getState().removeTripsFromHistory([item.id], operation.ownerScope);
    requireCurrentAccount(operation);
    await deleteOfflineTrip(item.id);
    requireCurrentAccount(operation);
  } catch (error) {
    throw publicTripError(error, 'This trip could not be deleted. Try again.');
  }
}

export async function deleteLibraryDrafts(items: TripLibraryItem[]) {
  const operation = captureAccountOperation();
  try {
    const requests = items.map(item => {
      if (item.document.ownerScope !== operation.ownerScope) {
        throw new Error('One of these trips belongs to a different account.');
      }
      const current = freshDocument(item);
      if (current.status !== 'draft') throw new Error('One of these trips is no longer a draft.');
      return { id: current.id, expectedRevision: current.revision };
    });
    const deletedIds = await deleteDraftTrips(requests, { expectedOwnerScope: operation.ownerScope });
    requireCurrentAccount(operation);
    const activeTripId = useStore.getState().activeTrip?.trip_id;
    if (activeTripId && deletedIds.includes(activeTripId)) useStore.getState().setActiveTrip(null);
    await useStore.getState().removeTripsFromHistory(deletedIds, operation.ownerScope);
    requireCurrentAccount(operation);
    await deleteOfflineTrips(deletedIds);
    requireCurrentAccount(operation);
    return deletedIds;
  } catch (error) {
    throw publicTripError(error, 'These drafts could not be deleted. Refresh and try again.');
  }
}

function xml(value: string) {
  return value.replace(/[<>&'\"]/g, character => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character] ?? character);
}

function gpxForTrip(trip: TripResult) {
  const points = trip.plan?.waypoints ?? [];
  const camps = trip.campsites ?? [];
  const route = trip.route_geometry?.coords ?? [];
  const waypoints = [
    ...points.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)).map(point => (
      `  <wpt lat="${point.lat}" lon="${point.lng}"><name>${xml(point.name)}</name><desc>${xml(point.description || point.notes || '')}</desc></wpt>`
    )),
    ...camps.filter(camp => Number.isFinite(camp.lat) && Number.isFinite(camp.lng)).map(camp => (
      `  <wpt lat="${camp.lat}" lon="${camp.lng}"><name>${xml(camp.name)}</name><type>Camp</type><desc>${xml(camp.description || '')}</desc></wpt>`
    )),
  ];
  const track = route.length >= 2
    ? [
        `  <trk><name>${xml(trip.plan?.trip_name || 'Trailhead trip')}</name><trkseg>`,
        ...route.map(([lng, lat]) => `    <trkpt lat="${lat}" lon="${lng}" />`),
        '  </trkseg></trk>',
      ]
    : [];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trailhead" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xml(trip.plan?.trip_name || 'Trailhead trip')}</name></metadata>`,
    ...waypoints,
    ...track,
    '</gpx>',
  ].join('\n');
}

function safeFilename(value: string) {
  const clean = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return clean || 'trailhead-trip';
}

export async function exportLibraryTrip(item: TripLibraryItem) {
  const storageEpoch = accountStorage.epoch();
  try {
    const trip = await resolveTrip(item);
    const cacheRoot = FileSystem.cacheDirectory;
    const canShareFile = cacheRoot && await Sharing.isAvailableAsync().catch(() => false);
    if (canShareFile) {
      const uri = `${cacheRoot}${safeFilename(trip.plan?.trip_name || item.name)}.gpx`;
      const stored = await accountStorage.run(async () => {
        await FileSystem.writeAsStringAsync(uri, gpxForTrip(trip));
        return true;
      }, storageEpoch);
      if (!stored) return;
      await Sharing.shareAsync(uri, {
        mimeType: 'application/gpx+xml',
        UTI: 'com.topografix.gpx',
        dialogTitle: 'Export trip',
      });
      return;
    }
    const region = trip.plan?.states?.join(', ') || 'Open route';
    await Share.share({
      title: trip.plan?.trip_name || item.name,
      message: `${trip.plan?.trip_name || item.name}\n${region}\n${Math.round(trip.plan?.total_est_miles || 0)} miles across ${trip.plan?.duration_days || 0} days`,
    });
  } catch (error) {
    throw publicTripError(error, 'This trip could not be exported right now.');
  }
}
