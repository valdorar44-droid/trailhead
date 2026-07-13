import type {
  AccountLibraryEntityType,
  AccountLibraryItem,
  AccountLibraryPage,
  AccountLibraryWritePayload,
  AccountTripDocumentPage,
  AccountTripDocumentV2,
  AccountTripDocumentWritePayload,
} from './api';
import { TRAILHEAD_API_BASE } from './apiBase';
import {
  applyTripRepositoryRemoteSavedEntity,
  applyTripRepositoryRemoteSavedEntityTombstone,
  applyTripRepositoryRemoteTrip,
  applyTripRepositoryRemoteTripTombstone,
  acknowledgeTripRepositoryOutbox,
  failTripRepositoryOutbox,
  getTripRepositoryOutbox,
  getTripRepositorySnapshot,
  markTripRepositoryOutboxSyncing,
  retryTripRepositoryOutboxEntries,
  subscribeTripRepository,
  type RepositoryOutboxEntryV1,
  type SavedEntityV1,
  type TripDocumentV2,
  type SavedEntityKind,
  type TripItemKind,
  type TripItemV1,
  type TripNoteV1,
} from './tripRepository';
import {
  hasRunnableTripRepositoryOutboxEntries,
  nextTripRepositoryRetryAt,
  processTripRepositoryOutbox,
  retryEligibleTripRepositoryEntryIds,
} from './tripRepository/syncEngine';
import {
  deleteRemoteTripWithRevisionRebase,
  isOutboxEntrySupersededByDelete,
} from './tripRepository/deleteSync';

export { deleteRemoteTripWithRevisionRebase } from './tripRepository/deleteSync';

export type TripRepositorySyncResult = {
  completed: number;
  remaining: number;
  blockedByConflict: boolean;
  canceled?: boolean;
  error?: string;
};

type ConfiguredSyncIdentity = {
  generation: number;
  ownerScope: string;
  token: string;
};

type ActiveSyncSession = ConfiguredSyncIdentity & {
  controller: AbortController;
};

type ActiveSyncOperation = {
  session: ActiveSyncSession;
  hydrateRequested: boolean;
  promise: Promise<TripRepositorySyncResult>;
};

type ActiveHydrationOperation = {
  session: ActiveSyncSession;
  promise: Promise<{ trips: number; savedEntities: number }>;
};

let identityGeneration = 0;
let configuredIdentity: ConfiguredSyncIdentity | null = null;
let activeSync: ActiveSyncOperation | null = null;
let activeHydration: ActiveHydrationOperation | null = null;
const sessionControllers = new Set<AbortController>();
let autoSyncSubscribers = 0;
let autoSyncUnsubscribe: (() => void) | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean || undefined;
}

function milliseconds(value: unknown): number {
  const clean = Number(value);
  if (!Number.isFinite(clean) || clean <= 0) return Date.now();
  return clean < 10_000_000_000 ? clean * 1000 : clean;
}

const SAVED_KINDS = new Set<SavedEntityKind>(['place', 'camp', 'trail', 'activity', 'fuel', 'water', 'service', 'trip_pack']);
const ITEM_KINDS = new Set<TripItemKind>(['start', 'destination', 'camp', 'trail', 'activity', 'fuel', 'water', 'food', 'service', 'place', 'note']);

function remoteSavedEntity(item: AccountLibraryItem, ownerScope: string): SavedEntityV1 {
  const data = record(item.data);
  const rawKind = String(data.kind || (item.entity_type === 'pack' ? 'trip_pack' : item.entity_type));
  const kind = SAVED_KINDS.has(rawKind as SavedEntityKind) ? rawKind as SavedEntityKind : 'place';
  const coordinates = record(data.coordinates);
  const lat = Number(coordinates.lat);
  const lng = Number(coordinates.lng);
  const media = Array.isArray(data.media)
    ? data.media.flatMap(value => {
        const entry = record(value);
        const url = text(entry.url);
        return url ? [{
          url,
          kind: entry.kind === 'video' ? 'video' as const : 'image' as const,
          credit: text(entry.credit),
          caption: text(entry.caption),
          source: text(entry.source),
        }] : [];
      })
    : [];
  return {
    schemaVersion: 1,
    id: item.canonical_id,
    ownerScope,
    revision: item.revision,
    kind,
    title: item.title,
    summary: text(data.summary),
    category: text(data.category),
    region: text(data.region),
    coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    note: text(data.note),
    source: text(data.source),
    sourceId: text(data.source_id),
    sourceUrl: text(data.source_url),
    bookingUrl: text(data.booking_url),
    media,
    facts: record(data.facts),
    needsEnrichment: typeof data.needs_enrichment === 'boolean' ? data.needs_enrichment : undefined,
    createdAt: milliseconds(data.created_at || item.created_at),
    updatedAt: milliseconds(data.updated_at || item.updated_at),
  };
}

function remoteTripDocument(item: AccountTripDocumentV2, ownerScope: string): TripDocumentV2 {
  const dates = record(item.dates);
  const days = Array.isArray(item.days) ? item.days.map((value, index) => {
    const day = record(value);
    return {
      day: Math.max(1, Number(day.day) || index + 1),
      title: text(day.title) || `Day ${index + 1}`,
      summary: text(day.summary),
      date: text(day.date),
    };
  }) : [];
  const items = Array.isArray(item.items) ? item.items.flatMap((value, index) => {
    const candidate = record(value);
    const title = text(candidate.title);
    if (!title) return [];
    const rawKind = String(candidate.kind || 'place');
    const kind = ITEM_KINDS.has(rawKind as TripItemKind) ? rawKind as TripItemKind : 'place';
    const coordinates = record(candidate.coordinates);
    const lat = Number(coordinates.lat);
    const lng = Number(coordinates.lng);
    return [{
      schemaVersion: 1 as const,
      id: text(candidate.id) || `${item.trip_id}:item:${index}`,
      entityId: text(candidate.entity_id),
      kind,
      title,
      summary: text(candidate.summary),
      day: Math.max(1, Number(candidate.day) || 1),
      order: Math.max(0, Number(candidate.order) || index),
      coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
      note: text(candidate.note),
      source: text(candidate.source),
      sourceUrl: text(candidate.source_url),
      bookingUrl: text(candidate.booking_url),
      startsAt: text(candidate.starts_at),
      endsAt: text(candidate.ends_at),
      facts: record(candidate.facts),
      createdAt: milliseconds(candidate.created_at || item.created_at),
      updatedAt: milliseconds(candidate.updated_at || item.updated_at),
    } satisfies TripItemV1];
  }) : [];
  const notes = Array.isArray(item.notes) ? item.notes.flatMap((value, index) => {
    const candidate = record(value);
    const body = text(candidate.body);
    if (!body) return [];
    return [{
      id: text(candidate.id) || `${item.trip_id}:note:${index}`,
      body,
      day: Number.isFinite(Number(candidate.day)) ? Number(candidate.day) : undefined,
      entityId: text(candidate.entity_id),
      visibility: 'private' as const,
      createdAt: milliseconds(candidate.created_at || item.created_at),
      updatedAt: milliseconds(candidate.updated_at || item.updated_at),
    }];
  }) : [];
  const readiness = record(item.readiness);
  const readinessStatus = readiness.status === 'ready' || readiness.status === 'review' ? readiness.status : 'not_started';
  const legacy = record(item.legacy_v1);
  return {
    schemaVersion: 2,
    id: item.trip_id,
    ownerScope,
    revision: item.revision,
    status: item.status === 'deleted' ? 'archived' : item.status,
    title: item.title,
    summary: item.summary,
    startsOn: item.starts_on || text(dates.starts_on),
    endsOn: item.ends_on || text(dates.ends_on),
    regions: Array.isArray(item.regions) ? item.regions.map(String).filter(Boolean) : [],
    days,
    items,
    notes,
    readiness: { ...readiness, status: readinessStatus },
    bookings: Array.isArray(item.bookings) ? item.bookings.map(record) : [],
    alerts: Array.isArray(item.alerts) ? item.alerts.map(record) : [],
    offline: record(item.offline),
    visibility: item.visibility,
    rigSnapshot: record(item.rig_snapshot),
    route: record(item.route),
    source: item.source,
    createdAt: milliseconds(item.created_at),
    updatedAt: milliseconds(item.updated_at),
    archivedAt: item.archived_at ? milliseconds(item.archived_at) : undefined,
    legacy: Object.keys(legacy).length ? { source: 'server_legacy_v1', payload: legacy } : undefined,
  };
}

function libraryEntityType(entity: SavedEntityV1): AccountLibraryEntityType {
  if (entity.kind === 'trip_pack') return 'pack';
  if (entity.kind === 'fuel' || entity.kind === 'service') return 'place';
  return entity.kind;
}

function savedEntityPayload(entity: SavedEntityV1, expectedRevision: number): AccountLibraryWritePayload {
  return {
    canonical_id: entity.id,
    entity_type: libraryEntityType(entity),
    title: entity.title,
    expected_revision: expectedRevision,
    data: {
      schema_version: entity.schemaVersion,
      kind: entity.kind,
      summary: entity.summary,
      category: entity.category,
      region: entity.region,
      coordinates: entity.coordinates,
      note: entity.note,
      source: entity.source,
      source_id: entity.sourceId,
      source_url: entity.sourceUrl,
      booking_url: entity.bookingUrl,
      media: entity.media,
      facts: entity.facts,
      needs_enrichment: entity.needsEnrichment,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    },
  };
}

function tripItemPayload(item: TripItemV1): Record<string, unknown> {
  return {
    schema_version: item.schemaVersion,
    id: item.id,
    entity_id: item.entityId,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    day: item.day,
    order: item.order,
    coordinates: item.coordinates,
    note: item.note,
    source: item.source,
    source_url: item.sourceUrl,
    booking_url: item.bookingUrl,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
    facts: item.facts,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function tripNotePayload(note: TripNoteV1): Record<string, unknown> {
  return {
    id: note.id,
    body: note.body,
    day: note.day,
    entity_id: note.entityId,
    visibility: 'private',
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  };
}

function tripDocumentPayload(trip: TripDocumentV2, expectedRevision: number): AccountTripDocumentWritePayload {
  const legacyPayload = trip.legacy?.payload;
  const legacy = legacyPayload && typeof legacyPayload === 'object' && !Array.isArray(legacyPayload)
    ? { source: trip.legacy?.source, payload: legacyPayload }
    : trip.legacy?.source
      ? { source: trip.legacy.source }
      : undefined;
  const document: AccountTripDocumentWritePayload['document'] = {
    schema_version: 2,
    trip_id: trip.id,
    status: trip.status,
    title: trip.title,
    summary: trip.summary,
    starts_on: trip.startsOn,
    ends_on: trip.endsOn,
    dates: {
      starts_on: trip.startsOn,
      ends_on: trip.endsOn,
    },
    regions: trip.regions,
    rig_snapshot: trip.rigSnapshot ?? {},
    days: trip.days.map(day => ({
      day: day.day,
      title: day.title,
      summary: day.summary,
      date: day.date,
    })),
    items: trip.items.map(tripItemPayload),
    notes: trip.notes.map(tripNotePayload),
    readiness: { ...trip.readiness },
    bookings: trip.bookings,
    alerts: trip.alerts,
    offline: trip.offline,
    route: trip.route ? { ...trip.route } : undefined,
    visibility: trip.visibility,
    source: trip.source ?? 'trailhead-mobile',
    legacy_v1: legacy,
  };
  return { trip_id: trip.id, expected_revision: expectedRevision, document };
}

class TripRepositorySyncHttpError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = 'TripRepositorySyncHttpError';
    this.status = status;
    this.detail = detail;
  }
}

function sessionIsCurrent(session: ActiveSyncSession): boolean {
  const identity = configuredIdentity;
  return Boolean(
    identity
    && identity.generation === session.generation
    && identity.ownerScope === session.ownerScope
    && identity.token === session.token
    && !session.controller.signal.aborted
    && getTripRepositorySnapshot().ownerScope === session.ownerScope,
  );
}

async function syncRequest<T>(
  session: ActiveSyncSession,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!sessionIsCurrent(session)) throw new Error('Trip repository sync session changed.');
  const response = await fetch(`${TRAILHEAD_API_BASE}${path}`, {
    ...options,
    signal: session.controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${session.token}`,
    },
  });
  const raw = await response.text();
  let payload: unknown = undefined;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = undefined; }
  }
  if (!response.ok) {
    const detail = record(payload).detail ?? payload;
    const detailRecord = record(detail);
    const message = text(typeof detail === 'string' ? detail : detailRecord.message || detailRecord.reason)
      || response.statusText
      || 'Request failed';
    throw new TripRepositorySyncHttpError(message, response.status, detail);
  }
  return payload as T;
}

function libraryListPath(cursor?: string) {
  const query = new URLSearchParams({ limit: '100', include_archived: 'true', include_deleted: 'true' });
  if (cursor) query.set('cursor', cursor);
  return `/api/library?${query.toString()}`;
}

function tripListPath(cursor?: string) {
  const query = new URLSearchParams({ limit: '100', include_archived: 'true', include_deleted: 'true' });
  if (cursor) query.set('cursor', cursor);
  return `/api/trips/v2?${query.toString()}`;
}

function expectedServerRevision(entry: RepositoryOutboxEntryV1): number {
  return Math.max(0, Number(entry.revision ?? 1) - 1);
}

function tripDeleteRebaseMode(entry: RepositoryOutboxEntryV1) {
  const payload = record(entry.payload);
  return payload.kind === 'trip_deletion' && payload.mode === 'explicit'
    ? 'explicit' as const
    : 'draft-only' as const;
}

async function syncSavedEntity(session: ActiveSyncSession, entry: RepositoryOutboxEntryV1) {
  const expectedRevision = expectedServerRevision(entry);
  const encodedId = encodeURIComponent(entry.entityId);
  const headers = { 'Idempotency-Key': entry.idempotencyKey };
  if (entry.operation === 'delete') {
    await syncRequest(session, `/api/library/${encodedId}?expected_revision=${expectedRevision}`, {
      method: 'DELETE',
      headers,
    });
    return;
  }
  const entity = entry.payload as SavedEntityV1 | undefined;
  if (!entity || entity.id !== entry.entityId) throw new Error('Saved item sync record is incomplete.');
  if (entry.operation === 'archive') {
    await syncRequest(session, `/api/library/${encodedId}/archive`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expected_revision: expectedRevision }),
    });
    return;
  }
  const payload = savedEntityPayload(entity, expectedRevision);
  await syncRequest(session, expectedRevision === 0 ? '/api/library' : `/api/library/${encodedId}`, {
    method: expectedRevision === 0 ? 'POST' : 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
}

async function syncTrip(session: ActiveSyncSession, entry: RepositoryOutboxEntryV1) {
  const currentOutbox = getTripRepositoryOutbox();
  const currentEntry = currentOutbox.find(candidate => candidate.id === entry.id) ?? entry;
  if (isOutboxEntrySupersededByDelete(currentEntry, currentOutbox)) return;
  const expectedRevision = expectedServerRevision(entry);
  const encodedId = encodeURIComponent(entry.entityId);
  const headers = { 'Idempotency-Key': entry.idempotencyKey };
  if (entry.operation === 'delete') {
    await deleteRemoteTripWithRevisionRebase(
      entry.entityId,
      expectedRevision,
      entry.idempotencyKey,
      (path, options) => syncRequest(session, path, options),
      { mode: tripDeleteRebaseMode(entry) },
    );
    return;
  }
  const trip = entry.payload as TripDocumentV2 | undefined;
  if (!trip || trip.id !== entry.entityId) throw new Error('Trip sync record is incomplete.');
  if (entry.operation === 'archive') {
    await syncRequest(session, `/api/trips/v2/${encodedId}/archive`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expected_revision: expectedRevision }),
    });
    return;
  }
  const payload = tripDocumentPayload(trip, expectedRevision);
  await syncRequest(session, expectedRevision === 0 ? '/api/trips/v2' : `/api/trips/v2/${encodedId}`, {
    method: expectedRevision === 0 ? 'POST' : 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
}

function publicSyncError(error: unknown): { message: string; conflict: boolean } {
  if (error instanceof TripRepositorySyncHttpError && error.status === 409) {
    return { message: 'This item changed on another device. Your local copy is still saved.', conflict: true };
  }
  if (error instanceof TripRepositorySyncHttpError && error.status === 401) {
    return { message: 'Sign in again to sync trips and saved places.', conflict: false };
  }
  if (error instanceof TripRepositorySyncHttpError && error.status === 403) {
    return { message: 'This account cannot update that item.', conflict: false };
  }
  const message = error instanceof Error && error.message
    ? error.message
    : 'Trips and saved places will sync when a connection is available.';
  return { message, conflict: false };
}

async function preserveRemoteConflict(session: ActiveSyncSession, entry: RepositoryOutboxEntryV1) {
  const ownerScope = session.ownerScope;
  if (entry.entityType === 'trip') {
    const remote = await syncRequest<AccountTripDocumentV2>(
      session,
      `/api/trips/v2/${encodeURIComponent(entry.entityId)}?include_deleted=true`,
    );
    if (remote.status === 'deleted') {
      await applyTripRepositoryRemoteTripTombstone(
        remote.trip_id,
        remote.revision,
        remote.deleted_at ? milliseconds(remote.deleted_at) : undefined,
      );
      return;
    }
    await applyTripRepositoryRemoteTrip(remoteTripDocument(remote, ownerScope));
    return;
  }
  const remote = await syncRequest<AccountLibraryItem>(
    session,
    `/api/library/${encodeURIComponent(entry.entityId)}?include_deleted=true`,
  );
  if (remote.status === 'deleted') {
    await applyTripRepositoryRemoteSavedEntityTombstone(
      remote.canonical_id,
      remote.revision,
      remote.deleted_at ? milliseconds(remote.deleted_at) : undefined,
    );
    return;
  }
  await applyTripRepositoryRemoteSavedEntity(remoteSavedEntity(remote, ownerScope));
}

function sessionFromConfiguredIdentity(): ActiveSyncSession | null {
  const identity = configuredIdentity;
  if (!identity) return null;
  const controller = new AbortController();
  sessionControllers.add(controller);
  return { ...identity, controller };
}

function releaseSession(session: ActiveSyncSession) {
  sessionControllers.delete(session.controller);
}

async function hydrateWithSession(session: ActiveSyncSession): Promise<{ trips: number; savedEntities: number }> {
  const snapshot = getTripRepositorySnapshot();
  if (!snapshot.initialized || snapshot.ownerScope !== session.ownerScope || !sessionIsCurrent(session)) {
    return { trips: 0, savedEntities: 0 };
  }

  let trips = 0;
  let savedEntities = 0;
  let tripCursor: string | undefined;
  const tripCursors = new Set<string>();
  do {
    const page = await syncRequest<AccountTripDocumentPage>(session, tripListPath(tripCursor));
    for (const item of page.items) {
      if (!sessionIsCurrent(session)) return { trips, savedEntities };
      if (item.status === 'deleted') {
        await applyTripRepositoryRemoteTripTombstone(
          item.trip_id,
          item.revision,
          item.deleted_at ? milliseconds(item.deleted_at) : undefined,
        );
        continue;
      }
      await applyTripRepositoryRemoteTrip(remoteTripDocument(item, snapshot.ownerScope));
      trips += 1;
    }
    const next = page.next_cursor || undefined;
    if (next && tripCursors.has(next)) throw new Error('Trip sync returned a repeated page.');
    if (next) tripCursors.add(next);
    tripCursor = next;
  } while (tripCursor);

  let libraryCursor: string | undefined;
  const libraryCursors = new Set<string>();
  do {
    const page = await syncRequest<AccountLibraryPage>(session, libraryListPath(libraryCursor));
    for (const item of page.items) {
      if (!sessionIsCurrent(session)) return { trips, savedEntities };
      if (item.status === 'deleted') {
        await applyTripRepositoryRemoteSavedEntityTombstone(
          item.canonical_id,
          item.revision,
          item.deleted_at ? milliseconds(item.deleted_at) : undefined,
        );
        continue;
      }
      await applyTripRepositoryRemoteSavedEntity(remoteSavedEntity(item, snapshot.ownerScope));
      savedEntities += 1;
    }
    const next = page.next_cursor || undefined;
    if (next && libraryCursors.has(next)) throw new Error('Saved-place sync returned a repeated page.');
    if (next) libraryCursors.add(next);
    libraryCursor = next;
  } while (libraryCursor);
  return { trips, savedEntities };
}

export async function hydrateTripRepositoryFromServer(): Promise<{ trips: number; savedEntities: number }> {
  if (activeHydration) return activeHydration.promise;
  if (activeSync) {
    await activeSync.promise.catch(() => {});
    return hydrateTripRepositoryFromServer();
  }
  const session = sessionFromConfiguredIdentity();
  if (!session) return { trips: 0, savedEntities: 0 };
  const promise = hydrateWithSession(session).finally(() => {
    releaseSession(session);
    if (activeHydration?.session === session) activeHydration = null;
    if (hasRunnableTripRepositoryOutboxEntries(getTripRepositoryOutbox())) scheduleAutoSync(0);
    scheduleRetryFromOutbox();
  });
  activeHydration = { session, promise };
  return promise;
}

async function runSync(session: ActiveSyncSession): Promise<TripRepositorySyncResult> {
  const snapshot = getTripRepositorySnapshot();
  if (!snapshot.initialized || snapshot.ownerScope !== session.ownerScope || !sessionIsCurrent(session)) {
    return { completed: 0, remaining: getTripRepositoryOutbox().length, blockedByConflict: false };
  }

  const eligibleRetries = retryEligibleTripRepositoryEntryIds(getTripRepositoryOutbox(), Date.now());
  if (eligibleRetries.length > 0) await retryTripRepositoryOutboxEntries(eligibleRetries);
  const entries = getTripRepositoryOutbox().filter(entry => entry.ownerScope === session.ownerScope);
  const processed = await processTripRepositoryOutbox(entries, {
    isSessionCurrent: () => sessionIsCurrent(session),
    markSyncing: entry => markTripRepositoryOutboxSyncing([entry.id]),
    syncEntry: entry => entry.entityType === 'trip' ? syncTrip(session, entry) : syncSavedEntity(session, entry),
    acknowledge: entry => acknowledgeTripRepositoryOutbox([entry.id]),
    fail: (entry, message) => failTripRepositoryOutbox([entry.id], message),
    resolveFailure: async (entry, error) => {
      const currentOutbox = getTripRepositoryOutbox();
      const currentEntry = currentOutbox.find(candidate => candidate.id === entry.id) ?? entry;
      if (isOutboxEntrySupersededByDelete(currentEntry, currentOutbox)) {
        return { resolved: true, conflict: false, message: 'A newer deletion replaced this change.' };
      }
      const failure = publicSyncError(error);
      if (failure.conflict) {
        if (entry.entityType === 'trip' && entry.operation === 'delete') {
          const draftCleanup = tripDeleteRebaseMode(entry) === 'draft-only';
          return {
            resolved: false,
            conflict: true,
            message: draftCleanup
              ? 'This draft changed on another device. Trailhead will retry deleting it.'
              : 'This trip changed on another device. Trailhead will retry deleting it.',
          };
        }
        try {
          await preserveRemoteConflict(session, entry);
          return { resolved: true, conflict: true, message: 'Changes from both devices were kept as separate copies.' };
        } catch {
          return { resolved: false, conflict: true, message: failure.message };
        }
      }
      return { resolved: false, conflict: false, message: failure.message };
    },
  });
  const remaining = sessionIsCurrent(session) ? getTripRepositoryOutbox().length : entries.length;
  return {
    completed: processed.completed,
    remaining,
    blockedByConflict: processed.blockedByConflict,
    canceled: processed.canceled,
    error: processed.error,
  };
}

function beginTripRepositorySync(hydrateRequested: boolean): Promise<TripRepositorySyncResult> {
  const identity = configuredIdentity;
  if (!identity || getTripRepositorySnapshot().ownerScope !== identity.ownerScope) {
    return Promise.resolve({
      completed: 0,
      remaining: getTripRepositoryOutbox().length,
      blockedByConflict: false,
    });
  }
  if (activeSync) {
    activeSync.hydrateRequested ||= hydrateRequested;
    return activeSync.promise;
  }
  if (activeHydration) {
    return activeHydration.promise.then(
      () => beginTripRepositorySync(hydrateRequested),
      () => beginTripRepositorySync(hydrateRequested),
    );
  }
  const session = sessionFromConfiguredIdentity();
  if (!session) {
    return Promise.resolve({ completed: 0, remaining: getTripRepositoryOutbox().length, blockedByConflict: false });
  }
  const operation: ActiveSyncOperation = {
    session,
    hydrateRequested,
    promise: Promise.resolve({ completed: 0, remaining: 0, blockedByConflict: false }),
  };
  // Defer the run one microtask so activeSync is visible to repository
  // subscribers before markOutboxSyncing emits its first update.
  const promise = Promise.resolve().then(async () => {
    let result = await runSync(session);
    if (operation.hydrateRequested
      && !result.canceled
      && !result.error
      && result.remaining === 0
      && sessionIsCurrent(session)) {
      try {
        await hydrateWithSession(session);
      } catch (error) {
        const failure = publicSyncError(error);
        result = { ...result, error: failure.message };
      }
    }
    if (sessionIsCurrent(session)) {
      result = { ...result, remaining: getTripRepositoryOutbox().length };
    }
    return result;
  }).finally(() => {
    releaseSession(session);
    if (activeSync?.session === session) activeSync = null;
    if (hasRunnableTripRepositoryOutboxEntries(getTripRepositoryOutbox())) scheduleAutoSync(0);
    scheduleRetryFromOutbox();
  });
  operation.promise = promise;
  activeSync = operation;
  return promise;
}

export function syncTripRepositoryOutbox(): Promise<TripRepositorySyncResult> {
  return beginTripRepositorySync(false);
}

export async function synchronizeTripRepository(): Promise<TripRepositorySyncResult> {
  return beginTripRepositorySync(true);
}

function clearAutoSyncTimers() {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  if (retryTimer) clearTimeout(retryTimer);
  autoSyncTimer = null;
  retryTimer = null;
}

function scheduleRetryFromOutbox() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (autoSyncSubscribers <= 0 || !configuredIdentity) return;
  const retryAt = nextTripRepositoryRetryAt(getTripRepositoryOutbox());
  if (retryAt == null) return;
  const delay = Math.max(50, retryAt - Date.now());
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void synchronizeTripRepository();
  }, delay);
}

function scheduleAutoSync(delay = 350) {
  if (autoSyncSubscribers <= 0 || !configuredIdentity) return;
  if (activeSync || activeHydration) return;
  if (getTripRepositorySnapshot().ownerScope !== configuredIdentity.ownerScope) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    void synchronizeTripRepository();
  }, delay);
}

export function startTripRepositoryAutoSync(): () => void {
  autoSyncSubscribers += 1;
  if (!autoSyncUnsubscribe) {
    autoSyncUnsubscribe = subscribeTripRepository(() => {
      if (hasRunnableTripRepositoryOutboxEntries(getTripRepositoryOutbox())) scheduleAutoSync();
      scheduleRetryFromOutbox();
    });
  }
  scheduleAutoSync(0);
  return () => {
    autoSyncSubscribers = Math.max(0, autoSyncSubscribers - 1);
    if (autoSyncSubscribers === 0) {
      autoSyncUnsubscribe?.();
      autoSyncUnsubscribe = null;
      clearAutoSyncTimers();
    }
  };
}

export async function setTripRepositorySyncIdentity(ownerScope: string, token: string | null): Promise<void> {
  const cleanScope = String(ownerScope || '').trim();
  const cleanToken = String(token || '').trim();
  if (configuredIdentity?.ownerScope === cleanScope && configuredIdentity.token === cleanToken) return;

  const requestedGeneration = ++identityGeneration;
  configuredIdentity = null;
  clearAutoSyncTimers();
  for (const controller of sessionControllers) controller.abort();
  const pending = [activeSync?.promise, activeHydration?.promise].filter(Boolean) as Promise<unknown>[];
  if (pending.length > 0) await Promise.all(pending.map(operation => operation.catch(() => {})));
  if (requestedGeneration !== identityGeneration) return;
  if (cleanScope.startsWith('account:') && cleanToken) {
    configuredIdentity = { generation: requestedGeneration, ownerScope: cleanScope, token: cleanToken };
    scheduleAutoSync(0);
  }
}

export function cancelTripRepositorySync(): Promise<void> {
  return setTripRepositorySyncIdentity('anonymous', null);
}

export function toAccountTripDocumentV2(trip: TripDocumentV2): AccountTripDocumentV2 {
  return {
    ...tripDocumentPayload(trip, Math.max(0, trip.revision - 1)).document,
    revision: trip.revision,
    created_at: trip.createdAt,
    updated_at: trip.updatedAt,
    archived_at: trip.archivedAt,
    deleted_at: undefined,
  } as AccountTripDocumentV2;
}
