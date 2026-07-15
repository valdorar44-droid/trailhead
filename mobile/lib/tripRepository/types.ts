export const TRIP_DOCUMENT_SCHEMA_VERSION = 2 as const;
export const SAVED_ENTITY_SCHEMA_VERSION = 1 as const;
export const TRIP_ITEM_SCHEMA_VERSION = 1 as const;

export type TripRepositoryUserScope =
  | string
  | number
  | { id?: string | number | null; userId?: string | number | null }
  | null
  | undefined;

export type TripStatus = 'active' | 'draft' | 'completed' | 'archived';
export type TripVisibility = 'private' | 'shared' | 'public';
export type TripItemKind =
  | 'start'
  | 'destination'
  | 'camp'
  | 'trail'
  | 'activity'
  | 'fuel'
  | 'water'
  | 'food'
  | 'service'
  | 'place'
  | 'note';

export type SavedEntityKind =
  | 'place'
  | 'camp'
  | 'trail'
  | 'activity'
  | 'fuel'
  | 'water'
  | 'service'
  | 'trip_pack';

export interface RepositoryCoordinates {
  lat: number;
  lng: number;
}

export interface TripItemV1 {
  schemaVersion: typeof TRIP_ITEM_SCHEMA_VERSION;
  id: string;
  entityId?: string;
  kind: TripItemKind;
  title: string;
  summary?: string;
  day: number;
  order: number;
  coordinates?: RepositoryCoordinates;
  note?: string;
  source?: string;
  sourceUrl?: string;
  bookingUrl?: string;
  startsAt?: string;
  endsAt?: string;
  facts?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface TripDayV1 {
  day: number;
  title: string;
  summary?: string;
  date?: string;
}

export interface TripNoteV1 {
  id: string;
  body: string;
  day?: number;
  entityId?: string;
  visibility: 'private';
  createdAt: number;
  updatedAt: number;
}

export interface TripNoteInput {
  id?: string;
  body: string;
  day?: number;
  entityId?: string;
}

export interface TripReadinessV1 {
  status: 'not_started' | 'review' | 'ready';
  checks?: Record<string, boolean | string | number | null>;
}

export interface TripDocumentV2 {
  schemaVersion: typeof TRIP_DOCUMENT_SCHEMA_VERSION;
  id: string;
  ownerScope: string;
  revision: number;
  status: TripStatus;
  title: string;
  summary?: string;
  startsOn?: string;
  endsOn?: string;
  regions: string[];
  days: TripDayV1[];
  items: TripItemV1[];
  notes: TripNoteV1[];
  readiness: TripReadinessV1;
  bookings: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  offline: Record<string, unknown>;
  visibility: TripVisibility;
  rigSnapshot?: Record<string, unknown>;
  route?: Record<string, unknown>;
  source?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  legacy?: {
    source: string;
    payload?: unknown;
  };
}

export interface SavedEntityMediaV1 {
  url: string;
  kind?: 'image' | 'video';
  credit?: string;
  caption?: string;
  source?: string;
}

export interface SavedEntityV1 {
  schemaVersion: typeof SAVED_ENTITY_SCHEMA_VERSION;
  id: string;
  ownerScope: string;
  revision: number;
  kind: SavedEntityKind;
  title: string;
  summary?: string;
  category?: string;
  region?: string;
  coordinates?: RepositoryCoordinates;
  note?: string;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  bookingUrl?: string;
  media: SavedEntityMediaV1[];
  facts?: Record<string, unknown>;
  needsEnrichment?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type OutboxEntityType = 'trip' | 'saved_entity';
export type OutboxOperation = 'upsert' | 'archive' | 'delete';
export type OutboxEntryStatus = 'pending' | 'syncing' | 'failed';
export type TripDeletionMode = 'explicit' | 'draft_cleanup';

export interface TripDeletionOutboxPayloadV1 {
  kind: 'trip_deletion';
  mode: TripDeletionMode;
  originalStatus: TripStatus;
}

export interface RepositoryOutboxEntryV1 {
  id: string;
  idempotencyKey: string;
  ownerScope: string;
  entityType: OutboxEntityType;
  entityId: string;
  operation: OutboxOperation;
  revision?: number;
  payload?: unknown;
  status: OutboxEntryStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export type MigrationReceiptStatus = 'imported' | 'skipped' | 'quarantined';

export interface RepositoryMigrationReceiptV1 {
  id: string;
  ownerScope: string;
  source: string;
  sourceKey: string;
  status: MigrationReceiptStatus;
  importedCount: number;
  skippedCount: number;
  corruptCount: number;
  createdAt: number;
  preservedRef?: string;
  detail?: string;
}

export interface TripRepositorySyncStatus {
  state: 'idle' | 'pending' | 'syncing' | 'error' | 'offline';
  online: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface TripRepositorySnapshot {
  initialized: boolean;
  ownerScope: string;
  revision: number;
  trips: TripDocumentV2[];
  savedEntities: SavedEntityV1[];
  sync: TripRepositorySyncStatus;
  migrationReceipts: RepositoryMigrationReceiptV1[];
}

export interface ListTripsOptions {
  includeArchived?: boolean;
  status?: TripStatus | TripStatus[];
}

export interface ListSavedEntitiesOptions {
  kind?: SavedEntityKind | SavedEntityKind[];
  query?: string;
}

export interface RepositoryMutationOptions {
  expectedRevision?: number;
  enqueueSync?: boolean;
}

export interface DraftTripDeletionRequest {
  id: string;
  expectedRevision?: number;
}

export interface DraftTripDeletionOptions {
  enqueueSync?: boolean;
  expectedOwnerScope?: string;
}

export interface TripDeletionOptions extends RepositoryMutationOptions {
  expectedOwnerScope?: string;
}

export interface AddEntityToTripOptions extends RepositoryMutationOptions {
  day?: number;
  order?: number;
  note?: string;
  allowDuplicate?: boolean;
}

export interface LegacyTripHistoryItem {
  trip_id?: unknown;
  trip_name?: unknown;
  states?: unknown;
  duration_days?: unknown;
  est_miles?: unknown;
  planned_at?: unknown;
}

export interface LegacySavedPlace {
  id?: unknown;
  name?: unknown;
  lat?: unknown;
  lng?: unknown;
  icon?: unknown;
  note?: unknown;
  sourceLabel?: unknown;
  createdAt?: unknown;
  [key: string]: unknown;
}

export interface LegacyMigrationInput {
  tripHistory?: unknown;
  activeTrip?: unknown;
  favoriteCamps?: unknown;
  savedPlaces?: unknown;
  exploreBookmarkIds?: unknown;
}

export interface LegacyMigrationResult {
  receipts: RepositoryMigrationReceiptV1[];
  importedTripIds: string[];
  importedEntityIds: string[];
}

export interface TripRepositoryScopeMergeResult {
  sourceScope: string;
  destinationScope: string;
  importedTripIds: string[];
  importedEntityIds: string[];
  conflictTripIds: string[];
  conflictEntityIds: string[];
  receipt: RepositoryMigrationReceiptV1;
}

export interface TripRepositoryRemoteResult<T> {
  record: T;
  conflictCopy?: T;
}

export interface TripRepositoryLegacyAcknowledgementResult {
  record: TripDocumentV2 | null;
  applied: boolean;
  blockedByPendingWrites?: boolean;
  ignoredAsStale?: boolean;
}
