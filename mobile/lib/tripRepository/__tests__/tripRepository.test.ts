import assert from 'node:assert/strict';
import {
  createSavedEntity,
  createTripDocument,
  MemoryTripRepositoryStorage,
  TripRepository,
  TripRepositoryConflictError,
  tripRepositoryScopeKey,
  type TripRepositoryRemoteBatchItem,
} from '../core';
import {
  hasRunnableTripRepositoryOutboxEntries,
  processTripRepositoryOutbox,
  retryEligibleTripRepositoryEntryIds,
} from '../syncEngine';
import { isOutboxEntrySupersededByDelete } from '../deleteSync';
import type { RepositoryOutboxEntryV1 } from '../types';

function deterministicRepository(storage = new MemoryTripRepositoryStorage()) {
  let clock = 1_700_000_000_000;
  let sequence = 0;
  return {
    storage,
    repository: new TripRepository({
      storage,
      now: () => {
        clock += 1;
        return clock;
      },
      createId: prefix => `${prefix}_${++sequence}`,
    }),
  };
}

function outboxEntry(
  id: string,
  entityId: string,
  status: RepositoryOutboxEntryV1['status'] = 'pending',
): RepositoryOutboxEntryV1 {
  return {
    id,
    idempotencyKey: `trip:upsert:test:${id}`,
    ownerScope: 'account:1',
    entityType: 'trip',
    entityId,
    operation: 'upsert',
    revision: 1,
    payload: {},
    status,
    attempts: status === 'failed' ? 1 : 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    lastError: status === 'failed' ? 'First revision failed' : undefined,
  };
}

class DelayedEraseStorage extends MemoryTripRepositoryStorage {
  private releaseErase!: () => void;
  private markEraseStarted!: () => void;
  readonly eraseStarted: Promise<void>;
  private readonly eraseReleased: Promise<void>;

  constructor() {
    super();
    this.eraseStarted = new Promise<void>(resolve => { this.markEraseStarted = resolve; });
    this.eraseReleased = new Promise<void>(resolve => { this.releaseErase = resolve; });
  }

  release() {
    this.releaseErase();
  }

  override async erase(ownerScopeKey: string): Promise<void> {
    this.markEraseStarted();
    await this.eraseReleased;
    await super.erase(ownerScopeKey);
  }
}

class DelayedReadStorage extends MemoryTripRepositoryStorage {
  private blockedKey: string | null = null;
  private releaseRead: (() => void) | null = null;
  private markReadStarted: (() => void) | null = null;
  private readReleased: Promise<void> | null = null;
  readStarted: Promise<void> = Promise.resolve();

  blockNextRead(ownerScopeKey: string) {
    this.blockedKey = ownerScopeKey;
    this.readStarted = new Promise<void>(resolve => { this.markReadStarted = resolve; });
    this.readReleased = new Promise<void>(resolve => { this.releaseRead = resolve; });
  }

  release() {
    this.releaseRead?.();
  }

  override async read(ownerScopeKey: string): Promise<string | null> {
    if (ownerScopeKey === this.blockedKey && this.readReleased) {
      this.blockedKey = null;
      this.markReadStarted?.();
      await this.readReleased;
    }
    return super.read(ownerScopeKey);
  }
}

class CountingStorage extends MemoryTripRepositoryStorage {
  reads = 0;
  writes = 0;

  resetCounts() {
    this.reads = 0;
    this.writes = 0;
  }

  override async read(ownerScopeKey: string): Promise<string | null> {
    this.reads += 1;
    return super.read(ownerScopeKey);
  }

  override async write(ownerScopeKey: string, value: string): Promise<void> {
    this.writes += 1;
    await super.write(ownerScopeKey, value);
  }
}

class FailOnceReadStorage extends CountingStorage {
  private failingKey: string | null = null;

  failNextRead(ownerScopeKey: string) {
    this.failingKey = ownerScopeKey;
  }

  override async read(ownerScopeKey: string): Promise<string | null> {
    if (ownerScopeKey === this.failingKey) {
      this.failingKey = null;
      this.reads += 1;
      throw new Error('fixture read failed');
    }
    return super.read(ownerScopeKey);
  }
}

class FailNextWriteStorage extends CountingStorage {
  private failingKey: string | null = null;

  failNextWrite(ownerScopeKey: string) {
    this.failingKey = ownerScopeKey;
  }

  override async write(ownerScopeKey: string, value: string): Promise<void> {
    if (ownerScopeKey === this.failingKey) {
      this.failingKey = null;
      this.writes += 1;
      throw new Error('fixture write failed');
    }
    await super.write(ownerScopeKey, value);
  }
}

class DelayedCountingReadStorage extends CountingStorage {
  private blockedKey: string | null = null;
  private releaseRead: (() => void) | null = null;
  private markReadStarted: (() => void) | null = null;
  private readReleased: Promise<void> | null = null;
  readStarted: Promise<void> = Promise.resolve();

  blockNextRead(ownerScopeKey: string) {
    this.blockedKey = ownerScopeKey;
    this.readStarted = new Promise<void>(resolve => { this.markReadStarted = resolve; });
    this.readReleased = new Promise<void>(resolve => { this.releaseRead = resolve; });
  }

  release() {
    this.releaseRead?.();
  }

  override async read(ownerScopeKey: string): Promise<string | null> {
    if (ownerScopeKey === this.blockedKey && this.readReleased) {
      this.blockedKey = null;
      this.markReadStarted?.();
      await this.readReleased;
    }
    return super.read(ownerScopeKey);
  }
}

class DelayedWriteStorage extends CountingStorage {
  private blockedKey: string | null = null;
  private releaseWrite: (() => void) | null = null;
  private markWriteStarted: (() => void) | null = null;
  private writeReleased: Promise<void> | null = null;
  writeStarted: Promise<void> = Promise.resolve();

  blockNextWrite(ownerScopeKey: string) {
    this.blockedKey = ownerScopeKey;
    this.writeStarted = new Promise<void>(resolve => { this.markWriteStarted = resolve; });
    this.writeReleased = new Promise<void>(resolve => { this.releaseWrite = resolve; });
  }

  release() {
    this.releaseWrite?.();
  }

  override async write(ownerScopeKey: string, value: string): Promise<void> {
    if (ownerScopeKey === this.blockedKey && this.writeReleased) {
      this.blockedKey = null;
      this.markWriteStarted?.();
      await this.writeReleased;
    }
    await super.write(ownerScopeKey, value);
  }
}

async function accountIsolationAndPersistence() {
  const { storage, repository } = deterministicRepository();
  const initial = repository.getSnapshot();
  assert.equal(initial.initialized, false);
  assert.deepEqual(initial.trips, []);
  assert.equal(initial.sync.state, 'idle');

  await repository.initialize({ id: 41 });
  const trip = await repository.upsertTrip(createTripDocument({ id: 'trip-a', title: 'Desert week' }));
  assert.equal(trip.ownerScope, 'account:41');
  assert.equal(trip.revision, 1);

  await repository.initialize({ id: 84 });
  assert.equal(repository.listTrips({ includeArchived: true }).length, 0);

  const restored = deterministicRepository(storage).repository;
  await restored.initialize({ id: 41 });
  assert.equal(restored.getTrip('trip-a')?.title, 'Desert week');
  assert.equal(restored.getOutbox().length, 1);
  assert.equal(restored.getSnapshot().sync.state, 'pending');
}

async function uncappedCollectionsAndFiltering() {
  const { repository } = deterministicRepository();
  await repository.initialize('large-library');

  for (let index = 0; index < 24; index += 1) {
    await repository.upsertTrip(createTripDocument({
      id: `trip-${index}`,
      title: `Trip ${index}`,
      status: index % 3 === 0 ? 'archived' : 'draft',
    }), { enqueueSync: false });
  }
  for (let index = 0; index < 215; index += 1) {
    await repository.saveEntity(createSavedEntity({
      id: `place-${index}`,
      title: `Place ${index}`,
      kind: index % 2 === 0 ? 'camp' : 'place',
      region: index < 10 ? 'Utah' : 'Nevada',
    }), { enqueueSync: false });
  }

  assert.equal(repository.listTrips({ includeArchived: true }).length, 24);
  assert.equal(repository.listTrips().length, 16);
  assert.equal(repository.listSavedEntities().length, 215);
  assert.equal(repository.listSavedEntities({ kind: 'camp' }).length, 108);
  assert.equal(repository.listSavedEntities({ query: 'Utah' }).length, 10);
}

async function tripAndLibraryOperations() {
  const { repository } = deterministicRepository();
  await repository.initialize();
  const entity = await repository.saveEntity(createSavedEntity({
    id: 'camp-1',
    title: 'Willow Camp',
    kind: 'camp',
    coordinates: { lat: 38.1, lng: -109.4 },
  }));
  const created = await repository.createTripFromEntity(entity.id);
  assert.equal(created.items.length, 1);
  assert.equal(created.items[0].entityId, entity.id);

  const updated = await repository.addEntityToTrip(created.id, entity.id, { day: 2, note: 'Arrive before dark' });
  assert.equal(updated.items.length, 1, 'adding the same entity updates its trip item by default');
  assert.equal(updated.items[0].day, 2);
  assert.equal(updated.days.length, 2);

  const withNote = await repository.saveTripNote(created.id, { body: 'Gate code is in the permit email.', day: 2 });
  assert.equal(withNote.notes.length, 1);
  assert.equal(withNote.notes[0].visibility, 'private');
  const editedNote = await repository.saveTripNote(created.id, { id: withNote.notes[0].id, body: 'Permit and gate code are downloaded.', day: 2 });
  assert.equal(editedNote.notes[0].body, 'Permit and gate code are downloaded.');
  const withoutNote = await repository.deleteTripNote(created.id, editedNote.notes[0].id);
  assert.equal(withoutNote.notes.length, 0);

  const copied = await repository.duplicateTrip(created.id);
  assert.notEqual(copied.id, created.id);
  assert.equal(copied.status, 'draft');
  assert.notEqual(copied.items[0].id, updated.items[0].id);

  const archived = await repository.archiveTrip(created.id);
  assert.equal(archived.status, 'archived');
  assert.ok(archived.archivedAt);
  assert.equal(await repository.deleteTrip(copied.id), true);
  assert.equal(await repository.removeEntity(entity.id), true);
}

async function bulkDraftDeletionIsAtomicAndDurable() {
  const { storage, repository } = deterministicRepository();
  await repository.initialize('bulk-delete');
  const first = await repository.upsertTrip(createTripDocument({ id: 'draft-a', title: 'Draft A', status: 'draft' }), { enqueueSync: false });
  const second = await repository.upsertTrip(createTripDocument({ id: 'draft-b', title: 'Draft B', status: 'draft' }), { enqueueSync: false });
  const saved = await repository.upsertTrip(createTripDocument({ id: 'saved-trip', title: 'Saved', status: 'completed' }), { enqueueSync: false });
  const archived = await repository.upsertTrip(createTripDocument({ id: 'archived-trip', title: 'Archived', status: 'archived' }), { enqueueSync: false });

  const deleted = await repository.deleteDraftTrips([
    { id: first.id, expectedRevision: first.revision },
    { id: second.id, expectedRevision: second.revision },
    { id: first.id, expectedRevision: first.revision },
  ]);
  assert.deepEqual(deleted, ['draft-a', 'draft-b']);
  assert.equal(repository.getTrip(first.id), null);
  assert.equal(repository.getTrip(second.id), null);
  assert.equal(repository.getTrip(saved.id)?.status, 'completed');
  assert.equal(repository.getTrip(archived.id)?.status, 'archived');
  assert.deepEqual(
    repository.getOutbox().map(entry => [entry.entityId, entry.operation, entry.revision]),
    [['draft-a', 'delete', 2], ['draft-b', 'delete', 2]],
  );

  const restored = deterministicRepository(storage).repository;
  await restored.initialize('bulk-delete');
  assert.equal(restored.getTrip(first.id), null);
  assert.equal(restored.getTrip(second.id), null);
  assert.equal(restored.getTrip(saved.id)?.status, 'completed');
  assert.equal(restored.getTrip(archived.id)?.status, 'archived');
  assert.equal(restored.getOutbox().filter(entry => entry.operation === 'delete').length, 2);
  await restored.applyRemoteTrip({ ...first, ownerScope: 'account:bulk-delete' });
  assert.equal(restored.getTrip(first.id), null, 'an older server draft cannot return after bulk deletion');

  const third = await restored.upsertTrip(createTripDocument({ id: 'draft-c', title: 'Draft C', status: 'draft' }), { enqueueSync: false });
  await assert.rejects(
    restored.deleteDraftTrips([
      { id: third.id, expectedRevision: third.revision },
      { id: saved.id, expectedRevision: saved.revision },
    ]),
    /is no longer a draft/,
  );
  assert.equal(restored.getTrip(third.id)?.status, 'draft', 'a mixed-status request deletes nothing');
  assert.equal(restored.getTrip(saved.id)?.status, 'completed');
}

async function queuedScopeSwitchCannotDeleteAnotherAccountsDrafts() {
  const storage = new DelayedReadStorage();
  const { repository } = deterministicRepository(storage);
  await repository.initialize('scope-b');
  const scopeB = await repository.upsertTrip(
    createTripDocument({ id: 'shared-draft', title: 'Scope B draft', status: 'draft' }),
    { enqueueSync: false },
  );
  await repository.initialize('scope-a');
  const scopeA = await repository.upsertTrip(
    createTripDocument({ id: 'shared-draft', title: 'Scope A draft', status: 'draft' }),
    { enqueueSync: false },
  );

  storage.blockNextRead(tripRepositoryScopeKey('account:scope-b'));
  const switching = repository.initialize('scope-b');
  await storage.readStarted;
  const deleting = repository.deleteDraftTrips(
    [{ id: scopeA.id, expectedRevision: scopeA.revision }],
    { expectedOwnerScope: 'account:scope-a' },
  );
  storage.release();
  await switching;
  await assert.rejects(deleting, /owner scope changed/);
  assert.equal(repository.getSnapshot().ownerScope, 'account:scope-b');
  assert.equal(repository.getTrip(scopeB.id)?.title, 'Scope B draft');
}

async function queuedScopeSwitchCannotDeleteAnotherAccountsSavedTrip() {
  const storage = new DelayedReadStorage();
  const { repository } = deterministicRepository(storage);
  await repository.initialize('saved-scope-b');
  const scopeB = await repository.upsertTrip(
    createTripDocument({ id: 'shared-saved-trip', title: 'Scope B saved trip', status: 'completed' }),
    { enqueueSync: false },
  );
  await repository.initialize('saved-scope-a');
  const scopeA = await repository.upsertTrip(
    createTripDocument({ id: 'shared-saved-trip', title: 'Scope A saved trip', status: 'completed' }),
    { enqueueSync: false },
  );

  storage.blockNextRead(tripRepositoryScopeKey('account:saved-scope-b'));
  const switching = repository.initialize('saved-scope-b');
  await storage.readStarted;
  const deleting = repository.deleteTrip(scopeA.id, {
    expectedRevision: scopeA.revision,
    expectedOwnerScope: 'account:saved-scope-a',
  });
  storage.release();
  await switching;
  await assert.rejects(deleting, /owner scope changed/);
  assert.equal(repository.getSnapshot().ownerScope, 'account:saved-scope-b');
  assert.equal(repository.getTrip(scopeB.id)?.title, 'Scope B saved trip');
}

async function batchDeletePrunesSupersededOutboxEntries() {
  const { repository } = deterministicRepository();
  await repository.initialize('outbox-pruning');
  const first = await repository.upsertTrip(createTripDocument({ id: 'pruned-draft', title: 'First', status: 'draft' }));
  const second = await repository.upsertTrip(
    { ...first, title: 'Second' },
    { expectedRevision: first.revision },
  );
  const [syncing] = repository.getOutbox();
  await repository.markOutboxSyncing([syncing.id]);

  await repository.deleteDraftTrips(
    [{ id: second.id, expectedRevision: second.revision }],
    { expectedOwnerScope: 'account:outbox-pruning' },
  );
  const remaining = repository.getOutbox().filter(entry => entry.entityId === second.id);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0]?.id, syncing.id);
  assert.equal(remaining[0]?.status, 'syncing');
  assert.equal(remaining[0]?.operation, 'upsert');
  assert.equal(remaining[1]?.status, 'pending');
  assert.equal(remaining[1]?.operation, 'delete');
  assert.equal(remaining[1]?.revision, second.revision + 1);
  assert.deepEqual(remaining[1]?.payload, {
    kind: 'trip_deletion',
    mode: 'draft_cleanup',
    originalStatus: 'draft',
  });
}

async function singleDeletePersistsExplicitIntent() {
  const { storage, repository } = deterministicRepository();
  await repository.initialize('single-delete-intent');
  const saved = await repository.upsertTrip(createTripDocument({
    id: 'saved-delete-intent',
    title: 'Saved trip',
    status: 'completed',
  }), { enqueueSync: false });
  await repository.deleteTrip(saved.id, {
    expectedRevision: saved.revision,
    expectedOwnerScope: 'account:single-delete-intent',
  });

  const entry = repository.getOutbox().find(candidate => candidate.entityId === saved.id);
  assert.deepEqual(entry?.payload, {
    kind: 'trip_deletion',
    mode: 'explicit',
    originalStatus: 'completed',
  });

  const restored = deterministicRepository(storage).repository;
  await restored.initialize('single-delete-intent');
  assert.deepEqual(restored.getOutbox()[0]?.payload, entry?.payload, 'delete intent survives restart');
}

async function optimisticRevisionContract() {
  const { repository } = deterministicRepository();
  await repository.initialize();
  const first = await repository.upsertTrip(createTripDocument({ id: 'revision-trip', title: 'First' }));
  await assert.rejects(
    repository.upsertTrip({ ...first, title: 'Stale edit' }, { expectedRevision: 0 }),
    (error: unknown) => error instanceof TripRepositoryConflictError
      && error.expectedRevision === 0
      && error.actualRevision === 1,
  );
}

async function persistentOutboxContract() {
  const { storage, repository } = deterministicRepository();
  await repository.initialize('sync-user');
  await repository.saveEntity(createSavedEntity({ id: 'sync-camp', title: 'Sync Camp', kind: 'camp' }));
  const [entry] = repository.getOutbox();
  assert.match(entry.idempotencyKey, /^saved_entity:upsert:/);
  assert.ok(entry.idempotencyKey.length < 160);

  await repository.markOutboxSyncing([entry.id]);
  assert.equal(repository.getSnapshot().sync.state, 'syncing');
  await repository.failOutbox([entry.id], 'No connection');
  assert.equal(repository.getSnapshot().sync.state, 'error');
  assert.equal(repository.getSnapshot().sync.failedCount, 1);
  await repository.setOnline(false);
  assert.equal(repository.getSnapshot().sync.state, 'offline');

  const restored = deterministicRepository(storage).repository;
  await restored.initialize('sync-user');
  assert.equal(restored.getSnapshot().sync.state, 'offline');
  assert.equal(restored.getOutbox()[0].lastError, 'No connection');
  await restored.setOnline(true);
  await restored.retryFailedOutbox();
  assert.equal(restored.getSnapshot().sync.state, 'pending');
  await restored.acknowledgeOutbox([entry.id]);
  assert.equal(restored.getSnapshot().sync.state, 'idle');
  assert.ok(restored.getSnapshot().sync.lastSyncedAt);
}

async function unchangedOnlineStateDoesNotPersist() {
  const storage = new CountingStorage();
  const { repository } = deterministicRepository(storage);
  await repository.initialize('online-noop');

  storage.resetCounts();
  await repository.setOnline(true);
  assert.equal(storage.writes, 0, 'repeating the persisted online state is a no-op');

  await repository.setOnline(false);
  assert.equal(storage.writes, 1, 'an actual connectivity transition is durable');

  storage.resetCounts();
  await repository.setOnline(false);
  assert.equal(storage.writes, 0, 'repeating the offline state is also a no-op');
}

async function legacyMigrationAndQuarantine() {
  const { storage, repository } = deterministicRepository();
  await repository.initialize('legacy-user');
  const input = {
    tripHistory: JSON.stringify([
      { trip_id: 'legacy-trip', trip_name: 'Old summary', states: ['UT'], duration_days: 3, planned_at: 100 },
      { trip_name: 'Missing id' },
    ]),
    activeTrip: JSON.stringify({
      trip_id: 'legacy-trip',
      updated_at: 200,
      version: 3,
      plan: {
        trip_name: 'Complete old trip',
        overview: 'Migrated from the active trip file.',
        duration_days: 2,
        states: ['UT', 'AZ'],
        waypoints: [
          { day: 1, name: 'Moab', type: 'start', lat: 38.57, lng: -109.55 },
          { day: 2, name: 'Valley camp', type: 'camp', lat: 36.9, lng: -111.4 },
        ],
        daily_itinerary: [{ title: 'Leave Moab' }, { title: 'Camp night' }],
      },
    }),
    favoriteCamps: JSON.stringify([
      { id: 'favorite-camp', name: 'Favorite Camp', lat: 38, lng: -110, land_type: 'BLM', photos: ['https://images.test/camp.jpg'] },
    ]),
    savedPlaces: '{broken-json',
    exploreBookmarkIds: JSON.stringify(['explore-1', '', 'explore-2']),
  };

  const result = await repository.migrateLegacy(input);
  assert.equal(repository.getTrip('legacy-trip')?.title, 'Complete old trip');
  assert.equal(repository.getTrip('legacy-trip')?.items.length, 2);
  assert.equal(repository.getSavedEntity('favorite-camp')?.kind, 'camp');
  assert.equal(repository.getSavedEntity('explore-1')?.needsEnrichment, true);
  assert.ok(result.receipts.some(receipt => receipt.source === 'saved_places' && receipt.status === 'quarantined'));
  assert.ok(result.receipts.some(receipt => receipt.source === 'trip_history' && receipt.corruptCount === 1));
  assert.ok(storage.corrupt.size >= 2, 'invalid legacy payloads and records are retained');

  const second = await repository.migrateLegacy(input);
  assert.ok(second.receipts.some(receipt => receipt.source === 'trip_history' && receipt.status === 'skipped'));
  assert.equal(repository.listTrips({ includeArchived: true }).length, 1);
}

async function legacyMigrationDoesNotResurrectDeletedTrips() {
  const { repository } = deterministicRepository();
  await repository.initialize('legacy-deletions');
  const historyTrip = await repository.upsertTrip(createTripDocument({
    id: 'deleted-history-trip',
    title: 'Deleted history trip',
    status: 'draft',
  }), { enqueueSync: false });
  const activeTrip = await repository.upsertTrip(createTripDocument({
    id: 'deleted-active-trip',
    title: 'Deleted active trip',
    status: 'draft',
  }), { enqueueSync: false });
  await repository.deleteDraftTrips([
    { id: historyTrip.id, expectedRevision: historyTrip.revision },
    { id: activeTrip.id, expectedRevision: activeTrip.revision },
  ], { expectedOwnerScope: 'account:legacy-deletions' });

  const migrated = await repository.migrateLegacy({
    tripHistory: [{
      trip_id: historyTrip.id,
      trip_name: 'History copy',
      states: ['UT'],
      duration_days: 2,
      planned_at: 100,
    }],
    activeTrip: {
      trip_id: activeTrip.id,
      updated_at: 200,
      version: 3,
      plan: {
        trip_name: 'Active copy',
        duration_days: 1,
        states: ['AZ'],
        waypoints: [{ day: 1, name: 'Start', type: 'start', lat: 34, lng: -112 }],
      },
    },
  });

  assert.equal(repository.getTrip(historyTrip.id), null);
  assert.equal(repository.getTrip(activeTrip.id), null);
  assert.deepEqual(migrated.importedTripIds, []);
  assert.ok(migrated.receipts.some(receipt => receipt.source === 'trip_history'
    && receipt.status === 'skipped'
    && receipt.skippedCount === 1));
  assert.ok(migrated.receipts.some(receipt => receipt.source === 'active_trip'
    && receipt.status === 'skipped'
    && receipt.skippedCount === 1));
  assert.ok(!repository.getOutbox().some(entry => entry.operation === 'upsert'
    && (entry.entityId === historyTrip.id || entry.entityId === activeTrip.id)));
}

async function corruptRepositoryRecovery() {
  const storage = new MemoryTripRepositoryStorage();
  storage.values.set(tripRepositoryScopeKey('account:corrupt'), '{not-json');
  const { repository } = deterministicRepository(storage);
  await repository.initialize('corrupt');
  assert.equal(repository.getSnapshot().initialized, true);
  assert.equal(repository.listTrips({ includeArchived: true }).length, 0);
  assert.ok(repository.getSnapshot().migrationReceipts.some(receipt => receipt.source === 'repository_state' && receipt.status === 'quarantined'));
  assert.equal(storage.corrupt.size, 1);
  assert.doesNotThrow(() => JSON.parse(storage.values.get(tripRepositoryScopeKey('account:corrupt')) ?? ''));
}

async function explicitAnonymousMerge() {
  const { storage, repository } = deterministicRepository();
  await repository.initialize();
  await repository.upsertTrip(createTripDocument({ id: 'shared-id', title: 'Anonymous route' }));
  await repository.upsertTrip(createTripDocument({ id: 'anonymous-only', title: 'Anonymous only' }));
  await repository.saveEntity(createSavedEntity({ id: 'shared-place', title: 'Anonymous camp', kind: 'camp' }));
  await repository.saveEntity(createSavedEntity({ id: 'anonymous-place', title: 'Anonymous place', kind: 'place' }));

  await repository.initialize(501);
  await repository.upsertTrip(createTripDocument({ id: 'shared-id', title: 'Account route' }));
  await repository.saveEntity(createSavedEntity({ id: 'shared-place', title: 'Account camp', kind: 'camp' }));
  const merged = await repository.mergeScope(undefined, 501);

  assert.equal(repository.getSnapshot().ownerScope, 'account:501');
  assert.equal(repository.getTrip('shared-id')?.title, 'Account route', 'destination record remains canonical');
  assert.equal(repository.getTrip('anonymous-only')?.ownerScope, 'account:501');
  assert.equal(repository.getSavedEntity('anonymous-place')?.ownerScope, 'account:501');
  assert.equal(merged.conflictTripIds.length, 1);
  assert.equal(merged.conflictEntityIds.length, 1);
  assert.match(repository.getTrip(merged.conflictTripIds[0])?.title ?? '', /signed-out copy/);
  assert.match(repository.getSavedEntity(merged.conflictEntityIds[0])?.title ?? '', /signed-out copy/);
  assert.equal(merged.receipt.status, 'imported');

  const destinationCount = repository.listTrips({ includeArchived: true }).length;
  const repeated = await repository.mergeScope(undefined, 501);
  assert.equal(repeated.receipt.status, 'skipped');
  assert.equal(repository.listTrips({ includeArchived: true }).length, destinationCount, 'same source revision is idempotent');

  await repository.initialize();
  assert.equal(repository.getTrip('shared-id')?.title, 'Anonymous route', 'merge never deletes or rewrites anonymous source');
  assert.equal(repository.listSavedEntities().length, 2);
  assert.ok(storage.values.has('anonymous'));
}

async function changedScopeMergeUpdatesOnlyChangedRecords() {
  const { repository } = deterministicRepository();
  await repository.initialize();
  const anonymous = await repository.upsertTrip(createTripDocument({ id: 'changed-trip', title: 'First title' }));
  await repository.mergeScope(null, 601);

  await repository.initialize();
  await repository.upsertTrip({ ...anonymous, title: 'Changed while signed out' }, { expectedRevision: anonymous.revision });
  const changed = await repository.mergeScope(null, 601);

  assert.deepEqual(changed.conflictTripIds, []);
  assert.deepEqual(changed.importedTripIds, ['changed-trip']);
  assert.equal(repository.listTrips({ includeArchived: true }).length, 1);
  assert.equal(repository.getTrip('changed-trip')?.title, 'Changed while signed out');
  const changedEntry = repository.getOutbox().at(-1);
  assert.equal(changedEntry?.entityId, 'changed-trip');
  assert.equal(changedEntry?.revision, 2);

  const repeated = await repository.mergeScope(null, 601);
  assert.equal(repeated.receipt.status, 'skipped');
  assert.equal(repository.listTrips({ includeArchived: true }).length, 1);
}

async function identicalScopeMergeDeduplicatesCanonicalIds() {
  const { repository } = deterministicRepository();
  await repository.initialize();
  await repository.upsertTrip(createTripDocument({ id: 'same-id', title: 'Same content' }));
  await repository.saveEntity(createSavedEntity({ id: 'same-place', title: 'Same place', kind: 'place' }));

  await repository.initialize(602);
  await repository.upsertTrip(createTripDocument({ id: 'same-id', title: 'Same content' }));
  await repository.saveEntity(createSavedEntity({ id: 'same-place', title: 'Same place', kind: 'place' }));
  const outboxBefore = repository.getOutbox().length;
  const merged = await repository.mergeScope(null, 602);

  assert.deepEqual(merged.conflictTripIds, []);
  assert.deepEqual(merged.conflictEntityIds, []);
  assert.deepEqual(merged.importedTripIds, []);
  assert.deepEqual(merged.importedEntityIds, []);
  assert.equal(repository.listTrips({ includeArchived: true }).length, 1);
  assert.equal(repository.listSavedEntities().length, 1);
  assert.equal(repository.getOutbox().length, outboxBefore);
}

async function applyRemoteItemSequentially(repository: TripRepository, item: TripRepositoryRemoteBatchItem) {
  if (item.kind === 'trip') return repository.applyRemoteTrip(item.record);
  if (item.kind === 'saved_entity') return repository.applyRemoteSavedEntity(item.record);
  if (item.kind === 'trip_tombstone') {
    return repository.applyRemoteTripTombstone(item.id, item.revision, item.deletedAt);
  }
  return repository.applyRemoteSavedEntityTombstone(item.id, item.revision, item.deletedAt);
}

async function seedLargeRemoteBatchRepository(repository: TripRepository): Promise<TripRepositoryRemoteBatchItem[]> {
  const ownerScope = 'account:batch-user';
  await repository.initialize('batch-user');
  const dirtyTrip = await repository.upsertTrip(createTripDocument({
    id: 'dirty-trip',
    title: 'Local dirty trip',
    createdAt: 10,
    updatedAt: 10,
  }));
  const dirtyTripDelete = await repository.upsertTrip(createTripDocument({
    id: 'dirty-trip-delete',
    title: 'Local trip deleted remotely',
    createdAt: 11,
    updatedAt: 11,
  }));
  const equalTripTombstone = await repository.upsertTrip(createTripDocument({
    id: 'equal-trip-tombstone',
    title: 'Already deleted trip',
    createdAt: 12,
    updatedAt: 12,
  }), { enqueueSync: false });
  await repository.deleteTrip(equalTripTombstone.id, {
    expectedRevision: equalTripTombstone.revision,
    enqueueSync: false,
  });

  const dirtyEntity = await repository.saveEntity(createSavedEntity({
    id: 'dirty-entity',
    title: 'Local dirty place',
    kind: 'place',
    createdAt: 20,
    updatedAt: 20,
  }));
  const dirtyEntityDelete = await repository.saveEntity(createSavedEntity({
    id: 'dirty-entity-delete',
    title: 'Local place deleted remotely',
    kind: 'camp',
    createdAt: 21,
    updatedAt: 21,
  }));
  const equalEntityTombstone = await repository.saveEntity(createSavedEntity({
    id: 'equal-entity-tombstone',
    title: 'Already deleted place',
    kind: 'place',
    createdAt: 22,
    updatedAt: 22,
  }), { enqueueSync: false });
  await repository.removeEntity(equalEntityTombstone.id, {
    expectedRevision: equalEntityTombstone.revision,
    enqueueSync: false,
  });

  const items: TripRepositoryRemoteBatchItem[] = [];
  for (let index = 0; index < 120; index += 1) {
    items.push({
      kind: 'trip',
      record: createTripDocument({
        id: `remote-trip-${index}`,
        ownerScope,
        revision: index + 1,
        title: `Remote trip ${index}`,
        createdAt: 1_000 + index,
        updatedAt: 2_000 + index,
      }),
    });
  }
  items.push(
    {
      kind: 'trip',
      record: {
        ...dirtyTrip,
        ownerScope,
        revision: 8,
        title: 'Server trip',
        updatedAt: 3_000,
      },
    },
    { kind: 'trip_tombstone', id: dirtyTripDelete.id, revision: 9, deletedAt: 3_100 },
    {
      kind: 'trip',
      record: {
        ...equalTripTombstone,
        ownerScope,
        revision: equalTripTombstone.revision + 1,
        updatedAt: 3_200,
      },
    },
  );

  for (let index = 0; index < 240; index += 1) {
    items.push({
      kind: 'saved_entity',
      record: createSavedEntity({
        id: `remote-entity-${index}`,
        ownerScope,
        revision: index + 1,
        title: `Remote place ${index}`,
        kind: index % 2 === 0 ? 'camp' : 'place',
        createdAt: 4_000 + index,
        updatedAt: 5_000 + index,
      }),
    });
  }
  items.push(
    {
      kind: 'saved_entity',
      record: {
        ...dirtyEntity,
        ownerScope,
        revision: 10,
        title: 'Server place',
        updatedAt: 6_000,
      },
    },
    { kind: 'saved_entity_tombstone', id: dirtyEntityDelete.id, revision: 11, deletedAt: 6_100 },
    {
      kind: 'saved_entity',
      record: {
        ...equalEntityTombstone,
        ownerScope,
        revision: equalEntityTombstone.revision + 1,
        updatedAt: 6_200,
      },
    },
  );
  return items;
}

async function remoteBatchMatchesRecordByRecordSemanticsAndPersistsOnce() {
  const sequentialStorage = new CountingStorage();
  const batchStorage = new CountingStorage();
  const sequential = deterministicRepository(sequentialStorage).repository;
  const batched = deterministicRepository(batchStorage).repository;
  const sequentialItems = await seedLargeRemoteBatchRepository(sequential);
  const batchItems = await seedLargeRemoteBatchRepository(batched);
  assert.deepEqual(batchItems, sequentialItems);
  sequentialStorage.resetCounts();
  batchStorage.resetCounts();

  for (const item of sequentialItems) await applyRemoteItemSequentially(sequential, item);
  const result = await batched.applyRemoteBatch(batchItems, { expectedOwnerScope: 'account:batch-user' });

  assert.equal(result.processed, batchItems.length);
  assert.equal(result.conflicts, 4);
  assert.equal(batchStorage.writes, 1, 'one fetched page is serialized and persisted once');
  assert.equal(sequentialStorage.writes, result.changed, 'record-by-record writes match the changed-record count');
  assert.ok(sequentialStorage.writes > 350, 'the fixture represents a large account page');
  assert.deepEqual(batched.getSnapshot(), sequential.getSnapshot());
  assert.deepEqual(batched.getOutbox(), sequential.getOutbox());
  const scopeKey = tripRepositoryScopeKey('account:batch-user');
  assert.deepEqual(
    JSON.parse(batchStorage.values.get(scopeKey) ?? '{}'),
    JSON.parse(sequentialStorage.values.get(scopeKey) ?? '{}'),
    'batching retains persisted conflict, tombstone, revision, and outbox semantics',
  );
}

async function sameScopeInitializationReusesTheCurrentRepositoryState() {
  const storage = new CountingStorage();
  const { repository } = deterministicRepository(storage);
  await repository.initialize('same-scope');
  await repository.upsertTrip(createTripDocument({ id: 'kept-trip', title: 'Kept trip' }));
  storage.resetCounts();
  let sameScopeEmissions = 0;
  const unsubscribe = repository.subscribe(() => { sameScopeEmissions += 1; });
  const before = repository.getSnapshot();
  const [after, duplicateAfter] = await Promise.all([
    repository.initialize('account:same-scope'),
    repository.initialize('same-scope'),
  ]);
  unsubscribe();
  assert.equal(after, before);
  assert.equal(duplicateAfter, before);
  assert.equal(storage.reads, 0, 'an initialized scope is not parsed from disk again');
  assert.equal(storage.writes, 0);
  assert.equal(sameScopeEmissions, 0, 'same-scope initialization does not emit unchanged state');
  assert.equal(repository.getTrip('kept-trip')?.title, 'Kept trip');

  const concurrentStorage = new DelayedCountingReadStorage();
  const concurrentRepository = deterministicRepository(concurrentStorage).repository;
  const scopeKey = tripRepositoryScopeKey('account:concurrent-scope');
  concurrentStorage.blockNextRead(scopeKey);
  const concurrentSnapshots: unknown[] = [];
  const unsubscribeConcurrent = concurrentRepository.subscribe(() => {
    concurrentSnapshots.push(concurrentRepository.getSnapshot());
  });
  const firstInitialize = concurrentRepository.initialize('concurrent-scope');
  await concurrentStorage.readStarted;
  const secondInitialize = concurrentRepository.initialize('account:concurrent-scope');
  concurrentStorage.release();
  const [firstSnapshot, secondSnapshot] = await Promise.all([firstInitialize, secondInitialize]);
  unsubscribeConcurrent();
  assert.equal(concurrentStorage.reads, 1, 'concurrent same-scope initialization shares one disk read');
  assert.equal(concurrentSnapshots.length, 1, 'concurrent same-scope initialization emits once');
  assert.equal(firstSnapshot, secondSnapshot);
  assert.equal(firstSnapshot, concurrentSnapshots[0]);
}

async function failedInitializationLeavesThePreviousScopeRetryable() {
  const storage = new FailOnceReadStorage();
  const seedTarget = deterministicRepository(storage).repository;
  await seedTarget.initialize('read-target');
  await seedTarget.upsertTrip(
    createTripDocument({ id: 'target-trip', title: 'Target trip' }),
    { enqueueSync: false },
  );

  const repository = deterministicRepository(storage).repository;
  await repository.initialize('read-source');
  await repository.upsertTrip(
    createTripDocument({ id: 'source-trip', title: 'Source trip' }),
    { enqueueSync: false },
  );
  const before = repository.getSnapshot();
  let emissions = 0;
  const unsubscribe = repository.subscribe(() => { emissions += 1; });
  storage.resetCounts();
  storage.failNextRead(tripRepositoryScopeKey('account:read-target'));

  await assert.rejects(repository.initialize('read-target'), /fixture read failed/);
  assert.equal(repository.getSnapshot(), before);
  assert.equal(repository.getSnapshot().ownerScope, 'account:read-source');
  assert.equal(repository.getTrip('source-trip')?.title, 'Source trip');
  assert.equal(repository.getTrip('target-trip'), null);
  assert.equal(emissions, 0, 'a failed scope read never emits or replaces the active scope');

  const retried = await repository.initialize('account:read-target');
  unsubscribe();
  assert.equal(storage.reads, 2, 'a failed scope read is retried instead of being short-circuited');
  assert.equal(emissions, 1);
  assert.equal(retried.ownerScope, 'account:read-target');
  assert.equal(repository.getTrip('target-trip')?.title, 'Target trip');
  assert.equal(repository.getTrip('source-trip'), null);
}

async function failedRemoteBatchWriteRollsBackWithoutEmission() {
  const storage = new FailNextWriteStorage();
  const repository = deterministicRepository(storage).repository;
  await repository.initialize('atomic-write');
  await repository.upsertTrip(
    createTripDocument({ id: 'committed-trip', title: 'Committed trip' }),
    { enqueueSync: false },
  );
  const before = repository.getSnapshot();
  const scopeKey = tripRepositoryScopeKey('account:atomic-write');
  const persistedBefore = storage.values.get(scopeKey);
  const remoteItems: TripRepositoryRemoteBatchItem[] = [
    {
      kind: 'trip',
      record: createTripDocument({
        id: 'unpersisted-trip',
        ownerScope: 'account:atomic-write',
        revision: 2,
        title: 'Must roll back',
        createdAt: 100,
        updatedAt: 200,
      }),
    },
    {
      kind: 'saved_entity',
      record: createSavedEntity({
        id: 'unpersisted-place',
        ownerScope: 'account:atomic-write',
        revision: 2,
        title: 'Must roll back too',
        kind: 'place',
        createdAt: 100,
        updatedAt: 200,
      }),
    },
  ];
  let emissions = 0;
  const unsubscribe = repository.subscribe(() => { emissions += 1; });
  storage.resetCounts();
  storage.failNextWrite(scopeKey);

  await assert.rejects(
    repository.applyRemoteBatch(remoteItems, { expectedOwnerScope: 'account:atomic-write' }),
    /fixture write failed/,
  );
  assert.equal(storage.writes, 1);
  assert.equal(emissions, 0, 'a failed page write never emits staged records');
  assert.equal(repository.getSnapshot(), before);
  assert.equal(repository.getTrip('unpersisted-trip'), null);
  assert.equal(repository.getSavedEntity('unpersisted-place'), null);
  assert.equal(repository.getTrip('committed-trip')?.title, 'Committed trip');
  assert.equal(storage.values.get(scopeKey), persistedBefore);

  storage.resetCounts();
  assert.equal(await repository.initialize('atomic-write'), before);
  assert.equal(storage.reads, 0, 'a rolled-back same-scope repository stays safely initialized');
  const applied = await repository.applyRemoteBatch(
    remoteItems,
    { expectedOwnerScope: 'account:atomic-write' },
  );
  unsubscribe();
  assert.equal(applied.changed, 2);
  assert.equal(emissions, 1, 'the successfully persisted retry emits exactly once');
  assert.equal(repository.getTrip('unpersisted-trip')?.title, 'Must roll back');
  assert.equal(repository.getSavedEntity('unpersisted-place')?.title, 'Must roll back too');
}

async function remoteBatchIsCanceledOrCommittedWithinOneAccountScope() {
  const delayedRead = new DelayedReadStorage();
  const cancellationRepository = deterministicRepository(delayedRead).repository;
  await cancellationRepository.initialize('scope-batch-b');
  await cancellationRepository.upsertTrip(
    createTripDocument({ id: 'scope-b-trip', title: 'Scope B trip' }),
    { enqueueSync: false },
  );
  await cancellationRepository.initialize('scope-batch-a');
  delayedRead.blockNextRead(tripRepositoryScopeKey('account:scope-batch-b'));
  const switchingBeforeBatch = cancellationRepository.initialize('scope-batch-b');
  await delayedRead.readStarted;
  const canceledBatch = cancellationRepository.applyRemoteBatch([{
    kind: 'trip',
    record: createTripDocument({
      id: 'must-not-cross-accounts',
      ownerScope: 'account:scope-batch-a',
      revision: 1,
      title: 'Old account remote trip',
      createdAt: 100,
      updatedAt: 100,
    }),
  }], { expectedOwnerScope: 'account:scope-batch-a' });
  delayedRead.release();
  await switchingBeforeBatch;
  await assert.rejects(canceledBatch, /owner scope changed/);
  assert.equal(cancellationRepository.getSnapshot().ownerScope, 'account:scope-batch-b');
  assert.equal(cancellationRepository.getTrip('must-not-cross-accounts'), null);
  assert.equal(cancellationRepository.getTrip('scope-b-trip')?.title, 'Scope B trip');

  const delayedWrite = new DelayedWriteStorage();
  const atomicRepository = deterministicRepository(delayedWrite).repository;
  await atomicRepository.initialize('atomic-b');
  await atomicRepository.upsertTrip(
    createTripDocument({ id: 'atomic-b-trip', title: 'Atomic B trip' }),
    { enqueueSync: false },
  );
  await atomicRepository.initialize('atomic-a');
  const atomicItems: TripRepositoryRemoteBatchItem[] = Array.from({ length: 180 }, (_, index) => ({
    kind: 'trip' as const,
    record: createTripDocument({
      id: `atomic-trip-${index}`,
      ownerScope: 'account:atomic-a',
      revision: 1,
      title: `Atomic trip ${index}`,
      createdAt: 10_000 + index,
      updatedAt: 20_000 + index,
    }),
  }));
  delayedWrite.blockNextWrite(tripRepositoryScopeKey('account:atomic-a'));
  const emittedBatchSnapshots: ReturnType<TripRepository['getSnapshot']>[] = [];
  const unsubscribeBatch = atomicRepository.subscribe(() => {
    emittedBatchSnapshots.push(atomicRepository.getSnapshot());
  });
  const applying = atomicRepository.applyRemoteBatch(atomicItems, { expectedOwnerScope: 'account:atomic-a' });
  await delayedWrite.writeStarted;
  assert.equal(atomicRepository.getSnapshot().trips.length, 0);
  assert.equal(atomicRepository.getTrip('atomic-trip-0'), null, 'direct getters retain committed state until persistence succeeds');
  assert.equal(emittedBatchSnapshots.length, 0, 'listeners never observe a partially persisted page');
  const switchingDuringBatch = atomicRepository.initialize('atomic-b');
  delayedWrite.release();
  await applying;
  assert.equal(emittedBatchSnapshots.length, 1, 'one persisted remote page emits exactly once');
  assert.equal(emittedBatchSnapshots[0].trips.length, atomicItems.length);
  assert.ok(atomicItems.every(item => item.kind === 'trip'
    && emittedBatchSnapshots[0].trips.some(trip => trip.id === item.record.id)));
  unsubscribeBatch();
  await switchingDuringBatch;
  assert.equal(atomicRepository.getSnapshot().ownerScope, 'account:atomic-b');
  assert.deepEqual(atomicRepository.listTrips({ includeArchived: true }).map(trip => trip.id), ['atomic-b-trip']);

  const restoredA = deterministicRepository(delayedWrite).repository;
  await restoredA.initialize('atomic-a');
  assert.equal(restoredA.listTrips({ includeArchived: true }).length, atomicItems.length);
  assert.ok(atomicItems.every(item => item.kind === 'trip' && restoredA.getTrip(item.record.id) != null));
}

async function remoteReconciliation() {
  const { repository } = deterministicRepository();
  await repository.initialize(77);
  const localTrip = await repository.upsertTrip(createTripDocument({ id: 'remote-trip', title: 'Unsynced local route' }));
  const localEntity = await repository.saveEntity(createSavedEntity({ id: 'remote-place', title: 'Unsynced local camp', kind: 'camp' }));
  const originalOutboxCount = repository.getOutbox().length;

  const remoteTrip = {
    ...localTrip,
    ownerScope: 'account:77',
    revision: 12,
    title: 'Server route',
    createdAt: 900,
    updatedAt: 950,
  };
  const tripResult = await repository.applyRemoteTrip(remoteTrip);
  assert.equal(tripResult.record.revision, 12);
  assert.equal(tripResult.record.createdAt, 900);
  assert.equal(tripResult.record.updatedAt, 950);
  assert.equal(repository.getTrip('remote-trip')?.title, 'Server route');
  assert.equal(tripResult.conflictCopy?.title, 'Unsynced local route (local changes)');
  assert.equal(repository.getOutbox().length, originalOutboxCount, 'reconciliation does not enqueue extra work');
  assert.ok(repository.getOutbox().some(entry => entry.entityId === tripResult.conflictCopy?.id));
  assert.ok(!repository.getOutbox().some(entry => entry.entityType === 'trip' && entry.entityId === 'remote-trip'));

  const remoteEntity = {
    ...localEntity,
    ownerScope: 'account:77',
    revision: 22,
    title: 'Server camp',
    createdAt: 1_000,
    updatedAt: 1_050,
  };
  const entityResult = await repository.applyRemoteSavedEntity(remoteEntity);
  assert.equal(entityResult.record.revision, 22);
  assert.equal(entityResult.record.updatedAt, 1_050);
  assert.equal(entityResult.conflictCopy?.title, 'Unsynced local camp (local changes)');
  assert.ok(repository.getOutbox().some(entry => entry.entityId === entityResult.conflictCopy?.id));

  const cleanRemote = createTripDocument({
    id: 'remote-only',
    title: 'Downloaded route',
    ownerScope: 'account:77',
    revision: 31,
    createdAt: 2_000,
    updatedAt: 2_100,
  });
  const beforeCleanPull = repository.getOutbox().length;
  const cleanResult = await repository.applyRemoteTrip(cleanRemote);
  assert.equal(cleanResult.record.revision, 31);
  assert.equal(cleanResult.conflictCopy, undefined);
  assert.equal(repository.getOutbox().length, beforeCleanPull);

  const semanticallyCleanLocal = await repository.upsertTrip(createTripDocument({ id: 'same-trip', title: 'Same route' }));
  const sameResult = await repository.applyRemoteTrip({
    ...semanticallyCleanLocal,
    revision: 44,
    createdAt: 3_000,
    updatedAt: 3_100,
  });
  assert.equal(sameResult.conflictCopy, undefined, 'server-only revision and timestamp changes do not create conflicts');
  assert.equal(repository.getTrip('same-trip')?.revision, 44);

  const multiEdit = await repository.upsertTrip(createTripDocument({ id: 'multi-edit', title: 'First local title' }));
  const multiEditLatest = await repository.upsertTrip({ ...multiEdit, title: 'Latest local title' });
  assert.equal(repository.getOutbox().filter(entry => entry.entityId === 'multi-edit').length, 2);
  const multiResult = await repository.applyRemoteTrip({
    ...multiEditLatest,
    ownerScope: 'account:77',
    revision: 9,
    title: 'Server multi-edit route',
    updatedAt: 4_000,
  });
  const conflictEntries = repository.getOutbox().filter(entry => entry.entityId === multiResult.conflictCopy?.id);
  assert.equal(conflictEntries.length, 1, 'several local edits reconcile as one conflict-copy upsert');
  assert.equal(conflictEntries[0]?.operation, 'upsert');
  assert.equal((conflictEntries[0]?.payload as { title?: string })?.title, 'Latest local title (local changes)');

  await assert.rejects(
    repository.applyRemoteTrip({ ...cleanRemote, id: 'wrong-owner', ownerScope: 'account:88' }),
    /does not match account:77/,
  );
  assert.equal(repository.getTrip('wrong-owner'), null);
}

async function legacyAcknowledgementDoesNotDualWrite() {
  const { repository } = deterministicRepository();
  await repository.initialize(77);
  const local = await repository.upsertTrip(
    createTripDocument({ id: 'legacy-save', title: 'Route before save' }),
    { enqueueSync: false },
  );
  assert.equal(local.revision, 1);
  assert.equal(repository.getOutbox().length, 0);

  const result = await repository.acknowledgeLegacyTrip({
    ...local,
    ownerScope: 'account:77',
    revision: 2,
    title: 'Route acknowledged by server',
    updatedAt: local.updatedAt + 10,
  }, local.revision);

  assert.equal(result.applied, true);
  assert.equal(result.record?.revision, 2);
  assert.equal(repository.getTrip('legacy-save')?.title, 'Route acknowledged by server');
  assert.equal(repository.listTrips({ includeArchived: true }).length, 1, 'acknowledgement never creates a conflict copy');
  assert.equal(repository.getOutbox().length, 0, 'acknowledgement never enqueues a second v2 write');

  const pending = await repository.upsertTrip({
    ...result.record!,
    title: 'Newer local route',
  }, { expectedRevision: 2 });
  const blocked = await repository.acknowledgeLegacyTrip({
    ...pending,
    revision: 4,
    title: 'Stale legacy response',
  }, 2);
  assert.equal(blocked.applied, false);
  assert.equal(blocked.blockedByPendingWrites, true);
  assert.equal(repository.getTrip('legacy-save')?.title, 'Newer local route');
  assert.equal(repository.listTrips({ includeArchived: true }).length, 1, 'pending writes do not create conflict drafts');
  assert.equal(repository.getOutbox().filter(entry => entry.entityId === 'legacy-save').length, 1);

  await repository.initialize(88);
  await assert.rejects(
    repository.acknowledgeLegacyTrip({
      ...result.record!,
      ownerScope: 'account:77',
      revision: 3,
    }, 2),
    /does not match account:88/,
  );
  assert.equal(repository.listTrips({ includeArchived: true }).length, 0, 'an old response cannot write into the next account scope');
  assert.equal(repository.getOutbox().length, 0);
}

async function authChangeCancelsOutboxBeforeNextMutation() {
  const entries = [outboxEntry('entry-a', 'trip-a'), outboxEntry('entry-b', 'trip-b')];
  const sent: string[] = [];
  const acknowledged: string[] = [];
  let sessionCurrent = true;
  const result = await processTripRepositoryOutbox(entries, {
    isSessionCurrent: () => sessionCurrent,
    markSyncing: async () => {},
    clearSyncing: async () => {},
    syncEntry: async entry => {
      sent.push(entry.id);
      sessionCurrent = false;
    },
    acknowledge: async batch => { acknowledged.push(...batch.map(entry => entry.id)); },
    fail: async () => {},
    resolveFailure: async () => ({ resolved: false, conflict: false, message: 'failed' }),
  });

  assert.equal(result.canceled, true);
  assert.deepEqual(sent, ['entry-a']);
  assert.deepEqual(acknowledged, []);
}

async function startupOutboxSuccessUsesOneDurableAcknowledgement() {
  const storage = new CountingStorage();
  const { repository } = deterministicRepository(storage);
  const ownerScope = 'account:batched-startup';
  await repository.initialize(ownerScope);
  await repository.saveEntity(createSavedEntity({ id: 'batch-a', title: 'Batch A', kind: 'place' }));
  await repository.saveEntity(createSavedEntity({ id: 'batch-b', title: 'Batch B', kind: 'camp' }));
  await repository.saveEntity(createSavedEntity({ id: 'batch-c', title: 'Batch C', kind: 'trail' }));
  const entries = repository.getOutbox();
  const acknowledgedBatches: string[][] = [];
  const sent: string[] = [];
  const scopeKey = tripRepositoryScopeKey(ownerScope);
  storage.resetCounts();

  const result = await processTripRepositoryOutbox(entries, {
    isSessionCurrent: () => true,
    markSyncing: async entry => {
      await repository.markOutboxSyncingTransient([entry.id], ownerScope);
      const durable = JSON.parse(storage.values.get(scopeKey) ?? '{}') as { outbox?: RepositoryOutboxEntryV1[] };
      assert.equal(
        durable.outbox?.find(candidate => candidate.id === entry.id)?.status,
        'pending',
        'transient syncing status must not enter the durable repository',
      );
    },
    clearSyncing: entriesToClear => repository.clearOutboxSyncingTransient(
      entriesToClear.map(entry => entry.id),
      ownerScope,
    ),
    syncEntry: async entry => { sent.push(entry.id); },
    acknowledge: async batch => {
      acknowledgedBatches.push(batch.map(entry => entry.id));
      await repository.acknowledgeOutbox(batch.map(entry => entry.id));
    },
    fail: (entry, message) => repository.failOutbox([entry.id], message),
    resolveFailure: async () => ({ resolved: false, conflict: false, message: 'failed' }),
  });

  assert.deepEqual(sent, entries.map(entry => entry.id));
  assert.deepEqual(acknowledgedBatches, [entries.map(entry => entry.id)]);
  assert.equal(storage.writes, 1, 'the complete successful run has one durable acknowledgement write');
  assert.equal(repository.getOutbox().length, 0);
  assert.equal(result.completed, 3);
  assert.equal(result.canceled, false);
}

async function canceledOutboxBatchKeepsAccumulatedSuccessDurable() {
  const storage = new CountingStorage();
  const { repository } = deterministicRepository(storage);
  const ownerScope = 'account:canceled-startup';
  await repository.initialize(ownerScope);
  await repository.saveEntity(createSavedEntity({ id: 'cancel-a', title: 'Cancel A', kind: 'place' }));
  await repository.saveEntity(createSavedEntity({ id: 'cancel-b', title: 'Cancel B', kind: 'place' }));
  const entries = repository.getOutbox();
  let sessionCurrent = true;
  let acknowledged = 0;
  storage.resetCounts();

  const result = await processTripRepositoryOutbox(entries, {
    isSessionCurrent: () => sessionCurrent,
    markSyncing: async entry => {
      await repository.markOutboxSyncingTransient([entry.id], ownerScope);
      if (entry.id === entries[1].id) sessionCurrent = false;
    },
    clearSyncing: entriesToClear => repository.clearOutboxSyncingTransient(
      entriesToClear.map(entry => entry.id),
      ownerScope,
    ),
    syncEntry: async () => {},
    acknowledge: async () => { acknowledged += 1; },
    fail: (entry, message) => repository.failOutbox([entry.id], message),
    resolveFailure: async () => ({ resolved: false, conflict: false, message: 'failed' }),
  });

  assert.equal(result.canceled, true);
  assert.equal(result.completed, 0, 'unacknowledged remote writes remain durable and retry idempotently');
  assert.equal(acknowledged, 0, 'a canceled account session cannot acknowledge its accumulated writes');
  assert.equal(storage.writes, 0, 'transient marks and cancellation do not rewrite the repository');
  assert.deepEqual(repository.getOutbox().map(entry => entry.status), ['pending', 'pending']);

  const restored = deterministicRepository(storage).repository;
  await restored.initialize(ownerScope);
  assert.deepEqual(restored.getOutbox().map(entry => entry.status), ['pending', 'pending']);
}

async function outboxFailuresRemainDurableAndPreserveBatchOrder() {
  const entries = [
    outboxEntry('fail-a1', 'trip-a'),
    outboxEntry('skip-a2', 'trip-a'),
    outboxEntry('success-b', 'trip-b'),
    outboxEntry('resolved-c', 'trip-c'),
    outboxEntry('success-d', 'trip-d'),
  ];
  const events: string[] = [];
  const acknowledgedBatches: string[][] = [];
  const result = await processTripRepositoryOutbox(entries, {
    isSessionCurrent: () => true,
    markSyncing: async entry => { events.push(`mark:${entry.id}`); },
    clearSyncing: async () => {},
    syncEntry: async entry => {
      events.push(`sync:${entry.id}`);
      if (entry.id === 'fail-a1' || entry.id === 'resolved-c') throw new Error(entry.id);
    },
    acknowledge: async batch => {
      const ids = batch.map(entry => entry.id);
      acknowledgedBatches.push(ids);
      events.push(`ack:${ids.join(',')}`);
    },
    fail: async entry => { events.push(`fail:${entry.id}`); },
    resolveFailure: async entry => entry.id === 'resolved-c'
      ? { resolved: true, conflict: true, message: 'conflict preserved' }
      : { resolved: false, conflict: false, message: 'hard failure' },
  });

  assert.deepEqual(events, [
    'mark:fail-a1',
    'sync:fail-a1',
    'fail:fail-a1',
    'mark:success-b',
    'sync:success-b',
    'mark:resolved-c',
    'sync:resolved-c',
    'mark:success-d',
    'sync:success-d',
    'ack:success-b,resolved-c,success-d',
  ]);
  assert.deepEqual(acknowledgedBatches, [['success-b', 'resolved-c', 'success-d']]);
  assert.equal(result.completed, 2, 'resolved conflicts retain the existing completed-count semantics');
  assert.equal(result.blockedByConflict, true);
  assert.equal(result.error, 'hard failure');
}

async function failedRevisionBlocksOnlyItsEntity() {
  const entries = [
    outboxEntry('failed-first', 'same-trip', 'failed'),
    outboxEntry('later-same-trip', 'same-trip'),
    outboxEntry('other-trip', 'other-trip'),
  ];
  const sent: string[] = [];
  const acknowledged: string[] = [];
  const result = await processTripRepositoryOutbox(entries, {
    isSessionCurrent: () => true,
    markSyncing: async () => {},
    clearSyncing: async () => {},
    syncEntry: async entry => { sent.push(entry.id); },
    acknowledge: async batch => { acknowledged.push(...batch.map(entry => entry.id)); },
    fail: async () => {},
    resolveFailure: async () => ({ resolved: false, conflict: false, message: 'failed' }),
  });

  assert.deepEqual(sent, ['other-trip']);
  assert.deepEqual(acknowledged, ['other-trip']);
  assert.equal(result.completed, 1);
  assert.equal(result.error, 'First revision failed');
  assert.equal(hasRunnableTripRepositoryOutboxEntries(entries.slice(0, 2)), false);
  assert.equal(hasRunnableTripRepositoryOutboxEntries(entries), true);
  assert.deepEqual(retryEligibleTripRepositoryEntryIds(entries, 2_999), []);
  assert.deepEqual(retryEligibleTripRepositoryEntryIds(entries, 3_000), ['failed-first']);
}

async function supersededSyncingUpsertCannotBlockDelete() {
  const syncing = {
    ...outboxEntry('syncing-upsert', 'deleted-trip', 'pending'),
    status: 'syncing' as const,
    revision: 2,
  };
  const deletion = {
    ...outboxEntry('following-delete', 'deleted-trip'),
    operation: 'delete' as const,
    revision: 3,
    payload: undefined,
  };
  const entries = [syncing, deletion];
  const sent: string[] = [];
  const acknowledged: string[] = [];
  const result = await processTripRepositoryOutbox(entries, {
    isSessionCurrent: () => true,
    markSyncing: async () => {},
    clearSyncing: async () => {},
    syncEntry: async entry => {
      if (isOutboxEntrySupersededByDelete(entry, entries)) return;
      sent.push(entry.id);
    },
    acknowledge: async batch => { acknowledged.push(...batch.map(entry => entry.id)); },
    fail: async () => {},
    resolveFailure: async () => ({ resolved: false, conflict: false, message: 'failed' }),
  });

  assert.deepEqual(sent, ['following-delete']);
  assert.deepEqual(acknowledged, ['syncing-upsert', 'following-delete']);
  assert.equal(result.completed, 2);
  assert.equal(result.blockedByConflict, false);

  const failed: string[] = [];
  const acknowledgedAfterFailure: string[] = [];
  const failurePass = await processTripRepositoryOutbox([syncing], {
    isSessionCurrent: () => true,
    markSyncing: async () => {},
    clearSyncing: async () => {},
    syncEntry: async () => { throw new Error('request failed'); },
    acknowledge: async batch => { acknowledgedAfterFailure.push(...batch.map(entry => entry.id)); },
    fail: async entry => { failed.push(entry.id); },
    resolveFailure: async entry => isOutboxEntrySupersededByDelete(entry, entries)
      ? { resolved: true, conflict: false, message: 'superseded' }
      : { resolved: false, conflict: false, message: 'failed' },
  });
  assert.deepEqual(acknowledgedAfterFailure, ['syncing-upsert']);
  assert.deepEqual(failed, []);
  assert.equal(failurePass.canceled, false);

  const sentOnNextPass: string[] = [];
  await processTripRepositoryOutbox([deletion], {
    isSessionCurrent: () => true,
    markSyncing: async () => {},
    clearSyncing: async () => {},
    syncEntry: async entry => { sentOnNextPass.push(entry.id); },
    acknowledge: async () => {},
    fail: async () => {},
    resolveFailure: async () => ({ resolved: false, conflict: false, message: 'failed' }),
  });
  assert.deepEqual(sentOnNextPass, ['following-delete']);
}

async function tombstonesPreserveRevisionAcrossResave() {
  const { storage, repository } = deterministicRepository();
  await repository.initialize(808);
  const saved = await repository.saveEntity(createSavedEntity({ id: 'resaved-place', title: 'Place', kind: 'place' }));
  await repository.removeEntity(saved.id, { expectedRevision: saved.revision });
  const resaved = await repository.saveEntity(createSavedEntity({ id: saved.id, title: 'Place again', kind: 'place' }));
  assert.equal(resaved.revision, 3);
  assert.deepEqual(repository.getOutbox().map(entry => entry.revision), [1, 2, 3]);

  const restored = deterministicRepository(storage).repository;
  await restored.initialize(808);
  assert.equal(restored.getSavedEntity(saved.id)?.revision, 3);
}

async function equalRevisionTombstonesBeatRemoteRows() {
  const { repository } = deterministicRepository();
  await repository.initialize('equal-tombstones');
  const trip = await repository.upsertTrip(
    createTripDocument({ id: 'equal-trip', title: 'Deleted trip' }),
    { enqueueSync: false },
  );
  const entity = await repository.saveEntity(
    createSavedEntity({ id: 'equal-place', title: 'Deleted place', kind: 'place' }),
    { enqueueSync: false },
  );
  await repository.deleteTrip(trip.id, { expectedRevision: trip.revision, enqueueSync: false });
  await repository.removeEntity(entity.id, { expectedRevision: entity.revision, enqueueSync: false });
  const revisionBeforeRemoteRows = repository.getSnapshot().revision;

  await repository.applyRemoteTrip({
    ...trip,
    ownerScope: 'account:equal-tombstones',
    revision: trip.revision + 1,
    title: 'Equal revision server trip',
  });
  await repository.applyRemoteSavedEntity({
    ...entity,
    ownerScope: 'account:equal-tombstones',
    revision: entity.revision + 1,
    title: 'Equal revision server place',
  });

  assert.equal(repository.getTrip(trip.id), null);
  assert.equal(repository.getSavedEntity(entity.id), null);
  assert.equal(repository.getSnapshot().revision, revisionBeforeRemoteRows);
}

async function staleRemoteRevisionsCannotMoveLocalStateBackward() {
  const { repository } = deterministicRepository();
  await repository.initialize(818);

  const tripV1 = await repository.upsertTrip(createTripDocument({ id: 'monotonic-trip', title: 'Trip v1' }));
  const tripV2 = await repository.upsertTrip({ ...tripV1, title: 'Trip v2' }, { expectedRevision: tripV1.revision });
  await repository.acknowledgeOutbox(repository.getOutbox().map(entry => entry.id));
  const repositoryRevisionBeforeStaleTrip = repository.getSnapshot().revision;
  await repository.applyRemoteTrip({
    ...tripV1,
    ownerScope: 'account:818',
    title: 'Stale server trip',
    updatedAt: tripV1.updatedAt + 1,
  });
  assert.equal(repository.getTrip(tripV2.id)?.title, 'Trip v2');
  assert.equal(repository.getTrip(tripV2.id)?.revision, tripV2.revision);
  assert.equal(repository.getSnapshot().revision, repositoryRevisionBeforeStaleTrip, 'ignored trip rows do not emit a repository write');

  const staleTripDelete = await repository.applyRemoteTripTombstone(tripV2.id, tripV1.revision, tripV1.updatedAt + 2);
  assert.deepEqual(staleTripDelete, { deleted: false, ignored: true });
  assert.equal(repository.getTrip(tripV2.id)?.title, 'Trip v2');

  const entityV1 = await repository.saveEntity(createSavedEntity({ id: 'monotonic-place', title: 'Place v1', kind: 'place' }));
  const entityV2 = await repository.saveEntity({ ...entityV1, title: 'Place v2' }, { expectedRevision: entityV1.revision });
  await repository.acknowledgeOutbox(repository.getOutbox().map(entry => entry.id));
  const repositoryRevisionBeforeStaleEntity = repository.getSnapshot().revision;
  await repository.applyRemoteSavedEntity({
    ...entityV1,
    ownerScope: 'account:818',
    title: 'Stale server place',
    updatedAt: entityV1.updatedAt + 1,
  });
  assert.equal(repository.getSavedEntity(entityV2.id)?.title, 'Place v2');
  assert.equal(repository.getSavedEntity(entityV2.id)?.revision, entityV2.revision);
  assert.equal(repository.getSnapshot().revision, repositoryRevisionBeforeStaleEntity, 'ignored saved rows do not emit a repository write');

  const staleEntityDelete = await repository.applyRemoteSavedEntityTombstone(entityV2.id, entityV1.revision, entityV1.updatedAt + 2);
  assert.deepEqual(staleEntityDelete, { deleted: false, ignored: true });
  assert.equal(repository.getSavedEntity(entityV2.id)?.title, 'Place v2');

  await repository.deleteTrip(tripV2.id, { expectedRevision: tripV2.revision });
  await repository.removeEntity(entityV2.id, { expectedRevision: entityV2.revision });
  await repository.acknowledgeOutbox(repository.getOutbox().map(entry => entry.id));
  const revisionWithTombstones = repository.getSnapshot().revision;
  await repository.applyRemoteTrip({ ...tripV2, ownerScope: 'account:818' });
  await repository.applyRemoteSavedEntity({ ...entityV2, ownerScope: 'account:818' });
  assert.equal(repository.getTrip(tripV2.id), null, 'an older row cannot resurrect a newer trip tombstone');
  assert.equal(repository.getSavedEntity(entityV2.id), null, 'an older row cannot resurrect a newer saved-item tombstone');
  assert.equal(repository.getSnapshot().revision, revisionWithTombstones);

  const tripV4 = await repository.applyRemoteTrip({
    ...tripV2,
    ownerScope: 'account:818',
    revision: tripV2.revision + 2,
    title: 'Trip v4 from server',
    updatedAt: tripV2.updatedAt + 10,
  });
  const entityV4 = await repository.applyRemoteSavedEntity({
    ...entityV2,
    ownerScope: 'account:818',
    revision: entityV2.revision + 2,
    title: 'Place v4 from server',
    updatedAt: entityV2.updatedAt + 10,
  });
  assert.equal(tripV4.record.title, 'Trip v4 from server');
  assert.equal(entityV4.record.title, 'Place v4 from server');
  assert.equal(repository.getTrip(tripV2.id)?.revision, tripV2.revision + 2);
  assert.equal(repository.getSavedEntity(entityV2.id)?.revision, entityV2.revision + 2);
}

async function erasureClearsMemoryBeforeDurableDeleteCompletes() {
  const storage = new DelayedEraseStorage();
  const { repository } = deterministicRepository(storage);
  await repository.initialize(909);
  await repository.upsertTrip(createTripDocument({ id: 'private-trip', title: 'Private trip' }));

  const erasing = repository.eraseScope(909);
  await storage.eraseStarted;
  assert.equal(repository.getSnapshot().ownerScope, 'account:909');
  assert.equal(repository.listTrips({ includeArchived: true }).length, 0);
  assert.equal(repository.getOutbox().length, 0);
  assert.equal(storage.values.has(tripRepositoryScopeKey('account:909')), true);

  storage.release();
  await erasing;
  assert.equal(storage.values.has(tripRepositoryScopeKey('account:909')), false);
}

async function scopedErasure() {
  const { storage, repository } = deterministicRepository();
  await repository.initialize();
  await repository.upsertTrip(createTripDocument({ id: 'anonymous-kept', title: 'Anonymous draft' }));
  await repository.initialize(909);
  await repository.upsertTrip(createTripDocument({ id: 'account-erased', title: 'Account draft' }));
  await repository.saveEntity(createSavedEntity({ id: 'account-place', title: 'Account place', kind: 'place' }));

  const erased = await repository.eraseScope(909);
  assert.deepEqual(erased, { ownerScope: 'account:909', erasedCurrentScope: true });
  assert.equal(repository.getSnapshot().initialized, true);
  assert.equal(repository.getSnapshot().ownerScope, 'account:909');
  assert.equal(repository.listTrips({ includeArchived: true }).length, 0);
  assert.equal(repository.listSavedEntities().length, 0);
  assert.equal(repository.getOutbox().length, 0);
  assert.equal(storage.values.has(tripRepositoryScopeKey('account:909')), false);

  await repository.initialize();
  assert.equal(repository.getTrip('anonymous-kept')?.title, 'Anonymous draft');
  assert.equal(storage.values.has('anonymous'), true, 'account erasure does not touch the anonymous namespace');
}

async function run() {
  await accountIsolationAndPersistence();
  await uncappedCollectionsAndFiltering();
  await tripAndLibraryOperations();
  await bulkDraftDeletionIsAtomicAndDurable();
  await queuedScopeSwitchCannotDeleteAnotherAccountsDrafts();
  await queuedScopeSwitchCannotDeleteAnotherAccountsSavedTrip();
  await batchDeletePrunesSupersededOutboxEntries();
  await singleDeletePersistsExplicitIntent();
  await optimisticRevisionContract();
  await persistentOutboxContract();
  await unchangedOnlineStateDoesNotPersist();
  await legacyMigrationAndQuarantine();
  await legacyMigrationDoesNotResurrectDeletedTrips();
  await corruptRepositoryRecovery();
  await explicitAnonymousMerge();
  await changedScopeMergeUpdatesOnlyChangedRecords();
  await identicalScopeMergeDeduplicatesCanonicalIds();
  await remoteBatchMatchesRecordByRecordSemanticsAndPersistsOnce();
  await sameScopeInitializationReusesTheCurrentRepositoryState();
  await failedInitializationLeavesThePreviousScopeRetryable();
  await failedRemoteBatchWriteRollsBackWithoutEmission();
  await remoteBatchIsCanceledOrCommittedWithinOneAccountScope();
  await remoteReconciliation();
  await legacyAcknowledgementDoesNotDualWrite();
  await authChangeCancelsOutboxBeforeNextMutation();
  await startupOutboxSuccessUsesOneDurableAcknowledgement();
  await canceledOutboxBatchKeepsAccumulatedSuccessDurable();
  await outboxFailuresRemainDurableAndPreserveBatchOrder();
  await failedRevisionBlocksOnlyItsEntity();
  await supersededSyncingUpsertCannotBlockDelete();
  await tombstonesPreserveRevisionAcrossResave();
  await equalRevisionTombstonesBeatRemoteRows();
  await staleRemoteRevisionsCannotMoveLocalStateBackward();
  await erasureClearsMemoryBeforeDurableDeleteCompletes();
  await scopedErasure();
  console.log('trip repository contracts passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
