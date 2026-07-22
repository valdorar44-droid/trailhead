import * as FileSystem from 'expo-file-system/legacy';
import type { DownloadResumable } from 'expo-file-system/legacy';
import { TRAILHEAD_API_BASE } from '../apiBase';
import { storage as secureStorage } from '../storage';
import { expoOriginalFileAdapter } from '../originals/expoFileAdapter';
import type { OfflineArtifactTransferAdapter } from './coordinator';
import { createOfflineBundleJobStoreV2 } from './jobStore';
import { createOfflineBundleManifestRepository } from './repository';

function safe(value: string) {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function resolveArtifactUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  return `${TRAILHEAD_API_BASE}/${value.replace(/^\/+/, '')}`;
}

function abortError() {
  const error = new Error('Offline download paused.');
  error.name = 'AbortError';
  return error;
}

type ActiveDownload = {
  task: DownloadResumable;
  destination: string;
};

export function createExpoOfflineArtifactTransferAdapter(input: Readonly<{
  getAuthToken?: () => Promise<string | null>;
}> = {}): OfflineArtifactTransferAdapter {
  const active = new Map<string, ActiveDownload>();
  const getAuthToken = input.getAuthToken
    ?? (() => secureStorage.get('trailhead_token').catch(() => null));

  return {
    async download(artifact, destination, options) {
      if (!artifact.uri) throw new Error(`Offline artifact ${artifact.id} has no download address.`);
      if (options.signal?.aborted) throw abortError();
      const token = await getAuthToken();
      if (!token) throw new Error('Sign in to continue this offline download.');
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: artifact.media_type || 'application/octet-stream',
        ...(options.etag ? { 'If-Range': `"${options.etag.replace(/^"|"$/g, '')}"` } : {}),
      };
      const task = FileSystem.createDownloadResumable(
        resolveArtifactUrl(artifact.uri),
        destination,
        { headers },
        progress => options.onProgress?.({
          received_bytes: progress.totalBytesWritten,
          total_bytes: progress.totalBytesExpectedToWrite > 0
            ? progress.totalBytesExpectedToWrite
            : artifact.bytes,
          etag: options.etag,
          resume_token: task.savable().resumeData,
        }),
        options.resume_token,
      );
      active.set(artifact.id, { task, destination });
      const pauseOnAbort = () => { void task.pauseAsync().catch(() => undefined); };
      options.signal?.addEventListener('abort', pauseOnAbort, { once: true });
      try {
        const result = options.resume_token
          ? await task.resumeAsync()
          : await task.downloadAsync();
        if (options.signal?.aborted || !result) throw abortError();
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Offline artifact ${artifact.id} returned HTTP ${result.status}.`);
        }
        return Object.freeze({
          etag: options.etag,
          resume_token: task.savable().resumeData,
        });
      } finally {
        options.signal?.removeEventListener('abort', pauseOnAbort);
        if (active.get(artifact.id)?.task === task) active.delete(artifact.id);
      }
    },
    async pause(artifactId) {
      const current = active.get(artifactId);
      if (!current) return Object.freeze({});
      const paused = await current.task.pauseAsync();
      return Object.freeze({ resume_token: paused.resumeData });
    },
    async cancel(artifactId) {
      const current = active.get(artifactId);
      if (!current) return;
      await current.task.cancelAsync().catch(() => undefined);
      await FileSystem.deleteAsync(current.destination, { idempotent: true }).catch(() => undefined);
      active.delete(artifactId);
    },
  };
}

/** One account scope owns one canonical V2 installation and progress store. */
export function createExpoOfflineV2Persistence(ownerScope: string) {
  const root = `${expoOriginalFileAdapter.documentDirectory.replace(/\/+$/, '')}/offline-v2/scopes/${safe(ownerScope)}`;
  return Object.freeze({
    root,
    storage: expoOriginalFileAdapter,
    repository: createOfflineBundleManifestRepository(expoOriginalFileAdapter, root),
    jobs: createOfflineBundleJobStoreV2(expoOriginalFileAdapter, `${root}/jobs`),
  });
}
