/**
 * Single-stream PMTiles file download with progress, pause/resume, and
 * cross-restart persistence. Replaces per-tile MLN offline packs for large
 * regions — a 1 GB file downloads in ~2 min on wifi vs 60+ min for 300k tiles.
 *
 * Usage:
 *   const { getState, startDownload, pauseDownload, resumeDownload, deleteDownload } = useOfflineFiles();
 *   const conus = getState('conus');
 *   if (conus.status === 'complete') { // file is at conus.localPath }
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system';
import { storage } from './storage';

const BASE = 'https://tiles.gettrailhead.app';

export const OFFLINE_DIR = `${FileSystem.documentDirectory}offline/`;

export const FILE_REGIONS = {
  conus: {
    id:           'conus',
    name:         'Continental US',
    url:          `${BASE}/api/download/us.pmtiles`,
    localPath:    `${OFFLINE_DIR}conus.pmtiles`,
    estimatedGb:  17.1,   // actual file size fetched from manifest at runtime
    description:  'All roads, trails, towns, parks · z0–z15',
    bounds:       { n: 49.5, s: 24.5, e: -66.5, w: -125.0 },
  },
} as const;

export type FileRegionId = keyof typeof FILE_REGIONS;

export interface FileDownloadState {
  status:          'idle' | 'downloading' | 'paused' | 'complete' | 'error';
  progress:        number;   // 0–100
  downloadedBytes: number;
  totalBytes:      number;
  speedBps:        number;
  etaSec:          number;
  fileSizeMb:      number;
  localPath:       string;
  error?:          string;
}

const RESUME_KEY  = (id: string) => `offl_resume_${id}`;
const EMPTY = (id: FileRegionId): FileDownloadState => ({
  status: 'idle', progress: 0, downloadedBytes: 0, totalBytes: 0,
  speedBps: 0, etaSec: 0, fileSizeMb: 0,
  localPath: FILE_REGIONS[id].localPath,
});

// ── Formatting helpers ────────────────────────────────────────────────────────
export function fmtBytes(b: number): string {
  if (b < 1_048_576)      return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1_073_741_824)  return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1_073_741_824).toFixed(2)} GB`;
}
export function fmtSpeed(bps: number): string {
  if (bps <= 0)           return '─';
  if (bps < 1_048_576)    return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1_048_576).toFixed(1)} MB/s`;
}
export function fmtEta(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '─';
  if (sec < 60)   return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useOfflineFiles() {
  const [states, setStates] = useState<Record<string, FileDownloadState>>(
    () => Object.fromEntries(
      Object.keys(FILE_REGIONS).map(id => [id, EMPTY(id as FileRegionId)])
    )
  );
  // Real file sizes fetched from CF manifest (overrides estimatedGb)
  const [manifestSizes, setManifestSizes] = useState<Record<string, number>>({});

  const dlRefs    = useRef<Record<string, ReturnType<typeof createDownloadResumable> | null>>({});
  const speedBuf  = useRef<Record<string, Array<{ b: number; t: number }>>>({});
  const prevSpeed = useRef<Record<string, number>>({});

  // Fetch real file sizes from CF manifest
  useEffect(() => {
    fetch(`${BASE}/api/download/manifest.json`)
      .then(r => r.json())
      .then((m: Record<string, { size: number }>) => {
        const sizes: Record<string, number> = {};
        if (m['us.pmtiles']?.size) sizes['conus'] = m['us.pmtiles'].size;
        setManifestSizes(sizes);
      })
      .catch(() => {});
  }, []);

  // On mount: check which files already exist, and which have paused resume data
  useEffect(() => {
    (async () => {
      await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true }).catch(() => {});

      for (const [id, region] of Object.entries(FILE_REGIONS)) {
        const info = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
        if (info?.exists) {
          const sizeMb = Math.round(((info as any).size ?? 0) / 1_048_576 * 10) / 10;
          setStates(prev => ({
            ...prev,
            [id]: { ...EMPTY(id as FileRegionId), status: 'complete', progress: 100, fileSizeMb: sizeMb, localPath: region.localPath },
          }));
          continue;
        }
        // Check for paused download
        const saved = await storage.get(RESUME_KEY(id)).catch(() => null);
        if (saved) {
          setStates(prev => ({ ...prev, [id]: { ...EMPTY(id as FileRegionId), status: 'paused' } }));
        }
      }
    })();
  }, []);

  // ── Speed smoothing (EMA over ~8 seconds) ────────────────────────────────
  const calcSpeed = useCallback((id: string, bytes: number): number => {
    const now = Date.now();
    if (!speedBuf.current[id]) speedBuf.current[id] = [];
    speedBuf.current[id].push({ b: bytes, t: now });
    // Keep only last 8 seconds
    speedBuf.current[id] = speedBuf.current[id].filter(s => now - s.t < 8000);
    const buf = speedBuf.current[id];
    if (buf.length < 2) return prevSpeed.current[id] ?? 0;
    const elapsed = (buf[buf.length - 1].t - buf[0].t) / 1000;
    const delta   = buf[buf.length - 1].b - buf[0].b;
    const raw     = elapsed > 0 ? delta / elapsed : 0;
    // EMA smoothing
    const prev    = prevSpeed.current[id] ?? raw;
    const smooth  = prev * 0.6 + raw * 0.4;
    prevSpeed.current[id] = smooth;
    return smooth;
  }, []);

  const updateState = useCallback((id: string, patch: Partial<FileDownloadState>) => {
    setStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // ── Start or restart a download ───────────────────────────────────────────
  const startDownload = useCallback(async (id: string) => {
    const region = FILE_REGIONS[id as FileRegionId];
    if (!region) return;

    await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true }).catch(() => {});
    speedBuf.current[id]  = [];
    prevSpeed.current[id] = 0;

    // Load resume data if available
    let resumeData: string | undefined;
    try {
      const saved = await storage.get(RESUME_KEY(id));
      if (saved) {
        const parsed: FileSystem.DownloadPauseState = JSON.parse(saved);
        resumeData = parsed.resumeData;
      }
    } catch {}

    updateState(id, { status: 'downloading', progress: 0, error: undefined });

    const dl = FileSystem.createDownloadResumable(
      region.url,
      region.localPath,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const total    = totalBytesExpectedToWrite || region.estimatedGb * 1_073_741_824;
        const pct      = (totalBytesWritten / total) * 100;
        const speed    = calcSpeed(id, totalBytesWritten);
        const remain   = total - totalBytesWritten;
        const eta      = speed > 0 ? remain / speed : 0;
        updateState(id, {
          status:          'downloading',
          progress:        Math.min(pct, 99.9),
          downloadedBytes: totalBytesWritten,
          totalBytes:      total,
          speedBps:        speed,
          etaSec:          eta,
          fileSizeMb:      totalBytesWritten / 1_048_576,
        });
      },
      resumeData,
    );

    dlRefs.current[id] = dl;

    try {
      const result = await dl.downloadAsync();
      if (result?.uri) {
        const info   = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
        const sizeMb = Math.round(((info as any)?.size ?? 0) / 1_048_576 * 10) / 10;
        await storage.del(RESUME_KEY(id)).catch(() => {});
        updateState(id, { status: 'complete', progress: 100, fileSizeMb: sizeMb, speedBps: 0, etaSec: 0 });
      }
    } catch (e: any) {
      const msg = e?.message ?? '';
      // pauseAsync() throws with "cancelled" on iOS — not an error
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('pause')) {
        updateState(id, { status: 'error', error: msg || 'Download failed' });
      }
    }
  }, [calcSpeed, updateState]);

  // ── Pause ─────────────────────────────────────────────────────────────────
  const pauseDownload = useCallback(async (id: string) => {
    const dl = dlRefs.current[id];
    if (!dl) return;
    try {
      const state = await dl.pauseAsync();
      if (state) await storage.set(RESUME_KEY(id), JSON.stringify(state)).catch(() => {});
    } catch {}
    updateState(id, { status: 'paused', speedBps: 0, etaSec: 0 });
  }, [updateState]);

  // ── Resume ────────────────────────────────────────────────────────────────
  const resumeDownload = useCallback(async (id: string) => {
    const dl = dlRefs.current[id];
    if (dl) {
      updateState(id, { status: 'downloading' });
      try {
        const result = await dl.resumeAsync();
        if (result?.uri) {
          await storage.del(RESUME_KEY(id)).catch(() => {});
          updateState(id, { status: 'complete', progress: 100, speedBps: 0, etaSec: 0 });
        }
      } catch {
        // If resume fails, restart fresh
        await startDownload(id);
      }
    } else {
      await startDownload(id);
    }
  }, [startDownload, updateState]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteDownload = useCallback(async (id: string) => {
    const region = FILE_REGIONS[id as FileRegionId];
    if (!region) return;
    dlRefs.current[id] = null;
    speedBuf.current[id]  = [];
    prevSpeed.current[id] = 0;
    await FileSystem.deleteAsync(region.localPath, { idempotent: true }).catch(() => {});
    await storage.del(RESUME_KEY(id)).catch(() => {});
    updateState(id, EMPTY(id as FileRegionId));
  }, [updateState]);

  const getState = useCallback((id: string): FileDownloadState =>
    states[id] ?? EMPTY('conus'), [states]);

  const isFileAvailable = useCallback((id: string): boolean =>
    states[id]?.status === 'complete', [states]);

  // Returns the real file size in bytes (from manifest) or estimated fallback
  const getTotalBytes = useCallback((id: string): number => {
    if (manifestSizes[id]) return manifestSizes[id];
    const region = FILE_REGIONS[id as FileRegionId];
    return region ? region.estimatedGb * 1_073_741_824 : 0;
  }, [manifestSizes]);

  return { startDownload, pauseDownload, resumeDownload, deleteDownload, getState, isFileAvailable, getTotalBytes, states };
}
