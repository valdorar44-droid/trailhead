import {
  AddEntityToTripOptions,
  DraftTripDeletionOptions,
  DraftTripDeletionRequest,
  LegacyMigrationInput,
  LegacyMigrationResult,
  ListSavedEntitiesOptions,
  ListTripsOptions,
  RepositoryMigrationReceiptV1,
  RepositoryMutationOptions,
  RepositoryOutboxEntryV1,
  SavedEntityKind,
  SavedEntityV1,
  SAVED_ENTITY_SCHEMA_VERSION,
  TripDocumentV2,
  TripDeletionMode,
  TripDeletionOptions,
  TripDeletionOutboxPayloadV1,
  TripItemKind,
  TripItemV1,
  TripNoteInput,
  TRIP_DOCUMENT_SCHEMA_VERSION,
  TRIP_ITEM_SCHEMA_VERSION,
  TripRepositorySnapshot,
  TripRepositoryRemoteResult,
  TripRepositoryScopeMergeResult,
  TripRepositorySyncStatus,
  TripRepositoryUserScope,
  TripStatus,
} from './types';

const REPOSITORY_SCHEMA_VERSION = 2 as const;

interface PersistedSyncMeta {
  online: boolean;
  lastSyncedAt?: number;
  lastError?: string;
}

interface PersistedRepositoryTombstone {
  entityType: RepositoryOutboxEntryV1['entityType'];
  entityId: string;
  revision: number;
  deletedAt: number;
}

interface PersistedScopeMergeRecord {
  sourceHash: string;
  destinationHash?: string;
  destinationId: string;
  sourceRevision: number;
  mergedAt: number;
}

interface PersistedRepositoryStateV2 {
  schemaVersion: typeof REPOSITORY_SCHEMA_VERSION;
  ownerScope: string;
  revision: number;
  trips: Record<string, TripDocumentV2>;
  savedEntities: Record<string, SavedEntityV1>;
  outbox: RepositoryOutboxEntryV1[];
  migrationReceipts: RepositoryMigrationReceiptV1[];
  migrationKeys: Record<string, number>;
  tombstones: Record<string, PersistedRepositoryTombstone>;
  scopeMergeRecords: Record<string, PersistedScopeMergeRecord>;
  syncMeta: PersistedSyncMeta;
}

export interface TripRepositoryStorage {
  read(ownerScopeKey: string): Promise<string | null>;
  write(ownerScopeKey: string, value: string): Promise<void>;
  preserveCorrupt(ownerScopeKey: string, value: string, reason: string): Promise<string>;
  erase(ownerScopeKey: string): Promise<void>;
}

export interface TripRepositoryDependencies {
  storage: TripRepositoryStorage;
  now?: () => number;
  createId?: (prefix: string) => string;
}

export class TripRepositoryConflictError extends Error {
  readonly entityId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(entityId: string, expectedRevision: number, actualRevision: number) {
    super(`Repository revision conflict for ${entityId}: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = 'TripRepositoryConflictError';
    this.entityId = entityId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(value: unknown, fallback = 1): number {
  const parsed = finiteNumber(value);
  return parsed == null ? fallback : Math.max(1, Math.round(parsed));
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => text(item)).filter(Boolean);
}

function coordinates(lat: unknown, lng: unknown) {
  const cleanLat = finiteNumber(lat);
  const cleanLng = finiteNumber(lng);
  if (cleanLat == null || cleanLng == null || Math.abs(cleanLat) > 90 || Math.abs(cleanLng) > 180) return undefined;
  return { lat: cleanLat, lng: cleanLng };
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function serializeUnknown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function tombstoneKey(entityType: RepositoryOutboxEntryV1['entityType'], entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function normalizeTripRepositoryScope(scope?: TripRepositoryUserScope): string {
  if (scope && typeof scope === 'object') {
    const id = scope.userId ?? scope.id;
    if (id != null && String(id).trim()) return `account:${String(id).trim()}`;
    return 'anonymous';
  }
  if (scope != null && String(scope).trim() && String(scope).trim() !== 'anonymous') {
    const raw = String(scope).trim();
    return raw.startsWith('account:') ? raw : `account:${raw}`;
  }
  return 'anonymous';
}

export function tripRepositoryScopeKey(ownerScope: string): string {
  if (ownerScope === 'anonymous') return 'anonymous';
  const reversed = [...ownerScope].reverse().join('');
  return `account_${stableHash(ownerScope)}_${stableHash(reversed)}`;
}

function comparableJson(value: unknown): string {
  const normalize = (current: unknown, depth: number): unknown => {
    if (depth === 0 && current && typeof current === 'object' && !Array.isArray(current)) {
      const root = current as Record<string, unknown>;
      return normalize(Object.fromEntries(
        Object.entries(root).filter(([key]) => !['ownerScope', 'revision', 'createdAt', 'updatedAt'].includes(key)),
      ), depth + 1);
    }
    if (Array.isArray(current)) return current.map(item => normalize(item, depth + 1));
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested, depth + 1)]));
    }
    return current;
  };
  return JSON.stringify(normalize(value, 0));
}

function contentHash(value: unknown): string {
  return stableHash(comparableJson(value));
}

function emptyState(ownerScope: string): PersistedRepositoryStateV2 {
  return {
    schemaVersion: REPOSITORY_SCHEMA_VERSION,
    ownerScope,
    revision: 0,
    trips: {},
    savedEntities: {},
    outbox: [],
    migrationReceipts: [],
    migrationKeys: {},
    tombstones: {},
    scopeMergeRecords: {},
    syncMeta: { online: true },
  };
}

function isTripDocument(value: unknown): value is TripDocumentV2 {
  const candidate = record(value);
  return candidate?.schemaVersion === TRIP_DOCUMENT_SCHEMA_VERSION
    && typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && Array.isArray(candidate.items)
    && Array.isArray(candidate.days);
}

function isSavedEntity(value: unknown): value is SavedEntityV1 {
  const candidate = record(value);
  return candidate?.schemaVersion === SAVED_ENTITY_SCHEMA_VERSION
    && typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && Array.isArray(candidate.media);
}

function isOutboxEntry(value: unknown): value is RepositoryOutboxEntryV1 {
  const candidate = record(value);
  return typeof candidate?.id === 'string'
    && typeof candidate.entityId === 'string'
    && (candidate.entityType === 'trip' || candidate.entityType === 'saved_entity');
}

function canonicalItemKind(value: unknown): TripItemKind {
  const raw = text(value).toLowerCase();
  if (raw === 'start') return 'start';
  if (raw === 'destination' || raw === 'finish') return 'destination';
  if (raw.includes('camp') || raw === 'overnight') return 'camp';
  if (raw.includes('trail')) return 'trail';
  if (raw.includes('activity') || raw.includes('tour')) return 'activity';
  if (raw.includes('fuel') || raw.includes('gas')) return 'fuel';
  if (raw.includes('water') || raw.includes('spring')) return 'water';
  if (raw.includes('food') || raw.includes('restaurant') || raw.includes('grocery')) return 'food';
  if (raw.includes('service') || raw.includes('repair') || raw.includes('mechanic')) return 'service';
  return 'place';
}

function canonicalEntityKind(value: unknown): SavedEntityKind {
  const kind = canonicalItemKind(value);
  if (kind === 'start' || kind === 'destination' || kind === 'food' || kind === 'note') return 'place';
  return kind;
}

function outboxStatus(entries: RepositoryOutboxEntryV1[], meta: PersistedSyncMeta): TripRepositorySyncStatus {
  const pendingCount = entries.length;
  const failedCount = entries.filter(entry => entry.status === 'failed').length;
  const syncing = entries.some(entry => entry.status === 'syncing');
  const state = !meta.online
    ? 'offline'
    : syncing
      ? 'syncing'
      : failedCount > 0
        ? 'error'
        : pendingCount > 0
          ? 'pending'
          : 'idle';
  return {
    state,
    online: meta.online,
    pendingCount,
    failedCount,
    lastSyncedAt: meta.lastSyncedAt,
    lastError: meta.lastError,
  };
}

function snapshotFromState(state: PersistedRepositoryStateV2, initialized: boolean): TripRepositorySnapshot {
  const trips = Object.values(state.trips).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const savedEntities = Object.values(state.savedEntities).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return {
    initialized,
    ownerScope: state.ownerScope,
    revision: state.revision,
    trips,
    savedEntities,
    sync: outboxStatus(state.outbox, state.syncMeta),
    migrationReceipts: [...state.migrationReceipts].sort((a, b) => b.createdAt - a.createdAt),
  };
}

function normalizedTrip(input: TripDocumentV2, ownerScope: string, now: number, revision: number): TripDocumentV2 {
  const createdAt = finiteNumber(input.createdAt) ?? now;
  return {
    ...input,
    schemaVersion: TRIP_DOCUMENT_SCHEMA_VERSION,
    id: text(input.id),
    ownerScope,
    revision,
    title: text(input.title, 'Untitled trip'),
    regions: stringList(input.regions),
    days: Array.isArray(input.days) ? input.days : [],
    items: Array.isArray(input.items) ? input.items : [],
    notes: Array.isArray(input.notes) ? input.notes : [],
    readiness: input.readiness ?? { status: 'not_started' },
    bookings: Array.isArray(input.bookings) ? input.bookings : [],
    alerts: Array.isArray(input.alerts) ? input.alerts : [],
    offline: record(input.offline) ?? {},
    visibility: input.visibility ?? 'private',
    createdAt,
    updatedAt: now,
  };
}

function normalizedEntity(input: SavedEntityV1, ownerScope: string, now: number, revision: number): SavedEntityV1 {
  return {
    ...input,
    schemaVersion: SAVED_ENTITY_SCHEMA_VERSION,
    id: text(input.id),
    ownerScope,
    revision,
    kind: input.kind ?? 'place',
    title: text(input.title, 'Saved place'),
    media: Array.isArray(input.media) ? input.media : [],
    createdAt: finiteNumber(input.createdAt) ?? now,
    updatedAt: now,
  };
}

function assertExpectedRevision(
  entityId: string,
  actualRevision: number,
  expectedRevision: number | undefined,
) {
  if (expectedRevision != null && expectedRevision !== actualRevision) {
    throw new TripRepositoryConflictError(entityId, expectedRevision, actualRevision);
  }
}

function tripDeletionPayload(mode: TripDeletionMode, originalStatus: TripStatus): TripDeletionOutboxPayloadV1 {
  return { kind: 'trip_deletion', mode, originalStatus };
}

export class TripRepository {
  private readonly storage: TripRepositoryStorage;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private ownerScope = 'anonymous';
  private ownerScopeKey = tripRepositoryScopeKey(this.ownerScope);
  private state = emptyState(this.ownerScope);
  private snapshot = snapshotFromState(this.state, false);
  private listeners = new Set<() => void>();
  private writeChain: Promise<unknown> = Promise.resolve();
  private loadHadCorruption = false;

  constructor(dependencies: TripRepositoryDependencies) {
    this.storage = dependencies.storage;
    this.now = dependencies.now ?? (() => Date.now());
    this.createId = dependencies.createId ?? ((prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TripRepositorySnapshot => this.snapshot;

  private emit() {
    this.snapshot = snapshotFromState(this.state, true);
    for (const listener of this.listeners) listener();
  }

  private async persist() {
    await this.storage.write(this.ownerScopeKey, JSON.stringify(this.state));
    this.emit();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(operation, operation);
    this.writeChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private receipt(
    source: string,
    sourceKey: string,
    status: RepositoryMigrationReceiptV1['status'],
    counts: { imported?: number; skipped?: number; corrupt?: number },
    detail?: string,
    preservedRef?: string,
    ownerScope = this.ownerScope,
  ): RepositoryMigrationReceiptV1 {
    return {
      id: this.createId('migration'),
      ownerScope,
      source,
      sourceKey,
      status,
      importedCount: counts.imported ?? 0,
      skippedCount: counts.skipped ?? 0,
      corruptCount: counts.corrupt ?? 0,
      createdAt: this.now(),
      detail,
      preservedRef,
    };
  }

  private async loadState(
    raw: string,
    ownerScope = this.ownerScope,
    ownerScopeKey = this.ownerScopeKey,
  ): Promise<PersistedRepositoryStateV2> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.loadHadCorruption = true;
      const preservedRef = await this.storage.preserveCorrupt(ownerScopeKey, raw, 'repository-json');
      const next = emptyState(ownerScope);
      next.migrationReceipts.push(this.receipt(
        'repository_state',
        `repository_state:${stableHash(raw)}`,
        'quarantined',
        { corrupt: 1 },
        error instanceof Error ? error.message : 'Repository JSON could not be read',
        preservedRef,
        ownerScope,
      ));
      return next;
    }

    const root = record(parsed);
    if (!root || root.schemaVersion !== REPOSITORY_SCHEMA_VERSION) {
      this.loadHadCorruption = true;
      const preservedRef = await this.storage.preserveCorrupt(ownerScopeKey, raw, 'repository-schema');
      const next = emptyState(ownerScope);
      next.migrationReceipts.push(this.receipt(
        'repository_state',
        `repository_state:${stableHash(raw)}`,
        'quarantined',
        { corrupt: 1 },
        'Unsupported repository schema',
        preservedRef,
        ownerScope,
      ));
      return next;
    }

    const next = emptyState(ownerScope);
    next.revision = finiteNumber(root.revision) ?? 0;
    next.syncMeta = {
      online: record(root.syncMeta)?.online !== false,
      lastSyncedAt: finiteNumber(record(root.syncMeta)?.lastSyncedAt),
      lastError: text(record(root.syncMeta)?.lastError) || undefined,
    };
    next.migrationKeys = record(root.migrationKeys) as Record<string, number> ?? {};
    next.migrationReceipts = Array.isArray(root.migrationReceipts)
      ? root.migrationReceipts.filter(item => record(item) && typeof record(item)?.id === 'string') as RepositoryMigrationReceiptV1[]
      : [];
    const tombstones = record(root.tombstones) ?? {};
    for (const [key, value] of Object.entries(tombstones)) {
      const candidate = record(value);
      const entityType = candidate?.entityType;
      const entityId = text(candidate?.entityId);
      const revision = finiteNumber(candidate?.revision);
      const deletedAt = finiteNumber(candidate?.deletedAt);
      if ((entityType === 'trip' || entityType === 'saved_entity') && entityId && revision != null && deletedAt != null) {
        next.tombstones[key] = {
          entityType,
          entityId,
          revision: Math.max(1, Math.round(revision)),
          deletedAt,
        };
      }
    }
    const scopeMergeRecords = record(root.scopeMergeRecords) ?? {};
    for (const [key, value] of Object.entries(scopeMergeRecords)) {
      const candidate = record(value);
      const sourceHash = text(candidate?.sourceHash);
      const destinationId = text(candidate?.destinationId);
      const sourceRevision = finiteNumber(candidate?.sourceRevision);
      const mergedAt = finiteNumber(candidate?.mergedAt);
      if (sourceHash && destinationId && sourceRevision != null && mergedAt != null) {
        next.scopeMergeRecords[key] = {
          sourceHash,
          destinationHash: text(candidate?.destinationHash) || undefined,
          destinationId,
          sourceRevision: Math.max(0, Math.round(sourceRevision)),
          mergedAt,
        };
      }
    }

    const corruptRecords: Array<{ source: string; id: string; value: unknown }> = [];
    const trips = record(root.trips) ?? {};
    for (const [id, value] of Object.entries(trips)) {
      if (isTripDocument(value)) next.trips[id] = { ...value, ownerScope };
      else corruptRecords.push({ source: 'trip_record', id, value });
    }
    const entities = record(root.savedEntities) ?? {};
    for (const [id, value] of Object.entries(entities)) {
      if (isSavedEntity(value)) next.savedEntities[id] = { ...value, ownerScope };
      else corruptRecords.push({ source: 'saved_entity_record', id, value });
    }
    if (Array.isArray(root.outbox)) {
      root.outbox.forEach((value, index) => {
        if (isOutboxEntry(value)) next.outbox.push({ ...value, ownerScope });
        else corruptRecords.push({ source: 'outbox_record', id: String(index), value });
      });
    }

    for (const corrupt of corruptRecords) {
      this.loadHadCorruption = true;
      const serialized = serializeUnknown(corrupt.value);
      const preservedRef = await this.storage.preserveCorrupt(ownerScopeKey, serialized, `${corrupt.source}-${corrupt.id}`);
      next.migrationReceipts.push(this.receipt(
        corrupt.source,
        `${corrupt.source}:${corrupt.id}:${stableHash(serialized)}`,
        'quarantined',
        { corrupt: 1 },
        `Invalid ${corrupt.source.replace(/_/g, ' ')} ${corrupt.id}`,
        preservedRef,
        ownerScope,
      ));
    }
    return next;
  }

  async initialize(scope?: TripRepositoryUserScope): Promise<TripRepositorySnapshot> {
    return this.serialize(async () => {
      this.ownerScope = normalizeTripRepositoryScope(scope);
      this.ownerScopeKey = tripRepositoryScopeKey(this.ownerScope);
      const raw = await this.storage.read(this.ownerScopeKey);
      this.loadHadCorruption = false;
      this.state = raw ? await this.loadState(raw) : emptyState(this.ownerScope);
      if (raw && this.loadHadCorruption) {
        await this.persist();
      } else {
        this.emit();
      }
      return this.snapshot;
    });
  }

  async inspectScope(scopeInput?: TripRepositoryUserScope): Promise<{
    ownerScope: string;
    revision: number;
    tripCount: number;
    savedEntityCount: number;
  }> {
    return this.serialize(async () => {
      const ownerScope = normalizeTripRepositoryScope(scopeInput);
      const ownerScopeKey = tripRepositoryScopeKey(ownerScope);
      const raw = await this.storage.read(ownerScopeKey);
      if (!raw) return { ownerScope, revision: 0, tripCount: 0, savedEntityCount: 0 };

      const previousCorruptionState = this.loadHadCorruption;
      this.loadHadCorruption = false;
      const inspected = await this.loadState(raw, ownerScope, ownerScopeKey);
      const repaired = this.loadHadCorruption;
      this.loadHadCorruption = previousCorruptionState;
      if (repaired) await this.storage.write(ownerScopeKey, JSON.stringify(inspected));
      return {
        ownerScope,
        revision: inspected.revision,
        tripCount: Object.keys(inspected.trips).length,
        savedEntityCount: Object.keys(inspected.savedEntities).length,
      };
    });
  }

  async mergeScope(
    sourceScopeInput: TripRepositoryUserScope,
    destinationScopeInput: TripRepositoryUserScope,
  ): Promise<TripRepositoryScopeMergeResult> {
    return this.serialize(async () => {
      const sourceScope = normalizeTripRepositoryScope(sourceScopeInput);
      const destinationScope = normalizeTripRepositoryScope(destinationScopeInput);
      const sourceKey = tripRepositoryScopeKey(sourceScope);
      const destinationKey = tripRepositoryScopeKey(destinationScope);
      this.loadHadCorruption = false;
      const sourceRaw = await this.storage.read(sourceKey);
      const destinationRaw = sourceScope === destinationScope
        ? sourceRaw
        : await this.storage.read(destinationKey);
      const sourceState = sourceRaw
        ? await this.loadState(sourceRaw, sourceScope, sourceKey)
        : emptyState(sourceScope);
      const destinationState = destinationRaw
        ? await this.loadState(destinationRaw, destinationScope, destinationKey)
        : emptyState(destinationScope);

      this.ownerScope = destinationScope;
      this.ownerScopeKey = destinationKey;
      this.state = destinationState;

      const mergeKey = `scope_merge:${sourceKey}:${sourceState.revision}`;
      const previouslyMerged = Boolean(destinationState.migrationKeys[mergeKey]);
      const importedTripIds: string[] = [];
      const importedEntityIds: string[] = [];
      const conflictTripIds: string[] = [];
      const conflictEntityIds: string[] = [];
      let skippedRecords = 0;
      if (sourceScope !== destinationScope) {
        for (const trip of Object.values(sourceState.trips)) {
          const recordKey = `${sourceKey}:trip:${trip.id}`;
          const sourceHash = contentHash(trip);
          const previous = this.state.scopeMergeRecords[recordKey];
          if (previous?.sourceHash === sourceHash) {
            skippedRecords += 1;
            continue;
          }

          const priorDestination = previous ? this.state.trips[previous.destinationId] : undefined;
          if (previous && !priorDestination) {
            this.state.scopeMergeRecords[recordKey] = {
              ...previous,
              sourceHash,
              sourceRevision: trip.revision,
              mergedAt: this.now(),
            };
            skippedRecords += 1;
            continue;
          }

          const directCollision = this.state.trips[trip.id];
          if (!previous && directCollision && contentHash(directCollision) === sourceHash) {
            this.state.scopeMergeRecords[recordKey] = {
              sourceHash,
              destinationHash: contentHash(directCollision),
              destinationId: directCollision.id,
              sourceRevision: trip.revision,
              mergedAt: this.now(),
            };
            skippedRecords += 1;
            continue;
          }

          const canUpdatePrior = Boolean(
            previous
            && priorDestination
            && previous.destinationHash
            && contentHash(priorDestination) === previous.destinationHash,
          );
          const collision = canUpdatePrior ? priorDestination : directCollision;
          const updatingPrior = Boolean(canUpdatePrior && priorDestination);
          const id = updatingPrior
            ? priorDestination!.id
            : collision
              ? this.createId('trip_conflict')
              : trip.id;
          const isConflictCopy = id !== trip.id;
          const now = this.now();
          const copied = normalizedTrip({
            ...trip,
            id,
            title: isConflictCopy ? `${trip.title} (signed-out copy)` : trip.title,
            legacy: isConflictCopy
              ? { source: 'scope_merge_conflict', payload: { sourceScope, originalId: trip.id } }
              : trip.legacy,
            createdAt: trip.createdAt,
          }, destinationScope, now, updatingPrior ? priorDestination!.revision + 1 : 1);
          this.state.trips[id] = copied;
          this.enqueueOutbox('trip', id, 'upsert', copied, copied.revision);
          this.state.scopeMergeRecords[recordKey] = {
            sourceHash,
            destinationHash: contentHash(copied),
            destinationId: id,
            sourceRevision: trip.revision,
            mergedAt: now,
          };
          if (isConflictCopy) conflictTripIds.push(id);
          else importedTripIds.push(id);
        }

        for (const entity of Object.values(sourceState.savedEntities)) {
          const recordKey = `${sourceKey}:saved_entity:${entity.id}`;
          const sourceHash = contentHash(entity);
          const previous = this.state.scopeMergeRecords[recordKey];
          if (previous?.sourceHash === sourceHash) {
            skippedRecords += 1;
            continue;
          }

          const priorDestination = previous ? this.state.savedEntities[previous.destinationId] : undefined;
          if (previous && !priorDestination) {
            this.state.scopeMergeRecords[recordKey] = {
              ...previous,
              sourceHash,
              sourceRevision: entity.revision,
              mergedAt: this.now(),
            };
            skippedRecords += 1;
            continue;
          }

          const directCollision = this.state.savedEntities[entity.id];
          if (!previous && directCollision && contentHash(directCollision) === sourceHash) {
            this.state.scopeMergeRecords[recordKey] = {
              sourceHash,
              destinationHash: contentHash(directCollision),
              destinationId: directCollision.id,
              sourceRevision: entity.revision,
              mergedAt: this.now(),
            };
            skippedRecords += 1;
            continue;
          }

          const canUpdatePrior = Boolean(
            previous
            && priorDestination
            && previous.destinationHash
            && contentHash(priorDestination) === previous.destinationHash,
          );
          const collision = canUpdatePrior ? priorDestination : directCollision;
          const updatingPrior = Boolean(canUpdatePrior && priorDestination);
          const id = updatingPrior
            ? priorDestination!.id
            : collision
              ? this.createId('entity_conflict')
              : entity.id;
          const isConflictCopy = id !== entity.id;
          const now = this.now();
          const mergeFacts = isConflictCopy
            ? { ...(entity.facts ?? {}), scopeMergeConflict: { sourceScope, originalId: entity.id } }
            : entity.facts;
          const copied = normalizedEntity({
            ...entity,
            id,
            title: isConflictCopy ? `${entity.title} (signed-out copy)` : entity.title,
            facts: mergeFacts,
            createdAt: entity.createdAt,
          }, destinationScope, now, updatingPrior ? priorDestination!.revision + 1 : 1);
          this.state.savedEntities[id] = copied;
          this.enqueueOutbox('saved_entity', id, 'upsert', copied, copied.revision);
          this.state.scopeMergeRecords[recordKey] = {
            sourceHash,
            destinationHash: contentHash(copied),
            destinationId: id,
            sourceRevision: entity.revision,
            mergedAt: now,
          };
          if (isConflictCopy) conflictEntityIds.push(id);
          else importedEntityIds.push(id);
        }
        this.state.migrationKeys[mergeKey] = this.now();
      }

      const importedCount = importedTripIds.length + importedEntityIds.length + conflictTripIds.length + conflictEntityIds.length;
      const alreadyMerged = previouslyMerged || sourceScope === destinationScope;
      const receipt = this.receipt(
        'scope_merge',
        mergeKey,
        importedCount > 0 ? 'imported' : 'skipped',
        { imported: importedCount, skipped: skippedRecords || (alreadyMerged ? Object.keys(sourceState.trips).length + Object.keys(sourceState.savedEntities).length : 0) },
        conflictTripIds.length || conflictEntityIds.length
          ? `${conflictTripIds.length + conflictEntityIds.length} id conflict copies retained`
          : sourceScope === destinationScope
            ? 'Source and destination scopes were the same'
            : alreadyMerged
              ? 'This source revision was already merged'
              : 'The source scope had no trips or saved entities',
      );
      this.state.migrationReceipts.push(receipt);
      this.state.revision += 1;
      await this.persist();
      return {
        sourceScope,
        destinationScope,
        importedTripIds,
        importedEntityIds,
        conflictTripIds,
        conflictEntityIds,
        receipt,
      };
    });
  }

  async eraseScope(scopeInput: TripRepositoryUserScope): Promise<{ ownerScope: string; erasedCurrentScope: boolean }> {
    return this.serialize(async () => {
      const ownerScope = normalizeTripRepositoryScope(scopeInput);
      const ownerScopeKey = tripRepositoryScopeKey(ownerScope);
      const erasedCurrentScope = ownerScope === this.ownerScope;
      if (erasedCurrentScope) {
        this.state = emptyState(ownerScope);
        this.emit();
      }
      await this.storage.erase(ownerScopeKey);
      return { ownerScope, erasedCurrentScope };
    });
  }

  listTrips(options: ListTripsOptions = {}): TripDocumentV2[] {
    const statuses = options.status == null
      ? null
      : new Set(Array.isArray(options.status) ? options.status : [options.status]);
    return this.snapshot.trips.filter(trip => {
      if (!options.includeArchived && trip.status === 'archived') return false;
      return !statuses || statuses.has(trip.status);
    });
  }

  getTrip(id: string): TripDocumentV2 | null {
    return this.state.trips[id] ?? null;
  }

  private enqueueOutbox(
    entityType: RepositoryOutboxEntryV1['entityType'],
    entityId: string,
    operation: RepositoryOutboxEntryV1['operation'],
    payload?: unknown,
    revision?: number,
  ) {
    const now = this.now();
    const id = this.createId('outbox');
    const payloadHash = stableHash(serializeUnknown(payload));
    const entry: RepositoryOutboxEntryV1 = {
      id,
      idempotencyKey: `${entityType}:${operation}:${stableHash(this.ownerScope)}:${stableHash(entityId)}:${payloadHash}:${stableHash(id)}`,
      ownerScope: this.ownerScope,
      entityType,
      entityId,
      operation,
      revision,
      payload,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.state.outbox.push(entry);
  }

  private pruneOutboxBeforeDelete(
    entityType: RepositoryOutboxEntryV1['entityType'],
    entityId: string,
  ) {
    this.state.outbox = this.state.outbox.filter(entry => entry.entityType !== entityType
      || entry.entityId !== entityId
      || entry.status === 'syncing');
  }

  async upsertTrip(input: TripDocumentV2, options: RepositoryMutationOptions = {}): Promise<TripDocumentV2> {
    return this.serialize(async () => {
      if (!text(input.id)) throw new Error('Trip id is required');
      const current = this.state.trips[input.id];
      const tombstone = this.state.tombstones[tombstoneKey('trip', input.id)];
      const currentRevision = current?.revision ?? tombstone?.revision ?? 0;
      assertExpectedRevision(input.id, currentRevision, options.expectedRevision);
      const next = normalizedTrip(input, this.ownerScope, this.now(), currentRevision + 1);
      this.state.trips[next.id] = next;
      delete this.state.tombstones[tombstoneKey('trip', next.id)];
      this.state.revision += 1;
      if (options.enqueueSync !== false) this.enqueueOutbox('trip', next.id, 'upsert', next, next.revision);
      await this.persist();
      return next;
    });
  }

  async archiveTrip(id: string, options: RepositoryMutationOptions = {}): Promise<TripDocumentV2> {
    return this.serialize(async () => {
      const current = this.state.trips[id];
      if (!current) throw new Error(`Trip ${id} was not found`);
      assertExpectedRevision(id, current.revision, options.expectedRevision);
      const now = this.now();
      const next = normalizedTrip({ ...current, status: 'archived', archivedAt: now }, this.ownerScope, now, current.revision + 1);
      this.state.trips[id] = next;
      this.state.revision += 1;
      if (options.enqueueSync !== false) this.enqueueOutbox('trip', id, 'archive', next, next.revision);
      await this.persist();
      return next;
    });
  }

  async deleteTrip(id: string, options: TripDeletionOptions = {}): Promise<boolean> {
    const expectedOwnerScope = normalizeTripRepositoryScope(options.expectedOwnerScope ?? this.ownerScope);
    return this.serialize(async () => {
      if (this.ownerScope !== expectedOwnerScope) {
        throw new Error(`Trip repository owner scope changed from ${expectedOwnerScope} to ${this.ownerScope}`);
      }
      const current = this.state.trips[id];
      if (!current) return false;
      assertExpectedRevision(id, current.revision, options.expectedRevision);
      const revision = current.revision + 1;
      delete this.state.trips[id];
      this.state.tombstones[tombstoneKey('trip', id)] = {
        entityType: 'trip',
        entityId: id,
        revision,
        deletedAt: this.now(),
      };
      this.state.revision += 1;
      this.pruneOutboxBeforeDelete('trip', id);
      if (options.enqueueSync !== false) {
        this.enqueueOutbox('trip', id, 'delete', tripDeletionPayload('explicit', current.status), revision);
      }
      await this.persist();
      return true;
    });
  }

  async deleteDraftTrips(
    requests: DraftTripDeletionRequest[],
    options: DraftTripDeletionOptions = {},
  ): Promise<string[]> {
    const expectedOwnerScope = normalizeTripRepositoryScope(options.expectedOwnerScope ?? this.ownerScope);
    return this.serialize(async () => {
      if (this.ownerScope !== expectedOwnerScope) {
        throw new Error(`Trip repository owner scope changed from ${expectedOwnerScope} to ${this.ownerScope}`);
      }
      const requestsById = new Map<string, DraftTripDeletionRequest>();
      requests.forEach(request => {
        const id = text(request.id);
        if (id && !requestsById.has(id)) requestsById.set(id, { ...request, id });
      });
      const uniqueRequests = [...requestsById.values()];
      const drafts = uniqueRequests.flatMap(request => {
        const current = this.state.trips[request.id];
        if (!current) return [];
        if (current.status !== 'draft') {
          throw new Error(`Trip ${request.id} is no longer a draft`);
        }
        assertExpectedRevision(request.id, current.revision, request.expectedRevision);
        return [current];
      });
      if (drafts.length === 0) return [];

      const deletedAt = this.now();
      for (const draft of drafts) {
        const revision = draft.revision + 1;
        delete this.state.trips[draft.id];
        this.state.tombstones[tombstoneKey('trip', draft.id)] = {
          entityType: 'trip',
          entityId: draft.id,
          revision,
          deletedAt,
        };
        this.pruneOutboxBeforeDelete('trip', draft.id);
        if (options.enqueueSync !== false) {
          this.enqueueOutbox('trip', draft.id, 'delete', tripDeletionPayload('draft_cleanup', 'draft'), revision);
        }
      }
      this.state.revision += 1;
      await this.persist();
      return drafts.map(draft => draft.id);
    });
  }

  async duplicateTrip(id: string, title?: string): Promise<TripDocumentV2> {
    const current = this.getTrip(id);
    if (!current) throw new Error(`Trip ${id} was not found`);
    const now = this.now();
    const duplicateId = this.createId('trip');
    return this.upsertTrip({
      ...current,
      id: duplicateId,
      ownerScope: this.ownerScope,
      revision: 0,
      status: 'draft',
      title: text(title, `${current.title} copy`),
      items: current.items.map(item => ({ ...item, id: this.createId('item'), createdAt: now, updatedAt: now })),
      notes: current.notes.map(note => ({ ...note, id: this.createId('note'), createdAt: now, updatedAt: now })),
      createdAt: now,
      updatedAt: now,
      archivedAt: undefined,
      legacy: undefined,
    });
  }

  listSavedEntities(options: ListSavedEntitiesOptions = {}): SavedEntityV1[] {
    const kinds = options.kind == null
      ? null
      : new Set(Array.isArray(options.kind) ? options.kind : [options.kind]);
    const query = text(options.query).toLowerCase();
    return this.snapshot.savedEntities.filter(entity => {
      if (kinds && !kinds.has(entity.kind)) return false;
      if (!query) return true;
      return `${entity.title} ${entity.summary ?? ''} ${entity.category ?? ''} ${entity.region ?? ''}`.toLowerCase().includes(query);
    });
  }

  getSavedEntity(id: string): SavedEntityV1 | null {
    return this.state.savedEntities[id] ?? null;
  }

  async saveEntity(input: SavedEntityV1, options: RepositoryMutationOptions = {}): Promise<SavedEntityV1> {
    return this.serialize(async () => {
      if (!text(input.id)) throw new Error('Saved entity id is required');
      const current = this.state.savedEntities[input.id];
      const tombstone = this.state.tombstones[tombstoneKey('saved_entity', input.id)];
      const currentRevision = current?.revision ?? tombstone?.revision ?? 0;
      assertExpectedRevision(input.id, currentRevision, options.expectedRevision);
      const next = normalizedEntity(input, this.ownerScope, this.now(), currentRevision + 1);
      this.state.savedEntities[next.id] = next;
      delete this.state.tombstones[tombstoneKey('saved_entity', next.id)];
      this.state.revision += 1;
      if (options.enqueueSync !== false) this.enqueueOutbox('saved_entity', next.id, 'upsert', next, next.revision);
      await this.persist();
      return next;
    });
  }

  async removeEntity(id: string, options: RepositoryMutationOptions = {}): Promise<boolean> {
    return this.serialize(async () => {
      const current = this.state.savedEntities[id];
      if (!current) return false;
      assertExpectedRevision(id, current.revision, options.expectedRevision);
      const revision = current.revision + 1;
      delete this.state.savedEntities[id];
      this.state.tombstones[tombstoneKey('saved_entity', id)] = {
        entityType: 'saved_entity',
        entityId: id,
        revision,
        deletedAt: this.now(),
      };
      this.state.revision += 1;
      if (options.enqueueSync !== false) this.enqueueOutbox('saved_entity', id, 'delete', undefined, revision);
      await this.persist();
      return true;
    });
  }

  async applyRemoteTrip(remote: TripDocumentV2): Promise<TripRepositoryRemoteResult<TripDocumentV2>> {
    return this.serialize(async () => {
      if (!isTripDocument(remote)) throw new Error('Remote trip is invalid');
      if (remote.ownerScope !== this.ownerScope) {
        throw new Error(`Remote trip owner scope ${remote.ownerScope} does not match ${this.ownerScope}`);
      }
      if (finiteNumber(remote.revision) == null || finiteNumber(remote.createdAt) == null || finiteNumber(remote.updatedAt) == null) {
        throw new Error('Remote trip revision and timestamps are required');
      }
      const local = this.state.trips[remote.id];
      const localTombstone = this.state.tombstones[tombstoneKey('trip', remote.id)];
      const localRevision = Math.max(local?.revision ?? 0, localTombstone?.revision ?? 0);
      if (localRevision > remote.revision || Boolean(localTombstone && localTombstone.revision === remote.revision)) {
        return { record: local ?? remote };
      }
      const dirtyEntries = this.state.outbox.filter(entry => entry.entityType === 'trip'
        && entry.entityId === remote.id
        && entry.operation !== 'delete');
      let conflictCopy: TripDocumentV2 | undefined;
      if (local && dirtyEntries.length > 0 && comparableJson(local) !== comparableJson(remote)) {
        const now = this.now();
        const conflictId = this.createId('trip_conflict');
        conflictCopy = normalizedTrip({
          ...local,
          id: conflictId,
          title: `${local.title} (local changes)`,
          legacy: { source: 'remote_reconciliation_conflict', payload: { originalId: local.id } },
          createdAt: local.createdAt,
        }, this.ownerScope, now, 1);
        this.state.trips[conflictId] = conflictCopy;
        const dirtyIds = new Set(dirtyEntries.map(entry => entry.id));
        this.state.outbox = this.state.outbox.filter(entry => !dirtyIds.has(entry.id));
        this.enqueueOutbox('trip', conflictId, 'upsert', conflictCopy, conflictCopy.revision);
      }
      const stored = { ...remote, ownerScope: this.ownerScope };
      this.state.trips[remote.id] = stored;
      delete this.state.tombstones[tombstoneKey('trip', remote.id)];
      this.state.revision += 1;
      await this.persist();
      return { record: stored, conflictCopy };
    });
  }

  async applyRemoteSavedEntity(remote: SavedEntityV1): Promise<TripRepositoryRemoteResult<SavedEntityV1>> {
    return this.serialize(async () => {
      if (!isSavedEntity(remote)) throw new Error('Remote saved entity is invalid');
      if (remote.ownerScope !== this.ownerScope) {
        throw new Error(`Remote saved entity owner scope ${remote.ownerScope} does not match ${this.ownerScope}`);
      }
      if (finiteNumber(remote.revision) == null || finiteNumber(remote.createdAt) == null || finiteNumber(remote.updatedAt) == null) {
        throw new Error('Remote saved entity revision and timestamps are required');
      }
      const local = this.state.savedEntities[remote.id];
      const localTombstone = this.state.tombstones[tombstoneKey('saved_entity', remote.id)];
      const localRevision = Math.max(local?.revision ?? 0, localTombstone?.revision ?? 0);
      if (localRevision > remote.revision || Boolean(localTombstone && localTombstone.revision === remote.revision)) {
        return { record: local ?? remote };
      }
      const dirtyEntries = this.state.outbox.filter(entry => entry.entityType === 'saved_entity'
        && entry.entityId === remote.id
        && entry.operation !== 'delete');
      let conflictCopy: SavedEntityV1 | undefined;
      if (local && dirtyEntries.length > 0 && comparableJson(local) !== comparableJson(remote)) {
        const now = this.now();
        const conflictId = this.createId('entity_conflict');
        conflictCopy = normalizedEntity({
          ...local,
          id: conflictId,
          title: `${local.title} (local changes)`,
          facts: { ...(local.facts ?? {}), remoteReconciliationConflict: { originalId: local.id } },
          createdAt: local.createdAt,
        }, this.ownerScope, now, 1);
        this.state.savedEntities[conflictId] = conflictCopy;
        const dirtyIds = new Set(dirtyEntries.map(entry => entry.id));
        this.state.outbox = this.state.outbox.filter(entry => !dirtyIds.has(entry.id));
        this.enqueueOutbox('saved_entity', conflictId, 'upsert', conflictCopy, conflictCopy.revision);
      }
      const stored = { ...remote, ownerScope: this.ownerScope };
      this.state.savedEntities[remote.id] = stored;
      delete this.state.tombstones[tombstoneKey('saved_entity', remote.id)];
      this.state.revision += 1;
      await this.persist();
      return { record: stored, conflictCopy };
    });
  }

  async applyRemoteTripTombstone(
    id: string,
    revision: number,
    deletedAt = this.now(),
  ): Promise<{ deleted: boolean; ignored?: boolean; conflictCopy?: TripDocumentV2 }> {
    return this.serialize(async () => {
      const local = this.state.trips[id];
      const currentTombstone = this.state.tombstones[tombstoneKey('trip', id)];
      const cleanRevision = Math.max(1, Math.round(finiteNumber(revision) ?? 1));
      const localRevision = Math.max(local?.revision ?? 0, currentTombstone?.revision ?? 0);
      if (localRevision > cleanRevision) return { deleted: false, ignored: true };
      if (!local && currentTombstone?.revision === cleanRevision) return { deleted: true };
      const dirtyEntries = this.state.outbox.filter(entry => entry.entityType === 'trip' && entry.entityId === id);
      const dirtyUpserts = dirtyEntries.filter(entry => entry.operation !== 'delete');
      let conflictCopy: TripDocumentV2 | undefined;
      if (local && dirtyUpserts.length > 0) {
        const now = this.now();
        const conflictId = this.createId('trip_conflict');
        conflictCopy = normalizedTrip({
          ...local,
          id: conflictId,
          title: `${local.title} (local changes)`,
          legacy: { source: 'remote_deletion_conflict', payload: { originalId: local.id } },
          createdAt: local.createdAt,
        }, this.ownerScope, now, 1);
        this.state.trips[conflictId] = conflictCopy;
        this.enqueueOutbox('trip', conflictId, 'upsert', conflictCopy, conflictCopy.revision);
      }
      const dirtyIds = new Set(dirtyEntries.map(entry => entry.id));
      this.state.outbox = this.state.outbox.filter(entry => !dirtyIds.has(entry.id));
      delete this.state.trips[id];
      this.state.tombstones[tombstoneKey('trip', id)] = {
        entityType: 'trip',
        entityId: id,
        revision: cleanRevision,
        deletedAt: finiteNumber(deletedAt) ?? this.now(),
      };
      this.state.revision += 1;
      await this.persist();
      return { conflictCopy, deleted: true };
    });
  }

  async applyRemoteSavedEntityTombstone(
    id: string,
    revision: number,
    deletedAt = this.now(),
  ): Promise<{ deleted: boolean; ignored?: boolean; conflictCopy?: SavedEntityV1 }> {
    return this.serialize(async () => {
      const local = this.state.savedEntities[id];
      const currentTombstone = this.state.tombstones[tombstoneKey('saved_entity', id)];
      const cleanRevision = Math.max(1, Math.round(finiteNumber(revision) ?? 1));
      const localRevision = Math.max(local?.revision ?? 0, currentTombstone?.revision ?? 0);
      if (localRevision > cleanRevision) return { deleted: false, ignored: true };
      if (!local && currentTombstone?.revision === cleanRevision) return { deleted: true };
      const dirtyEntries = this.state.outbox.filter(entry => entry.entityType === 'saved_entity' && entry.entityId === id);
      const dirtyUpserts = dirtyEntries.filter(entry => entry.operation !== 'delete');
      let conflictCopy: SavedEntityV1 | undefined;
      if (local && dirtyUpserts.length > 0) {
        const now = this.now();
        const conflictId = this.createId('entity_conflict');
        conflictCopy = normalizedEntity({
          ...local,
          id: conflictId,
          title: `${local.title} (local changes)`,
          facts: { ...(local.facts ?? {}), remoteDeletionConflict: { originalId: local.id } },
          createdAt: local.createdAt,
        }, this.ownerScope, now, 1);
        this.state.savedEntities[conflictId] = conflictCopy;
        this.enqueueOutbox('saved_entity', conflictId, 'upsert', conflictCopy, conflictCopy.revision);
      }
      const dirtyIds = new Set(dirtyEntries.map(entry => entry.id));
      this.state.outbox = this.state.outbox.filter(entry => !dirtyIds.has(entry.id));
      delete this.state.savedEntities[id];
      this.state.tombstones[tombstoneKey('saved_entity', id)] = {
        entityType: 'saved_entity',
        entityId: id,
        revision: cleanRevision,
        deletedAt: finiteNumber(deletedAt) ?? this.now(),
      };
      this.state.revision += 1;
      await this.persist();
      return { conflictCopy, deleted: true };
    });
  }

  private itemFromEntity(entity: SavedEntityV1, options: AddEntityToTripOptions = {}): TripItemV1 {
    const now = this.now();
    return {
      schemaVersion: TRIP_ITEM_SCHEMA_VERSION,
      id: this.createId('item'),
      entityId: entity.id,
      kind: canonicalItemKind(entity.kind),
      title: entity.title,
      summary: entity.summary,
      day: positiveInteger(options.day, 1),
      order: Math.max(0, Math.round(options.order ?? 0)),
      coordinates: entity.coordinates,
      note: options.note ?? entity.note,
      source: entity.source,
      sourceUrl: entity.sourceUrl,
      bookingUrl: entity.bookingUrl,
      facts: entity.facts,
      createdAt: now,
      updatedAt: now,
    };
  }

  async addEntityToTrip(tripId: string, entityId: string, options: AddEntityToTripOptions = {}): Promise<TripDocumentV2> {
    const trip = this.getTrip(tripId);
    const entity = this.getSavedEntity(entityId);
    if (!trip) throw new Error(`Trip ${tripId} was not found`);
    if (!entity) throw new Error(`Saved entity ${entityId} was not found`);
    assertExpectedRevision(tripId, trip.revision, options.expectedRevision);
    const existing = !options.allowDuplicate ? trip.items.find(item => item.entityId === entityId) : undefined;
    const maxOrder = trip.items.reduce((max, item) => Math.max(max, item.order), -1);
    const item = this.itemFromEntity(entity, {
      ...options,
      day: options.day ?? existing?.day ?? 1,
      order: options.order ?? existing?.order ?? maxOrder + 1,
    });
    const items = existing
      ? trip.items.map(current => current.id === existing.id ? { ...item, id: existing.id, createdAt: existing.createdAt } : current)
      : [...trip.items, item];
    const day = positiveInteger(options.day ?? existing?.day, 1);
    const days = trip.days.some(candidate => candidate.day === day)
      ? trip.days
      : [...trip.days, { day, title: `Day ${day}` }].sort((a, b) => a.day - b.day);
    return this.upsertTrip({ ...trip, items, days }, { expectedRevision: trip.revision, enqueueSync: options.enqueueSync });
  }

  async saveTripNote(tripId: string, input: TripNoteInput, options: RepositoryMutationOptions = {}): Promise<TripDocumentV2> {
    const trip = this.getTrip(tripId);
    if (!trip) throw new Error(`Trip ${tripId} was not found`);
    assertExpectedRevision(tripId, trip.revision, options.expectedRevision);
    const body = text(input.body);
    if (!body) throw new Error('Note text is required');
    if (body.length > 10_000) throw new Error('Note text is too long');
    const now = this.now();
    const existing = input.id ? trip.notes.find(note => note.id === input.id) : undefined;
    const note = {
      id: existing?.id ?? this.createId('note'),
      body,
      day: input.day == null ? existing?.day : positiveInteger(input.day, 1),
      entityId: text(input.entityId) || existing?.entityId,
      visibility: 'private' as const,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const notes = existing
      ? trip.notes.map(current => current.id === existing.id ? note : current)
      : [...trip.notes, note];
    return this.upsertTrip({ ...trip, notes }, { expectedRevision: trip.revision, enqueueSync: options.enqueueSync });
  }

  async deleteTripNote(tripId: string, noteId: string, options: RepositoryMutationOptions = {}): Promise<TripDocumentV2> {
    const trip = this.getTrip(tripId);
    if (!trip) throw new Error(`Trip ${tripId} was not found`);
    assertExpectedRevision(tripId, trip.revision, options.expectedRevision);
    const notes = trip.notes.filter(note => note.id !== noteId);
    if (notes.length === trip.notes.length) throw new Error(`Note ${noteId} was not found`);
    return this.upsertTrip({ ...trip, notes }, { expectedRevision: trip.revision, enqueueSync: options.enqueueSync });
  }

  async createTripFromEntity(entityOrId: SavedEntityV1 | string, title?: string): Promise<TripDocumentV2> {
    let entity = typeof entityOrId === 'string' ? this.getSavedEntity(entityOrId) : entityOrId;
    if (!entity) throw new Error(`Saved entity ${String(entityOrId)} was not found`);
    if (!this.getSavedEntity(entity.id)) entity = await this.saveEntity(entity);
    const now = this.now();
    const id = this.createId('trip');
    return this.upsertTrip({
      schemaVersion: TRIP_DOCUMENT_SCHEMA_VERSION,
      id,
      ownerScope: this.ownerScope,
      revision: 0,
      status: 'draft',
      title: text(title, `Trip to ${entity.title}`),
      summary: entity.summary,
      regions: entity.region ? [entity.region] : [],
      days: [{ day: 1, title: entity.title }],
      items: [this.itemFromEntity(entity, { day: 1, order: 0 })],
      notes: [],
      readiness: { status: 'not_started' },
      bookings: [],
      alerts: [],
      offline: {},
      visibility: 'private',
      source: 'saved_entity',
      createdAt: now,
      updatedAt: now,
    });
  }

  getOutbox(): RepositoryOutboxEntryV1[] {
    return this.state.outbox.map(entry => ({ ...entry }));
  }

  async markOutboxSyncing(ids: string[]): Promise<void> {
    return this.serialize(async () => {
      const wanted = new Set(ids);
      const now = this.now();
      this.state.outbox = this.state.outbox.map(entry => wanted.has(entry.id)
        ? { ...entry, status: 'syncing', attempts: entry.attempts + 1, updatedAt: now, lastError: undefined }
        : entry);
      this.state.syncMeta.lastError = undefined;
      await this.persist();
    });
  }

  async acknowledgeOutbox(ids: string[]): Promise<void> {
    return this.serialize(async () => {
      const wanted = new Set(ids);
      this.state.outbox = this.state.outbox.filter(entry => !wanted.has(entry.id));
      this.state.syncMeta.lastSyncedAt = this.now();
      this.state.syncMeta.lastError = undefined;
      await this.persist();
    });
  }

  async failOutbox(ids: string[], error: string): Promise<void> {
    return this.serialize(async () => {
      const wanted = new Set(ids);
      const now = this.now();
      this.state.outbox = this.state.outbox.map(entry => wanted.has(entry.id)
        ? { ...entry, status: 'failed', updatedAt: now, lastError: text(error, 'Sync failed') }
        : entry);
      this.state.syncMeta.lastError = text(error, 'Sync failed');
      await this.persist();
    });
  }

  async retryFailedOutbox(): Promise<void> {
    return this.serialize(async () => {
      const now = this.now();
      this.state.outbox = this.state.outbox.map(entry => entry.status === 'failed'
        ? { ...entry, status: 'pending', updatedAt: now, lastError: undefined }
        : entry);
      this.state.syncMeta.lastError = undefined;
      await this.persist();
    });
  }

  async retryOutbox(ids: string[]): Promise<void> {
    return this.serialize(async () => {
      const wanted = new Set(ids);
      if (wanted.size === 0) return;
      const now = this.now();
      this.state.outbox = this.state.outbox.map(entry => wanted.has(entry.id) && entry.status === 'failed'
        ? { ...entry, status: 'pending', updatedAt: now, lastError: undefined }
        : entry);
      if (!this.state.outbox.some(entry => entry.status === 'failed')) this.state.syncMeta.lastError = undefined;
      await this.persist();
    });
  }

  async setOnline(online: boolean): Promise<void> {
    return this.serialize(async () => {
      this.state.syncMeta.online = online;
      await this.persist();
    });
  }

  private async parseLegacyArray(source: string, value: unknown): Promise<{ items: unknown[]; corrupt: number; preservedRef?: string }> {
    if (value == null || value === '') return { items: [], corrupt: 0 };
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        const preservedRef = await this.storage.preserveCorrupt(this.ownerScopeKey, value, `legacy-${source}`);
        return { items: [], corrupt: 1, preservedRef };
      }
    }
    if (!Array.isArray(parsed)) {
      const serialized = serializeUnknown(parsed);
      const preservedRef = await this.storage.preserveCorrupt(this.ownerScopeKey, serialized, `legacy-${source}`);
      return { items: [], corrupt: 1, preservedRef };
    }
    return { items: parsed, corrupt: 0 };
  }

  private legacyTripSummary(value: unknown): TripDocumentV2 | null {
    const source = record(value);
    const id = text(source?.trip_id);
    if (!source || !id) return null;
    const now = finiteNumber(source.planned_at) ?? this.now();
    const dayCount = positiveInteger(source.duration_days, 1);
    return {
      schemaVersion: TRIP_DOCUMENT_SCHEMA_VERSION,
      id,
      ownerScope: this.ownerScope,
      revision: 1,
      status: 'archived',
      title: text(source.trip_name, 'Saved trip'),
      regions: stringList(source.states),
      days: Array.from({ length: dayCount }, (_, index) => ({ day: index + 1, title: `Day ${index + 1}` })),
      items: [],
      notes: [],
      readiness: { status: 'review' },
      bookings: [],
      alerts: [],
      offline: {},
      visibility: 'private',
      source: 'legacy_trip_history',
      createdAt: now,
      updatedAt: now,
      legacy: { source: 'trailhead_history', payload: value },
    };
  }

  private legacyTripResult(value: unknown): TripDocumentV2 | null {
    const source = record(value);
    const plan = record(source?.plan);
    const id = text(source?.trip_id);
    if (!source || !plan || !id) return null;
    const now = finiteNumber(source.updated_at) ?? this.now();
    const waypoints = Array.isArray(plan.waypoints) ? plan.waypoints : [];
    const items: TripItemV1[] = waypoints.flatMap((value, index) => {
      const waypoint = record(value);
      if (!waypoint) return [];
      const title = text(waypoint.name);
      if (!title) return [];
      return [{
        schemaVersion: TRIP_ITEM_SCHEMA_VERSION,
        id: `${id}:waypoint:${index}`,
        kind: canonicalItemKind(waypoint.type),
        title,
        summary: text(waypoint.description) || undefined,
        day: positiveInteger(waypoint.day, 1),
        order: index,
        coordinates: coordinates(waypoint.lat, waypoint.lng),
        note: text(waypoint.notes) || undefined,
        source: text(waypoint.verified_source || waypoint.source) || undefined,
        facts: { legacyWaypoint: value },
        createdAt: now,
        updatedAt: now,
      } satisfies TripItemV1];
    });
    const legacyDays = Array.isArray(plan.daily_itinerary) ? plan.daily_itinerary : [];
    const dayCount = positiveInteger(plan.duration_days, Math.max(1, legacyDays.length));
    const days = Array.from({ length: dayCount }, (_, index) => {
      const legacyDay = record(legacyDays[index]);
      return {
        day: index + 1,
        title: text(legacyDay?.title, `Day ${index + 1}`),
        summary: text(legacyDay?.description) || undefined,
      };
    });
    return {
      schemaVersion: TRIP_DOCUMENT_SCHEMA_VERSION,
      id,
      ownerScope: this.ownerScope,
      revision: Math.max(1, positiveInteger(source.version, 1)),
      status: 'active',
      title: text(plan.trip_name, 'Saved trip'),
      summary: text(plan.overview) || undefined,
      regions: stringList(plan.states),
      days,
      items,
      notes: [],
      readiness: { status: 'review' },
      bookings: [],
      alerts: [],
      offline: record(record(source.timeline)?.offline_readiness) ?? {},
      visibility: 'private',
      route: record(source.route_geometry) ?? undefined,
      source: 'legacy_active_trip',
      createdAt: now,
      updatedAt: now,
      legacy: { source: 'active_trip.json', payload: value },
    };
  }

  private legacySavedEntity(value: unknown, sourceName: string, fallbackKind: SavedEntityKind): SavedEntityV1 | null {
    const source = record(value);
    const id = text(source?.id);
    const title = text(source?.name);
    if (!source || !id || !title) return null;
    const now = finiteNumber(source.createdAt || source.fetched_at || source.last_checked) ?? this.now();
    const photoValues = Array.isArray(source.photos) ? source.photos : [];
    const media = photoValues.flatMap(photo => {
      if (typeof photo === 'string' && photo) return [{ url: photo, kind: 'image' as const }];
      const photoRecord = record(photo);
      const url = text(photoRecord?.url);
      return url ? [{ url, kind: 'image' as const, credit: text(photoRecord?.credit) || undefined, source: text(photoRecord?.source) || undefined }] : [];
    });
    const category = text(source.icon || source.type || source.land_type);
    const inferredKind = canonicalEntityKind(category || fallbackKind);
    return {
      schemaVersion: SAVED_ENTITY_SCHEMA_VERSION,
      id,
      ownerScope: this.ownerScope,
      revision: 1,
      kind: inferredKind === 'place' && fallbackKind !== 'place' ? fallbackKind : inferredKind,
      title,
      summary: text(source.description || source.summary) || undefined,
      category: category || undefined,
      coordinates: coordinates(source.lat, source.lng),
      note: text(source.note) || undefined,
      source: text(source.sourceLabel || source.source_badge || source.source, sourceName),
      sourceId: text(source.provider_place_id || source.place_id) || undefined,
      sourceUrl: text(source.url || source.official_url) || undefined,
      bookingUrl: text(source.booking_url) || undefined,
      media,
      facts: { legacy: value },
      createdAt: now,
      updatedAt: now,
    };
  }

  async migrateLegacy(input: LegacyMigrationInput): Promise<LegacyMigrationResult> {
    return this.serialize(async () => {
      const receipts: RepositoryMigrationReceiptV1[] = [];
      const importedTripIds: string[] = [];
      const importedEntityIds: string[] = [];

      const migrateArray = async (
        source: string,
        raw: unknown,
        convert: (value: unknown) => TripDocumentV2 | SavedEntityV1 | null,
        target: 'trip' | 'entity',
      ) => {
        const serializedSource = typeof raw === 'string' ? raw : serializeUnknown(raw ?? null);
        const sourceKey = `legacy:${source}:${stableHash(serializedSource)}`;
        if (this.state.migrationKeys[sourceKey]) {
          const receipt = this.receipt(source, sourceKey, 'skipped', { skipped: 1 }, 'Legacy payload was already migrated');
          receipts.push(receipt);
          return;
        }
        const parsed = await this.parseLegacyArray(source, raw);
        let imported = 0;
        let skipped = 0;
        let corrupt = parsed.corrupt;
        for (let index = 0; index < parsed.items.length; index += 1) {
          const value = parsed.items[index];
          const converted = convert(value);
          if (!converted) {
            const serialized = serializeUnknown(value);
            const preservedRef = await this.storage.preserveCorrupt(this.ownerScopeKey, serialized, `legacy-${source}-${index}`);
            receipts.push(this.receipt(source, `${sourceKey}:record:${index}`, 'quarantined', { corrupt: 1 }, `Legacy ${source} record ${index} was invalid`, preservedRef));
            corrupt += 1;
            continue;
          }
          if (target === 'trip') {
            const trip = converted as TripDocumentV2;
            if (this.state.tombstones[tombstoneKey('trip', trip.id)]) {
              skipped += 1;
              continue;
            }
            const existing = this.state.trips[trip.id];
            if (existing && existing.items.length >= trip.items.length) {
              skipped += 1;
              continue;
            }
            const migrated = {
              ...trip,
              ownerScope: this.ownerScope,
              revision: existing ? existing.revision + 1 : 1,
            };
            this.state.trips[trip.id] = migrated;
            if (this.ownerScope.startsWith('account:')) {
              this.enqueueOutbox('trip', trip.id, 'upsert', migrated, migrated.revision);
            }
            importedTripIds.push(trip.id);
          } else {
            const entity = converted as SavedEntityV1;
            if (this.state.savedEntities[entity.id]) {
              skipped += 1;
              continue;
            }
            const migrated = { ...entity, ownerScope: this.ownerScope, revision: 1 };
            this.state.savedEntities[entity.id] = migrated;
            if (this.ownerScope.startsWith('account:')) {
              this.enqueueOutbox('saved_entity', entity.id, 'upsert', migrated, migrated.revision);
            }
            importedEntityIds.push(entity.id);
          }
          imported += 1;
        }
        this.state.migrationKeys[sourceKey] = this.now();
        const status = corrupt > 0 && imported === 0 ? 'quarantined' : imported > 0 ? 'imported' : 'skipped';
        receipts.push(this.receipt(source, sourceKey, status, { imported, skipped, corrupt }, undefined, parsed.preservedRef));
      };

      await migrateArray('trip_history', input.tripHistory, value => this.legacyTripSummary(value), 'trip');
      await migrateArray('favorite_camps', input.favoriteCamps, value => this.legacySavedEntity(value, 'trailhead_favorites', 'camp'), 'entity');
      await migrateArray('saved_places', input.savedPlaces, value => this.legacySavedEntity(value, 'trailhead_saved_places', 'place'), 'entity');
      await migrateArray('explore_bookmarks', input.exploreBookmarkIds, value => {
        const id = text(value);
        if (!id) return null;
        const now = this.now();
        return {
          schemaVersion: SAVED_ENTITY_SCHEMA_VERSION,
          id,
          ownerScope: this.ownerScope,
          revision: 1,
          kind: 'place',
          title: 'Saved Explorer place',
          source: 'explore',
          sourceId: id,
          media: [],
          needsEnrichment: true,
          createdAt: now,
          updatedAt: now,
        };
      }, 'entity');

      if (input.activeTrip != null && input.activeTrip !== '') {
        let parsed: unknown = input.activeTrip;
        const sourceRaw = typeof input.activeTrip === 'string' ? input.activeTrip : serializeUnknown(input.activeTrip);
        if (typeof input.activeTrip === 'string') {
          try { parsed = JSON.parse(input.activeTrip); } catch {
            const preservedRef = await this.storage.preserveCorrupt(this.ownerScopeKey, input.activeTrip, 'legacy-active-trip');
            receipts.push(this.receipt('active_trip', `legacy:active_trip:${stableHash(sourceRaw)}`, 'quarantined', { corrupt: 1 }, 'Legacy active trip JSON was invalid', preservedRef));
            parsed = null;
          }
        }
        if (parsed != null) {
          const sourceKey = `legacy:active_trip:${stableHash(sourceRaw)}`;
          if (this.state.migrationKeys[sourceKey]) {
            receipts.push(this.receipt('active_trip', sourceKey, 'skipped', { skipped: 1 }, 'Legacy active trip was already migrated'));
          } else {
            const trip = this.legacyTripResult(parsed);
            if (!trip) {
              const preservedRef = await this.storage.preserveCorrupt(this.ownerScopeKey, sourceRaw, 'legacy-active-trip-record');
              receipts.push(this.receipt('active_trip', sourceKey, 'quarantined', { corrupt: 1 }, 'Legacy active trip record was invalid', preservedRef));
            } else {
              const existing = this.state.trips[trip.id];
              if (this.state.tombstones[tombstoneKey('trip', trip.id)]) {
                receipts.push(this.receipt('active_trip', sourceKey, 'skipped', { skipped: 1 }, 'Deleted trip was not restored from legacy storage'));
              } else {
                const migrated = { ...trip, ownerScope: this.ownerScope, revision: (existing?.revision ?? 0) + 1 };
                this.state.trips[trip.id] = migrated;
                if (this.ownerScope.startsWith('account:')) {
                  this.enqueueOutbox('trip', trip.id, 'upsert', migrated, migrated.revision);
                }
                importedTripIds.push(trip.id);
                receipts.push(this.receipt('active_trip', sourceKey, 'imported', { imported: 1 }));
              }
            }
            this.state.migrationKeys[sourceKey] = this.now();
          }
        }
      }

      this.state.migrationReceipts.push(...receipts);
      this.state.revision += 1;
      await this.persist();
      return { receipts, importedTripIds, importedEntityIds };
    });
  }
}

export class MemoryTripRepositoryStorage implements TripRepositoryStorage {
  readonly values = new Map<string, string>();
  readonly corrupt = new Map<string, string>();
  private corruptCounter = 0;

  async read(ownerScopeKey: string): Promise<string | null> {
    return this.values.get(ownerScopeKey) ?? null;
  }

  async write(ownerScopeKey: string, value: string): Promise<void> {
    this.values.set(ownerScopeKey, value);
  }

  async preserveCorrupt(ownerScopeKey: string, value: string, reason: string): Promise<string> {
    this.corruptCounter += 1;
    const key = `${ownerScopeKey}:${reason}:${this.corruptCounter}`;
    this.corrupt.set(key, value);
    return key;
  }

  async erase(ownerScopeKey: string): Promise<void> {
    this.values.delete(ownerScopeKey);
    for (const key of this.corrupt.keys()) {
      if (key.startsWith(`${ownerScopeKey}:`)) this.corrupt.delete(key);
    }
  }
}

export function createTripDocument(input: Partial<TripDocumentV2> & Pick<TripDocumentV2, 'id' | 'title'>): TripDocumentV2 {
  const now = Date.now();
  return {
    schemaVersion: TRIP_DOCUMENT_SCHEMA_VERSION,
    id: input.id,
    ownerScope: input.ownerScope ?? 'anonymous',
    revision: input.revision ?? 0,
    status: input.status ?? 'draft',
    title: input.title,
    summary: input.summary,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    regions: input.regions ?? [],
    days: input.days ?? [],
    items: input.items ?? [],
    notes: input.notes ?? [],
    readiness: input.readiness ?? { status: 'not_started' },
    bookings: input.bookings ?? [],
    alerts: input.alerts ?? [],
    offline: input.offline ?? {},
    visibility: input.visibility ?? 'private',
    rigSnapshot: input.rigSnapshot,
    route: input.route,
    source: input.source,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    archivedAt: input.archivedAt,
    legacy: input.legacy,
  };
}

export function createSavedEntity(input: Partial<SavedEntityV1> & Pick<SavedEntityV1, 'id' | 'title' | 'kind'>): SavedEntityV1 {
  const now = Date.now();
  return {
    schemaVersion: SAVED_ENTITY_SCHEMA_VERSION,
    id: input.id,
    ownerScope: input.ownerScope ?? 'anonymous',
    revision: input.revision ?? 0,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    category: input.category,
    region: input.region,
    coordinates: input.coordinates,
    note: input.note,
    source: input.source,
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    bookingUrl: input.bookingUrl,
    media: input.media ?? [],
    facts: input.facts,
    needsEnrichment: input.needsEnrichment,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
