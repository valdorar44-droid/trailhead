import { TRAILHEAD_API_BASE } from '../apiBase';
import { accountStorage, storage as secureStorage } from '../storage';
import { createOfflineDownloadCoordinator } from './coordinator';
import {
  createExpoOfflineArtifactTransferAdapter,
  createExpoOfflineV2Persistence,
} from './expoAdapters';
import { createOfflineBundlePreparationClientV2 } from './preparation';
import { createRnMapboxOfflineDownloadAdapter, rnMapboxPackName } from './rnMapboxAdapter';
import { createOfflineBundleRuntimeV2 } from './runtime';
import { clearOfflineBundleScopeV2 } from './scopeCleanup';
import { validateExpoOfflineSearchIndex } from './sqliteIndex';

type ExpoOfflineRuntimeEntry = Readonly<{
  runtime: ReturnType<typeof createOfflineBundleRuntimeV2>;
  persistence: ReturnType<typeof createExpoOfflineV2Persistence>;
  renderer: ReturnType<typeof createRnMapboxOfflineDownloadAdapter>;
  lifecycle: { retired: boolean };
  epoch: number;
}>;

const runtimes = new Map<string, ExpoOfflineRuntimeEntry>();
const blockedScopes = new Map<string, number>();

export function getExpoOfflineV2Runtime(ownerScope: string) {
  const blockedEpoch = blockedScopes.get(ownerScope);
  if (blockedEpoch != null && blockedEpoch === accountStorage.epoch()) {
    throw new Error('Offline downloads are being cleared for this account.');
  }
  if (blockedEpoch != null) blockedScopes.delete(ownerScope);
  const existing = runtimes.get(ownerScope);
  if (existing && existing.epoch === accountStorage.epoch() && !existing.lifecycle.retired) {
    return existing.runtime;
  }
  if (existing) {
    existing.lifecycle.retired = true;
    runtimes.delete(ownerScope);
  }
  const persistence = createExpoOfflineV2Persistence(ownerScope);
  const renderer = createRnMapboxOfflineDownloadAdapter();
  const lifecycle = { retired: false };
  const epoch = accountStorage.epoch();
  const coordinator = createOfflineDownloadCoordinator({
    activeRenderer: 'rnmapbox',
    files: persistence.storage,
    repository: persistence.repository,
    rendererAdapters: { rnmapbox: renderer },
  });
  const runtime = createOfflineBundleRuntimeV2({
    ownerScope,
    preparation: createOfflineBundlePreparationClientV2({
      baseUrl: TRAILHEAD_API_BASE,
      getAuthToken: () => secureStorage.get('trailhead_token').catch(() => null),
    }),
    coordinator,
    repository: persistence.repository,
    jobs: persistence.jobs,
    transfer: createExpoOfflineArtifactTransferAdapter(),
    renderer,
    storage: persistence.storage,
    validateSearchIndex: validateExpoOfflineSearchIndex,
    canOperate: () => !lifecycle.retired && epoch === accountStorage.epoch() && !accountStorage.isCleaning(),
  });
  runtimes.set(ownerScope, { runtime, persistence, renderer, lifecycle, epoch });
  return runtime;
}

/** Account-departure barrier. Never call this with another account's scope. */
export async function clearExpoOfflineV2Scope(ownerScope: string) {
  const epoch = accountStorage.epoch();
  blockedScopes.set(ownerScope, epoch);
  let entry = runtimes.get(ownerScope);
  if (!entry) {
    // Build the adapters before marking the entry retired; cleanup needs the
    // canonical job store and native renderer even after a cold app restart.
    blockedScopes.delete(ownerScope);
    getExpoOfflineV2Runtime(ownerScope);
    blockedScopes.set(ownerScope, epoch);
    entry = runtimes.get(ownerScope);
  }
  if (!entry) throw new Error('The offline cleanup runtime is unavailable.');
  entry.lifecycle.retired = true;
  try {
    await clearOfflineBundleScopeV2({
      ownerScope,
      root: entry.persistence.root,
      runtime: entry.runtime,
      jobs: entry.persistence.jobs,
      repository: entry.persistence.repository,
      renderer: entry.renderer,
      storage: entry.persistence.storage,
      rendererInstallationForManifest: manifest => ({
        renderer: manifest.renderer.id,
        style_pack_id: manifest.renderer.style_pack_id,
        tile_region_id: manifest.renderer.tile_region_id,
        native_pack_name: rnMapboxPackName(manifest),
      }),
    });
    runtimes.delete(ownerScope);
  } catch (error) {
    // Keep the retired entry available to this barrier for an explicit retry,
    // but never let old UI references start new account-scoped writes.
    throw error;
  }
}
