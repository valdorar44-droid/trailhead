import assert from 'node:assert/strict';
import {
  createSavedEntity,
  createTripDocument,
  MemoryTripRepositoryStorage,
  TripRepository,
  TripRepositoryConflictError,
  tripRepositoryScopeKey,
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
    syncEntry: async entry => {
      sent.push(entry.id);
      sessionCurrent = false;
    },
    acknowledge: async entry => { acknowledged.push(entry.id); },
    fail: async () => {},
    resolveFailure: async () => ({ resolved: false, conflict: false, message: 'failed' }),
  });

  assert.equal(result.canceled, true);
  assert.deepEqual(sent, ['entry-a']);
  assert.deepEqual(acknowledged, []);
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
    syncEntry: async entry => { sent.push(entry.id); },
    acknowledge: async entry => { acknowledged.push(entry.id); },
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
    syncEntry: async entry => {
      if (isOutboxEntrySupersededByDelete(entry, entries)) return;
      sent.push(entry.id);
    },
    acknowledge: async entry => { acknowledged.push(entry.id); },
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
    syncEntry: async () => { throw new Error('request failed'); },
    acknowledge: async entry => { acknowledgedAfterFailure.push(entry.id); },
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
  await legacyMigrationAndQuarantine();
  await legacyMigrationDoesNotResurrectDeletedTrips();
  await corruptRepositoryRecovery();
  await explicitAnonymousMerge();
  await changedScopeMergeUpdatesOnlyChangedRecords();
  await identicalScopeMergeDeduplicatesCanonicalIds();
  await remoteReconciliation();
  await legacyAcknowledgementDoesNotDualWrite();
  await authChangeCancelsOutboxBeforeNextMutation();
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
