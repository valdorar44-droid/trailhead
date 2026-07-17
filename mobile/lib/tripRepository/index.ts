import { TripRepository } from './core';
import { createTripRepositoryHooks } from './hooks';
import { readLegacyTripRepositoryData } from './legacy';
import { createDefaultTripRepositoryStorage } from './storage';
import type {
  AddEntityToTripOptions,
  DraftTripDeletionOptions,
  DraftTripDeletionRequest,
  LegacyMigrationInput,
  ListSavedEntitiesOptions,
  ListTripsOptions,
  RepositoryMutationOptions,
  SavedEntityV1,
  TripDeletionOptions,
  TripDocumentV2,
  TripNoteInput,
  TripRepositoryUserScope,
} from './types';

export * from './types';
export * from './originalExperience';
export {
  createSavedEntity,
  createTripDocument,
  MemoryTripRepositoryStorage,
  normalizeTripRepositoryScope,
  TripRepository,
  TripRepositoryConflictError,
  tripRepositoryScopeKey,
} from './core';
export { NativeFileTripRepositoryStorage, WebTripRepositoryStorage } from './storage';
export { readLegacyTripRepositoryData } from './legacy';

const repository = new TripRepository({ storage: createDefaultTripRepositoryStorage() });
const hooks = createTripRepositoryHooks(repository);

export const subscribeTripRepository = repository.subscribe;
export const getTripRepositorySnapshot = repository.getSnapshot;
export const useTripRepositorySnapshot = hooks.useTripRepositorySnapshot;
export const useTrips = hooks.useTrips;
export const useSavedEntities = hooks.useSavedEntities;
export const useTripRepositorySyncStatus = hooks.useTripRepositorySyncStatus;

export async function initializeTripRepository(userScope?: TripRepositoryUserScope) {
  return repository.initialize(userScope);
}

export async function switchTripRepositoryScope(userScope?: TripRepositoryUserScope) {
  return repository.initialize(userScope);
}

export function inspectTripRepositoryScope(userScope?: TripRepositoryUserScope) {
  return repository.inspectScope(userScope);
}

export function listTrips(options?: ListTripsOptions) {
  return repository.listTrips(options);
}

export function getTrip(id: string) {
  return repository.getTrip(id);
}

export function upsertTrip(trip: TripDocumentV2, options?: RepositoryMutationOptions) {
  return repository.upsertTrip(trip, options);
}

export function archiveTrip(id: string, options?: RepositoryMutationOptions) {
  return repository.archiveTrip(id, options);
}

export function deleteTrip(id: string, options?: TripDeletionOptions) {
  return repository.deleteTrip(id, options);
}

export function deleteDraftTrips(
  requests: DraftTripDeletionRequest[],
  options?: DraftTripDeletionOptions,
) {
  return repository.deleteDraftTrips(requests, options);
}

export function duplicateTrip(id: string, title?: string) {
  return repository.duplicateTrip(id, title);
}

export function listSavedEntities(options?: ListSavedEntitiesOptions) {
  return repository.listSavedEntities(options);
}

export function getSavedEntity(id: string) {
  return repository.getSavedEntity(id);
}

export function saveEntity(entity: SavedEntityV1, options?: RepositoryMutationOptions) {
  return repository.saveEntity(entity, options);
}

export function removeEntity(id: string, options?: RepositoryMutationOptions) {
  return repository.removeEntity(id, options);
}

export function addEntityToTrip(tripId: string, entityId: string, options?: AddEntityToTripOptions) {
  return repository.addEntityToTrip(tripId, entityId, options);
}

export function saveTripNote(tripId: string, input: TripNoteInput, options?: RepositoryMutationOptions) {
  return repository.saveTripNote(tripId, input, options);
}

export function deleteTripNote(tripId: string, noteId: string, options?: RepositoryMutationOptions) {
  return repository.deleteTripNote(tripId, noteId, options);
}

export function createTripFromEntity(entityOrId: SavedEntityV1 | string, title?: string) {
  return repository.createTripFromEntity(entityOrId, title);
}

export async function migrateLegacyTripRepositoryData(input?: LegacyMigrationInput) {
  return repository.migrateLegacy(input ?? await readLegacyTripRepositoryData());
}

export function getTripRepositoryOutbox() {
  return repository.getOutbox();
}

export function markTripRepositoryOutboxSyncing(ids: string[]) {
  return repository.markOutboxSyncing(ids);
}

export function acknowledgeTripRepositoryOutbox(ids: string[]) {
  return repository.acknowledgeOutbox(ids);
}

export function failTripRepositoryOutbox(ids: string[], error: string) {
  return repository.failOutbox(ids, error);
}

export function retryFailedTripRepositoryOutbox() {
  return repository.retryFailedOutbox();
}

export function retryTripRepositoryOutboxEntries(ids: string[]) {
  return repository.retryOutbox(ids);
}

export function setTripRepositoryOnline(online: boolean) {
  return repository.setOnline(online);
}

export function mergeTripRepositoryScope(
  sourceScope: TripRepositoryUserScope,
  destinationScope: TripRepositoryUserScope,
) {
  return repository.mergeScope(sourceScope, destinationScope);
}

export function applyTripRepositoryRemoteTrip(trip: TripDocumentV2) {
  return repository.applyRemoteTrip(trip);
}

export function acknowledgeTripRepositoryLegacyTrip(
  trip: TripDocumentV2,
  expectedBaseRevision?: number,
) {
  return repository.acknowledgeLegacyTrip(trip, expectedBaseRevision);
}

export function applyTripRepositoryRemoteSavedEntity(entity: SavedEntityV1) {
  return repository.applyRemoteSavedEntity(entity);
}

export function applyTripRepositoryRemoteTripTombstone(id: string, revision: number, deletedAt?: number) {
  return repository.applyRemoteTripTombstone(id, revision, deletedAt);
}

export function applyTripRepositoryRemoteSavedEntityTombstone(id: string, revision: number, deletedAt?: number) {
  return repository.applyRemoteSavedEntityTombstone(id, revision, deletedAt);
}

export function eraseTripRepositoryScope(scope: TripRepositoryUserScope) {
  return repository.eraseScope(scope);
}
