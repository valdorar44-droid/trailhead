import type { OfflineRendererDownloadAdapter } from './coordinator';
import type { OfflineBundleJobStoreV2 } from './jobStore';
import type { OfflineBundleManifestRepository, OfflineBundleStorageAdapter } from './repository';
import type { OfflineBundleRuntimeV2 } from './runtime';
import type { OfflineBundleManifestV2, OfflineRendererInstallationV2 } from './types';

export type OfflineBundleScopeCleanupV2 = Readonly<{
  ownerScope: string;
  root: string;
  runtime: Pick<OfflineBundleRuntimeV2, 'cancel' | 'list'>;
  jobs: OfflineBundleJobStoreV2;
  repository: OfflineBundleManifestRepository;
  renderer: Pick<OfflineRendererDownloadAdapter, 'remove'>;
  storage: OfflineBundleStorageAdapter;
  rendererInstallationForManifest: (manifest: OfflineBundleManifestV2) => OfflineRendererInstallationV2;
}>;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown offline cleanup error');
}

/**
 * Stops one account's transfers and removes only that account-scoped V2 root.
 * The caller must finish this barrier before clearing the account identity.
 */
export async function clearOfflineBundleScopeV2(input: OfflineBundleScopeCleanupV2) {
  const jobs = await input.runtime.list(input.ownerScope);
  const installations = await input.repository.listCurrentInstallations();
  const errors: string[] = [];

  for (const job of jobs) {
    try {
      await input.runtime.cancel(job.job_id);
    } catch (error) {
      errors.push(`Could not stop ${job.job_id}: ${message(error)}`);
    }
  }

  const installedRevisions = new Set(installations.map(item => `${item.bundle_id}@${item.revision}`));
  for (const installation of installations) {
    try {
      await input.renderer.remove?.(installation.renderer);
      await input.repository.removeCurrentInstallation(installation.bundle_id);
    } catch (error) {
      errors.push(`Could not remove ${installation.bundle_id}@${installation.revision}: ${message(error)}`);
    }
  }

  // A renderer pack can exist before the immutable repository commit. Remove
  // those interrupted packs too, using the exact manifest-owned native name.
  for (const manifest of jobs.map(job => job.manifest).filter((item): item is OfflineBundleManifestV2 => Boolean(item))) {
    if (installedRevisions.has(`${manifest.bundle_id}@${manifest.revision}`)) continue;
    try {
      await input.renderer.remove?.(input.rendererInstallationForManifest(manifest));
    } catch (error) {
      errors.push(`Could not remove interrupted ${manifest.bundle_id}@${manifest.revision}: ${message(error)}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));

  await input.storage.remove(input.root).catch(error => {
    errors.push(`Could not remove the account offline directory: ${message(error)}`);
  });
  const [remainingJobs, remainingInstallations, rootInfo] = await Promise.all([
    input.jobs.list(input.ownerScope),
    input.repository.listCurrentInstallations(),
    input.storage.info(input.root),
  ]);
  if (remainingJobs.length > 0) errors.push(`${remainingJobs.length} offline jobs remain.`);
  if (remainingInstallations.length > 0) errors.push(`${remainingInstallations.length} offline installations remain.`);
  if (rootInfo.exists) errors.push('The account offline directory still exists.');
  if (errors.length > 0) throw new Error(errors.join('\n'));
}
