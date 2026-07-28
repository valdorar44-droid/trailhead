import MapboxGL from '@rnmapbox/maps';
import type { OfflineRendererDownloadAdapter, OfflineTransferProgress } from './coordinator';
import { createOrRecoverRnMapboxPack } from './rnMapboxPackRecovery';
import { resolveRnMapboxOfflinePackReadiness } from './rnMapboxPackReadiness';
import type { OfflineBundleManifestV2 } from './types';

function safe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52);
}

export function rnMapboxPackName(manifest: Pick<OfflineBundleManifestV2, 'bundle_id' | 'revision'>) {
  return `trailhead-v2-${safe(manifest.bundle_id)}-${safe(manifest.revision)}`.slice(0, 110);
}

function abortError() {
  const error = new Error('Offline map download paused.');
  error.name = 'AbortError';
  return error;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function sleep(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    setTimeout(() => signal?.removeEventListener('abort', cancel), milliseconds + 1);
  });
}

export function createRnMapboxOfflineDownloadAdapter(): OfflineRendererDownloadAdapter {
  const waitForReady = async (
    manifest: OfflineBundleManifestV2,
    signal?: AbortSignal,
    onProgress?: (progress: OfflineTransferProgress) => void,
    nativeError?: () => string,
  ) => {
    const name = rnMapboxPackName(manifest);
    const startedAt = Date.now();
    while (true) {
      if (signal?.aborted) {
        await MapboxGL.offlineManager.getPack(name).then(pack => pack?.pause()).catch(() => undefined);
        throw abortError();
      }
      const nativeFailure = nativeError?.();
      if (nativeFailure) throw new Error(nativeFailure);
      if (Date.now() - startedAt > 6 * 60 * 60 * 1000) {
        throw new Error('The RNMapbox offline map did not finish within six hours.');
      }
      const pack = await MapboxGL.offlineManager.getPack(name);
      if (!pack) throw new Error('The RNMapbox offline pack was not created.');
      const status = await pack.status();
      const percentage = Math.max(0, Math.min(100, Number(status.percentage) || 0));
      const expected = manifest.artifacts
        .filter(artifact => artifact.storage !== 'file')
        .reduce((sum, artifact) => sum + artifact.bytes, 0);
      onProgress?.({
        received_bytes: Math.min(expected, Math.max(0, Number(status.completedResourceSize) || Math.round(expected * percentage / 100))),
        total_bytes: expected,
      });
      if (percentage >= 100) return pack;
      await sleep(400, signal);
    }
  };

  return {
    renderer: 'rnmapbox',
    async prepare(manifest, options) {
      if (manifest.renderer.id !== 'rnmapbox') {
        throw new Error('The offline manifest does not use RNMapbox.');
      }
      const name = rnMapboxPackName(manifest);
      let nativeFailure = '';
      let pack = await MapboxGL.offlineManager.getPack(name);
      if (pack) {
        const metadata = parseMetadata(pack.metadata);
        if (metadata.manifest_sha256 !== manifest.manifest_sha256
          || metadata.style_id !== manifest.renderer.style_id
          || metadata.style_uri !== manifest.renderer.style_uri
          || metadata.style_revision !== manifest.renderer.style_revision) {
          throw new Error('The existing RNMapbox pack does not match this immutable manifest.');
        }
        await pack.resume();
      } else {
        pack = await createOrRecoverRnMapboxPack({
          create: () => MapboxGL.offlineManager.createPack({
            name,
            styleURL: manifest.renderer.style_uri,
            bounds: [
              [manifest.bounds.east, manifest.bounds.north],
              [manifest.bounds.west, manifest.bounds.south],
            ],
            minZoom: manifest.min_zoom,
            maxZoom: manifest.max_zoom,
            metadata: {
              schema_version: 2,
              bundle_id: manifest.bundle_id,
              revision: manifest.revision,
              manifest_sha256: manifest.manifest_sha256,
              style_id: manifest.renderer.style_id,
              style_uri: manifest.renderer.style_uri,
              style_revision: manifest.renderer.style_revision,
              style_pack_id: manifest.renderer.style_pack_id,
              tile_region_id: manifest.renderer.tile_region_id,
            },
          }, () => undefined, (_offlinePack, error) => {
            nativeFailure = error?.message || 'RNMapbox could not complete the offline map.';
          }),
          // getPack refreshes RNMapbox's JavaScript registry from TileStore.
          // This is required when native creation persisted before rejecting.
          reload: () => MapboxGL.offlineManager.getPack(name),
        });
      }
      if (!pack) throw new Error('The RNMapbox offline pack is unavailable.');
      const metadata = parseMetadata(pack.metadata);
      if (metadata.manifest_sha256 !== manifest.manifest_sha256
        || metadata.style_id !== manifest.renderer.style_id
        || metadata.style_uri !== manifest.renderer.style_uri
        || metadata.style_revision !== manifest.renderer.style_revision) {
        throw new Error('The RNMapbox offline pack does not match this immutable manifest.');
      }
      await waitForReady(manifest, options.signal, options.onProgress, () => nativeFailure);
      return Object.freeze({
        renderer: 'rnmapbox' as const,
        style_pack_id: manifest.renderer.style_pack_id,
        tile_region_id: manifest.renderer.tile_region_id,
        native_pack_name: name,
      });
    },
    async inspect(manifest, installation) {
      const diagnostics: string[] = [];
      if (manifest.renderer.id !== 'rnmapbox' || installation.renderer !== 'rnmapbox') {
        return {
          renderer: 'rnmapbox', ready: false, style_ready: false, tiles_ready: false,
          render_probe_ready: false, diagnostics: ['The downloaded map uses a different renderer.'],
        };
      }
      const name = installation.native_pack_name || rnMapboxPackName(manifest);
      const pack = await MapboxGL.offlineManager.getPack(name).catch(() => undefined);
      const status = pack ? await pack.status().catch(() => null) : null;
      const metadata = parseMetadata(pack?.metadata);
      const readiness = resolveRnMapboxOfflinePackReadiness({
        manifest,
        installation,
        pack_exists: Boolean(pack),
        percentage: Number(status?.percentage || 0),
        metadata,
      });
      diagnostics.push(...readiness.diagnostics);
      return {
        renderer: 'rnmapbox',
        ready: readiness.ready,
        style_ready: readiness.style_ready,
        tiles_ready: readiness.tiles_ready,
        render_probe_ready: readiness.render_probe_ready,
        diagnostics,
      };
    },
    async pause(manifest) {
      await MapboxGL.offlineManager.getPack(rnMapboxPackName(manifest))
        .then(pack => pack?.pause());
    },
    async resume(manifest) {
      await MapboxGL.offlineManager.getPack(rnMapboxPackName(manifest))
        .then(pack => pack?.resume());
    },
    async remove(installation) {
      const name = installation.native_pack_name || installation.legacy_pack_name;
      if (name) await MapboxGL.offlineManager.deletePack(name);
    },
  };
}
