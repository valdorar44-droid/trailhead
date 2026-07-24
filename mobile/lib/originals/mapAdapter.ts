import type { OriginalOfflineMapV1 } from './types';
import {
  ORIGINAL_MAP_STATUS_POLL_MS,
  createOriginalMapDownloadWatchdog,
  observeOriginalMapDownload,
} from './mapDownloadWatchdog';
import { originalOfflineStyleURI } from './mapPresentation';

export type OriginalMapDownloadProgress = {
  percentage: number;
  received_bytes: number;
  expected_bytes: number;
};

export type OriginalPreparedMap = {
  pack_id: string;
  ready: true;
  bytes: number;
};

export type OriginalOfflineMapAdapter = {
  prepare(
    map: OriginalOfflineMapV1,
    identity: { pack_id: string; version: number },
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: OriginalMapDownloadProgress) => void;
    },
  ): Promise<OriginalPreparedMap>;
  isReady?(packId: string): Promise<boolean>;
  remove?(packId: string): Promise<void>;
};

function mapPackName(map: OriginalOfflineMapV1, packId: string, version: number) {
  return `trailhead-original:${packId}:${version}:${map.region_id}`;
}

type OriginalMapRenderer = 'maplibre' | 'rnmapbox';
const MAP_PACK_REFERENCE_PREFIX = 'trailhead-original-map-v2:';

export function mapPackReference(renderer: OriginalMapRenderer, name: string) {
  return `${MAP_PACK_REFERENCE_PREFIX}${renderer}:${encodeURIComponent(name)}`;
}

export function parseMapPackReference(reference: string) {
  if (!reference.startsWith(MAP_PACK_REFERENCE_PREFIX)) {
    return { name: reference, renderer: null as OriginalMapRenderer | null };
  }
  const payload = reference.slice(MAP_PACK_REFERENCE_PREFIX.length);
  const separator = payload.indexOf(':');
  const renderer = payload.slice(0, separator);
  const name = separator >= 0 ? decodeURIComponent(payload.slice(separator + 1)) : '';
  if ((renderer !== 'maplibre' && renderer !== 'rnmapbox') || !name) {
    return { name: reference, renderer: null as OriginalMapRenderer | null };
  }
  return { name, renderer } as const;
}

async function activeMapRenderer() {
  const { resolveActiveNativeMapRenderer } = await import('../nativeMapRendererState');
  return resolveActiveNativeMapRenderer();
}

export const expoOriginalOfflineMapAdapter: OriginalOfflineMapAdapter = {
  async prepare(map, identity, options = {}) {
    const [manager, { api }, rendererState] = await Promise.all([
      import('@/components/NativeMap/offlineManager'),
      import('../api'),
      import('../nativeMapRendererState'),
    ]);
    const config = await api.getConfig();
    const renderer = config.mapbox_token
      ? 'rnmapbox'
      : await rendererState.resolveActiveNativeMapRenderer();
    rendererState.setActiveNativeMapRenderer(renderer);
    const name = mapPackName(map, identity.pack_id, identity.version);
    const installed = await manager.getInstalledPacks(renderer);
    const ready = installed.find(pack => pack.name === name && pack.complete);
    if (ready) {
      return {
        pack_id: mapPackReference(renderer, name),
        ready: true,
        bytes: Math.round(ready.sizeMb * 1_048_576),
      };
    }
    let settled = false;
    let abortHandler: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollInFlight = false;
    let watchdog = createOriginalMapDownloadWatchdog(Date.now());
    try {
      return await new Promise<OriginalPreparedMap>((resolve, reject) => {
        const finish = (operation: () => void) => {
          if (settled) return;
          settled = true;
          if (pollTimer) clearTimeout(pollTimer);
          pollTimer = null;
          operation();
        };
        const reportProgress = (percentage: number, receivedBytes: number) => {
          if (settled) return;
          const observation = observeOriginalMapDownload(watchdog, {
            percentage,
            receivedBytes,
            complete: false,
          }, Date.now());
          watchdog = observation.state;
          if (observation.advanced) {
            options.onProgress?.({
              percentage: watchdog.lastPercentage,
              received_bytes: watchdog.lastReceivedBytes,
              expected_bytes: map.estimated_bytes,
            });
          }
        };
        const scheduleVerification = (delayMs = ORIGINAL_MAP_STATUS_POLL_MS) => {
          if (settled || pollTimer) return;
          pollTimer = setTimeout(() => {
            pollTimer = null;
            void verifyInstalledPack();
          }, delayMs);
        };
        const verifyInstalledPack = async () => {
          if (settled || pollInFlight) return;
          pollInFlight = true;
          try {
            const packs = await manager.getInstalledPacks(renderer);
            if (settled) return;
            const pack = packs.find(candidate => candidate.name === name);
            const observation = observeOriginalMapDownload(
              watchdog,
              pack ? {
                percentage: pack.percentage,
                receivedBytes: Math.round(pack.sizeMb * 1_048_576),
                complete: pack.complete,
              } : null,
              Date.now(),
            );
            watchdog = observation.state;
            if (observation.advanced) {
              options.onProgress?.({
                percentage: watchdog.lastPercentage,
                received_bytes: watchdog.lastReceivedBytes,
                expected_bytes: map.estimated_bytes,
              });
            }
            if (observation.complete && pack) {
              finish(() => resolve({
                pack_id: mapPackReference(renderer, name),
                ready: true,
                bytes: Math.round(pack.sizeMb * 1_048_576),
              }));
              return;
            }
            if (observation.stalled) {
              void manager.pausePack(name, renderer);
              finish(() => reject(new Error(
                'Offline map download paused. Check your connection and retry.',
              )));
            }
          } catch {
            const observation = observeOriginalMapDownload(watchdog, null, Date.now());
            watchdog = observation.state;
            if (observation.stalled) {
              void manager.pausePack(name, renderer);
              finish(() => reject(new Error(
                'Offline map download paused. Check your connection and retry.',
              )));
            }
          } finally {
            pollInFlight = false;
            scheduleVerification();
          }
        };
        abortHandler = () => {
          void manager.pausePack(name, renderer);
          const error = new Error('Offline map download cancelled.');
          error.name = 'AbortError';
          finish(() => reject(error));
        };
        if (options.signal?.aborted) {
          abortHandler();
          return;
        }
        options.signal?.addEventListener('abort', abortHandler, { once: true });
        void manager.downloadPack(
          name,
          [[map.bounds.west, map.bounds.south], [map.bounds.east, map.bounds.north]],
          map.min_zoom,
          map.max_zoom,
          config.mapbox_token,
          progress => reportProgress(
            progress.percentage,
            Math.round(progress.sizeMb * 1_048_576),
          ),
          () => {
            reportProgress(100, map.estimated_bytes);
            void verifyInstalledPack();
          },
          message => finish(() => reject(new Error(message))),
          renderer,
          originalOfflineStyleURI(renderer),
        ).catch(error => finish(() => reject(error)));
        scheduleVerification();
      });
    } finally {
      if (abortHandler) options.signal?.removeEventListener('abort', abortHandler);
    }
  },

  async isReady(packId) {
    const [manager, activeRenderer] = await Promise.all([
      import('@/components/NativeMap/offlineManager'),
      activeMapRenderer(),
    ]);
    const reference = parseMapPackReference(packId);
    if (reference.renderer && reference.renderer !== activeRenderer) return false;
    const renderer = reference.renderer ?? activeRenderer;
    const installed = await manager.getInstalledPacks(renderer);
    return installed.some(pack => (
      pack.renderer === renderer
      && pack.name === reference.name
      && pack.complete
    ));
  },

  async remove(packId) {
    const manager = await import('@/components/NativeMap/offlineManager');
    const { name } = parseMapPackReference(packId);
    const removed = await Promise.allSettled([
      manager.deletePack(name, 'maplibre'),
      manager.deletePack(name, 'rnmapbox'),
    ]);
    if (removed.every(result => result.status === 'rejected')) {
      const rejected = removed.find(result => result.status === 'rejected');
      throw rejected && rejected.status === 'rejected'
        ? rejected.reason
        : new Error('Could not remove the offline map.');
    }
  },
};
