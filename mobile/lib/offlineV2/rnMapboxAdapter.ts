import MapboxGL from '@rnmapbox/maps';
import type { OfflineRendererDownloadAdapter, OfflineTransferProgress } from './coordinator';
import {
  awaitRnMapboxOfflinePackReady,
  classifyRnMapboxNativeFailure,
  recordRnMapboxOfflineLifecycleTerminalCode,
  RnMapboxOfflineLifecycleError,
  type RnMapboxNativeFailureSnapshot,
} from './rnMapboxPackLifecycle';
import { createOrRecoverRnMapboxPack } from './rnMapboxPackRecovery';
import { resolveRnMapboxOfflinePackReadiness } from './rnMapboxPackReadiness';
import type { OfflineBundleManifestV2 } from './types';

function safe(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52);
}

export function rnMapboxPackName(manifest: Pick<OfflineBundleManifestV2, 'bundle_id' | 'revision'>) {
  return `trailhead-v2-${safe(manifest.bundle_id)}-${safe(manifest.revision)}`.slice(0, 110);
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

export function createRnMapboxOfflineDownloadAdapter(): OfflineRendererDownloadAdapter {
  const waitForReady = async (
    manifest: OfflineBundleManifestV2,
    signal?: AbortSignal,
    onProgress?: (progress: OfflineTransferProgress) => void,
    nativeError?: () => RnMapboxNativeFailureSnapshot | undefined,
  ) => {
    const name = rnMapboxPackName(manifest);
    const expected = manifest.artifacts
      .filter(artifact => artifact.storage !== 'file')
      .reduce((sum, artifact) => sum + artifact.bytes, 0);
    return awaitRnMapboxOfflinePackReady({
      getPack: () => MapboxGL.offlineManager.getPack(name),
      readStatus: pack => pack.status(),
      pause: pack => pack.pause(),
      signal,
      expectedBytes: expected,
      onProgress,
      getNativeFailure: nativeError,
    });
  };

  return {
    renderer: 'rnmapbox',
    async prepare(manifest, options) {
      if (manifest.renderer.id !== 'rnmapbox') {
        throw new Error('The offline manifest does not use RNMapbox.');
      }
      const name = rnMapboxPackName(manifest);
      let nativeFailure: RnMapboxNativeFailureSnapshot | undefined;
      let nativeFailureSequence = 0;
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
        try {
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
              nativeFailure = Object.freeze({
                sequence: ++nativeFailureSequence,
                category: classifyRnMapboxNativeFailure(error?.message),
              });
            }),
            // getPack refreshes RNMapbox's JavaScript registry from TileStore.
            // This is required when native creation persisted before rejecting.
            reload: () => MapboxGL.offlineManager.getPack(name),
            // RNMapbox can deliver a creation callback error before the matching
            // native pack appears in its JavaScript registry. Once the exact
            // immutable pack is queryable, that bootstrap error is stale. Any
            // later native error is still observed by waitForReady below.
            onPackReady: () => { nativeFailure = undefined; },
          });
        } catch (error) {
          const category = classifyRnMapboxNativeFailure((error as { message?: unknown } | null)?.message);
          const code = `rnmapbox_${category}_before_registration`;
          recordRnMapboxOfflineLifecycleTerminalCode(code);
          throw new RnMapboxOfflineLifecycleError(
            code,
            'The offline map could not be created. Try again.',
          );
        }
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
