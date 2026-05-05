/**
 * NativeMap — replaces the WebView-based map with @maplibre/maplibre-react-native.
 *
 * Benefits over WebView:
 *  - Native GPU rendering via Metal (iOS) / Vulkan (Android)
 *  - No WKWebView HTTP/2 connection cap (tiles load in true parallel)
 *  - Direct React prop interface — no postMessage bridge
 *  - Offline via MLN OfflineStorage (week 3)
 */
import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle,
  useMemo, useRef, useState,
} from 'react';
import { TouchableOpacity, View, StyleSheet, Text } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '@/lib/storage';

import { buildMapStyle, MapMode } from './mapStyle';
import { fetchRoute, buildFallbackRoute } from './routing';
import type { RouteResult, RouteStep, RouteOpts, MapBounds, WP } from './types';
import type { CampsitePin, Pin, Report } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';
import { CACHE_OFFLINE_DIR, OFFLINE_DIR, FILE_REGIONS } from '@/lib/useOfflineFiles';
import { saveRouteGeometry } from '@/lib/offlineRoutes';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';

// Lazy-load the tile server module — gracefully no-ops if the binary doesn't
// include it yet (e.g. first launch after OTA-only update).
type TileServerModule = typeof import('expo-tile-server');
let tileServer: TileServerModule | null = null;
let tileServerRequireError = '';
try { tileServer = require('expo-tile-server'); } catch (e: any) { tileServerRequireError = e?.message ?? 'require failed'; }

const TILE_BASE_URL = 'https://tiles.gettrailhead.app';
const BASE_DL_URL   = `${TILE_BASE_URL}/api/download/base.pmtiles`;
const GLOBAL_BASE_DL_URL = `${TILE_BASE_URL}/api/download/base-global.pmtiles`;
const BASE_PATH     = `${OFFLINE_DIR}base.pmtiles`;
const GLOBAL_BASE_PATH = `${OFFLINE_DIR}base-global.pmtiles`;
const BASE_MIN_MB   = 10; // skip base file if under 10 MB (truncated)
const CONUS_MIN_MB  = 1024; // a partial conus.pmtiles must not hide state packs
const LEGACY_OFFLINE_DIR = `${FileSystem.documentDirectory}offline/`;

// ── Types ─────────────────────────────────────────────────────────────────────
export type { WP, RouteOpts, MapBounds, RouteResult, RouteStep } from './types';

export interface NativeMapHandle {
  flyTo:          (lat: number, lng: number, zoom?: number, name?: string) => void;
  locate:         (lat: number, lng: number) => void;
  loadRouteFrom:  (lat: number, lng: number, fromIdx: number) => void;
  rerouteFrom:    (lat: number, lng: number, fromIdx: number) => void;
  routeToSearch:  (lat: number, lng: number, name: string, userLat: number, userLng: number) => void;
  resetRoute:     () => void;
  stopNavigation: () => void;
  restoreRoute:   (coords: [number,number][], steps: RouteStep[], legs: RouteStep[][], td: number, tt: number) => void;
  setNavTarget:   (idx: number) => void;
}

export interface NativeMapProps {
  // Data
  waypoints:     WP[];
  camps:         CampsitePin[];
  gas:           { lat: number; lng: number; name: string }[];
  pois:          { lat: number; lng: number; name: string; type: string }[];
  reports:       Report[];
  communityPins: Pin[];
  searchMarker:  { lat: number; lng: number; name: string } | null;

  // Nav state
  userLoc:     { lat: number; lng: number; accuracy?: number | null } | null;
  navMode:     boolean;
  navIdx:      number;
  navHeading:  number | null;
  navSpeed:    number | null;

  // Config
  mapLayer:  MapMode;
  routeOpts: RouteOpts;

  // Overlay visibility
  showLandOverlay: boolean;
  showUsgsOverlay: boolean;
  showTerrain:     boolean;
  showMvum:        boolean;
  showFire:        boolean;
  showAva:         boolean;
  showRadar:       boolean;

  // Callbacks → replaces onWebMessage
  onMapReady:       () => void;
  onBoundsChange:   (bounds: MapBounds) => void;
  onMapTap:         (lat?: number, lng?: number) => void;
  onMapLongPress:   (lat: number, lng: number) => void;
  onCampTap:        (camp: CampsitePin) => void;
  onGasTap?:        (station: { name: string; lat: number; lng: number }) => void;
  onPoiTap?:        (poi: { name: string; type: string; lat: number; lng: number }) => void;
  onCommunityPinTap?: (pin: Pin) => void;
  onTileCampTap:    (name: string, kind: string, lat: number, lng: number) => void;
  onBaseCampTap:    (name: string, lat: number, lng: number, landType: string) => void;
  onTrailTap:       (name: string, lat: number, lng: number) => void;
  onWaypointTap:    (idx: number, name: string) => void;
  onRouteReady:     (result: RouteResult & { fromIdx: number }) => void;
  onRoutePersist:   (data: { coords: [number,number][]; steps: RouteStep[]; legs: RouteStep[][]; totalDistance: number; totalDuration: number; tripId: string | null }) => void;
  onOffRoute?:      (lat: number, lng: number, distanceM: number) => void;
  onOffRouteWarn?:  (lat: number, lng: number, distanceM: number) => void;
  onBackOnRoute?:   () => void;
  onRouteProgress?: (progress: { distanceM: number; remainingM: number; routeDistanceM: number; deviationM: number; segmentIdx: number }) => void;
  onError?:         (msg: string) => void;
  children?:         React.ReactNode;
}

// ── Waypoint type → styles ────────────────────────────────────────────────────
const WP_COLORS: Record<string, string> = {
  start: '#22c55e', camp: '#14b8a6', fuel: '#eab308', motel: '#6366f1',
  shower: '#38bdf8', town: '#94a3b8', waypoint: '#a855f7',
};
const WP_ICON_NAMES: Record<string, keyof typeof Ionicons.glyphMap> = {
  fuel: 'flash-outline',
  camp: 'bonfire-outline',
  start: 'flag-outline',
  motel: 'bed-outline',
  shower: 'water-outline',
  town: 'business-outline',
  waypoint: 'navigate-outline',
};
const WP_LABELS: Record<string, string> = {
  fuel: 'Fuel', camp: 'Camp', start: 'Start', motel: 'Lodging',
  shower: 'Showers', town: 'Town', waypoint: 'Waypoint',
};
const POI_CODES: Record<string, string> = {
  water: 'W',
  trailhead: 'T',
  viewpoint: 'V',
  peak: 'P',
  hot_spring: 'H',
  fuel: 'G',
  propane: 'P',
  dump: 'D',
  shower: 'S',
  laundromat: 'L',
  lodging: 'M',
  food: 'F',
  grocery: 'G',
  mechanic: 'R',
  parking: 'P',
  attraction: 'A',
};
const POI_ICON_NAMES: Record<string, keyof typeof Ionicons.glyphMap> = {
  water: 'water-outline',
  trailhead: 'trail-sign-outline',
  viewpoint: 'flag-outline',
  peak: 'triangle-outline',
  hot_spring: 'flame-outline',
  fuel: 'flash-outline',
  propane: 'flame-outline',
  dump: 'trash-bin-outline',
  shower: 'rainy-outline',
  laundromat: 'shirt-outline',
  lodging: 'bed-outline',
  food: 'restaurant-outline',
  grocery: 'cart-outline',
  mechanic: 'construct-outline',
  parking: 'car-outline',
  attraction: 'camera-outline',
};

const COMMUNITY_PIN_VISUALS: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  camp: { color: '#16a34a', icon: 'bonfire-outline' },
  informal_camp: { color: '#65a30d', icon: 'business-outline' },
  wild_camp: { color: '#15803d', icon: 'moon-outline' },
  fuel: { color: '#ea580c', icon: 'flash-outline' },
  propane: { color: '#f97316', icon: 'flame-outline' },
  water: { color: '#0284c7', icon: 'water-outline' },
  dump: { color: '#a16207', icon: 'trash-bin-outline' },
  parking: { color: '#d97706', icon: 'car-outline' },
  mechanic: { color: '#f97316', icon: 'construct-outline' },
  restaurant: { color: '#06b6d4', icon: 'restaurant-outline' },
  attraction: { color: '#0ea5e9', icon: 'camera-outline' },
  shopping: { color: '#06b6d4', icon: 'cart-outline' },
  medical: { color: '#06b6d4', icon: 'medical-outline' },
  pet: { color: '#06b6d4', icon: 'paw-outline' },
  laundromat: { color: '#06b6d4', icon: 'shirt-outline' },
  shower: { color: '#06b6d4', icon: 'rainy-outline' },
  wifi: { color: '#06b6d4', icon: 'wifi-outline' },
  trailhead: { color: '#22c55e', icon: 'trail-sign-outline' },
  trail_note: { color: '#16a34a', icon: 'walk-outline' },
  overlook: { color: '#0ea5e9', icon: 'flag-outline' },
  crossing: { color: '#0284c7', icon: 'git-merge-outline' },
  gate: { color: '#d97706', icon: 'lock-closed-outline' },
  trail_closure: { color: '#dc2626', icon: 'remove-circle-outline' },
  rock_art: { color: '#a855f7', icon: 'scan-outline' },
  cell_signal: { color: '#2563eb', icon: 'cellular-outline' },
  trash: { color: '#64748b', icon: 'trash-outline' },
  wildlife: { color: '#7c3aed', icon: 'paw-outline' },
  checkpoint: { color: '#dc2626', icon: 'hand-left-outline' },
  road_report: { color: '#dc2626', icon: 'trail-sign-outline' },
  warning: { color: '#ef4444', icon: 'warning-outline' },
  gpx_import: { color: '#64748b', icon: 'cloud-upload-outline' },
  other: { color: '#38bdf8', icon: 'star-outline' },
};

function communityPinVisual(type?: string) {
  return COMMUNITY_PIN_VISUALS[(type || '').toLowerCase()] ?? COMMUNITY_PIN_VISUALS.other;
}

// ── Helper: coords → GeoJSON ──────────────────────────────────────────────────
function lineFC(coords: [number,number][]) {
  return { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties: {} };
}
function pointFC(features: GeoJSON.Feature[]) {
  return { type: 'FeatureCollection' as const, features };
}
function campFeat(c: CampsitePin): GeoJSON.Feature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    properties: { id: c.id || '', name: c.name || '', land_type: c.land_type || 'Campground', cost: c.cost || '', full: (c as any).full || 0, raw: JSON.stringify(c) } };
}

function coordDistanceM(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

function routeCumulativeDistances(coords: [number, number][]): number[] {
  const out = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + coordDistanceM(coords[i - 1], coords[i]);
  return out;
}

function projectPointToRoute(
  point: [number, number],
  coords: [number, number][],
  cumulative: number[],
  fromSegment: number,
  toSegment: number,
) {
  if (coords.length < 2) return null;
  const latScale = 110_540;
  const lngScale = 111_320 * Math.cos(point[1] * Math.PI / 180);
  const px = point[0] * lngScale;
  const py = point[1] * latScale;
  let best: {
    segmentIdx: number;
    t: number;
    distanceM: number;
    projected: [number, number];
    progressM: number;
  } | null = null;

  const start = Math.max(0, Math.min(fromSegment, coords.length - 2));
  const end = Math.max(start, Math.min(toSegment, coords.length - 2));
  for (let i = start; i <= end; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const ax = a[0] * lngScale;
    const ay = a[1] * latScale;
    const bx = b[0] * lngScale;
    const by = b[1] * latScale;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    if (len2 <= 0.01) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
    const qx = ax + vx * t;
    const qy = ay + vy * t;
    const dx = px - qx;
    const dy = py - qy;
    const distanceM = Math.sqrt(dx * dx + dy * dy);
    if (!best || distanceM < best.distanceM) {
      const projected: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const segLen = cumulative[i + 1] - cumulative[i];
      best = { segmentIdx: i, t, distanceM, projected, progressM: cumulative[i] + segLen * t };
    }
    if (distanceM < 8) break;
  }
  return best;
}

function pressPayload(event: any): any {
  return event?.nativeEvent?.payload ?? event?.payload ?? event;
}

function eventLngLat(event: any): [number, number] | null {
  const payload = pressPayload(event);
  const coords =
    payload?.geometry?.type === 'Point' && Array.isArray(payload.geometry.coordinates) ? payload.geometry.coordinates :
    payload?.features?.[0]?.geometry?.type === 'Point' && Array.isArray(payload.features[0].geometry.coordinates) ? payload.features[0].geometry.coordinates :
    Array.isArray(payload?.coordinates) ? payload.coordinates :
    Array.isArray(payload?.coordinate) ? payload.coordinate :
    Array.isArray(payload?.nativeEvent?.coordinates) ? payload.nativeEvent.coordinates :
    Array.isArray(payload?.nativeEvent?.coordinate) ? payload.nativeEvent.coordinate :
    null;
  if (!coords) return null;
  const [lng, lat] = coords.map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function eventScreenPoint(event: any): [number, number] | null {
  const payload = pressPayload(event);
  const props = payload?.properties ?? {};
  const x = Number(props.screenPointX ?? payload?.screenPointX ?? payload?.x);
  const y = Number(props.screenPointY ?? payload?.screenPointY ?? payload?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

async function firstExistingPath(paths: string[]): Promise<{ path: string; sizeMb: number } | null> {
  for (const path of paths) {
    const info = await FileSystem.getInfoAsync(path).catch(() => null);
    if (!info?.exists) continue;
    const sizeMb = Math.round(((info as any).size ?? 0) / 1_048_576);
    return { path, sizeMb };
  }
  return null;
}

async function hasPublishedGlobalBase(): Promise<boolean> {
  try {
    const res = await fetch(`${TILE_BASE_URL}/api/download/manifest.json`);
    if (!res.ok) return false;
    const manifest = await res.json();
    return Boolean(manifest?.['base-global.pmtiles']?.size);
  } catch {
    return false;
  }
}

function offlinePathCandidates(id: string, currentPath: string): string[] {
  const fileName = id === 'conus' ? 'conus.pmtiles' : `${id}.pmtiles`;
  return [currentPath, `${LEGACY_OFFLINE_DIR}${fileName}`, `${CACHE_OFFLINE_DIR}${fileName}`];
}

async function probeTileCdn(timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch('https://tiles.gettrailhead.app/api/download/manifest.json', {
      method: 'HEAD',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(tid);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Main component ────────────────────────────────────────────────────────────
const NativeMap = forwardRef<NativeMapHandle, NativeMapProps>((props, ref) => {
  const {
    waypoints, camps, gas, pois, reports, communityPins, searchMarker,
    userLoc, navMode, navIdx, navHeading, navSpeed,
    mapLayer, routeOpts,
    showLandOverlay, showUsgsOverlay, showFire, showAva, showRadar, showMvum,
    onMapReady, onBoundsChange, onMapTap, onMapLongPress,
    onCampTap, onGasTap, onPoiTap, onCommunityPinTap, onTileCampTap, onBaseCampTap, onTrailTap, onWaypointTap,
    onRouteReady, onRoutePersist, onOffRoute, onOffRouteWarn, onBackOnRoute, onRouteProgress,
  } = props;

  const mapRef = useRef<MapLibreGL.MapViewRef>(null);
  const camRef = useRef<MapLibreGL.CameraRef>(null);

  // ── Overlay data ──────────────────────────────────────────────────────────────
  const [fireData,   setFireData]   = useState<GeoJSON.FeatureCollection | null>(null);
  const [avaData,    setAvaData]    = useState<GeoJSON.FeatureCollection | null>(null);
  const [radarUrl,   setRadarUrl]   = useState<string | null>(null);
  const [mvumRoads,  setMvumRoads]  = useState<GeoJSON.FeatureCollection | null>(null);
  const [mvumTrails, setMvumTrails] = useState<GeoJSON.FeatureCollection | null>(null);
  const boundsRef = useRef<{ n: number; s: number; e: number; w: number } | null>(null);

  // MVUM uses viewport-dependent queries — refetch when layer toggled or bounds change
  const fetchMvum = useCallback(async (bounds: { n: number; s: number; e: number; w: number }) => {
    const envelope = JSON.stringify({
      xmin: bounds.w, ymin: bounds.s, xmax: bounds.e, ymax: bounds.n,
      spatialReference: { wkid: 4326 },
    });
    const base = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/';
    const params = `where=1%3D1&geometry=${encodeURIComponent(envelope)}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&returnGeometry=true&f=geojson&resultRecordCount=1000`;
    try {
      const [roads, trails] = await Promise.all([
        fetch(`${base}1/query?${params}&outFields=name,symbol,mvum_symbol_name,passengervehicle,highclearancevehicle,seasonal,forestname`).then(r => r.json()),
        fetch(`${base}2/query?${params}&outFields=name,symbol,mvum_symbol_name,passengervehicle,highclearancevehicle,seasonal,forestname,trailstatus`).then(r => r.json()),
      ]);
      if (roads.features) setMvumRoads(roads);
      if (trails.features) setMvumTrails(trails);
    } catch {}
  }, []);

  useEffect(() => {
    if (!showMvum) { setMvumRoads(null); setMvumTrails(null); return; }
    // Use stored bounds, or fall back to waypoint bounding box
    const b = boundsRef.current ?? (waypoints.length > 0 ? {
      n: Math.max(...waypoints.map(w => w.lat)) + 0.5,
      s: Math.min(...waypoints.map(w => w.lat)) - 0.5,
      e: Math.max(...waypoints.map(w => w.lng)) + 0.5,
      w: Math.min(...waypoints.map(w => w.lng)) - 0.5,
    } : null);
    if (b) fetchMvum(b);
  }, [showMvum, fetchMvum, waypoints]);

  useEffect(() => {
    if (!showFire) { setFireData(null); return; }
    const url = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query'
      + '?where=1%3D1'
      + '&outFields=poly_IncidentName,poly_GISAcres,attr_IncidentSize,attr_PercentContained'
      + '&returnGeometry=true&f=geojson&resultRecordCount=500';
    fetch(url)
      .then(r => r.json())
      .then(d => setFireData(d?.features ? d : null))
      .catch(() => setFireData(null));
  }, [showFire]);

  useEffect(() => {
    if (!showAva) { setAvaData(null); return; }
    fetch('https://api.avalanche.org/v2/public/products/map-layer')
      .then(r => r.json()).then(setAvaData).catch(() => {});
  }, [showAva]);

  useEffect(() => {
    if (!showRadar) { setRadarUrl(null); return; }
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(d => {
        const frames = d?.radar?.past ?? [];
        if (frames.length > 0) {
          const frame = frames[frames.length - 1];
          const host = d?.host || 'https://tilecache.rainviewer.com';
          setRadarUrl(`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`);
        }
      }).catch(() => setRadarUrl(null));
  }, [showRadar]);

  // Compute initial camera position ONCE (lazy useState with no deps).
  // Passing these as controlled Camera props that never change means:
  //   1. Camera starts at the right position immediately (no ref timing issue)
  //   2. User can freely pan/zoom after — props don't change so no snap-back
  const [initialCenter] = useState<[number, number]>(() =>
    waypoints[0] ? [waypoints[0].lng, waypoints[0].lat] : [-98.5, 39.5]
  );
  const [initialZoom] = useState<number>(() => waypoints.length > 1 ? 7 : 10);
  const mapboxToken = useStore(s => s.mapboxToken);
  const activeTrip  = useStore(s => s.activeTrip);
  const C = useTheme();
  const [localTiles,   setLocalTiles]   = useState(false);
  const [tileDebug,    setTileDebug]    = useState('Checking maps');
  const [tileSession,  setTileSession]  = useState(() => Date.now());
  const onlineTilesRef  = useRef(true);                // true = prefer live CDN tiles
  const loadedStateRef  = useRef<string | null>(null); // path of currently-active offline region file
  const switchingRef    = useRef(false);               // prevent concurrent region switches
  const isRoutingRef    = useRef(false);               // route fetch in progress — block CDN fallback
  const offRouteStreakRef = useRef(0);
  const offRouteWarnAtRef = useRef(0);
  const wasOffRouteRef = useRef(false);
  const lastFlyToRef    = useRef(0);                   // timestamp of last flyTo — debounce CDN fallback
  const lastCamRef      = useRef(0);                   // timestamp of last nav setCamera — prevent animation overlap
  const routeRequestRef = useRef(0);                   // cancels stale async route results

  // Returns all downloaded region files with their bounds, or null for CONUS.
  // Skips files under 25% of estimated size (obviously truncated downloads).
  const getDownloadedFiles = useCallback(async () => {
    const conusPath = await firstExistingPath(offlinePathCandidates('conus', `${OFFLINE_DIR}conus.pmtiles`));
    if (conusPath && conusPath.sizeMb >= CONUS_MIN_MB) return null;

    const result: Array<{ id: string; path: string; sizeMb: number; bounds: typeof FILE_REGIONS[keyof typeof FILE_REGIONS]['bounds'] }> = [];
    for (const [id, region] of Object.entries(FILE_REGIONS)) {
      if (id === 'conus') continue;
      const found = await firstExistingPath(offlinePathCandidates(id, region.localPath));
      if (!found) continue;
      const minMb  = (region.estimatedGb * 1024) * 0.25;
      if (found.sizeMb < minMb) continue;
      result.push({ id, path: found.path, sizeMb: found.sizeMb, bounds: region.bounds });
    }
    return result;
  }, []);

  // Switch the active region file. Idempotent — no-ops if already the active file.
  const switchFile = useCallback(async (path: string, sizeMb: number) => {
    if (loadedStateRef.current === path || switchingRef.current) return;
    if (!tileServer?.switchState) { setTileDebug('switch unavailable'); return; }
    switchingRef.current = true;
    const nativePath = path.replace(/^file:\/\//, '');
    const fileName = path.split('/').pop() ?? 'pmtiles';
    setTileDebug(`Loading ${stateDisplayName(fileName)} maps`);
    try {
      await tileServer!.switchState(nativePath);
      loadedStateRef.current = path;
      setLocalTiles(true);
      setTileSession(Date.now());
      setTimeout(async () => {
        try {
          const health = await fetch('http://127.0.0.1:57832/health');
          if (!health.ok) {
            setTileDebug(`${stateDisplayName(fileName)} maps ready`);
            return;
          }
          await fetch('http://127.0.0.1:57832/api/tiles/12/928/1572.pbf').catch(() => null);
          setTileDebug(`${stateDisplayName(fileName)} maps ready`);
        } catch (e: any) {
          setTileDebug(`${stateDisplayName(fileName)} maps loaded`);
        }
      }, 600);
    } catch (e: any) {
      setTileDebug(`${stateDisplayName(fileName)} maps unavailable`);
    } finally {
      switchingRef.current = false;
    }
  }, []);

  const ensureRouteTileFile = useCallback(async (pairs: string[]) => {
    if (!tileServer?.switchState || pairs.length < 2) return;
    const parsed = pairs
      .map(pair => {
        const [lng, lat] = pair.split(',').map(Number);
        return Number.isFinite(lng) && Number.isFinite(lat) ? { lat, lng } : null;
      })
      .filter(Boolean) as Array<{ lat: number; lng: number }>;
    if (parsed.length < 2) return;

    const files = await getDownloadedFiles();
    if (!files) {
      const found = await firstExistingPath(offlinePathCandidates('conus', `${OFFLINE_DIR}conus.pmtiles`));
      if (found) await switchFile(found.path, found.sizeMb);
      return;
    }

    const start = parsed[0];
    const dest = parsed[parsed.length - 1];
    const covers = (bounds: { n: number; s: number; e: number; w: number }, p: { lat: number; lng: number }) =>
      p.lat >= bounds.s && p.lat <= bounds.n && p.lng >= bounds.w && p.lng <= bounds.e;

    // For tap-anywhere nav, the destination region is the file most likely to
    // contain the visible road graph. If both endpoints are in one downloaded
    // region, prefer that. Otherwise use the destination file instead of a stale
    // GPS/viewport-selected file.
    const both = files.find(f => covers(f.bounds, start) && covers(f.bounds, dest));
    const destMatch = files.find(f => covers(f.bounds, dest));
    const startMatch = files.find(f => covers(f.bounds, start));
    const chosen = both ?? destMatch ?? startMatch;
    if (chosen) await switchFile(chosen.path, chosen.sizeMb);
  }, [getDownloadedFiles, switchFile]);

  // Start server, load base file, then load best offline region file.
  useEffect(() => {
    if (!tileServer) { setTileDebug(`no module: ${tileServerRequireError}`); return; }

    (async () => {
      // 1. Start the HTTP server socket (no-op if already running)
      try {
        await tileServer!.startServer();
      } catch (e: any) {
        setTileDebug(`srv err: ${e?.message ?? '?'}`); return;
      }
      // localTiles stays false until a region file is loaded — keeps online CDN mode working

      // 2. Load low-zoom base if available. Prefer future global base, but keep
      // the current U.S. base as a stable fallback until that file exists on R2.
      await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true }).catch(() => {});
      const globalBaseInfo = await FileSystem.getInfoAsync(GLOBAL_BASE_PATH).catch(() => null);
      const globalBaseMb = Math.round(((globalBaseInfo as any)?.size ?? 0) / 1_048_576);
      const conusBaseInfo = await FileSystem.getInfoAsync(BASE_PATH).catch(() => null);
      const conusBaseMb = Math.round(((conusBaseInfo as any)?.size ?? 0) / 1_048_576);
      const activeBase = globalBaseInfo?.exists && globalBaseMb >= BASE_MIN_MB
        ? { path: GLOBAL_BASE_PATH, sizeMb: globalBaseMb, label: 'global base' }
        : conusBaseInfo?.exists && conusBaseMb >= BASE_MIN_MB
          ? { path: BASE_PATH, sizeMb: conusBaseMb, label: 'base' }
          : null;
      if (activeBase) {
        try {
          const ts = tileServer as any;
          if (typeof ts.setBase === 'function') await ts.setBase(activeBase.path.replace(/^file:\/\//, ''));
          setTileDebug(`${activeBase.label} ${activeBase.sizeMb}MB`);
        } catch {}
      }

      const globalBasePublished = await hasPublishedGlobalBase();
      const shouldDownloadGlobalBase = globalBasePublished && !(globalBaseInfo?.exists && globalBaseMb >= BASE_MIN_MB);
      const shouldDownloadConusBase = !globalBasePublished && !conusBaseInfo?.exists;
      if (shouldDownloadGlobalBase || shouldDownloadConusBase) {
        const targetPath = shouldDownloadGlobalBase ? GLOBAL_BASE_PATH : BASE_PATH;
        const targetUrl = shouldDownloadGlobalBase ? GLOBAL_BASE_DL_URL : BASE_DL_URL;
        FileSystem.createDownloadResumable(targetUrl, targetPath)
          .downloadAsync()
          .then(async res => {
            if (res?.status === 200) {
              try {
                const ts = tileServer as any;
                if (typeof ts.setBase === 'function') await ts.setBase(targetPath.replace(/^file:\/\//, ''));
              } catch {}
            } else {
              await FileSystem.deleteAsync(targetPath, { idempotent: true }).catch(() => {});
            }
          })
          .catch(() => {});
      }

      // 3. Prefer live CDN tiles when online. Downloaded packs are a fallback
      // for no-service use, not a replacement for richer live map coverage.
      const online = await probeTileCdn();
      onlineTilesRef.current = online;
      if (online) {
        setLocalTiles(false);
        setTileDebug('Online maps');
        return;
      }

      // 4. Offline: load best region file (GPS-matched, or first available)
      const files = await getDownloadedFiles();
      if (!files) {
        const found = await firstExistingPath(offlinePathCandidates('conus', `${OFFLINE_DIR}conus.pmtiles`));
        if (found) await switchFile(found.path, found.sizeMb);
        return;
      }
      if (files.length === 0) {
        const partialConus = await firstExistingPath(offlinePathCandidates('conus', `${OFFLINE_DIR}conus.pmtiles`));
        setTileDebug(partialConus ? 'Saved maps not ready' : 'No saved maps');
        return;
      }

      let best = files[0];
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          const match = files.find(({ bounds: b }) =>
            pos.coords.latitude  >= b.s && pos.coords.latitude  <= b.n &&
            pos.coords.longitude >= b.w && pos.coords.longitude <= b.e
          );
          if (match) best = match;
        }
      } catch {}
      setTileDebug(`${files.length} region map${files.length === 1 ? '' : 's'} saved`);
      await switchFile(best.path, best.sizeMb);
    })();

    return () => { tileServer?.stopServer().catch(() => {}); };
  }, [getDownloadedFiles, switchFile]);

  // Route state
  const [routeCoords,  setRouteCoords]  = useState<[number,number][]>([]);
  const [passedCoords, setPassedCoords] = useState<[number,number][]>([]);
  const [breadcrumb,   setBreadcrumb]   = useState<[number,number][]>([]);
  const [navTargetIdx, setNavTargetIdx] = useState(-1);
  const [searchDest,   setSearchDest]   = useState<{ lat: number; lng: number } | null>(null);
  const waypointSignature = useMemo(
    () => waypoints.map(w => `${w.lng.toFixed(5)},${w.lat.toFixed(5)}:${w.type}:${w.day}`).join('|'),
    [waypoints],
  );

  // Route tracking ref
  const makeRouteState = useCallback((coords: [number, number][]) => ({
    coords,
    cumulative: routeCumulativeDistances(coords),
    passedIdx: 0,
    passedProgressM: 0,
  }), []);
  const routeRef = useRef(makeRouteState([]));

  // MLRN v10 uses `mapStyle` — accepts string (style URL) or object (inline JSON).
  const mapStyleObj = useMemo(
    () => buildMapStyle(mapLayer, mapboxToken || '', localTiles, tileSession),
    [mapLayer, mapboxToken, localTiles, tileSession],
  );

  // ── Imperative API (replaces postMessage) ───────────────────────────────────
  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom = 14) {
      lastFlyToRef.current = Date.now();
      camRef.current?.setCamera({ centerCoordinate: [lng, lat], zoomLevel: zoom, animationDuration: 600, animationMode: 'flyTo' });
    },
    locate(lat, lng) {
      lastFlyToRef.current = Date.now();
      camRef.current?.setCamera({ centerCoordinate: [lng, lat], zoomLevel: 13, animationDuration: 500, animationMode: 'flyTo' });
    },
    loadRouteFrom(lat, lng, fromIdx) {
      const rem = waypoints.slice(fromIdx);
      const pairs = [`${lng},${lat}`, ...rem.map(w => `${w.lng},${w.lat}`)];
      doFetchRoute(pairs, fromIdx);
    },
    rerouteFrom(lat, lng, fromIdx) {
      setPassedCoords([]);
      routeRef.current.passedIdx = 0;
      routeRef.current.passedProgressM = 0;
      const rem = waypoints.slice(fromIdx);
      const pairs = rem.length
        ? [`${lng},${lat}`, ...rem.map(w => `${w.lng},${w.lat}`)]
        : searchDest ? [`${lng},${lat}`, `${searchDest.lng},${searchDest.lat}`] : [];
      if (pairs.length >= 2) doFetchRoute(pairs, fromIdx);
    },
    routeToSearch(lat, lng, name, userLat, userLng) {
      setSearchDest({ lat, lng });
      doFetchRoute([`${userLng},${userLat}`, `${lng},${lat}`], 0);
    },
    resetRoute() {
      routeRequestRef.current++;
      isRoutingRef.current = false;
      setRouteCoords([]); setPassedCoords([]); setBreadcrumb([]);
      routeRef.current = makeRouteState([]);
      setSearchDest(null); setNavTargetIdx(-1);
    },
    stopNavigation() {
      setPassedCoords([]);
      setBreadcrumb([]);
      setNavTargetIdx(-1);
      routeRef.current.passedIdx = 0;
      routeRef.current.passedProgressM = 0;
      offRouteStreakRef.current = 0;
      wasOffRouteRef.current = false;
    },
    restoreRoute(coords, steps, legs, td, tt) {
      setRouteCoords(coords);
      routeRef.current = makeRouteState(coords);
      onRouteReady({ coords, steps, legs, totalDistance: td, totalDuration: tt, isProper: true, fromCache: true, fromIdx: 0 });
    },
    setNavTarget(idx) { setNavTargetIdx(idx); },
  }), [waypoints, searchDest, mapboxToken, makeRouteState]);

  // ── Routing ─────────────────────────────────────────────────────────────────
  const doFetchRoute = useCallback(async (pairs: string[], fromIdx: number) => {
    const requestId = ++routeRequestRef.current;
    isRoutingRef.current = true;
    try {
      const online = await probeTileCdn();
      onlineTilesRef.current = online;
      if (online) {
        setLocalTiles(false);
        setTileDebug('Online maps');
      } else {
        await ensureRouteTileFile(pairs);
      }
      if (requestId !== routeRequestRef.current) return;
      const result = await fetchRoute(pairs, fromIdx, mapboxToken || '', routeOpts);
      if (requestId !== routeRequestRef.current) return;
      setRouteCoords(result.coords);
      routeRef.current = makeRouteState(result.coords);
      onRouteReady({ ...result, fromIdx });
      // Persist for offline relaunch
      onRoutePersist({
        coords: result.coords, steps: result.steps, legs: result.legs,
        totalDistance: result.totalDistance, totalDuration: result.totalDuration,
        tripId: activeTrip?.trip_id ?? null,
      });
      const routePayload = {
        coords: result.coords, steps: result.steps, legs: result.legs,
        totalDistance: result.totalDistance, totalDuration: result.totalDuration,
        tripId: activeTrip?.trip_id ?? null, ts: Date.now(),
      };
      storage.set('trailhead_active_route', JSON.stringify(routePayload)).catch(() => {});
      saveRouteGeometry(activeTrip?.trip_id, routePayload).catch(() => {});
    } catch {
      if (requestId !== routeRequestRef.current) return;
      const fb = buildFallbackRoute(pairs);
      setRouteCoords(fb.coords);
      routeRef.current = makeRouteState(fb.coords);
      onRouteReady({ ...fb, fromIdx });
    } finally {
      if (requestId === routeRequestRef.current) isRoutingRef.current = false;
    }
  }, [mapboxToken, routeOpts, waypoints, activeTrip, onRouteReady, onRoutePersist, ensureRouteTileFile, makeRouteState]);

  // When a new trip is planned: auto-route + fit camera to show all waypoints
  useEffect(() => {
    if (waypoints.length < 2) return;
    routeRequestRef.current++;
    isRoutingRef.current = false;
    setRouteCoords([]);
    setPassedCoords([]);
    setBreadcrumb([]);
    routeRef.current = makeRouteState([]);
    doFetchRoute(waypoints.map(w => `${w.lng},${w.lat}`), 0);
    // Fit camera to the trip bounding box (skip if actively navigating)
    if (!navMode) {
      const lngs = waypoints.map(w => w.lng);
      const lats = waypoints.map(w => w.lat);
      const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
      const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
      // Small delay lets the map finish loading the tile layer first
      setTimeout(() => {
        camRef.current?.fitBounds(ne, sw, [80, 50, 120, 50], 900);
      }, 400);
    }
  }, [waypointSignature]);

  // ── Nav: camera follow (independent of route) ───────────────────────────────
  // GPS can fire every ~180ms at highway speed. Calling setCamera with an 800ms
  // animation on every tick keeps MLN in permanent animation on iOS, which holds
  // a native touch-intercept lock and makes every button on screen unresponsive.
  // Gate so we only call setCamera once per animation cycle.
  useEffect(() => {
    if (!navMode || !userLoc) return;
    const now = Date.now();
    const { lat, lng } = userLoc;
    const speed = navSpeed ?? 0;
    const animDuration = speed > 2.2 ? 800 : 350;
    if (now - lastCamRef.current < animDuration - 80) return;
    lastCamRef.current = now;
    const hasHeading = speed > 2.2 && navHeading !== null && navHeading >= 0;
    camRef.current?.setCamera({
      centerCoordinate: [lng, lat],
      zoomLevel: speed > 20 ? 15.5 : speed > 9 ? 16.2 : 17,
      ...(hasHeading ? { heading: navHeading, pitch: 45 } : {}),
      animationDuration: animDuration,
      animationMode: 'easeTo',
    });
  }, [userLoc, navMode, navHeading, navSpeed]);

  // ── Nav: track user on route + update passed overlay ────────────────────────
  useEffect(() => {
    if (!navMode || !userLoc || routeRef.current.coords.length === 0) return;
    const { lat, lng } = userLoc;
    const state = routeRef.current;
    const coords = state.coords;
    if (coords.length < 2) return;

    const searchStart = Math.max(0, state.passedIdx - 8);
    const searchEnd = Math.min(coords.length - 2, state.passedIdx + 180);
    const snap = projectPointToRoute([lng, lat], coords, state.cumulative, searchStart, searchEnd);
    if (!snap) return;

    const speed = navSpeed ?? 0;
    const accuracy = Math.max(0, Math.min(userLoc.accuracy ?? 25, 120));
    const routeDistanceM = state.cumulative[state.cumulative.length - 1] ?? 0;
    const remainingM = Math.max(0, routeDistanceM - snap.progressM);
    onRouteProgress?.({
      distanceM: snap.progressM,
      remainingM,
      routeDistanceM,
      deviationM: snap.distanceM,
      segmentIdx: snap.segmentIdx,
    });

    if (snap.progressM + 5 >= state.passedProgressM) {
      state.passedIdx = Math.max(state.passedIdx, snap.segmentIdx);
      state.passedProgressM = Math.max(state.passedProgressM, snap.progressM);
      setPassedCoords([...coords.slice(0, snap.segmentIdx + 1), snap.projected]);
    }

    const warnThreshold = Math.max(65, accuracy * 1.5 + 25);
    const rerouteThreshold = Math.max(120, accuracy * 2 + 55);
    const allowReroute = speed > 1.2 || snap.distanceM > rerouteThreshold + 70;
    if (snap.distanceM > rerouteThreshold && allowReroute) {
      offRouteStreakRef.current += 1;
      wasOffRouteRef.current = true;
      if (offRouteStreakRef.current >= 2) {
        onOffRoute?.(lat, lng, Math.round(snap.distanceM));
      } else {
        onOffRouteWarn?.(lat, lng, Math.round(snap.distanceM));
      }
    } else if (snap.distanceM > warnThreshold) {
      offRouteStreakRef.current = 0;
      wasOffRouteRef.current = true;
      const now = Date.now();
      if (now - offRouteWarnAtRef.current > 8000) {
        offRouteWarnAtRef.current = now;
        onOffRouteWarn?.(lat, lng, Math.round(snap.distanceM));
      }
    } else if (wasOffRouteRef.current) {
      offRouteStreakRef.current = 0;
      wasOffRouteRef.current = false;
      onBackOnRoute?.();
    }
    setBreadcrumb(prev => [...prev, [lng, lat]]);
  }, [userLoc, navMode, navSpeed, onOffRoute, onOffRouteWarn, onBackOnRoute, onRouteProgress]);

  // ── GeoJSON sources ─────────────────────────────────────────────────────────
  const campFC = useMemo(() => pointFC(camps.map(campFeat)), [camps]);
  const gasFC  = useMemo(() => pointFC(gas.map(g => ({
    type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [g.lng, g.lat] },
    properties: { name: g.name },
  }))), [gas]);
  const poiFC = useMemo(() => pointFC(pois.map(p => ({
    type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    properties: { name: p.name, type: p.type },
  }))), [pois]);

  // ── Map event handlers ───────────────────────────────────────────────────────
  const handleMapReady = useCallback(() => {
    onMapReady();
  }, [onMapReady]);

  const coordinateFromPress = useCallback(async (event: any): Promise<[number, number] | null> => {
    const lngLat = eventLngLat(event);
    if (lngLat) return lngLat;

    const point = eventScreenPoint(event);
    if (!point || !mapRef.current) return null;
    try {
      const coord = await mapRef.current.getCoordinateFromView(point);
      const [lng, lat] = coord.map(Number);
      return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
    } catch {
      return null;
    }
  }, []);

  const handlePress = useCallback(async (feat: any) => {
    // Check if a PMTiles camp POI was tapped by querying rendered features at the press point
    const lngLat = await coordinateFromPress(feat);
    if (lngLat && mapRef.current) {
      const [lng, lat] = lngLat;
      try {
        const point = eventScreenPoint(feat);
        const rendered = await mapRef.current.queryRenderedFeaturesAtPoint(
          point ?? await mapRef.current.getPointInView([lng, lat]),
          undefined,
          ['pm-pois-camp-site', 'pm-pois-camp-pitch', 'pm-pois-shelter', 'pm-pois-trailhead']
        );
        const renderedFeatures = Array.isArray(rendered) ? rendered : rendered?.features;
        const tileFeat = renderedFeatures?.[0];
        if (tileFeat?.properties) {
          const kind = tileFeat.properties.kind ?? 'camp_site';
          const name = tileFeat.properties.name ?? kindLabel(kind);
          const coords = tileFeat.geometry?.type === 'Point'
            ? (tileFeat.geometry as GeoJSON.Point).coordinates
            : [lng, lat];
          if (kind === 'trailhead') {
            onTrailTap(name, coords[1] ?? lat, coords[0] ?? lng);
            return;
          }
          onTileCampTap(name, kind, coords[1] ?? lat, coords[0] ?? lng);
          return;
        }
      } catch { /* queryRenderedFeatures may not be supported — fall through */ }
      onMapTap(lat, lng);
    } else {
      onMapTap();
    }
  }, [coordinateFromPress, onMapTap, onTileCampTap]);

  const handleLongPress = useCallback(async (feat: any) => {
    const lngLat = await coordinateFromPress(feat);
    if (!lngLat) return;
    const [lng, lat] = lngLat;
    onMapLongPress(lat, lng);
  }, [coordinateFromPress, onMapLongPress]);

  const handleRegionChange = useCallback(async (feat: GeoJSON.Feature | undefined) => {
    if (!feat?.properties || !mapRef.current) return;
    const { zoomLevel } = feat.properties;
    const bounds = await mapRef.current.getVisibleBounds();
    if (!bounds) return;
    const [[e, n], [w, s]] = bounds;
    boundsRef.current = { n, s, e, w };
    onBoundsChange({ n, s, e, w, zoom: zoomLevel || 10 });
    if (showMvum) fetchMvum({ n, s, e, w });

    // Auto-switch region file as map pans only when the live CDN is unreachable.
    // While online, always keep live tiles active even if a downloaded region covers
    // the viewport; otherwise downloaded packs hide online detail outside the pack.
    if (tileServer) {
      const centerLat = (n + s) / 2;
      const centerLng = (e + w) / 2;
      (async () => {
        const online = await probeTileCdn();
        onlineTilesRef.current = online;
        if (online) {
          if (localTiles) setLocalTiles(false);
          setTileDebug('Online maps');
          return;
        }
        const files = await getDownloadedFiles();
        if (!files) {
          const found = await firstExistingPath(offlinePathCandidates('conus', `${OFFLINE_DIR}conus.pmtiles`));
          if (found) await switchFile(found.path, found.sizeMb);
          return;
        }
        const match = files.find(({ bounds: b }) =>
          centerLat >= b.s && centerLat <= b.n &&
          centerLng >= b.w && centerLng <= b.e
        );
        if (match) {
          if (loadedStateRef.current === match.path) {
            setTileDebug(`${stateName(match.id)} maps ready`);
          }
          switchFile(match.path, match.sizeMb);
        } else if (localTiles) {
          // Stay on local tiles while offline testing. Falling back to CDN here
          // produces a blank/error map in no-service conditions.
          setTileDebug('Outside saved maps');
        }
      })();
    }
  }, [onBoundsChange, showMvum, fetchMvum, localTiles, getDownloadedFiles, switchFile]);

  const handleCampPress = useCallback((e: any) => {
    const feat = e.features?.[0];
    if (!feat) return;
    const p = feat.properties;
    let raw: CampsitePin;
    try { raw = JSON.parse(p.raw || '{}'); } catch { raw = p as any; }
    onCampTap(raw);
  }, [onCampTap]);

  const mapStatusLabel = localTiles ? compactMapStatus(tileDebug) : 'Online maps';
  const overlayChildren = props.children;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={styles.mapRoot}>
      <MapLibreGL.MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        mapStyle={mapStyleObj}
        onPress={handlePress}
        onLongPress={handleLongPress}
        onRegionDidChange={handleRegionChange}
        onDidFinishLoadingMap={handleMapReady}
        compassEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        scrollEnabled={!navMode}
        zoomEnabled={!navMode}
        rotateEnabled={!navMode}
        pitchEnabled={!navMode}
      >

      {/* ── Camera ────────────────────────────────────────────────────── */}
      {/* Camera — initial values computed once via lazy useState.
          Because initialCenter/initialZoom never change after mount, these
          controlled props set the starting position without ever snapping back.
          All subsequent camera moves (nav follow, flyTo, etc.) happen via ref. */}
      <MapLibreGL.Camera
        ref={camRef}
        centerCoordinate={initialCenter}
        zoomLevel={initialZoom}
        animationDuration={0}
      />

      {/* ── User location ─────────────────────────────────────────────── */}
      <MapLibreGL.UserLocation
        visible={!!userLoc}
        renderMode="normal"
        showsUserHeadingIndicator
        animated
      />

      {/* ── Route line ────────────────────────────────────────────────── */}
      {routeCoords.length > 0 && (
        <MapLibreGL.ShapeSource id="route" shape={lineFC(routeCoords)}>
          <MapLibreGL.LineLayer
            id="route-shadow"
            style={{ lineColor: 'rgba(0,0,0,0.35)', lineWidth: 9, lineBlur: 5, lineTranslate: [0, 2] }}
          />
          <MapLibreGL.LineLayer
            id="route-line"
            style={{ lineColor: '#f97316', lineWidth: 5, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.94 }}
          />
          {/* Direction arrows along route — ASCII > rotated along line direction */}
          <MapLibreGL.SymbolLayer
            id="route-arrows"
            minZoomLevel={10}
            style={{
              symbolPlacement: 'line',
              symbolSpacing: 90,
              textField: '>',
              textSize: ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15],
              textColor: 'rgba(255,255,255,0.9)',
              textFont: ['Noto Sans Medium'],
              textIgnorePlacement: true,
              textAllowOverlap: true,
              textRotationAlignment: 'map',
              textKeepUpright: false,
              textLetterSpacing: -0.1,
            } as any}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── Passed route dimmed overlay ───────────────────────────────── */}
      {passedCoords.length > 1 && (
        <MapLibreGL.ShapeSource id="route-passed" shape={lineFC(passedCoords)}>
          <MapLibreGL.LineLayer
            id="route-passed-line"
            style={{ lineColor: '#374151', lineWidth: 5, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.72 }}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── Breadcrumb trail ──────────────────────────────────────────── */}
      {breadcrumb.length > 1 && (
        <MapLibreGL.ShapeSource id="breadcrumb" shape={lineFC(breadcrumb)}>
          <MapLibreGL.LineLayer
            id="breadcrumb-line"
            style={{ lineColor: '#3b82f6', lineWidth: 2.5, lineOpacity: 0.8, lineDasharray: [2, 4] }}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── Campsites (clustered) ──────────────────────────────────────── */}
      {camps.length > 0 && (
        <MapLibreGL.ShapeSource
          id="camps"
          shape={campFC}
          cluster
          clusterMaxZoomLevel={11}
          clusterRadius={45}
          onPress={handleCampPress}
        >
          <MapLibreGL.CircleLayer
            id="camp-cluster"
            filter={['has', 'point_count']}
            style={{
              circleColor: ['step', ['get', 'point_count'], '#14b8a6', 10, '#f97316', 50, '#ef4444'],
              circleRadius: ['step', ['get', 'point_count'], 18, 10, 25, 50, 32],
              circleOpacity: 0.88,
              circleStrokeWidth: 2,
              circleStrokeColor: '#fff',
            }}
          />
          <MapLibreGL.SymbolLayer
            id="camp-count"
            filter={['has', 'point_count']}
            style={{
              textField: '{point_count_abbreviated}',
              textColor: '#fff',
              textSize: 12,
            }}
          />
          <MapLibreGL.CircleLayer
            id="camp-circle"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 11],
              circleColor: ['match', ['get', 'land_type'],
                'BLM Land', '#f97316',
                'National Forest', '#22c55e',
                'National Park', '#3b82f6',
                'State Park', '#8b5cf6',
                '#14b8a6'],
              circleOpacity: 0.88,
              circleStrokeWidth: ['case', ['==', ['get', 'full'], 1], 3, 2],
              circleStrokeColor: ['case', ['==', ['get', 'full'], 1], '#ef4444', 'rgba(255,255,255,0.9)'],
            }}
          />
          <MapLibreGL.SymbolLayer
            id="camp-code"
            filter={['!', ['has', 'point_count']]}
            style={{
              textField: 'C',
              textSize: 10,
              textFont: ['Noto Sans Medium'],
              textColor: '#fff',
              textHaloColor: 'rgba(0,0,0,0.35)',
              textHaloWidth: 0.8,
              textIgnorePlacement: true,
              textAllowOverlap: true,
            } as any}
          />
          {/* Camp name labels — visible from z11, hidden when clustered */}
          <MapLibreGL.SymbolLayer
            id="camp-name"
            minZoomLevel={11}
            filter={['!', ['has', 'point_count']]}
            style={{
              textField: ['get', 'name'],
              textSize: 9.5, textFont: ['Noto Sans Regular'],
              textOffset: [0, 1.5], textAnchor: 'top',
              textColor: '#14b8a6', textHaloColor: 'rgba(0,0,0,0.8)', textHaloWidth: 1.8,
              textMaxWidth: 10, textIgnorePlacement: false, textAllowOverlap: false,
              textOptional: true,
            } as any}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── Gas stations ──────────────────────────────────────────────── */}
      {gas.length > 0 && (
        <MapLibreGL.ShapeSource
          id="gas" shape={gasFC}
          onPress={e => {
            const f = e.features?.[0];
            if (f && onGasTap) {
              const [lng, lat] = (f.geometry as any).coordinates;
              onGasTap({ name: f.properties?.name ?? 'Gas Station', lat, lng });
            }
          }}
        >
          <MapLibreGL.CircleLayer
            id="gas-circle"
            style={{ circleRadius: 9, circleColor: '#eab308', circleOpacity: 0.92, circleStrokeWidth: 2, circleStrokeColor: '#fff' }}
          />
          <MapLibreGL.SymbolLayer
            id="gas-code"
            style={{
              textField: 'F',
              textSize: 10,
              textFont: ['Noto Sans Medium'],
              textColor: '#111827',
              textHaloColor: 'rgba(255,255,255,0.55)',
              textHaloWidth: 0.8,
              textIgnorePlacement: true,
              textAllowOverlap: true,
            } as any}
          />
          <MapLibreGL.SymbolLayer
            id="gas-label"
            minZoomLevel={11}
            style={{
              textField: ['get', 'name'],
              textSize: 9, textFont: ['Noto Sans Regular'],
              textOffset: [0, 1.6], textAnchor: 'top',
              textColor: '#eab308', textHaloColor: 'rgba(0,0,0,0.7)', textHaloWidth: 1.5,
              textMaxWidth: 8, textIgnorePlacement: false, textAllowOverlap: false,
            } as any}
          />
        </MapLibreGL.ShapeSource>
      )}

      {gas.slice(0, 60).map((station, i) => (
        <MapLibreGL.MarkerView
          key={`gas-icon-${station.name}-${station.lat}-${station.lng}-${i}`}
          id={`gas-icon-${i}`}
          coordinate={[station.lng, station.lat]}
        >
          <IconPin
            color="#eab308"
            icon="flash-outline"
            onPress={() => onGasTap?.({ name: station.name || 'Gas Station', lat: station.lat, lng: station.lng })}
          />
        </MapLibreGL.MarkerView>
      ))}

      {/* ── POIs (water, trailheads, viewpoints, peaks) ───────────────── */}
      {pois.length > 0 && (
        <MapLibreGL.ShapeSource
          id="pois" shape={poiFC}
          onPress={e => {
            const f = e.features?.[0];
            if (f && onPoiTap) {
              const [lng, lat] = (f.geometry as any).coordinates;
              onPoiTap({ name: f.properties?.name ?? '', type: f.properties?.type ?? 'poi', lat, lng });
            }
          }}
        >
          <MapLibreGL.CircleLayer
            id="poi-circle"
            style={{
              circleRadius: ['case', ['==', ['get', 'type'], 'peak'], 9, 8],
              circleColor: ['match', ['get', 'type'], 'water', '#3b82f6', 'trailhead', '#22c55e', 'viewpoint', '#a855f7', 'peak', '#92400e', 'hot_spring', '#f97316', 'fuel', '#ea580c', 'propane', '#f97316', 'dump', '#a16207', 'shower', '#06b6d4', 'laundromat', '#06b6d4', 'lodging', '#6366f1', 'food', '#06b6d4', 'grocery', '#06b6d4', 'mechanic', '#f97316', 'parking', '#d97706', 'attraction', '#0ea5e9', '#6b7280'],
              circleOpacity: 0.9, circleStrokeWidth: 1.5, circleStrokeColor: '#fff',
            }}
          />
          <MapLibreGL.SymbolLayer
            id="poi-code"
            style={{
              textField: ['match', ['get', 'type'],
                'water', POI_CODES.water,
                'trailhead', POI_CODES.trailhead,
                'viewpoint', POI_CODES.viewpoint,
                'peak', POI_CODES.peak,
                'hot_spring', POI_CODES.hot_spring,
                'fuel', POI_CODES.fuel,
                'propane', POI_CODES.propane,
                'dump', POI_CODES.dump,
                'shower', POI_CODES.shower,
                'laundromat', POI_CODES.laundromat,
                'lodging', POI_CODES.lodging,
                'food', POI_CODES.food,
                'grocery', POI_CODES.grocery,
                'mechanic', POI_CODES.mechanic,
                'parking', POI_CODES.parking,
                'attraction', POI_CODES.attraction,
                'P'],
              textSize: 9.5,
              textFont: ['Noto Sans Medium'],
              textColor: '#fff',
              textHaloColor: 'rgba(0,0,0,0.35)',
              textHaloWidth: 0.8,
              textIgnorePlacement: true,
              textAllowOverlap: true,
            } as any}
          />
          <MapLibreGL.SymbolLayer
            id="poi-label"
            minZoomLevel={11}
            style={{
              textField: ['get', 'name'],
              textSize: 9, textFont: ['Noto Sans Regular'],
              textOffset: [0, 1.4], textAnchor: 'top',
              textColor: '#fff', textHaloColor: 'rgba(0,0,0,0.75)', textHaloWidth: 1.5,
              textMaxWidth: 8, textIgnorePlacement: false, textAllowOverlap: false,
            } as any}
          />
        </MapLibreGL.ShapeSource>
      )}

      {pois.slice(0, 70).map((poi, i) => (
        <MapLibreGL.MarkerView
          key={`poi-icon-${poi.type}-${poi.name}-${poi.lat}-${poi.lng}-${i}`}
          id={`poi-icon-${i}`}
          coordinate={[poi.lng, poi.lat]}
        >
          <IconPin
            color={poiColor(poi.type)}
            icon={POI_ICON_NAMES[poi.type] || 'location-outline'}
            onPress={() => onPoiTap?.({ name: poi.name, type: poi.type, lat: poi.lat, lng: poi.lng })}
          />
        </MapLibreGL.MarkerView>
      ))}

      {/* ── Community pins ────────────────────────────────────────────── */}
      {communityPins.slice(0, 150).map((pin, i) => {
        const visual = communityPinVisual(pin.type);
        return (
          <MapLibreGL.MarkerView
            key={`community-pin-${pin.id}-${pin.lat}-${pin.lng}-${i}`}
            id={`community-pin-${pin.id}-${i}`}
            coordinate={[pin.lng, pin.lat]}
          >
            <IconPin
              color={visual.color}
              icon={visual.icon}
              onPress={() => onCommunityPinTap?.(pin)}
            />
          </MapLibreGL.MarkerView>
        );
      })}

      {/* ── Radar (RainViewer) ───────────────────────────────────────── */}
      {showRadar && radarUrl && (
        <MapLibreGL.RasterSource id="radar-overlay" tileUrlTemplates={[radarUrl]} tileSize={256}>
          <MapLibreGL.RasterLayer id="radar-layer" style={{ rasterOpacity: 0.65 }} />
        </MapLibreGL.RasterSource>
      )}

      {/* ── Active wildfires (USFS) ───────────────────────────────────── */}
      {showFire && fireData && (
        <MapLibreGL.ShapeSource id="fire-overlay" shape={fireData}>
          <MapLibreGL.FillLayer
            id="fire-fill"
            style={{ fillColor: '#dc2626', fillOpacity: 0.3 }}
          />
          <MapLibreGL.LineLayer
            id="fire-line"
            style={{ lineColor: '#ef4444', lineWidth: 1.5, lineOpacity: 0.85 }}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── Avalanche danger zones ────────────────────────────────────── */}
      {showAva && avaData && (
        <MapLibreGL.ShapeSource id="ava-overlay" shape={avaData}>
          <MapLibreGL.FillLayer
            id="ava-fill"
            style={{
              fillColor: ['match', ['get', 'danger_level'],
                '1', '#50C878', '2', '#FFD700', '3', '#FF8C00',
                '4', '#E63946', '5', '#1a0a0a', '#888888'],
              fillOpacity: 0.45,
            }}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── MVUM — USFS Motor Vehicle Use Map ────────────────────────── */}
      {showMvum && mvumRoads && (
        <MapLibreGL.ShapeSource id="mvum-roads" shape={mvumRoads}>
          <MapLibreGL.LineLayer
            id="mvum-roads-line"
            style={{
              lineColor: ['case',
                ['==', ['get', 'passengervehicle'], 'open'], '#22c55e',
                ['==', ['get', 'highclearancevehicle'], 'open'], '#f97316',
                '#ef4444'],
              lineWidth: 2.5,
              lineOpacity: 0.85,
            }}
          />
        </MapLibreGL.ShapeSource>
      )}
      {showMvum && mvumTrails && (
        <MapLibreGL.ShapeSource id="mvum-trails" shape={mvumTrails}>
          <MapLibreGL.LineLayer
            id="mvum-trails-line"
            style={{ lineColor: '#a855f7', lineWidth: 1.5, lineOpacity: 0.8, lineDasharray: [3, 2] }}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── BLM / Land ownership overlay ─────────────────────────────── */}
      {showLandOverlay && (
        <MapLibreGL.RasterSource
          id="land-overlay"
          tileUrlTemplates={['https://trailhead-production-2049.up.railway.app/api/land-tile/{z}/{y}/{x}']}
          tileSize={256}
          minZoomLevel={4}
          maxZoomLevel={15}
        >
          <MapLibreGL.RasterLayer
            id="land-overlay-layer"
            style={{ rasterOpacity: 0.45 }}
          />
        </MapLibreGL.RasterSource>
      )}

      {/* ── USGS Topo overlay ─────────────────────────────────────────── */}
      {showUsgsOverlay && (
        <MapLibreGL.RasterSource
          id="usgs-overlay"
          tileUrlTemplates={['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}']}
          tileSize={256}
          minZoomLevel={4}
          maxZoomLevel={16}
        >
          <MapLibreGL.RasterLayer
            id="usgs-overlay-layer"
            style={{ rasterOpacity: 0.7 }}
          />
        </MapLibreGL.RasterSource>
      )}

      {/* ── Report markers ────────────────────────────────────────────── */}
      {reports.map(r => (
        <MapLibreGL.MarkerView key={`rep-${r.id}`} id={`rep-${r.id}`} coordinate={[r.lng, r.lat]}>
          <ReportDot type={r.type} subtype={r.subtype} />
        </MapLibreGL.MarkerView>
      ))}

      {/* ── Search marker ─────────────────────────────────────────────── */}
      {searchMarker && (
        <MapLibreGL.MarkerView id="search" coordinate={[searchMarker.lng, searchMarker.lat]}>
          <View style={styles.searchMarker}>
            <View style={styles.searchPin} />
          </View>
        </MapLibreGL.MarkerView>
      )}

      {/* ── Waypoint markers ──────────────────────────────────────────── */}
      {waypoints.map((wp, i) => (
        <MapLibreGL.MarkerView
          key={`wp-${i}-${wp.lat}-${wp.lng}`}
          id={`wp-${i}`}
          coordinate={[wp.lng, wp.lat]}
        >
          <WaypointDot
            wp={wp}
            index={i}
            isNavTarget={navMode && i === navTargetIdx}
            onPress={() => onWaypointTap(i, wp.name)}
          />
        </MapLibreGL.MarkerView>
      ))}
      </MapLibreGL.MapView>
      <View pointerEvents="none" style={styles.tileDebugWrap}>
        <View style={[styles.tileDebug, localTiles ? styles.tileDebugLocal : styles.tileDebugRemote]}>
          <Ionicons
            name={localTiles ? 'cloud-done-outline' : 'cloud-outline'}
            size={11}
            color={localTiles ? '#86efac' : '#bfdbfe'}
          />
          <Text numberOfLines={1} style={[styles.tileDebugText, localTiles ? styles.tileDebugTextLocal : styles.tileDebugTextRemote]}>
            {mapStatusLabel}
          </Text>
        </View>
      </View>
      {overlayChildren}
    </View>
  );
});

NativeMap.displayName = 'NativeMap';
export default NativeMap;

// ── Helpers ───────────────────────────────────────────────────────────────────
function kindLabel(kind: string): string {
  switch (kind) {
    case 'camp_pitch': return 'Dispersed Spot';
    case 'camp_site':  return 'Campground';
    case 'shelter':    return 'Trail Shelter';
    default:           return 'Camp';
  }
}

function stateName(id: string): string {
  if (id === 'conus') return 'USA';
  return FILE_REGIONS[id as keyof typeof FILE_REGIONS]?.name ?? id.toUpperCase();
}

function stateDisplayName(fileName: string): string {
  const id = fileName.replace(/\.pmtiles$/i, '');
  return stateName(id);
}

function compactMapStatus(status: string): string {
  if (/outside saved/i.test(status)) return 'Outside saved';
  if (/no (state|saved) maps/i.test(status)) return 'No saved maps';
  if (/not ready/i.test(status)) return 'Maps pending';
  const ready = status.match(/^(.+?) maps (ready|loaded|unavailable)$/i);
  if (ready?.[1]) return ready[1];
  const saved = status.match(/^(\d+) (state|region) maps? saved$/i);
  if (saved?.[1]) return `${saved[1]} saved`;
  return 'Saved maps';
}

function poiColor(type: string): string {
  switch (type) {
    case 'water': return '#3b82f6';
    case 'trailhead': return '#22c55e';
    case 'viewpoint': return '#a855f7';
    case 'peak': return '#92400e';
    case 'hot_spring': return '#f97316';
    case 'fuel': return '#ea580c';
    case 'propane': return '#f97316';
    case 'dump': return '#a16207';
    case 'shower': return '#06b6d4';
    case 'laundromat': return '#06b6d4';
    case 'lodging': return '#6366f1';
    case 'food': return '#06b6d4';
    case 'grocery': return '#06b6d4';
    case 'mechanic': return '#f97316';
    case 'parking': return '#d97706';
    case 'attraction': return '#0ea5e9';
    default: return '#6b7280';
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function WaypointDot({ wp, index, isNavTarget, onPress }: {
  wp: WP; index: number; isNavTarget: boolean; onPress: () => void;
}) {
  const color = WP_COLORS[wp.type] || '#f97316';
  const icon = WP_ICON_NAMES[wp.type];
  return (
    <View
      onTouchEnd={onPress}
      style={[
        styles.wpDot,
        { backgroundColor: isNavTarget ? '#fff' : color },
        isNavTarget && styles.wpDotNavTarget,
      ]}
    >
      {icon
        ? <Ionicons name={icon} size={16} color={isNavTarget ? color : '#fff'} />
        : <Text style={[styles.wpDotText, isNavTarget && { color }]} numberOfLines={1}>{index + 1}</Text>}
    </View>
  );
}

function ReportDot({ type, subtype }: { type: string; subtype?: string }) {
  const COLORS: Record<string, string> = {
    police: '#eab308dd', hazard: '#ef4444dd', road_condition: '#f97316dd',
    trail_condition: '#22c55edd',
    wildlife: '#a855f7dd', campsite: '#22c55edd', road_closure: '#dc2626dd',
    water: '#38bdf8dd',
  };
  const color = COLORS[type] || '#6b7280dd';
  const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    police: 'shield-outline',
    hazard: 'warning-outline',
    road_condition: 'trail-sign-outline',
    trail_condition: 'walk-outline',
    wildlife: 'paw-outline',
    campsite: 'bonfire-outline',
    road_closure: 'remove-circle-outline',
    closure: 'remove-circle-outline',
    water: 'water-outline',
    fuel: 'flash-outline',
    viewpoint: 'flag-outline',
    service: 'construct-outline',
    cell_signal: 'cellular-outline',
  };
  const icon = ICONS[type] || 'alert-outline';
  return (
    <View style={[styles.reportDot, { backgroundColor: color }]}>
      <Ionicons name={icon} size={17} color="#fff" />
    </View>
  );
}

function IconPin({ color, icon, onPress }: {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      onPress={onPress}
      style={[styles.iconPin, { backgroundColor: color }]}
    >
      <Ionicons name={icon} size={18} color="#fff" />
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  mapRoot: {
    flex: 1,
  },
  wpDot: {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 2.5, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 4, elevation: 4,
  },
  wpDotNavTarget: {
    shadowColor: '#f97316', shadowOpacity: 0.8, shadowRadius: 8,
  },
  wpDotText: {
    color: '#fff', fontSize: 11, fontWeight: '900', fontFamily: 'monospace',
    textAlign: 'center',
  },
  reportDot: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45, shadowRadius: 4, elevation: 4,
  },
  reportDotText: {
    color: '#fff', fontSize: 14, fontWeight: '900', textAlign: 'center',
  },
  iconPin: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 4,
  },
  searchMarker: {
    alignItems: 'center', justifyContent: 'center',
  },
  searchPin: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(59,130,246,0.2)',
    borderWidth: 2.5, borderColor: '#3b82f6',
  },
  tileDebugWrap: {
    position: 'absolute',
    bottom: 112,
    left: 10,
    zIndex: 999,
    alignItems: 'flex-start',
  },
  tileDebug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 132,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
  },
  tileDebugLocal: {
    backgroundColor: 'rgba(20,83,45,0.70)',
    borderColor: 'rgba(134,239,172,0.32)',
  },
  tileDebugRemote: {
    backgroundColor: 'rgba(30,41,59,0.62)',
    borderColor: 'rgba(147,197,253,0.28)',
  },
  tileDebugText: {
    fontSize: 9,
    fontWeight: '800',
    maxWidth: 102,
  },
  tileDebugTextLocal: { color: '#dcfce7' },
  tileDebugTextRemote: { color: '#dbeafe' },
});
