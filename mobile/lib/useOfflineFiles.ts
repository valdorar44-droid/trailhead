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

// Keep offline packs in persistent app storage. iOS may purge cacheDirectory
// when space is tight; a large routing download can otherwise evict maps.
export const OFFLINE_DIR = `${FileSystem.documentDirectory}offline/`;
export const CACHE_OFFLINE_DIR = `${FileSystem.cacheDirectory}offline/`;
export const ROUTING_DIR = `${OFFLINE_DIR}routing/`;
const CACHE_ROUTING_DIR = `${CACHE_OFFLINE_DIR}routing/`;

export const FILE_REGIONS = {
  conus: {
    id: 'conus', name: 'Continental US',
    url: `${BASE}/api/download/us.pmtiles`,
    localPath: `${OFFLINE_DIR}conus.pmtiles`,
    estimatedGb: 17.1,
    description: 'Full US base map · roads, trails, towns, parks · use corridor download for active route',
    bounds: { n: 49.5, s: 24.5, e: -66.5, w: -125.0 },
  },
  // ── US States ──────────────────────────────────────────────────────────────
  ak: { id:'ak', name:'Alaska',         url:`${BASE}/api/download/ak.pmtiles`, localPath:`${OFFLINE_DIR}ak.pmtiles`, estimatedGb:1.4,  description:'Roads, trails, parks · z0–z15', bounds:{n:71.4,s:54.6,e:-130.0,w:-168.0} },
  az: { id:'az', name:'Arizona',        url:`${BASE}/api/download/az.pmtiles`, localPath:`${OFFLINE_DIR}az.pmtiles`, estimatedGb:0.7,  description:'Roads, trails, parks · z0–z15', bounds:{n:37.0,s:31.3,e:-109.0,w:-114.8} },
  ca: { id:'ca', name:'California',     url:`${BASE}/api/download/ca.pmtiles`, localPath:`${OFFLINE_DIR}ca.pmtiles`, estimatedGb:1.8,  description:'Roads, trails, parks · z0–z15', bounds:{n:42.0,s:32.5,e:-114.1,w:-124.4} },
  co: { id:'co', name:'Colorado',       url:`${BASE}/api/download/co.pmtiles`, localPath:`${OFFLINE_DIR}co.pmtiles`, estimatedGb:0.7,  description:'Roads, trails, parks · z0–z15', bounds:{n:41.0,s:37.0,e:-102.0,w:-109.1} },
  hi: { id:'hi', name:'Hawaii',         url:`${BASE}/api/download/hi.pmtiles`, localPath:`${OFFLINE_DIR}hi.pmtiles`, estimatedGb:0.1,  description:'Roads, trails, parks · z0–z15', bounds:{n:22.2,s:18.9,e:-154.8,w:-160.2} },
  id: { id:'id', name:'Idaho',          url:`${BASE}/api/download/id.pmtiles`, localPath:`${OFFLINE_DIR}id.pmtiles`, estimatedGb:0.5,  description:'Roads, trails, parks · z0–z15', bounds:{n:49.0,s:42.0,e:-111.0,w:-117.2} },
  mt: { id:'mt', name:'Montana',        url:`${BASE}/api/download/mt.pmtiles`, localPath:`${OFFLINE_DIR}mt.pmtiles`, estimatedGb:0.7,  description:'Roads, trails, parks · z0–z15', bounds:{n:49.0,s:44.4,e:-104.0,w:-116.0} },
  nm: { id:'nm', name:'New Mexico',     url:`${BASE}/api/download/nm.pmtiles`, localPath:`${OFFLINE_DIR}nm.pmtiles`, estimatedGb:0.6,  description:'Roads, trails, parks · z0–z15', bounds:{n:37.0,s:31.3,e:-103.0,w:-109.1} },
  nv: { id:'nv', name:'Nevada',         url:`${BASE}/api/download/nv.pmtiles`, localPath:`${OFFLINE_DIR}nv.pmtiles`, estimatedGb:0.5,  description:'Roads, trails, parks · z0–z15', bounds:{n:42.0,s:35.0,e:-114.0,w:-120.0} },
  or: { id:'or', name:'Oregon',         url:`${BASE}/api/download/or.pmtiles`, localPath:`${OFFLINE_DIR}or.pmtiles`, estimatedGb:0.6,  description:'Roads, trails, parks · z0–z15', bounds:{n:46.3,s:41.9,e:-116.5,w:-124.6} },
  ut: { id:'ut', name:'Utah',           url:`${BASE}/api/download/ut.pmtiles`, localPath:`${OFFLINE_DIR}ut.pmtiles`, estimatedGb:0.5,  description:'Roads, trails, parks · z0–z15', bounds:{n:42.0,s:36.9,e:-109.0,w:-114.1} },
  wa: { id:'wa', name:'Washington',     url:`${BASE}/api/download/wa.pmtiles`, localPath:`${OFFLINE_DIR}wa.pmtiles`, estimatedGb:0.7,  description:'Roads, trails, parks · z0–z15', bounds:{n:49.0,s:45.5,e:-116.9,w:-124.7} },
  wy: { id:'wy', name:'Wyoming',        url:`${BASE}/api/download/wy.pmtiles`, localPath:`${OFFLINE_DIR}wy.pmtiles`, estimatedGb:0.4,  description:'Roads, trails, parks · z0–z15', bounds:{n:45.0,s:41.0,e:-104.1,w:-111.1} },
  ks: { id:'ks', name:'Kansas',         url:`${BASE}/api/download/ks.pmtiles`, localPath:`${OFFLINE_DIR}ks.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:40.0,s:36.9,e:-94.6,w:-102.1} },
  mn: { id:'mn', name:'Minnesota',      url:`${BASE}/api/download/mn.pmtiles`, localPath:`${OFFLINE_DIR}mn.pmtiles`, estimatedGb:0.5,  description:'Roads, trails, parks · z0–z15', bounds:{n:49.4,s:43.5,e:-89.5,w:-97.2} },
  mo: { id:'mo', name:'Missouri',       url:`${BASE}/api/download/mo.pmtiles`, localPath:`${OFFLINE_DIR}mo.pmtiles`, estimatedGb:0.4,  description:'Roads, trails, parks · z0–z15', bounds:{n:40.6,s:35.9,e:-89.1,w:-95.8} },
  nd: { id:'nd', name:'North Dakota',   url:`${BASE}/api/download/nd.pmtiles`, localPath:`${OFFLINE_DIR}nd.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:49.0,s:45.9,e:-96.6,w:-104.1} },
  ne: { id:'ne', name:'Nebraska',       url:`${BASE}/api/download/ne.pmtiles`, localPath:`${OFFLINE_DIR}ne.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:43.0,s:40.0,e:-95.3,w:-104.1} },
  ok: { id:'ok', name:'Oklahoma',       url:`${BASE}/api/download/ok.pmtiles`, localPath:`${OFFLINE_DIR}ok.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:37.0,s:33.6,e:-94.4,w:-103.0} },
  sd: { id:'sd', name:'South Dakota',   url:`${BASE}/api/download/sd.pmtiles`, localPath:`${OFFLINE_DIR}sd.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:45.9,s:42.5,e:-96.4,w:-104.1} },
  tx: { id:'tx', name:'Texas',          url:`${BASE}/api/download/tx.pmtiles`, localPath:`${OFFLINE_DIR}tx.pmtiles`, estimatedGb:2.0,  description:'Roads, trails, parks · z0–z15', bounds:{n:36.5,s:25.8,e:-93.5,w:-106.6} },
  al: { id:'al', name:'Alabama',        url:`${BASE}/api/download/al.pmtiles`, localPath:`${OFFLINE_DIR}al.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:35.0,s:30.2,e:-84.9,w:-88.5} },
  ar: { id:'ar', name:'Arkansas',       url:`${BASE}/api/download/ar.pmtiles`, localPath:`${OFFLINE_DIR}ar.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:36.5,s:33.0,e:-89.6,w:-94.6} },
  fl: { id:'fl', name:'Florida',        url:`${BASE}/api/download/fl.pmtiles`, localPath:`${OFFLINE_DIR}fl.pmtiles`, estimatedGb:0.5,  description:'Roads, trails, parks · z0–z15', bounds:{n:31.0,s:24.5,e:-80.0,w:-87.6} },
  ga: { id:'ga', name:'Georgia',        url:`${BASE}/api/download/ga.pmtiles`, localPath:`${OFFLINE_DIR}ga.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:35.0,s:30.4,e:-80.8,w:-85.6} },
  ky: { id:'ky', name:'Kentucky',       url:`${BASE}/api/download/ky.pmtiles`, localPath:`${OFFLINE_DIR}ky.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:39.1,s:36.5,e:-81.9,w:-89.6} },
  la: { id:'la', name:'Louisiana',      url:`${BASE}/api/download/la.pmtiles`, localPath:`${OFFLINE_DIR}la.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:33.0,s:28.9,e:-88.8,w:-94.0} },
  ms: { id:'ms', name:'Mississippi',    url:`${BASE}/api/download/ms.pmtiles`, localPath:`${OFFLINE_DIR}ms.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:35.0,s:30.2,e:-88.1,w:-91.7} },
  nc: { id:'nc', name:'North Carolina', url:`${BASE}/api/download/nc.pmtiles`, localPath:`${OFFLINE_DIR}nc.pmtiles`, estimatedGb:0.4,  description:'Roads, trails, parks · z0–z15', bounds:{n:36.6,s:33.8,e:-75.5,w:-84.3} },
  sc: { id:'sc', name:'South Carolina', url:`${BASE}/api/download/sc.pmtiles`, localPath:`${OFFLINE_DIR}sc.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:35.2,s:32.0,e:-78.5,w:-83.4} },
  tn: { id:'tn', name:'Tennessee',      url:`${BASE}/api/download/tn.pmtiles`, localPath:`${OFFLINE_DIR}tn.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:36.7,s:35.0,e:-81.6,w:-90.3} },
  va: { id:'va', name:'Virginia',       url:`${BASE}/api/download/va.pmtiles`, localPath:`${OFFLINE_DIR}va.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:39.5,s:36.5,e:-75.2,w:-83.7} },
  wv: { id:'wv', name:'West Virginia',  url:`${BASE}/api/download/wv.pmtiles`, localPath:`${OFFLINE_DIR}wv.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:40.6,s:37.2,e:-77.7,w:-82.6} },
  ct: { id:'ct', name:'Connecticut',    url:`${BASE}/api/download/ct.pmtiles`, localPath:`${OFFLINE_DIR}ct.pmtiles`, estimatedGb:0.05, description:'Roads, trails, parks · z0–z15', bounds:{n:42.1,s:41.0,e:-71.8,w:-73.7} },
  de: { id:'de', name:'Delaware',       url:`${BASE}/api/download/de.pmtiles`, localPath:`${OFFLINE_DIR}de.pmtiles`, estimatedGb:0.03, description:'Roads, trails, parks · z0–z15', bounds:{n:39.8,s:38.4,e:-75.0,w:-75.8} },
  ma: { id:'ma', name:'Massachusetts',  url:`${BASE}/api/download/ma.pmtiles`, localPath:`${OFFLINE_DIR}ma.pmtiles`, estimatedGb:0.1,  description:'Roads, trails, parks · z0–z15', bounds:{n:42.9,s:41.2,e:-69.9,w:-73.5} },
  md: { id:'md', name:'Maryland',       url:`${BASE}/api/download/md.pmtiles`, localPath:`${OFFLINE_DIR}md.pmtiles`, estimatedGb:0.1,  description:'Roads, trails, parks · z0–z15', bounds:{n:39.7,s:37.9,e:-75.0,w:-79.5} },
  me: { id:'me', name:'Maine',          url:`${BASE}/api/download/me.pmtiles`, localPath:`${OFFLINE_DIR}me.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:47.5,s:43.1,e:-66.9,w:-71.1} },
  nh: { id:'nh', name:'New Hampshire',  url:`${BASE}/api/download/nh.pmtiles`, localPath:`${OFFLINE_DIR}nh.pmtiles`, estimatedGb:0.1,  description:'Roads, trails, parks · z0–z15', bounds:{n:45.3,s:42.7,e:-70.6,w:-72.6} },
  nj: { id:'nj', name:'New Jersey',     url:`${BASE}/api/download/nj.pmtiles`, localPath:`${OFFLINE_DIR}nj.pmtiles`, estimatedGb:0.1,  description:'Roads, trails, parks · z0–z15', bounds:{n:41.4,s:38.9,e:-73.9,w:-75.6} },
  ny: { id:'ny', name:'New York',       url:`${BASE}/api/download/ny.pmtiles`, localPath:`${OFFLINE_DIR}ny.pmtiles`, estimatedGb:0.6,  description:'Roads, trails, parks · z0–z15', bounds:{n:45.0,s:40.5,e:-71.8,w:-79.8} },
  pa: { id:'pa', name:'Pennsylvania',   url:`${BASE}/api/download/pa.pmtiles`, localPath:`${OFFLINE_DIR}pa.pmtiles`, estimatedGb:0.4,  description:'Roads, trails, parks · z0–z15', bounds:{n:42.3,s:39.7,e:-74.7,w:-80.5} },
  ri: { id:'ri', name:'Rhode Island',   url:`${BASE}/api/download/ri.pmtiles`, localPath:`${OFFLINE_DIR}ri.pmtiles`, estimatedGb:0.02, description:'Roads, trails, parks · z0–z15', bounds:{n:42.0,s:41.1,e:-71.1,w:-71.9} },
  vt: { id:'vt', name:'Vermont',        url:`${BASE}/api/download/vt.pmtiles`, localPath:`${OFFLINE_DIR}vt.pmtiles`, estimatedGb:0.1,  description:'Roads, trails, parks · z0–z15', bounds:{n:45.0,s:42.7,e:-71.5,w:-73.4} },
  ia: { id:'ia', name:'Iowa',           url:`${BASE}/api/download/ia.pmtiles`, localPath:`${OFFLINE_DIR}ia.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:43.5,s:40.4,e:-90.1,w:-96.6} },
  il: { id:'il', name:'Illinois',       url:`${BASE}/api/download/il.pmtiles`, localPath:`${OFFLINE_DIR}il.pmtiles`, estimatedGb:0.4,  description:'Roads, trails, parks · z0–z15', bounds:{n:42.5,s:36.9,e:-87.0,w:-91.5} },
  in: { id:'in', name:'Indiana',        url:`${BASE}/api/download/in.pmtiles`, localPath:`${OFFLINE_DIR}in.pmtiles`, estimatedGb:0.2,  description:'Roads, trails, parks · z0–z15', bounds:{n:41.8,s:37.8,e:-84.8,w:-88.1} },
  mi: { id:'mi', name:'Michigan',       url:`${BASE}/api/download/mi.pmtiles`, localPath:`${OFFLINE_DIR}mi.pmtiles`, estimatedGb:0.5,  description:'Roads, trails, parks · z0–z15', bounds:{n:48.3,s:41.7,e:-82.4,w:-90.4} },
  oh: { id:'oh', name:'Ohio',           url:`${BASE}/api/download/oh.pmtiles`, localPath:`${OFFLINE_DIR}oh.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:42.0,s:38.4,e:-80.5,w:-84.8} },
  wi: { id:'wi', name:'Wisconsin',      url:`${BASE}/api/download/wi.pmtiles`, localPath:`${OFFLINE_DIR}wi.pmtiles`, estimatedGb:0.3,  description:'Roads, trails, parks · z0–z15', bounds:{n:47.1,s:42.5,e:-86.2,w:-92.9} },
  // ── International regions ──────────────────────────────────────────────────
  canada: {
    id: 'canada', name: 'Canada',
    url: `${BASE}/api/download/canada.pmtiles`,
    localPath: `${OFFLINE_DIR}canada.pmtiles`,
    estimatedGb: 18.9,
    description: 'Canada offline map · roads, trails, towns, parks · province packs next',
    bounds: { n: 83.2, s: 41.7, e: -52.6, w: -141.1 },
  },
  mexico: {
    id: 'mexico', name: 'Mexico',
    url: `${BASE}/api/download/mexico.pmtiles`,
    localPath: `${OFFLINE_DIR}mexico.pmtiles`,
    estimatedGb: 2.5,
    description: 'Mexico offline map · roads, towns, trails, parks',
    bounds: { n: 32.8, s: 14.5, e: -86.7, w: -118.6 },
  },
} as const;

export type FileRegionId = keyof typeof FILE_REGIONS;

export const ROUTING_PACK_BYTES: Record<string, number> = {
  ak: 57640960, az: 462120960, ca: 1636608000, co: 475648000,
  hi: 38666240, id: 213155840, mt: 142909440, nm: 226703360,
  nv: 208168960, or: 336179200, ut: 285788160, wa: 542812160,
  wy: 106383360, ks: 296611840, mn: 421969920, mo: 469155840,
  nd: 132608000, ne: 190586880, ok: 331417600, sd: 91770880,
  tx: 1580605440, al: 290508800, ar: 212910080, fl: 1080350720,
  ga: 582103040, ky: 273674240, la: 207462400, ms: 168458240,
  nc: 743546880, sc: 309278720, tn: 407162880, va: 607528960,
  wv: 115722240, ct: 210780160, de: 51496960, ma: 369500160,
  md: 337172480, me: 108247040, nh: 130754560, nj: 344668160,
  ny: 701071360, pa: 678471680, ri: 50247680, vt: 60221440,
  ia: 276623360, il: 753500160, in: 478351360, mi: 799098880,
  oh: 786380800, wi: 485171200,
  canada: 1828741120,
  mexico: 1835325440,
};

export const ROUTING_REGIONS = Object.fromEntries(
  Object.entries(FILE_REGIONS)
    .filter(([id]) => id !== 'conus')
    .map(([id, region]) => [id, {
      id,
      name: region.name,
      url: `${BASE}/api/routing/${id}.tar`,
      localPath: `${ROUTING_DIR}${id}.tar`,
      estimatedGb: Math.max(0.1, Math.round(((ROUTING_PACK_BYTES[id] ?? region.estimatedGb * 1_073_741_824 * 0.7) / 1_073_741_824) * 10) / 10),
      description: 'Valhalla graph pack · offline turn-by-turn routing',
      bounds: region.bounds,
    }])
) as Record<Exclude<FileRegionId, 'conus'>, {
  id: string;
  name: string;
  url: string;
  localPath: string;
  estimatedGb: number;
  description: string;
  bounds: { n: number; s: number; e: number; w: number };
}>;

export type RoutingRegionId = keyof typeof ROUTING_REGIONS;

export function isPlannedOfflineRegion(id: string): boolean {
  const region = FILE_REGIONS[id as FileRegionId] as any;
  return Boolean(region?.comingSoon);
}

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
const ROUTING_RESUME_KEY = (id: string) => `route_resume_${id}`;
const EMPTY = (id: FileRegionId): FileDownloadState => ({
  status: 'idle', progress: 0, downloadedBytes: 0, totalBytes: 0,
  speedBps: 0, etaSec: 0, fileSizeMb: 0,
  localPath: FILE_REGIONS[id].localPath,
});
const EMPTY_ROUTING = (id: string): FileDownloadState => {
  const region = ROUTING_REGIONS[id as RoutingRegionId] ?? ROUTING_REGIONS.ks;
  return {
    status: 'idle', progress: 0, downloadedBytes: 0, totalBytes: 0,
    speedBps: 0, etaSec: 0, fileSizeMb: 0,
    localPath: region?.localPath ?? `${ROUTING_DIR}${id}.tar`,
  };
};

async function migrateCachedFile(cachePath: string, persistentPath: string) {
  const target = await FileSystem.getInfoAsync(persistentPath).catch(() => null);
  if (target?.exists) return;

  const source = await FileSystem.getInfoAsync(cachePath).catch(() => null);
  if (!source?.exists) return;

  const parent = persistentPath.slice(0, persistentPath.lastIndexOf('/') + 1);
  await FileSystem.makeDirectoryAsync(parent, { intermediates: true }).catch(() => {});
  try {
    await FileSystem.moveAsync({ from: cachePath, to: persistentPath });
  } catch {
    await FileSystem.copyAsync({ from: cachePath, to: persistentPath }).catch(() => {});
    await FileSystem.deleteAsync(cachePath, { idempotent: true }).catch(() => {});
  }
}

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
  const [routingStates, setRoutingStates] = useState<Record<string, FileDownloadState>>(
    () => Object.fromEntries(
      Object.keys(ROUTING_REGIONS).map(id => [id, EMPTY_ROUTING(id)])
    )
  );
  // Real file sizes fetched from CF manifest (overrides estimatedGb)
  const [manifestSizes, setManifestSizes] = useState<Record<string, number>>({});
  const [routingManifestSizes, setRoutingManifestSizes] = useState<Record<string, number>>({});

  const dlRefs    = useRef<Record<string, FileSystem.DownloadResumable | null>>({});
  const routingDlRefs = useRef<Record<string, FileSystem.DownloadResumable | null>>({});
  const speedBuf  = useRef<Record<string, Array<{ b: number; t: number }>>>({});
  const prevSpeed = useRef<Record<string, number>>({});

  // Fetch real file sizes from CF manifest
  useEffect(() => {
    fetch(`${BASE}/api/download/manifest.json`)
      .then(r => r.json())
      .then((m: Record<string, { size: number }>) => {
        const sizes: Record<string, number> = {};
        if (m['us.pmtiles']?.size) sizes['conus'] = m['us.pmtiles'].size;
        // State files: manifest key is "{code}.pmtiles", region id is code lowercase
        Object.keys(FILE_REGIONS).forEach(id => {
          if (id === 'conus') return;
          const key = `${id}.pmtiles`;
          if (m[key]?.size) sizes[id] = m[key].size;
        });
        setManifestSizes(sizes);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${BASE}/api/routing/manifest.json`)
      .then(r => r.ok ? r.json() : {})
      .then((m: Record<string, { size: number }>) => {
        const sizes: Record<string, number> = {};
        Object.keys(ROUTING_REGIONS).forEach(id => {
          const tarKey = `${id}.tar`;
          const gzKey = `${id}.tar.gz`;
          if (m[tarKey]?.size) sizes[id] = m[tarKey].size;
          else if (m[gzKey]?.size) sizes[id] = m[gzKey].size;
        });
        setRoutingManifestSizes(sizes);
      })
      .catch(() => {});
  }, []);

  // On mount: check which files already exist, and which have paused resume data
  useEffect(() => {
    (async () => {
      await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true }).catch(() => {});
      await FileSystem.makeDirectoryAsync(ROUTING_DIR, { intermediates: true }).catch(() => {});

      for (const [id, region] of Object.entries(FILE_REGIONS)) {
        const fileName = id === 'conus' ? 'conus.pmtiles' : `${id}.pmtiles`;
        await migrateCachedFile(`${CACHE_OFFLINE_DIR}${fileName}`, region.localPath);
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

      for (const [id, region] of Object.entries(ROUTING_REGIONS)) {
        await migrateCachedFile(`${CACHE_ROUTING_DIR}${id}.tar`, region.localPath);
        const info = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
        if (info?.exists) {
          const sizeMb = Math.round(((info as any).size ?? 0) / 1_048_576 * 10) / 10;
          setRoutingStates(prev => ({
            ...prev,
            [id]: { ...EMPTY_ROUTING(id), status: 'complete', progress: 100, fileSizeMb: sizeMb, localPath: region.localPath },
          }));
          continue;
        }
        const saved = await storage.get(ROUTING_RESUME_KEY(id)).catch(() => null);
        if (saved) {
          setRoutingStates(prev => ({ ...prev, [id]: { ...EMPTY_ROUTING(id), status: 'paused' } }));
        }
      }
    })();
  }, []);

  // After manifest loads: validate any "complete" files against expected size.
  // If a file is <85% of expected, it's truncated — delete it and reset to idle.
  useEffect(() => {
    if (Object.keys(manifestSizes).length === 0) return;
    (async () => {
      for (const [id, region] of Object.entries(FILE_REGIONS)) {
        const expected = manifestSizes[id];
        if (!expected) continue;
        const info = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
        if (!info?.exists) continue;
        const actual = (info as any).size ?? 0;
        if (actual < expected * 0.99) {
          await FileSystem.deleteAsync(region.localPath, { idempotent: true }).catch(() => {});
          await storage.del(RESUME_KEY(id)).catch(() => {});
          setStates(prev => ({ ...prev, [id]: { ...EMPTY(id as FileRegionId) } }));
        }
      }
    })();
  }, [manifestSizes]);

  useEffect(() => {
    if (Object.keys(routingManifestSizes).length === 0) return;
    (async () => {
      for (const [id, region] of Object.entries(ROUTING_REGIONS)) {
        const expected = routingManifestSizes[id];
        if (!expected) continue;
        const info = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
        if (!info?.exists) continue;
        const actual = (info as any).size ?? 0;
        if (actual < expected * 0.99) {
          await FileSystem.deleteAsync(region.localPath, { idempotent: true }).catch(() => {});
          await storage.del(ROUTING_RESUME_KEY(id)).catch(() => {});
          setRoutingStates(prev => ({ ...prev, [id]: { ...EMPTY_ROUTING(id) } }));
        }
      }
    })();
  }, [routingManifestSizes]);

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
  const updateRoutingState = useCallback((id: string, patch: Partial<FileDownloadState>) => {
    setRoutingStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
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
      if (result?.uri && result.status === 200) {
        const info   = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
        const sizeMb = Math.round(((info as any)?.size ?? 0) / 1_048_576 * 10) / 10;
        await storage.del(RESUME_KEY(id)).catch(() => {});
        updateState(id, { status: 'complete', progress: 100, fileSizeMb: sizeMb, speedBps: 0, etaSec: 0 });
      } else if (result && result.status !== 200) {
        // Server returned an error (e.g. 404 — file not yet extracted on backend)
        await FileSystem.deleteAsync(region.localPath, { idempotent: true }).catch(() => {});
        await storage.del(RESUME_KEY(id)).catch(() => {});
        updateState(id, { status: 'error', error: `Not available yet (${result.status}) — check back soon` });
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
        if (result?.uri && result.status === 200) {
          await storage.del(RESUME_KEY(id)).catch(() => {});
          updateState(id, { status: 'complete', progress: 100, speedBps: 0, etaSec: 0 });
        } else if (result && result.status !== 200) {
          await FileSystem.deleteAsync(FILE_REGIONS[id as FileRegionId].localPath, { idempotent: true }).catch(() => {});
          await storage.del(RESUME_KEY(id)).catch(() => {});
          updateState(id, { status: 'error', error: `Not available yet (${result.status}) — check back soon` });
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

  const startRoutingDownload = useCallback(async (id: string) => {
    const region = ROUTING_REGIONS[id as RoutingRegionId];
    if (!region) return;

    await FileSystem.makeDirectoryAsync(ROUTING_DIR, { intermediates: true }).catch(() => {});
    speedBuf.current[`route:${id}`] = [];
    prevSpeed.current[`route:${id}`] = 0;

    let resumeData: string | undefined;
    try {
      const saved = await storage.get(ROUTING_RESUME_KEY(id));
      if (saved) {
        const parsed: FileSystem.DownloadPauseState = JSON.parse(saved);
        resumeData = parsed.resumeData;
      }
    } catch {}

    updateRoutingState(id, { status: 'downloading', progress: 0, error: undefined });
    const dl = FileSystem.createDownloadResumable(
      region.url,
      region.localPath,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const key = `route:${id}`;
        const total = totalBytesExpectedToWrite || routingManifestSizes[id] || region.estimatedGb * 1_073_741_824;
        const pct = (totalBytesWritten / total) * 100;
        const speed = calcSpeed(key, totalBytesWritten);
        const remain = total - totalBytesWritten;
        updateRoutingState(id, {
          status: 'downloading',
          progress: Math.min(pct, 99.9),
          downloadedBytes: totalBytesWritten,
          totalBytes: total,
          speedBps: speed,
          etaSec: speed > 0 ? remain / speed : 0,
          fileSizeMb: totalBytesWritten / 1_048_576,
        });
      },
      resumeData,
    );
    routingDlRefs.current[id] = dl;

    try {
      const result = await dl.downloadAsync();
      if (result?.uri && result.status === 200) {
        const info = await FileSystem.getInfoAsync(region.localPath).catch(() => null);
        const sizeMb = Math.round(((info as any)?.size ?? 0) / 1_048_576 * 10) / 10;
        await storage.del(ROUTING_RESUME_KEY(id)).catch(() => {});
        updateRoutingState(id, { status: 'complete', progress: 100, fileSizeMb: sizeMb, speedBps: 0, etaSec: 0 });
      } else if (result && result.status !== 200) {
        await FileSystem.deleteAsync(region.localPath, { idempotent: true }).catch(() => {});
        await storage.del(ROUTING_RESUME_KEY(id)).catch(() => {});
        updateRoutingState(id, { status: 'error', error: `Routing pack not available yet (${result.status})` });
      }
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('pause')) {
        updateRoutingState(id, { status: 'error', error: msg || 'Routing download failed' });
      }
    }
  }, [calcSpeed, routingManifestSizes, updateRoutingState]);

  const pauseRoutingDownload = useCallback(async (id: string) => {
    const dl = routingDlRefs.current[id];
    if (!dl) return;
    try {
      const state = await dl.pauseAsync();
      if (state) await storage.set(ROUTING_RESUME_KEY(id), JSON.stringify(state)).catch(() => {});
    } catch {}
    updateRoutingState(id, { status: 'paused', speedBps: 0, etaSec: 0 });
  }, [updateRoutingState]);

  const resumeRoutingDownload = useCallback(async (id: string) => {
    const dl = routingDlRefs.current[id];
    if (dl) {
      updateRoutingState(id, { status: 'downloading' });
      try {
        const result = await dl.resumeAsync();
        if (result?.uri && result.status === 200) {
          await storage.del(ROUTING_RESUME_KEY(id)).catch(() => {});
          updateRoutingState(id, { status: 'complete', progress: 100, speedBps: 0, etaSec: 0 });
        } else if (result && result.status !== 200) {
          await FileSystem.deleteAsync(ROUTING_REGIONS[id as RoutingRegionId].localPath, { idempotent: true }).catch(() => {});
          await storage.del(ROUTING_RESUME_KEY(id)).catch(() => {});
          updateRoutingState(id, { status: 'error', error: `Routing pack not available yet (${result.status})` });
        }
      } catch {
        await startRoutingDownload(id);
      }
    } else {
      await startRoutingDownload(id);
    }
  }, [startRoutingDownload, updateRoutingState]);

  const deleteRoutingDownload = useCallback(async (id: string) => {
    const region = ROUTING_REGIONS[id as RoutingRegionId];
    if (!region) return;
    routingDlRefs.current[id] = null;
    speedBuf.current[`route:${id}`] = [];
    prevSpeed.current[`route:${id}`] = 0;
    await FileSystem.deleteAsync(region.localPath, { idempotent: true }).catch(() => {});
    await storage.del(ROUTING_RESUME_KEY(id)).catch(() => {});
    updateRoutingState(id, EMPTY_ROUTING(id));
  }, [updateRoutingState]);

  const getState = useCallback((id: string): FileDownloadState =>
    states[id] ?? EMPTY('conus'), [states]);

  const isFileAvailable = useCallback((id: string): boolean =>
    states[id]?.status === 'complete', [states]);
  const getRoutingState = useCallback((id: string): FileDownloadState =>
    routingStates[id] ?? EMPTY_ROUTING(id), [routingStates]);
  const isRoutingAvailable = useCallback((id: string): boolean =>
    routingStates[id]?.status === 'complete', [routingStates]);

  // Returns the real file size in bytes (from manifest) or estimated fallback
  const getTotalBytes = useCallback((id: string): number => {
    if (manifestSizes[id]) return manifestSizes[id];
    const region = FILE_REGIONS[id as FileRegionId];
    return region ? region.estimatedGb * 1_073_741_824 : 0;
  }, [manifestSizes]);
  const getRoutingTotalBytes = useCallback((id: string): number => {
    if (routingManifestSizes[id]) return routingManifestSizes[id];
    if (ROUTING_PACK_BYTES[id]) return ROUTING_PACK_BYTES[id];
    const region = ROUTING_REGIONS[id as RoutingRegionId];
    return region ? region.estimatedGb * 1_073_741_824 : 0;
  }, [routingManifestSizes]);

  const isFilePublished = useCallback((id: string): boolean => {
    const region = FILE_REGIONS[id as FileRegionId] as any;
    if (!region) return false;
    return !region.comingSoon || Boolean(manifestSizes[id]);
  }, [manifestSizes]);

  const isRoutingPublished = useCallback((id: string): boolean => {
    const region = FILE_REGIONS[id as FileRegionId] as any;
    if (!region || id === 'conus') return false;
    return !region.comingSoon || Boolean(routingManifestSizes[id]);
  }, [routingManifestSizes]);

  return {
    startDownload, pauseDownload, resumeDownload, deleteDownload,
    startRoutingDownload, pauseRoutingDownload, resumeRoutingDownload, deleteRoutingDownload,
    getState, getRoutingState, isFileAvailable, isRoutingAvailable,
    isFilePublished, isRoutingPublished,
    getTotalBytes, getRoutingTotalBytes, states, routingStates,
  };
}
