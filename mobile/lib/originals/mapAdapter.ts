import type { OriginalOfflineMapV1 } from './types';

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

export const expoOriginalOfflineMapAdapter: OriginalOfflineMapAdapter = {
  async prepare(map, identity, options = {}) {
    const manager = await import('@/components/NativeMap/offlineManager');
    const name = mapPackName(map, identity.pack_id, identity.version);
    const installed = await manager.getInstalledPacks();
    const ready = installed.find(pack => pack.name === name && pack.complete);
    if (ready) {
      return { pack_id: name, ready: true, bytes: Math.round(ready.sizeMb * 1_048_576) };
    }

    const [{ api }] = await Promise.all([import('../api')]);
    const config = await api.getConfig();
    let settled = false;
    let abortHandler: (() => void) | null = null;
    try {
      return await new Promise<OriginalPreparedMap>((resolve, reject) => {
        const finish = (operation: () => void) => {
          if (settled) return;
          settled = true;
          operation();
        };
        abortHandler = () => {
          void manager.pausePack(name);
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
          progress => options.onProgress?.({
            percentage: progress.percentage,
            received_bytes: Math.round(progress.sizeMb * 1_048_576),
            expected_bytes: map.estimated_bytes,
          }),
          () => finish(() => resolve({
            pack_id: name,
            ready: true,
            bytes: map.estimated_bytes,
          })),
          message => finish(() => reject(new Error(message))),
        ).catch(error => finish(() => reject(error)));
      });
    } finally {
      if (abortHandler) options.signal?.removeEventListener('abort', abortHandler);
    }
  },

  async isReady(packId) {
    const manager = await import('@/components/NativeMap/offlineManager');
    const installed = await manager.getInstalledPacks();
    return installed.some(pack => pack.name === packId && pack.complete);
  },

  async remove(packId) {
    const manager = await import('@/components/NativeMap/offlineManager');
    await manager.deletePack(packId);
  },
};
