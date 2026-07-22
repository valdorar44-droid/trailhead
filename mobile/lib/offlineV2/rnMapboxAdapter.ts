import MapboxGL from '@rnmapbox/maps';
import type { OfflineRendererDownloadAdapter, OfflineTransferProgress } from './coordinator';
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

async function renderProbe(manifest: OfflineBundleManifestV2) {
  const center: [number, number] = [
    (manifest.bounds.west + manifest.bounds.east) / 2,
    (manifest.bounds.south + manifest.bounds.north) / 2,
  ];
  const result = await MapboxGL.snapshotManager.takeSnap({
    centerCoordinate: center,
    width: 32,
    height: 32,
    zoomLevel: Math.min(manifest.max_zoom, Math.max(manifest.min_zoom, 10)),
    styleURL: manifest.renderer.style_uri,
    withLogo: false,
    writeToDisk: false,
  });
  return typeof result === 'string' && result.length > 0;
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
        await MapboxGL.offlineManager.createPack({
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
        });
        pack = await MapboxGL.offlineManager.getPack(name);
      }
      if (!pack) throw new Error('The RNMapbox offline pack is unavailable.');
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
      const identityReady = Boolean(pack
        && metadata.manifest_sha256 === manifest.manifest_sha256
        && metadata.style_id === manifest.renderer.style_id
        && metadata.style_uri === manifest.renderer.style_uri
        && metadata.style_revision === manifest.renderer.style_revision);
      const resourcesReady = identityReady && Number(status?.percentage || 0) >= 100;
      const styleReady = resourcesReady
        && installation.style_pack_id === manifest.renderer.style_pack_id;
      const tilesReady = resourcesReady
        && installation.tile_region_id === manifest.renderer.tile_region_id;
      if (!identityReady) diagnostics.push('The RNMapbox pack identity does not match the manifest.');
      else if (!resourcesReady) diagnostics.push('The RNMapbox offline map is incomplete.');
      if (!styleReady) diagnostics.push('The RNMapbox style pack is incomplete.');
      if (!tilesReady) diagnostics.push('The RNMapbox tile region is incomplete.');
      const probeReady = styleReady && tilesReady
        ? await renderProbe(manifest).catch(() => false)
        : false;
      if (styleReady && tilesReady && !probeReady) diagnostics.push('The RNMapbox render probe failed.');
      return {
        renderer: 'rnmapbox',
        ready: styleReady && tilesReady && probeReady,
        style_ready: styleReady,
        tiles_ready: tilesReady,
        render_probe_ready: probeReady,
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
