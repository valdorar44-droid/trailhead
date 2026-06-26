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
import { Dimensions, PanResponder, Platform, TouchableOpacity, View, StyleSheet, Text } from 'react-native';
import { EventEmitter, requireNativeModule } from 'expo-modules-core';
import MapLibreGL from '@maplibre/maplibre-react-native';
import MapboxGL from '@rnmapbox/maps';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '@/lib/storage';

import { buildMapStyle, MapMode } from './mapStyle';
import type { ContourSourceMode, PremiumMapStyle, TrailSourceMode } from './mapStyle';
import { fetchRoute, buildFallbackRoute } from './routing';
import type { RouteProviderMode, RouteResult, RouteStep, RouteOpts, MapBounds, WP } from './types';
import type { CampsitePin, MapSelectableFeature, OsmPoi, Pin, Report, WaterSpotCard, SuggestedWaterCorridorResponse } from '@/lib/api';
import type { WaterRoute } from '@/lib/store';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';
import { buildOfflineTrailGraphSelection } from '@/lib/trailGraph';
import { CACHE_OFFLINE_DIR, CONTOUR_DIR, OFFLINE_DIR, FILE_REGIONS } from '@/lib/useOfflineFiles';
import { saveRouteGeometry } from '@/lib/offlineRoutes';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';

// Lazy-load the tile server module — gracefully no-ops if the binary doesn't
// include it yet (e.g. first launch after OTA-only update).
type TileServerModule = typeof import('expo-tile-server');
let tileServer: TileServerModule | null = null;
let tileServerRequireError = '';
try { tileServer = require('expo-tile-server'); } catch (e: any) { tileServerRequireError = e?.message ?? 'require failed'; }

type MapboxStandardInteractionsModule = {
  enable?: () => Promise<boolean>;
  disable?: () => Promise<boolean>;
};
let mapboxStandardInteractions: MapboxStandardInteractionsModule | null = null;
let mapboxStandardInteractionEvents: any = null;
try {
  mapboxStandardInteractions = requireNativeModule<MapboxStandardInteractionsModule>('TrailheadMapboxStandardInteractions');
  mapboxStandardInteractionEvents = new EventEmitter(mapboxStandardInteractions as any);
} catch {}

const TILE_BASE_URL = 'https://tiles.gettrailhead.app';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';
const BASE_DL_URL   = `${TILE_BASE_URL}/api/download/base.pmtiles`;
const GLOBAL_BASE_DL_URL = `${TILE_BASE_URL}/api/download/base-global.pmtiles`;
const BASE_PATH     = `${OFFLINE_DIR}base.pmtiles`;
const GLOBAL_BASE_PATH = `${OFFLINE_DIR}base-global.pmtiles`;
const BASE_MIN_MB   = 10; // skip base file if under 10 MB (truncated)
const CONUS_MIN_MB  = 1024; // a partial conus.pmtiles must not hide state packs
const LEGACY_OFFLINE_DIR = `${FileSystem.documentDirectory}offline/`;
const CACHE_CONTOUR_DIR = `${FileSystem.cacheDirectory}offline/contours/`;
const TRAIL_DIR = `${OFFLINE_DIR}trails/`;
const CACHE_TRAIL_DIR = `${CACHE_OFFLINE_DIR}trails/`;

const MAPBOX_STYLE_URLS: Record<PremiumMapStyle, string> = {
  standard: 'mapbox://styles/mapbox/standard',
  standard_satellite: 'mapbox://styles/mapbox/standard-satellite',
  satellite_streets: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
  navigation_day: 'mapbox://styles/mapbox/navigation-day-v1',
  navigation_night: 'mapbox://styles/mapbox/navigation-night-v1',
  dawn: 'mapbox://styles/mapbox/standard',
  dusk: 'mapbox://styles/mapbox/standard',
  night: 'mapbox://styles/mapbox/standard',
};

const MAPBOX_LIGHT_PRESETS: Partial<Record<PremiumMapStyle, 'dawn' | 'day' | 'dusk' | 'night'>> = {
  standard: 'day',
  standard_satellite: 'day',
  streets: 'day',
  outdoors: 'day',
  satellite_streets: 'day',
  navigation_day: 'day',
  navigation_night: 'night',
  dawn: 'dawn',
  dusk: 'dusk',
  night: 'night',
};

const RECENT_MAP_VIEWPORT_KEY = 'trailhead_map_recent_viewport_v1';
const RECENT_MAP_VIEWPORT_TTL_MS = 5 * 60 * 1000;
const RECENT_MAP_VIEWPORT_WRITE_MS = 2500;
const NAV_GESTURE_HOLD_MS = Platform.OS === 'ios' ? 2600 : 1800;
const NAV_GESTURE_NOTIFY_COOLDOWN_MS = Platform.OS === 'ios' ? 1400 : 900;

type CachedMapViewport = {
  at: number;
  centerCoordinate: [number, number];
  zoomLevel: number;
  pitch: number;
  mapLayer?: string;
  premiumMapStyle?: string | null;
};

function isUserCameraEvent(feature: any) {
  const props = feature?.properties ?? feature?.nativeEvent?.payload?.properties ?? feature?.nativeEvent?.payload ?? {};
  return !!(props.isUserInteraction || props.isAnimatingFromUserInteraction);
}

function parseCachedMapViewport(raw: string | null | undefined): CachedMapViewport | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const center = Array.isArray(parsed?.centerCoordinate) ? parsed.centerCoordinate.map(Number) : null;
    const at = Number(parsed?.at);
    const zoomLevel = Number(parsed?.zoomLevel);
    const pitch = Number(parsed?.pitch);
    if (
      !center ||
      center.length !== 2 ||
      !center.every(Number.isFinite) ||
      !Number.isFinite(at) ||
      !Number.isFinite(zoomLevel)
    ) {
      return null;
    }
    return {
      at,
      centerCoordinate: [center[0], center[1]],
      zoomLevel,
      pitch: Number.isFinite(pitch) ? pitch : 0,
      mapLayer: typeof parsed?.mapLayer === 'string' ? parsed.mapLayer : undefined,
      premiumMapStyle: typeof parsed?.premiumMapStyle === 'string' ? parsed.premiumMapStyle : null,
    };
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type { WP, RouteOpts, MapBounds, RouteResult, RouteStep } from './types';

export type NativeMapCameraOptions = {
  lat: number;
  lng: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  duration?: number;
  mode?: 'flyTo' | 'easeTo' | string;
};

export type NativeMapDebugEvent = {
  at: number;
  kind: string;
  details?: Record<string, unknown>;
};

export interface NativeMapHandle {
  flyTo:          (lat: number, lng: number, zoom?: number, name?: string) => void;
  flyToCamera:    (options: NativeMapCameraOptions) => void;
  setZoom:        (zoom: number, focus?: { lat?: number; lng?: number } | null) => Promise<number | null>;
  zoomBy:         (delta: number, focus?: { lat?: number; lng?: number } | null) => Promise<number | null>;
  locate:         (lat: number, lng: number) => void;
  loadRouteFrom:  (lat: number, lng: number, fromIdx: number) => void;
  loadRouteSegmentFrom: (lat: number, lng: number, fromIdx: number, toIdx: number) => void;
  rerouteFrom:    (lat: number, lng: number, fromIdx: number) => void;
  routeToSearch:  (lat: number, lng: number, name: string, userLat: number, userLng: number) => void;
  resetRoute:     () => void;
  stopNavigation: () => void;
  highlightTrail: (lat: number, lng: number, name?: string) => void;
  clearTrailHighlight: () => void;
  getTrailHighlight: () => GeoJSON.FeatureCollection;
  captureTrailAt: (lat: number, lng: number, name?: string) => Promise<GeoJSON.FeatureCollection>;
  screenToCoordinate: (x: number, y: number) => Promise<[number, number] | null>;
  selectFeatureAtScreenPoint: (x: number, y: number) => Promise<MapSelectableFeature | null>;
  queryVisibleFeatures: () => Promise<MapSelectableFeature[]>;
  getVisibleMapCandidates: () => Promise<MapSelectableFeature[]>;
  getVisibleCenter: () => Promise<[number, number] | null>;
  getVisibleBounds: () => Promise<MapBounds | null>;
  restoreRoute:   (coords: [number,number][], steps: RouteStep[], legs: RouteStep[][], td: number, tt: number) => void;
  setNavTarget:   (idx: number) => void;
}

export interface NativeMapProps {
  // Data
  waypoints:     WP[];
  camps:         CampsitePin[];
  gas:           { lat: number; lng: number; name: string }[];
  pois:          OsmPoi[];
  waterNavLines?: any;
  waterSpotCards?: WaterSpotCard[];
  waterCorridor?: SuggestedWaterCorridorResponse | null;
  waterFollowRoute?: WaterRoute | null;
  reports:       Report[];
  communityPins: Pin[];
  searchMarker:  { lat: number; lng: number; name: string } | null;

  // Nav state
  userLoc:     { lat: number; lng: number; accuracy?: number | null } | null;
  navMode:     boolean;
  navCameraFollow?: boolean;
  nativeNavEngineActive?: boolean;
  navIdx:      number;
  navHeading:  number | null;
  navSpeed:    number | null;

  // Config
  mapLayer:  MapMode;
  premiumMapStyle?: PremiumMapStyle;
  routeProviderMode?: RouteProviderMode;
  routeOpts: RouteOpts;
  traceMode?: boolean;
  traceDraftCoords?: [number, number][];
  traceRouteCoords?: [number, number][];
  tracePinCoords?: [number, number][];
  suppressFeatureTaps?: boolean;

  // Overlay visibility
  showLandOverlay: boolean;
  showUsgsOverlay: boolean;
  showTerrain:     boolean;
  showTrailOverlay?: boolean;
  showMvum:        boolean;
  showFire:        boolean;
  showAva:         boolean;
  showRadar:       boolean;
  showNautical?:   boolean;
  hideMapStatusBadge?: boolean;

  // Callbacks → replaces onWebMessage
  onMapReady:       () => void;
  onBoundsChange:   (bounds: MapBounds) => void;
  onMapGesture?:    () => void;
  onMapTap:         (lat?: number, lng?: number) => void;
  onMapLongPress:   (lat: number, lng: number) => void;
  onCampTap:        (camp: CampsitePin) => void;
  onGasTap?:        (station: { name: string; lat: number; lng: number }) => void;
  onPoiTap?:        (poi: OsmPoi) => void;
  onWaterSpotTap?:  (spot: WaterSpotCard) => void;
  onCommunityPinTap?: (pin: Pin) => void;
  onTileCampTap:    (name: string, kind: string, lat: number, lng: number) => void;
  onBaseCampTap:    (name: string, lat: number, lng: number, landType: string) => void;
  onTrailTap:       (name: string, lat: number, lng: number) => void;
  onWaypointTap:    (idx: number, name: string) => void;
  onRouteReady:     (result: RouteResult & { fromIdx: number }) => void;
  onRoutePersist:   (data: { coords: [number,number][]; steps: RouteStep[]; legs: RouteStep[][]; totalDistance: number; totalDuration: number; tripId: string | null; routeSource?: string | null; routeSourceLabel?: string | null }) => void;
  onOffRoute?:      (lat: number, lng: number, distanceM: number) => void;
  onOffRouteWarn?:  (lat: number, lng: number, distanceM: number) => void;
  onBackOnRoute?:   () => void;
  onRouteProgress?: (progress: { distanceM: number; remainingM: number; routeDistanceM: number; deviationM: number; segmentIdx: number } | null) => void;
  onTraceStart?:    (coord: [number, number]) => void;
  onTraceMove?:     (coord: [number, number]) => void;
  onTraceEnd?:      () => void;
  onDebugEvent?:    (event: NativeMapDebugEvent) => void;
  onError?:         (msg: string) => void;
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
  trail: 'T',
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
  camping: 'C',
  hardware: 'H',
  medical: 'M',
  parts: 'R',
  wifi: 'W',
  poi: 'P',
};
const POI_ICON_NAMES: Record<string, keyof typeof Ionicons.glyphMap> = {
  trail: 'walk-outline',
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
  camping: 'storefront-outline',
  hardware: 'hammer-outline',
  medical: 'medical-outline',
  parts: 'cog-outline',
  wifi: 'wifi-outline',
  poi: 'location-outline',
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
function emptyFC() {
  return { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] };
}

function maneuverArrowText(step: RouteStep): string | null {
  const type = (step.type || '').toLowerCase();
  const modifier = (step.modifier || '').toLowerCase();
  if (type === 'arrive') return '◆';
  if (type === 'roundabout' || type === 'rotary') return '↻';
  if (modifier.includes('uturn')) return '↩';
  if (modifier.includes('sharp left')) return '↰';
  if (modifier.includes('sharp right')) return '↱';
  if (modifier.includes('left')) return '↰';
  if (modifier.includes('right')) return '↱';
  return null;
}

function campFeat(c: CampsitePin): GeoJSON.Feature {
  const raw = [
    ...(Array.isArray(c.tags) ? c.tags : []),
    ...(Array.isArray(c.site_types) ? c.site_types : []),
    c.land_type,
    (c as any).source_badge,
    c.verified_source,
    c.source,
    c.cost,
    c.description,
  ].filter(Boolean).join(' ').toLowerCase();
  const kind = raw.includes('dispersed') || raw.includes('primitive') || raw.includes('boondock') ? 'dispersed'
    : raw.includes('blm') || raw.includes('bureau of land management') ? 'blm'
    : raw.includes('usfs') || raw.includes('national forest') || raw.includes('forest service') ? 'usfs'
    : raw.includes('nps') || raw.includes('national park') ? 'nps'
    : raw.includes('state park') ? 'state'
    : raw.includes('corps') ? 'corps'
    : raw.includes('rv') || raw.includes('hookup') || raw.includes('caravan') ? 'rv'
    : c.reservable ? 'reservable'
    : raw.includes('tent') ? 'tent'
    : 'camp';
  const code = kind === 'dispersed' ? 'd'
    : kind === 'rv' ? 'R'
    : kind === 'tent' ? 'T'
    : kind === 'blm' ? 'B'
    : kind === 'usfs' ? 'F'
    : kind === 'nps' ? 'N'
    : kind === 'state' ? 'S'
    : kind === 'corps' ? 'W'
    : 'C';
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    properties: { id: c.id || '', name: c.name || '', land_type: c.land_type || 'Campground', camp_kind: kind, camp_code: code, cost: c.cost || '', full: (c as any).full || 0, raw: JSON.stringify(c) } };
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

type TrailLineCandidate = {
  id: string;
  name: string;
  coords: [number, number][];
  start: [number, number];
  end: [number, number];
  distanceToSeed: number;
  lengthM: number;
  nameScore: number;
  feature: any;
};

function lineDistanceToPointM(coords: [number, number][], point: [number, number]): number {
  if (coords.length < 2) return Number.POSITIVE_INFINITY;
  const cumulative = routeCumulativeDistances(coords);
  const snap = projectPointToRoute(point, coords, cumulative, 0, coords.length - 2);
  return snap?.distanceM ?? Number.POSITIVE_INFINITY;
}

function lineLengthM(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += coordDistanceM(coords[i - 1], coords[i]);
  return total;
}

function normalizeTrailName(value?: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/\b(trail|path|road|route|loop|connector|spur)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesCompatible(a: string, b: string): boolean {
  const aa = normalizeTrailName(a);
  const bb = normalizeTrailName(b);
  if (!aa || !bb) return true;
  return aa === bb || aa.includes(bb) || bb.includes(aa);
}

function flattenLineCandidate(feature: any, seed: [number, number], trailName?: string): TrailLineCandidate[] {
  const geometry = feature?.geometry;
  const props = feature?.properties ?? {};
  if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString')) return [];
  const name = String(props.name ?? props.ref ?? props.mvum_symbol_name ?? props.symbol ?? '').trim();
  const normalizedName = normalizeTrailName(name);
  const wanted = normalizeTrailName(trailName);
  const nameScore = wanted && normalizedName
    ? normalizedName === wanted ? 3 : normalizedName.includes(wanted) || wanted.includes(normalizedName) ? 2 : 0
    : 1;
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  return lines
    .map((raw: any, idx: number) => {
      const coords = (raw ?? [])
        .map((c: any) => [Number(c?.[0]), Number(c?.[1])] as [number, number])
        .filter((c: [number, number]) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (coords.length < 2) return null;
      const id = `${feature?.id ?? name ?? 'line'}:${idx}:${coords[0][0].toFixed(5)},${coords[0][1].toFixed(5)}`;
      return {
        id,
        name,
        coords,
        start: coords[0],
        end: coords[coords.length - 1],
        distanceToSeed: lineDistanceToPointM(coords, seed),
        lengthM: lineLengthM(coords),
        nameScore,
        feature,
      };
    })
    .filter(Boolean) as TrailLineCandidate[];
}

function lineTouches(a: TrailLineCandidate, b: TrailLineCandidate): boolean {
  const thresholdM = 72;
  return coordDistanceM(a.start, b.start) <= thresholdM
    || coordDistanceM(a.start, b.end) <= thresholdM
    || coordDistanceM(a.end, b.start) <= thresholdM
    || coordDistanceM(a.end, b.end) <= thresholdM;
}

function buildTrailSystemFeatures(features: any[], seed: [number, number], trailName?: string): GeoJSON.Feature[] {
  const wanted = (trailName || '').trim().toLowerCase();
  const seen = new Set<string>();
  const candidates = features
    .flatMap(feature => flattenLineCandidate(feature, seed, trailName))
    .filter(c => {
      if (c.distanceToSeed > 5000) return false;
      if (wanted && c.name && !namesCompatible(c.name, trailName || '') && c.distanceToSeed > 700) return false;
      return c.lengthM > 8;
    })
    .sort((a, b) => (b.nameScore - a.nameScore) || (a.distanceToSeed - b.distanceToSeed));

  const seedLine = candidates.find(c => c.distanceToSeed <= 220 && (c.nameScore > 0 || !wanted))
    ?? candidates.find(c => c.distanceToSeed <= 420)
    ?? candidates[0];
  if (!seedLine) return [];

  const selected = new Map<string, TrailLineCandidate>();
  selected.set(seedLine.id, seedLine);
  const queue = [seedLine];
  let selectedLengthM = seedLine.lengthM;

  while (queue.length > 0 && selected.size < 90 && selectedLengthM < 96_000) {
    const current = queue.shift()!;
    for (const next of candidates) {
      if (selected.has(next.id)) continue;
      const sameNamedSystem = namesCompatible(current.name || trailName || '', next.name || trailName || '');
      if (!sameNamedSystem && next.nameScore === 0 && next.distanceToSeed > 850) continue;
      if (!lineTouches(current, next)) continue;
      selected.set(next.id, next);
      selectedLengthM += next.lengthM;
      queue.push(next);
      if (selected.size >= 90 || selectedLengthM >= 96_000) break;
    }
  }

  // If vector tile clipping breaks endpoints, add same-name visible pieces close
  // to the trailhead so the highlighted system still reads as one route.
  for (const next of candidates) {
    if (selected.has(next.id)) continue;
    if (next.distanceToSeed > 1800) continue;
    if (next.nameScore <= 0 && !namesCompatible(seedLine.name, next.name)) continue;
    selected.set(next.id, next);
    if (selected.size >= 90) break;
  }

  const out: GeoJSON.Feature[] = [];
  for (const line of selected.values()) {
    const key = `${line.start[0].toFixed(5)},${line.start[1].toFixed(5)}:${line.end[0].toFixed(5)},${line.end[1].toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line.coords },
      properties: {
        name: line.name || trailName || 'Selected trail',
        selected: 1,
      },
    });
  }
  return out;
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

function contourPathCandidates(id: string): string[] {
  const fileName = `${id}.pmtiles`;
  return [`${CONTOUR_DIR}${fileName}`, `${CACHE_CONTOUR_DIR}${fileName}`];
}

function trailPathCandidates(id: string): string[] {
  const fileName = `${id}.pmtiles`;
  return [`${TRAIL_DIR}${fileName}`, `${CACHE_TRAIL_DIR}${fileName}`];
}

async function probeTileCdn(timeoutMs = 1500): Promise<boolean> {
  let tid: ReturnType<typeof setTimeout> | null = null;
  try {
    const ctrl = new AbortController();
    tid = setTimeout(() => ctrl.abort(), timeoutMs);
    // Probe an actual low-zoom vector tile, not just the manifest. The manifest
    // can be healthy while the Worker tile path is wedged, which leaves the app
    // in "online maps" mode with no drawable tiles.
    const res = await fetch('https://tiles.gettrailhead.app/api/tiles/4/3/6.pbf', {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok || res.status === 204) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0;
  } catch {
    return false;
  } finally {
    if (tid) clearTimeout(tid);
  }
}

// ── Main component ────────────────────────────────────────────────────────────
const NativeMap = forwardRef<NativeMapHandle, NativeMapProps>((props, ref) => {
  const {
    waypoints, camps, gas, pois, waterNavLines, waterSpotCards = [], waterCorridor = null, waterFollowRoute = null, reports, communityPins, searchMarker,
    userLoc, navMode, navCameraFollow = false, nativeNavEngineActive = false, navIdx, navHeading, navSpeed,
    mapLayer, routeProviderMode = 'trailhead', routeOpts,
    traceMode = false, traceDraftCoords = [], traceRouteCoords = [], tracePinCoords = [],
    suppressFeatureTaps = false,
    showLandOverlay, showUsgsOverlay, showTerrain, showFire, showAva, showRadar, showTrailOverlay = true, showMvum, showNautical = false, hideMapStatusBadge = false,
    onMapReady, onBoundsChange, onMapGesture, onMapTap, onMapLongPress,
    onCampTap, onGasTap, onPoiTap, onWaterSpotTap, onCommunityPinTap, onTileCampTap, onBaseCampTap, onTrailTap, onWaypointTap,
    onRouteReady, onRoutePersist, onOffRoute, onOffRouteWarn, onBackOnRoute, onRouteProgress,
    onTraceStart, onTraceMove, onTraceEnd, onDebugEvent,
  } = props;

  const mapRef = useRef<any>(null);
  const camRef = useRef<any>(null);
  const lastNativeStandardTapRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const onPoiTapRef = useRef(onPoiTap);
  const suppressFeatureTapsRef = useRef(suppressFeatureTaps);
  const onDebugEventRef = useRef(onDebugEvent);

  useEffect(() => {
    onPoiTapRef.current = onPoiTap;
  }, [onPoiTap]);

  useEffect(() => {
    suppressFeatureTapsRef.current = suppressFeatureTaps;
  }, [suppressFeatureTaps]);

  useEffect(() => {
    onDebugEventRef.current = onDebugEvent;
  }, [onDebugEvent]);

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
    const url = `${API_BASE_URL}/api/conditions/fire-perimeters`;
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

  // Compute initial camera position once, then pass it as a Camera default.
  // Keeping center/zoom as controlled props can re-apply this launch position
  // when navigation follow is interrupted by a gesture on iOS.
  const [initialCenter] = useState<[number, number]>(() =>
    waypoints[0] ? [waypoints[0].lng, waypoints[0].lat] : [-98.5, 39.5]
  );
  const [initialZoom] = useState<number>(() => waypoints.length === 0 ? 3.7 : waypoints.length > 1 ? 7 : 10);
  const [freeCameraRevision, setFreeCameraRevision] = useState(0);
  const mapboxToken = useStore(s => s.mapboxToken);
  const activeTrip  = useStore(s => s.activeTrip);
  const C = useTheme();
  const isExtremeMapbox = mapLayer === 'extreme' && !!mapboxToken;
  const MapGL: any = isExtremeMapbox ? MapboxGL : MapLibreGL;
  const routeArrowFont = isExtremeMapbox
    ? ['DIN Pro Medium', 'Arial Unicode MS Regular']
    : ['Noto Sans Medium'];
  const routeTurnFont = isExtremeMapbox
    ? ['DIN Pro Bold', 'Arial Unicode MS Regular']
    : ['Noto Sans Bold'];
  const [localTiles,   setLocalTiles]   = useState(false);
  const [localContours, setLocalContours] = useState(false);
  const [localTrails, setLocalTrails] = useState(false);
  const [tileDebug,    setTileDebug]    = useState('Checking maps');
  const [tileSession,  setTileSession]  = useState(() => Date.now());
  const emitDebugEvent = useCallback((kind: string, details: Record<string, unknown> = {}) => {
    if (Platform.OS !== 'android') return;
    onDebugEventRef.current?.({
      at: Date.now(),
      kind,
      details: {
        provider: isExtremeMapbox ? 'rnmapbox' : 'maplibre',
        navMode,
        navCameraFollow,
        mapLayer,
        premiumMapStyle: props.premiumMapStyle ?? 'standard',
        showTerrain,
        localTiles,
        localContours,
        localTrails,
        tileDebug,
        ...details,
      },
    });
  }, [isExtremeMapbox, localContours, localTiles, localTrails, mapLayer, navCameraFollow, navMode, props.premiumMapStyle, showTerrain, tileDebug]);
  const trailHighlightRef = useRef<GeoJSON.FeatureCollection>(emptyFC());
  const lastTracePointRef = useRef(0);
  const onlineTilesRef  = useRef(true);                // true = prefer live CDN tiles
  const loadedStateRef  = useRef<string | null>(null); // path of currently-active offline region file
  const loadedContourRef = useRef<string | null>(null);
  const loadedTrailRef = useRef<string | null>(null);
  const switchingRef    = useRef(false);               // prevent concurrent region switches
  const isRoutingRef    = useRef(false);               // route fetch in progress — block CDN fallback
  const offRouteStreakRef = useRef(0);
  const offRouteWarnAtRef = useRef(0);
  const wasOffRouteRef = useRef(false);
  const lastFlyToRef    = useRef(0);                   // timestamp of last flyTo — debounce CDN fallback
  const lastCamRef      = useRef(0);                   // timestamp of last nav setCamera — prevent animation overlap
  const freeCameraDefaultRef = useRef({
    centerCoordinate: initialCenter,
    zoomLevel: initialZoom,
    pitch: showTerrain ? 68 : 0,
    animationDuration: 0,
  });
  const pendingFreeCameraRef = useRef<null | (() => void)>(null);
  const programmaticCameraUntilRef = useRef(0);
  const userCameraGestureUntilRef = useRef(0);
  const navGestureBreakawayRef = useRef(false);
  const lastGestureNotifyRef = useRef(0);
  const recentViewportRestoredRef = useRef(false);
  const lastViewportCacheWriteRef = useRef(0);
  const locateSettleTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const deferredSourceRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeRequestRef = useRef(0);                   // cancels stale async route results
  const tileProbeSeqRef = useRef(0);                   // cancels stale online/offline source probes
  const onlineProbeStreakRef = useRef(0);

  const rememberFreeCamera = useCallback((lat: number, lng: number, zoom?: number, pitch?: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    freeCameraDefaultRef.current = {
      centerCoordinate: [lng, lat],
      zoomLevel: Number.isFinite(Number(zoom)) ? Number(zoom) : freeCameraDefaultRef.current.zoomLevel,
      pitch: Number.isFinite(Number(pitch)) ? Number(pitch) : freeCameraDefaultRef.current.pitch,
      animationDuration: 0,
    };
  }, []);

  useEffect(() => {
    if (!navMode || navCameraFollow) navGestureBreakawayRef.current = false;
  }, [navCameraFollow, navMode]);

  const persistRecentViewport = useCallback((lat: number, lng: number, zoomLevel: number, pitch: number) => {
    if (navMode || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoomLevel)) return;
    const now = Date.now();
    if (now - lastViewportCacheWriteRef.current < RECENT_MAP_VIEWPORT_WRITE_MS) return;
    lastViewportCacheWriteRef.current = now;
    const payload: CachedMapViewport = {
      at: now,
      centerCoordinate: [lng, lat],
      zoomLevel,
      pitch: Number.isFinite(pitch) ? pitch : 0,
      mapLayer,
      premiumMapStyle: props.premiumMapStyle ?? null,
    };
    storage.set(RECENT_MAP_VIEWPORT_KEY, JSON.stringify(payload)).catch(() => {});
  }, [mapLayer, navMode, props.premiumMapStyle]);

  const restoreRecentViewportIfNeeded = useCallback(async () => {
    if (recentViewportRestoredRef.current || navMode || waypoints.length > 0 || searchMarker) return;
    recentViewportRestoredRef.current = true;
    const cached = parseCachedMapViewport(await storage.get(RECENT_MAP_VIEWPORT_KEY).catch(() => null));
    if (!cached || Date.now() - cached.at > RECENT_MAP_VIEWPORT_TTL_MS) return;
    freeCameraDefaultRef.current = {
      centerCoordinate: cached.centerCoordinate,
      zoomLevel: cached.zoomLevel,
      pitch: cached.pitch,
      animationDuration: 0,
    };
    emitDebugEvent('camera:restore-recent-viewport', {
      age_ms: Date.now() - cached.at,
      center: cached.centerCoordinate,
      zoom: cached.zoomLevel,
      cachedMapLayer: cached.mapLayer ?? null,
      cachedPremiumMapStyle: cached.premiumMapStyle ?? null,
    });
    setFreeCameraRevision(value => value + 1);
    camRef.current?.setCamera({
      centerCoordinate: cached.centerCoordinate,
      zoomLevel: cached.zoomLevel,
      pitch: cached.pitch,
      animationDuration: 0,
      animationMode: 'none',
    } as any);
  }, [emitDebugEvent, navMode, searchMarker, waypoints.length]);

  const markUserCameraGesture = useCallback((source: string, details: Record<string, unknown> = {}, notifyParent = true) => {
    const now = Date.now();
    userCameraGestureUntilRef.current = now + NAV_GESTURE_HOLD_MS;
    // A real touch should win over any in-flight locate/flyTo animation.
    programmaticCameraUntilRef.current = 0;
    pendingFreeCameraRef.current = null;
    locateSettleTimersRef.current.forEach(timer => clearTimeout(timer));
    locateSettleTimersRef.current = [];
    const alreadyBreakingAway = navMode && navGestureBreakawayRef.current;
    if (navMode) navGestureBreakawayRef.current = true;
    if (navMode && !navCameraFollow) setFreeCameraRevision(value => value + 1);
    const shouldNotifyParent = notifyParent && (!alreadyBreakingAway || now - lastGestureNotifyRef.current > NAV_GESTURE_NOTIFY_COOLDOWN_MS);
    emitDebugEvent('camera:user-gesture', {
      source,
      notifyParent: shouldNotifyParent,
      holdMs: NAV_GESTURE_HOLD_MS,
      ...details,
    });
    if (shouldNotifyParent) {
      lastGestureNotifyRef.current = now;
      onMapGesture?.();
    }
  }, [emitDebugEvent, navCameraFollow, navMode, onMapGesture]);

  const clearLocateSettleTimers = useCallback(() => {
    locateSettleTimersRef.current.forEach(timer => clearTimeout(timer));
    locateSettleTimersRef.current = [];
  }, []);

  const applyLocateCamera = useCallback((lat: number, lng: number, zoomLevel: number, animated = true) => {
    const camera = camRef.current as any;
    if (!camera) return;
    if (Platform.OS === 'ios') {
      // iOS MapLibre can lose a long animated setCamera when style/source
      // updates happen during the move. Snap the target first, then let the
      // final short settle call correct any interrupted camera state.
      camera.moveTo?.([lng, lat], animated ? 120 : 0);
      camera.zoomTo?.(zoomLevel, animated ? 120 : 0);
      camera.setCamera?.({
        centerCoordinate: [lng, lat],
        zoomLevel,
        animationDuration: animated ? 120 : 0,
        animationMode: animated ? 'easeTo' : 'none',
      });
      return;
    }
    camera.setCamera?.({
      centerCoordinate: [lng, lat],
      zoomLevel,
      animationDuration: animated ? 520 : 0,
      animationMode: animated ? 'flyTo' : 'none',
    });
  }, []);

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

  const getDownloadedContourFiles = useCallback(async () => {
    const result: Array<{ id: string; path: string; sizeMb: number; bounds: typeof FILE_REGIONS[keyof typeof FILE_REGIONS]['bounds'] }> = [];
    for (const [id, region] of Object.entries(FILE_REGIONS)) {
      if (id === 'conus') continue;
      const found = await firstExistingPath(contourPathCandidates(id));
      if (!found) continue;
      // Contour packs can be tiny in flat states. Only reject empty/truncated files.
      if (found.sizeMb <= 0) continue;
      result.push({ id, path: found.path, sizeMb: found.sizeMb, bounds: region.bounds });
    }
    return result;
  }, []);

  const getDownloadedTrailFiles = useCallback(async () => {
    const result: Array<{ id: string; path: string; sizeMb: number; bounds: typeof FILE_REGIONS[keyof typeof FILE_REGIONS]['bounds'] }> = [];
    for (const [id, region] of Object.entries(FILE_REGIONS)) {
      if (id === 'conus') continue;
      const found = await firstExistingPath(trailPathCandidates(id));
      if (!found) continue;
      if (found.sizeMb <= 0) continue;
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
    emitDebugEvent('source:switch-state:start', { fileName, sizeMb });
    setTileDebug(`Loading ${stateDisplayName(fileName)} maps`);
    try {
      await tileServer!.switchState(nativePath);
      loadedStateRef.current = path;
      setLocalTiles(true);
      setTileSession(Date.now());
      emitDebugEvent('source:switch-state:applied', { fileName, sizeMb });
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
      loadedStateRef.current = null;
      if (onlineTilesRef.current) setLocalTiles(false);
      setTileDebug(`${stateDisplayName(fileName)} maps unavailable`);
      emitDebugEvent('source:switch-state:error', { fileName, sizeMb, message: e?.message ?? String(e || '') });
    } finally {
      switchingRef.current = false;
    }
  }, [emitDebugEvent]);

  const switchContourFile = useCallback(async (path: string, sizeMb: number) => {
    if (loadedContourRef.current === path) return;
    const ts = tileServer as any;
    if (!ts?.setContours) return;
    try {
      await ts.setContours(path.replace(/^file:\/\//, ''));
      loadedContourRef.current = path;
      setLocalContours(true);
      setTileSession(Date.now());
      setTileDebug(`Topo contours ${sizeMb}MB`);
      emitDebugEvent('source:contours:applied', { fileName: path.split('/').pop() ?? 'contours', sizeMb });
    } catch {
      setLocalContours(false);
      emitDebugEvent('source:contours:error', { fileName: path.split('/').pop() ?? 'contours', sizeMb });
    }
  }, [emitDebugEvent]);

  const loadBestContourFile = useCallback(async (lat?: number, lng?: number) => {
    const files = await getDownloadedContourFiles();
    if (files.length === 0) {
      const ts = tileServer as any;
      if (ts?.clearContours) await ts.clearContours().catch(() => {});
      loadedContourRef.current = null;
      setLocalContours(false);
      return;
    }
    const match = Number.isFinite(lat) && Number.isFinite(lng)
      ? files.find(({ bounds: b }) =>
          (lat as number) >= b.s && (lat as number) <= b.n &&
          (lng as number) >= b.w && (lng as number) <= b.e
        )
      : null;
    const chosen = match ?? files[0];
    await switchContourFile(chosen.path, chosen.sizeMb);
  }, [getDownloadedContourFiles, switchContourFile]);

  const switchTrailFile = useCallback(async (path: string, sizeMb: number) => {
    if (loadedTrailRef.current === path) return;
    const ts = tileServer as any;
    if (!ts?.setTrails) return;
    try {
      await ts.setTrails(path.replace(/^file:\/\//, ''));
      loadedTrailRef.current = path;
      setLocalTrails(true);
      setTileSession(Date.now());
      setTileDebug(`Trail pack ${sizeMb}MB`);
    } catch {
      setLocalTrails(false);
    }
  }, []);

  const loadBestTrailFile = useCallback(async () => {
    const ts = tileServer as any;
    if (ts?.clearTrails) await ts.clearTrails().catch(() => {});
    loadedTrailRef.current = null;
    setLocalTrails(false);
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
      await FileSystem.makeDirectoryAsync(CONTOUR_DIR, { intermediates: true }).catch(() => {});
      await FileSystem.makeDirectoryAsync(TRAIL_DIR, { intermediates: true }).catch(() => {});
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
          .then(async (res: FileSystem.FileSystemDownloadResult | undefined) => {
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
        onlineProbeStreakRef.current += 1;
        setLocalTiles(false);
        setTileDebug('Online maps');
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          await loadBestContourFile(pos.coords.latitude, pos.coords.longitude);
        } catch {
          await loadBestContourFile();
        }
        return;
      }
      onlineProbeStreakRef.current = 0;

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
          await loadBestContourFile(pos.coords.latitude, pos.coords.longitude);
          await loadBestTrailFile();
        }
      } catch { await loadBestContourFile(); await loadBestTrailFile(); }
      setTileDebug(`${files.length} region map${files.length === 1 ? '' : 's'} saved`);
      await switchFile(best.path, best.sizeMb);
    })();

    return () => { tileServer?.stopServer().catch(() => {}); };
  }, [getDownloadedFiles, switchFile, loadBestContourFile, loadBestTrailFile]);

  // Route state
  const [routeCoords,  setRouteCoords]  = useState<[number,number][]>([]);
  const [routeSteps,   setRouteSteps]   = useState<RouteStep[]>([]);
  const [passedCoords, setPassedCoords] = useState<[number,number][]>([]);
  const [breadcrumb,   setBreadcrumb]   = useState<[number,number][]>([]);
  const [trailHighlight, setTrailHighlight] = useState<GeoJSON.FeatureCollection>(emptyFC);
  const [navTargetIdx, setNavTargetIdx] = useState(-1);
  const [searchDest,   setSearchDest]   = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    trailHighlightRef.current = trailHighlight;
  }, [trailHighlight]);
  const waypointSignature = useMemo(
    () => waypoints.map(w => `${w.lng.toFixed(5)},${w.lat.toFixed(5)}:${w.type}:${w.day}:${w.route_point_type ?? 'break'}`).join('|'),
    [waypoints],
  );
  const routableWaypoints = useMemo(
    () => waypoints.filter(w => w.route_point_type !== 'side_stop'),
    [waypoints],
  );
  const routePairsForWaypoints = useCallback(
    (wps: WP[]) => wps.map(w => `${w.lng},${w.lat}`),
    [],
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
  const effectiveMapLayer: MapMode = mapLayer === 'extreme' ? 'extreme' : showTerrain && mapboxToken ? 'hybrid' : mapLayer;
  const contourMode: ContourSourceMode = effectiveMapLayer === 'satellite'
    ? 'none'
    : localContours
      ? 'local'
      : 'online';
  const trailMode: TrailSourceMode = showTrailOverlay ? (localTrails ? 'local' : 'online') : 'none';
  const mapStyleObj = useMemo(
    () => buildMapStyle(effectiveMapLayer, mapboxToken || '', localTiles, tileSession, contourMode, trailMode, showNautical, showTerrain, props.premiumMapStyle),
    [effectiveMapLayer, mapboxToken, localTiles, tileSession, contourMode, trailMode, showNautical, showTerrain, props.premiumMapStyle],
  );
  const premiumStyle = props.premiumMapStyle ?? 'standard';
  const mapboxStyleURL = MAPBOX_STYLE_URLS[premiumStyle] ?? MAPBOX_STYLE_URLS.standard;
  const mapboxStyleImportConfig = useMemo(() => {
    const lightPreset = MAPBOX_LIGHT_PRESETS[premiumStyle] ?? (showTerrain ? 'day' : 'day');
    return {
      lightPreset,
      show3dObjects: showTerrain ? 'true' : 'false',
      show3dBuildings: showTerrain ? 'true' : 'false',
      show3dLandmarks: showTerrain ? 'true' : 'false',
      showLandmarkIcons: 'true',
      showLandmarkIconLabels: 'true',
      showPointOfInterestLabels: 'true',
      showPointofInterestLabels: 'true',
      showRoadLabels: 'true',
      showPlaceLabels: 'true',
      theme: premiumStyle === 'night' || premiumStyle === 'navigation_night' ? 'monochrome' : 'default',
    };
  }, [premiumStyle, showTerrain]);

  useEffect(() => {
    if (!mapboxToken) return;
    MapboxGL.setAccessToken(mapboxToken).catch(() => {});
  }, [mapboxToken]);

  useEffect(() => {
    if (!isExtremeMapbox || !mapboxStandardInteractions?.enable || !mapboxStandardInteractionEvents) return;
    let mounted = true;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const sub = mapboxStandardInteractionEvents.addListener('onStandardFeatureTap', (event: any) => {
      if (!mounted) return;
      if (suppressFeatureTapsRef.current) return;
      const poi = mapboxStandardFeatureEventToPoi(event);
      if (poi) {
        lastNativeStandardTapRef.current = { at: Date.now(), lat: poi.lat, lng: poi.lng };
        onPoiTapRef.current?.(poi);
      }
    });
    const enable = () => {
      attempts += 1;
      mapboxStandardInteractions?.enable?.()
        .then(ok => {
          if (!ok && mounted && attempts < 6) retry = setTimeout(enable, 350);
        })
        .catch(() => {
          if (mounted && attempts < 6) retry = setTimeout(enable, 350);
        });
    };
    enable();
    return () => {
      mounted = false;
      if (retry) clearTimeout(retry);
      sub.remove();
      mapboxStandardInteractions?.disable?.().catch(() => {});
    };
  }, [isExtremeMapbox]);

  useEffect(() => {
    if (navMode) return;
    lastCamRef.current = Date.now();
    freeCameraDefaultRef.current = {
      ...freeCameraDefaultRef.current,
      pitch: showTerrain ? 68 : 0,
      animationDuration: 0,
    };
    emitDebugEvent('camera:set:terrain-pitch', { pitch: showTerrain ? 68 : 0 });
    camRef.current?.setCamera({
      pitch: showTerrain ? 68 : 0,
      animationDuration: 520,
      animationMode: 'easeTo',
    } as any);
  }, [emitDebugEvent, navMode, showTerrain]);

  useEffect(() => {
    emitDebugEvent('camera:branch', {
      branch: navMode && navCameraFollow ? 'nav-follow' : 'free',
      freeCameraRevision,
      defaultCenter: freeCameraDefaultRef.current.centerCoordinate,
      defaultZoom: freeCameraDefaultRef.current.zoomLevel,
    });
  }, [emitDebugEvent, freeCameraRevision, navCameraFollow, navMode]);

  useEffect(() => {
    if (!pendingFreeCameraRef.current) return;
    const timer = setTimeout(() => {
      const pending = pendingFreeCameraRef.current;
      pendingFreeCameraRef.current = null;
      emitDebugEvent('camera:pending-free-camera:apply', { freeCameraRevision });
      pending?.();
    }, 40);
    return () => clearTimeout(timer);
  }, [emitDebugEvent, freeCameraRevision]);

  // ── Imperative API (replaces postMessage) ───────────────────────────────────
  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom = 14) {
      lastFlyToRef.current = Date.now();
      lastCamRef.current = Date.now();
      programmaticCameraUntilRef.current = Date.now() + 1100;
      const pitch = navMode ? freeCameraDefaultRef.current.pitch : showTerrain ? 62 : 0;
      rememberFreeCamera(lat, lng, zoom, pitch);
      emitDebugEvent('camera:set:flyTo', { lat, lng, zoom, pitch, programmatic_until_ms: programmaticCameraUntilRef.current - Date.now() });
      camRef.current?.setCamera({
        centerCoordinate: [lng, lat],
        zoomLevel: zoom,
        pitch,
        animationDuration: showTerrain && !navMode ? 620 : 250,
        animationMode: 'flyTo',
      } as any);
    },
    flyToCamera(options) {
      const lat = Number(options.lat);
      const lng = Number(options.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      lastFlyToRef.current = Date.now();
      lastCamRef.current = Date.now();
      programmaticCameraUntilRef.current = Date.now() + Math.max(900, (Number.isFinite(Number(options.duration)) ? Number(options.duration) : 520) + 450);
      rememberFreeCamera(
        lat,
        lng,
        Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : undefined,
        Number.isFinite(Number(options.pitch)) ? Math.max(0, Math.min(75, Number(options.pitch))) : undefined,
      );
      emitDebugEvent('camera:set:flyToCamera', {
        lat,
        lng,
        zoom: options.zoom ?? null,
        pitch: options.pitch ?? null,
        bearing: options.bearing ?? null,
        duration: options.duration ?? null,
        mode: options.mode || 'flyTo',
      });
      camRef.current?.setCamera({
        centerCoordinate: [lng, lat],
        ...(Number.isFinite(Number(options.zoom)) ? { zoomLevel: clampMapZoom(Number(options.zoom), 14) } : {}),
        ...(Number.isFinite(Number(options.pitch)) ? { pitch: Math.max(0, Math.min(75, Number(options.pitch))) } : {}),
        ...(Number.isFinite(Number(options.bearing)) ? { heading: Number(options.bearing) } : {}),
        animationDuration: Number.isFinite(Number(options.duration)) ? Number(options.duration) : 520,
        animationMode: options.mode || 'flyTo',
      } as any);
    },
    async setZoom(zoom, focus) {
      const nextZoom = clampMapZoom(Number(zoom), 12);
      const lat = Number(focus?.lat);
      const lng = Number(focus?.lng);
      const hasFocus = Number.isFinite(lat) && Number.isFinite(lng);
      lastCamRef.current = Date.now();
      programmaticCameraUntilRef.current = Date.now() + 900;
      if (hasFocus) rememberFreeCamera(lat, lng, nextZoom, navMode ? freeCameraDefaultRef.current.pitch : showTerrain ? 68 : 0);
      else freeCameraDefaultRef.current = { ...freeCameraDefaultRef.current, zoomLevel: nextZoom, animationDuration: 0 };
      emitDebugEvent('camera:set:setZoom', { zoom: nextZoom, focus: hasFocus ? { lat, lng } : null });
      camRef.current?.setCamera({
        ...(hasFocus ? { centerCoordinate: [lng, lat] } : {}),
        zoomLevel: nextZoom,
        animationDuration: 240,
        animationMode: 'easeTo',
      } as any);
      return nextZoom;
    },
    async zoomBy(delta, focus) {
      if (!mapRef.current) return null;
      const current = await mapRef.current.getZoom().catch(() => null);
      const base = Number.isFinite(Number(current)) ? Number(current) : 12;
      const nextZoom = clampMapZoom(base + (Number.isFinite(Number(delta)) ? Number(delta) : 1), base);
      const lat = Number(focus?.lat);
      const lng = Number(focus?.lng);
      const hasFocus = Number.isFinite(lat) && Number.isFinite(lng);
      lastCamRef.current = Date.now();
      programmaticCameraUntilRef.current = Date.now() + 900;
      if (hasFocus) rememberFreeCamera(lat, lng, nextZoom, navMode ? freeCameraDefaultRef.current.pitch : showTerrain ? 68 : 0);
      else freeCameraDefaultRef.current = { ...freeCameraDefaultRef.current, zoomLevel: nextZoom, animationDuration: 0 };
      emitDebugEvent('camera:set:zoomBy', { delta, zoom: nextZoom, base, focus: hasFocus ? { lat, lng } : null });
      camRef.current?.setCamera({
        ...(hasFocus ? { centerCoordinate: [lng, lat] } : {}),
        zoomLevel: nextZoom,
        animationDuration: 240,
        animationMode: 'easeTo',
      } as any);
      return nextZoom;
    },
    async locate(lat, lng) {
      clearLocateSettleTimers();
      lastFlyToRef.current = Date.now();
      lastCamRef.current = Date.now();
      programmaticCameraUntilRef.current = Date.now() + (Platform.OS === 'ios' ? 1600 : 1200);
      emitDebugEvent('locate:start', { lat, lng });
      const current = await mapRef.current?.getZoom?.().catch(() => null);
      const currentZoom = Number(current);
      const zoomLevel = Number.isFinite(currentZoom)
        ? Math.max(9, Math.min(13, currentZoom))
        : 11.5;
      rememberFreeCamera(lat, lng, zoomLevel, navMode ? freeCameraDefaultRef.current.pitch : showTerrain ? 68 : 0);
      emitDebugEvent('locate:set-camera', { lat, lng, currentZoom: Number.isFinite(currentZoom) ? currentZoom : null, zoomLevel });
      applyLocateCamera(lat, lng, zoomLevel, true);
      if (Platform.OS === 'ios') {
        [180, 460].forEach(delay => {
          const timer = setTimeout(() => {
            if (Date.now() < userCameraGestureUntilRef.current) return;
            lastCamRef.current = Date.now();
            programmaticCameraUntilRef.current = Date.now() + 700;
            rememberFreeCamera(lat, lng, zoomLevel, navMode ? freeCameraDefaultRef.current.pitch : showTerrain ? 68 : 0);
            emitDebugEvent('locate:settle-camera', { lat, lng, zoomLevel, delay });
            applyLocateCamera(lat, lng, zoomLevel, false);
          }, delay);
          locateSettleTimersRef.current.push(timer);
        });
      }
    },
    loadRouteFrom(lat, lng, fromIdx) {
      const rem = waypoints.slice(fromIdx).filter(w => w.route_point_type !== 'side_stop');
      const pairs = [`${lng},${lat}`, ...routePairsForWaypoints(rem)];
      doFetchRoute(pairs, fromIdx);
    },
    loadRouteSegmentFrom(lat, lng, fromIdx, toIdx) {
      const start = Math.max(0, Math.min(fromIdx, waypoints.length - 1));
      const end = Math.max(start, Math.min(toIdx, waypoints.length - 1));
      const rem = waypoints.slice(start, end + 1).filter(w => w.route_point_type !== 'side_stop');
      const pairs = [`${lng},${lat}`, ...routePairsForWaypoints(rem)];
      if (pairs.length >= 2) doFetchRoute(pairs, start);
    },
    rerouteFrom(lat, lng, fromIdx) {
      setPassedCoords([]);
      routeRef.current.passedIdx = 0;
      routeRef.current.passedProgressM = 0;
      const rem = waypoints.slice(fromIdx).filter(w => w.route_point_type !== 'side_stop');
      const pairs = rem.length
        ? [`${lng},${lat}`, ...routePairsForWaypoints(rem)]
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
      setRouteCoords([]); setRouteSteps([]); setPassedCoords([]); setBreadcrumb([]);
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
    async highlightTrail(lat, lng, name) {
      lastFlyToRef.current = Date.now();
      lastCamRef.current = Date.now();
      programmaticCameraUntilRef.current = Date.now() + 1100;
      const pitch = navMode ? freeCameraDefaultRef.current.pitch : showTerrain ? 62 : 0;
      rememberFreeCamera(lat, lng, 13, pitch);
      emitDebugEvent('camera:set:highlightTrail', { lat, lng, name: name ?? null, pitch });
      camRef.current?.setCamera({ centerCoordinate: [lng, lat], zoomLevel: 13, pitch, animationDuration: showTerrain && !navMode ? 640 : 260, animationMode: 'flyTo' } as any);
      setTimeout(async () => {
        if (!mapRef.current) return;
        try {
          const center = await mapRef.current.getPointInView([lng, lat]);
          const [cx, cy] = center.map(Number);
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
          const offsets = [
            [0, 0], [-18, 0], [18, 0], [0, -18], [0, 18],
            [-28, -18], [28, -18], [-28, 18], [28, 18],
          ];
          const layerIds = ['trail-pack-line', 'road-path', 'road-other', 'mvum-trails-line', 'mvum-roads-line'];
          const rendered: any[] = [];
          const screen = Dimensions.get('window');
          const rect = renderedQueryRectAroundPoint(cx, cy, 170);
          const rectFound = await (mapRef.current as any).queryRenderedFeaturesInRect?.(
            rect,
            undefined,
            layerIds,
          ).catch(() => null);
          const rectFeatures = Array.isArray(rectFound) ? rectFound : rectFound?.features;
          if (Array.isArray(rectFeatures)) rendered.push(...rectFeatures);
          const viewportFound = await (mapRef.current as any).queryRenderedFeaturesInRect?.(
            renderedQueryViewportRect(screen),
            undefined,
            layerIds,
          ).catch(() => null);
          const viewportFeatures = Array.isArray(viewportFound) ? viewportFound : viewportFound?.features;
          if (Array.isArray(viewportFeatures)) rendered.push(...viewportFeatures);
          for (const [dx, dy] of offsets) {
            const found = await mapRef.current.queryRenderedFeaturesAtPoint(
              [cx + dx, cy + dy],
              undefined,
              layerIds,
            ).catch(() => null);
            const features = Array.isArray(found) ? found : found?.features;
            if (Array.isArray(features)) rendered.push(...features);
          }
          const graph = buildOfflineTrailGraphSelection(rendered, [lng, lat], name);
          const features = graph.features.length ? graph.features : buildTrailSystemFeatures(rendered, [lng, lat], name);
          setTrailHighlight(features.length ? pointFC(features) : emptyFC());
        } catch {
          setTrailHighlight(emptyFC());
        }
      }, 340);
    },
    clearTrailHighlight() {
      setTrailHighlight(emptyFC());
    },
    getTrailHighlight() {
      return trailHighlightRef.current;
    },
    async captureTrailAt(lat, lng, name) {
      if (!mapRef.current) return emptyFC();
      try {
        const center = await mapRef.current.getPointInView([lng, lat]);
        const [cx, cy] = center.map(Number);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return emptyFC();
        const layerIds = ['trail-pack-line', 'road-path', 'road-other', 'mvum-trails-line', 'mvum-roads-line'];
        const rendered: any[] = [];
        const rectFound = await (mapRef.current as any).queryRenderedFeaturesInRect?.(
          renderedQueryRectAroundPoint(cx, cy, 150),
          undefined,
          layerIds,
        ).catch(() => null);
        const rectFeatures = Array.isArray(rectFound) ? rectFound : rectFound?.features;
        if (Array.isArray(rectFeatures)) rendered.push(...rectFeatures);
        for (const [dx, dy] of [[0, 0], [-16, 0], [16, 0], [0, -16], [0, 16], [-28, -18], [28, -18], [-28, 18], [28, 18]]) {
          const found = await mapRef.current.queryRenderedFeaturesAtPoint(
            [cx + dx, cy + dy],
            undefined,
            layerIds,
          ).catch(() => null);
          const features = Array.isArray(found) ? found : found?.features;
          if (Array.isArray(features)) rendered.push(...features);
        }
        const graph = buildOfflineTrailGraphSelection(rendered, [lng, lat], name);
        const features = graph.features.length ? graph.features : buildTrailSystemFeatures(rendered, [lng, lat], name);
        return features.length ? pointFC(features) : emptyFC();
      } catch {
        return emptyFC();
      }
    },
    async screenToCoordinate(x, y) {
      if (!mapRef.current) return null;
      try {
        const coord = await mapRef.current.getCoordinateFromView([x, y]);
        const [lng, lat] = coord.map(Number);
        return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
      } catch {
        return null;
      }
    },
    async selectFeatureAtScreenPoint(x, y) {
      if (!mapRef.current) return null;
      const px = Number(x);
      const py = Number(y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
      try {
        const coord = await mapRef.current.getCoordinateFromView([px, py]).catch(() => null);
        const lng = Number(coord?.[0]);
        const lat = Number(coord?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const rendered: any[] = [];
        const rectFound = await (mapRef.current as any).queryRenderedFeaturesInRect?.(
          renderedQueryRectAroundPoint(px, py, 72),
          undefined,
          undefined,
        ).catch(() => null);
        const rectFeatures = Array.isArray(rectFound) ? rectFound : rectFound?.features;
        if (Array.isArray(rectFeatures)) rendered.push(...rectFeatures);
        const pointFound = await mapRef.current.queryRenderedFeaturesAtPoint([px, py], undefined, undefined).catch(() => null);
        const pointFeatures = Array.isArray(pointFound) ? pointFound : pointFound?.features;
        if (Array.isArray(pointFeatures)) rendered.push(...pointFeatures);
        const poi = bestMapboxPoiFromFeatures(rendered, lat, lng);
        const feature = poi ? selectableFeatureFromPoi(poi, 0, (poi as any).source_layer || null, null) : null;
        return feature ? { ...feature, screen_x: px, screen_y: py, screen_position: screenPositionLabel(px, py), confidence: 'high' } : null;
      } catch {
        return null;
      }
    },
    async queryVisibleFeatures() {
      if (!mapRef.current) return [];
      try {
        const screen = Dimensions.get('window');
        const bounds = await mapRef.current.getVisibleBounds().catch(() => null);
        const center = bounds
          ? { lat: (Number(bounds[0]?.[1]) + Number(bounds[1]?.[1])) / 2, lng: (Number(bounds[0]?.[0]) + Number(bounds[1]?.[0])) / 2 }
          : null;
        const rectFound = await (mapRef.current as any).queryRenderedFeaturesInRect?.(
          renderedQueryViewportRect(screen),
          undefined,
          undefined,
        ).catch(() => null);
        const rectFeatures = Array.isArray(rectFound) ? rectFound : rectFound?.features;
        const features = normalizeRenderedFeatureList(rectFeatures, center);
        const enriched: MapSelectableFeature[] = [];
        for (const feature of features) {
          let sx: number | null = null;
          let sy: number | null = null;
          try {
            const point = await mapRef.current.getPointInView([feature.lng, feature.lat]);
            sx = Number(point?.[0]);
            sy = Number(point?.[1]);
          } catch {}
          enriched.push({
            ...feature,
            screen_x: Number.isFinite(sx) ? sx : null,
            screen_y: Number.isFinite(sy) ? sy : null,
            screen_position: Number.isFinite(sx) && Number.isFinite(sy) ? screenPositionLabel(sx!, sy!, screen) : feature.screen_position ?? null,
          });
        }
        return enriched;
      } catch {
        return [];
      }
    },
    async getVisibleMapCandidates() {
      if (!mapRef.current) return [];
      try {
        const screen = Dimensions.get('window');
        const bounds = await mapRef.current.getVisibleBounds().catch(() => null);
        const center = bounds
          ? { lat: (Number(bounds[0]?.[1]) + Number(bounds[1]?.[1])) / 2, lng: (Number(bounds[0]?.[0]) + Number(bounds[1]?.[0])) / 2 }
          : null;
        const rectFound = await (mapRef.current as any).queryRenderedFeaturesInRect?.(
          renderedQueryViewportRect(screen),
          undefined,
          undefined,
        ).catch(() => null);
        const rectFeatures = Array.isArray(rectFound) ? rectFound : rectFound?.features;
        const features = normalizeRenderedFeatureList(rectFeatures, center);
        const enriched: MapSelectableFeature[] = [];
        for (const feature of features) {
          let sx: number | null = null;
          let sy: number | null = null;
          try {
            const point = await mapRef.current.getPointInView([feature.lng, feature.lat]);
            sx = Number(point?.[0]);
            sy = Number(point?.[1]);
          } catch {}
          enriched.push({
            ...feature,
            screen_x: Number.isFinite(sx) ? sx : null,
            screen_y: Number.isFinite(sy) ? sy : null,
            screen_position: Number.isFinite(sx) && Number.isFinite(sy) ? screenPositionLabel(sx!, sy!, screen) : feature.screen_position ?? null,
          });
        }
        return enriched;
      } catch {
        return [];
      }
    },
    async getVisibleCenter() {
      if (!mapRef.current) return null;
      try {
        const bounds = await mapRef.current.getVisibleBounds();
        if (!bounds) return null;
        const [[e, n], [w, s]] = bounds;
        const lng = (Number(e) + Number(w)) / 2;
        const lat = (Number(n) + Number(s)) / 2;
        return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
      } catch {
        return null;
      }
    },
    async getVisibleBounds() {
      if (!mapRef.current) return null;
      try {
        const bounds = await mapRef.current.getVisibleBounds();
        if (!bounds) return null;
        const [[e, n], [w, s]] = bounds;
        const zoom = await mapRef.current.getZoom().catch(() => 10);
        const next = { n: Number(n), s: Number(s), e: Number(e), w: Number(w), zoom: Number(zoom) || 10 };
        return [next.n, next.s, next.e, next.w].every(Number.isFinite) ? next : null;
      } catch {
        return null;
      }
    },
    restoreRoute(coords, steps, legs, td, tt) {
      setRouteCoords(coords);
      setRouteSteps(steps);
      routeRef.current = makeRouteState(coords);
      onRouteReady({ coords, steps, legs, totalDistance: td, totalDuration: tt, isProper: true, fromCache: true, fromIdx: 0 });
    },
    setNavTarget(idx) { setNavTargetIdx(idx); },
  }), [applyLocateCamera, clearLocateSettleTimers, emitDebugEvent, waypoints, routePairsForWaypoints, searchDest, mapboxToken, makeRouteState, navMode, rememberFreeCamera, showTerrain]);

  const emitTracePoint = useCallback(async (
    x: number,
    y: number,
    phase: 'start' | 'move',
  ) => {
    if (!traceMode || !mapRef.current) return;
    const now = Date.now();
    if (phase === 'move' && now - lastTracePointRef.current < 45) return;
    lastTracePointRef.current = now;
    try {
      const coord = await mapRef.current.getCoordinateFromView([x, y]);
      const [lng, lat] = coord.map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (phase === 'start') onTraceStart?.([lng, lat]);
      else onTraceMove?.([lng, lat]);
    } catch {}
  }, [onTraceMove, onTraceStart, traceMode]);

  const tracePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => traceMode,
    onMoveShouldSetPanResponder: () => traceMode,
    onPanResponderGrant: evt => {
      emitTracePoint(evt.nativeEvent.locationX, evt.nativeEvent.locationY, 'start');
    },
    onPanResponderMove: evt => {
      emitTracePoint(evt.nativeEvent.locationX, evt.nativeEvent.locationY, 'move');
    },
    onPanResponderRelease: () => onTraceEnd?.(),
    onPanResponderTerminate: () => onTraceEnd?.(),
  }), [emitTracePoint, onTraceEnd, traceMode]);

  // ── Routing ─────────────────────────────────────────────────────────────────
  const doFetchRoute = useCallback(async (pairs: string[], fromIdx: number) => {
    const requestId = ++routeRequestRef.current;
    isRoutingRef.current = true;
    onRouteProgress?.(null);
    offRouteStreakRef.current = 0;
    wasOffRouteRef.current = false;
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
      const result = await fetchRoute(pairs, fromIdx, mapboxToken || '', routeOpts, routeProviderMode);
      if (requestId !== routeRequestRef.current) return;
      setRouteCoords(result.coords);
      setRouteSteps(result.steps);
      routeRef.current = makeRouteState(result.coords);
      onRouteReady({ ...result, fromIdx });
      // Persist for offline relaunch
      onRoutePersist({
        coords: result.coords, steps: result.steps, legs: result.legs,
        totalDistance: result.totalDistance, totalDuration: result.totalDuration,
        tripId: activeTrip?.trip_id ?? null,
        routeSource: (result as any).routeSource ?? null,
        routeSourceLabel: (result as any).routeSourceLabel ?? null,
      });
      const routePayload = {
        coords: result.coords, steps: result.steps, legs: result.legs,
        totalDistance: result.totalDistance, totalDuration: result.totalDuration,
        tripId: activeTrip?.trip_id ?? null, ts: Date.now(),
        routeSource: (result as any).routeSource ?? null,
        routeSourceLabel: (result as any).routeSourceLabel ?? null,
      };
      storage.set('trailhead_active_route', JSON.stringify(routePayload)).catch(() => {});
      saveRouteGeometry(activeTrip?.trip_id, routePayload).catch(() => {});
    } catch {
      if (requestId !== routeRequestRef.current) return;
      const fb = buildFallbackRoute(pairs);
      setRouteCoords(fb.coords);
      setRouteSteps(fb.steps);
      routeRef.current = makeRouteState(fb.coords);
      onRouteReady({ ...fb, fromIdx });
    } finally {
      if (requestId === routeRequestRef.current) isRoutingRef.current = false;
    }
  }, [mapboxToken, routeOpts, routeProviderMode, waypoints, activeTrip, onRouteReady, onRoutePersist, ensureRouteTileFile, makeRouteState]);

  // When a new trip is planned: auto-route + fit camera to show all waypoints
  useEffect(() => {
    if (routableWaypoints.length < 2) return;
    routeRequestRef.current++;
    isRoutingRef.current = false;
    setRouteCoords([]);
    setRouteSteps([]);
    setPassedCoords([]);
    setBreadcrumb([]);
    routeRef.current = makeRouteState([]);
    if (!navMode && routableWaypoints.length > 10) {
      const previewCoords = routableWaypoints.map(w => [w.lng, w.lat] as [number, number]);
      setRouteCoords(previewCoords);
      setRouteSteps([]);
      routeRef.current = makeRouteState(previewCoords);
    } else {
      doFetchRoute(routePairsForWaypoints(routableWaypoints), 0);
    }
    // Fit camera to the trip bounding box (skip if actively navigating)
    if (!navMode) {
      const lngs = routableWaypoints.map(w => w.lng);
      const lats = routableWaypoints.map(w => w.lat);
      const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
      const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
      // Small delay lets the map finish loading the tile layer first
      setTimeout(() => {
        camRef.current?.fitBounds(ne, sw, [80, 50, 120, 50], 900);
      }, 400);
    }
  }, [waypointSignature]);

  // ── Nav: track user on route + update passed overlay ────────────────────────
  useEffect(() => {
    if (nativeNavEngineActive || !navMode || !userLoc || isRoutingRef.current || routeRef.current.coords.length === 0) return;
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

    const warnThreshold = Math.max(30, accuracy * 1.2 + 15);
    const rerouteThreshold = Math.max(50, accuracy * 1.8 + 25);
    const allowReroute = speed > 1.2 || snap.distanceM > rerouteThreshold + 45;
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
  }, [userLoc, navMode, nativeNavEngineActive, navSpeed, onOffRoute, onOffRouteWarn, onBackOnRoute, onRouteProgress]);

  // ── GeoJSON sources ─────────────────────────────────────────────────────────
  const campFC = useMemo(() => pointFC(camps.map(campFeat)), [camps]);
  const gasFC  = useMemo(() => pointFC(gas.map(g => ({
    type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [g.lng, g.lat] },
    properties: { name: g.name },
  }))), [gas]);
  const poiFC = useMemo(() => pointFC(pois.map(p => ({
    type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    properties: { ...p, raw: JSON.stringify(p) },
  }))), [pois]);
  const waterNavLineFC = useMemo(() => (
    waterNavLines && Array.isArray(waterNavLines.features)
      ? waterNavLines
      : { type: 'FeatureCollection' as const, features: [] }
  ), [waterNavLines]);
  const waterSpotFC = useMemo(() => pointFC((waterSpotCards ?? []).map(card => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [card.lng, card.lat] },
    properties: {
      id: card.id,
      name: card.name,
      kind: card.kind,
      species: (card.species_targets ?? []).join(', '),
      raw: JSON.stringify(card),
    },
  }))), [waterSpotCards]);
  const waterCorridorFC = useMemo(() => {
    const coords = waterCorridor?.geometry?.coordinates ?? waterFollowRoute?.geometry ?? [];
    if (!coords.length) return { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] };
    const features: GeoJSON.Feature[] = [{
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: coords },
      properties: {
        status: waterCorridor?.status ?? 'following',
        distance_mi: waterCorridor?.distance_mi ?? waterFollowRoute?.distanceMi ?? 0,
        source_confidence: waterCorridor?.source_confidence ?? waterFollowRoute?.sourceConfidence ?? '',
      },
    }];
    const start = coords[0];
    const end = coords[coords.length - 1];
    const next = coords[Math.min(coords.length - 1, Math.max(1, Math.floor(coords.length * 0.28)))];
    [
      { coord: start, role: 'start', label: 'S' },
      { coord: next, role: 'next', label: 'N' },
      { coord: end, role: 'end', label: 'E' },
    ].forEach(item => {
      if (!item.coord) return;
      features.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: item.coord },
        properties: { role: item.role, label: item.label },
      });
    });
    return { type: 'FeatureCollection' as const, features };
  }, [waterCorridor, waterFollowRoute]);
  const waterRouteVisualActive = waterCorridorFC.features.length > 0 && (showNautical || !!waterFollowRoute);
  const routeTurnFC = useMemo(() => pointFC(routeSteps.flatMap((step, idx) => {
    if (step.lat == null || step.lng == null) return [];
    const arrow = maneuverArrowText(step);
    if (!arrow) return [];
    return [{
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [step.lng, step.lat] },
      properties: {
        arrow,
        idx,
        modifier: step.modifier || '',
        type: step.type || '',
      },
    }];
  })), [routeSteps]);

  // ── Map event handlers ───────────────────────────────────────────────────────
  const handleMapReady = useCallback(() => {
    emitDebugEvent('map:ready');
    onMapReady();
    restoreRecentViewportIfNeeded().catch(() => {});
  }, [emitDebugEvent, onMapReady, restoreRecentViewportIfNeeded]);

  const handleRegionIsChanging = useCallback((feat: any) => {
    if (!isUserCameraEvent(feat)) return;
    const props = feat?.properties ?? {};
    markUserCameraGesture('region-is-changing', {
      zoom: props.zoomLevel ?? null,
      center: Array.isArray(feat?.geometry?.coordinates) ? feat.geometry.coordinates : null,
      isUserInteraction: !!props.isUserInteraction,
      isAnimatingFromUserInteraction: !!props.isAnimatingFromUserInteraction,
    });
    emitDebugEvent('region:is-changing:user', {
      zoom: props.zoomLevel ?? null,
      center: Array.isArray(feat?.geometry?.coordinates) ? feat.geometry.coordinates : null,
      isUserInteraction: !!props.isUserInteraction,
      isAnimatingFromUserInteraction: !!props.isAnimatingFromUserInteraction,
    });
  }, [emitDebugEvent, markUserCameraGesture]);

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
      const nativeTap = lastNativeStandardTapRef.current;
      if (nativeTap && Date.now() - nativeTap.at < 2500) {
        const distanceMiles = haversineMiles(lat, lng, nativeTap.lat, nativeTap.lng);
        if (Number.isFinite(distanceMiles) && distanceMiles < 0.08) return;
      }
      if (suppressFeatureTaps) {
        onMapTap(lat, lng);
        return;
      }
      try {
        const point = eventScreenPoint(feat);
        const pressPoint = point ?? await mapRef.current.getPointInView([lng, lat]);
        if (showNautical) {
          const navRendered = await mapRef.current.queryRenderedFeaturesAtPoint(
            pressPoint,
            undefined,
            ['water-nav-aid', 'water-nav-code', 'water-nav-line', 'hydro-hazard-line', 'hydro-hazard-glow', 'hydro-depth-label', 'hydro-depth-index-contour', 'hydro-depth-contour', 'hydro-depth-area']
          );
          const navFeatures = Array.isArray(navRendered) ? navRendered : navRendered?.features;
          const navFeat = navFeatures?.[0];
          if (navFeat?.properties) {
            const coords = navFeat.geometry?.type === 'Point'
              ? (navFeat.geometry as GeoJSON.Point).coordinates
              : [lng, lat];
            const layerId = navFeat.layer?.id || '';
            onPoiTap?.(String(layerId).startsWith('hydro-')
              ? mapHydroPoi(navFeat.properties, coords[1] ?? lat, coords[0] ?? lng)
              : mapWaterNavigationPoi(navFeat.properties, coords[1] ?? lat, coords[0] ?? lng));
            return;
          }
          const waterRendered = await mapRef.current.queryRenderedFeaturesAtPoint(
            pressPoint,
            undefined,
            ['water-poly', 'water-river']
          );
          const waterFeatures = Array.isArray(waterRendered) ? waterRendered : waterRendered?.features;
          const waterFeat = waterFeatures?.[0];
          if (waterFeat?.properties) {
            onPoiTap?.(mapWaterPoi(waterFeat.properties, lat, lng));
            return;
          }
        }
        const rendered = await mapRef.current.queryRenderedFeaturesAtPoint(
          pressPoint,
          undefined,
          ['water-poly', 'water-river', 'trail-pack-line', 'pm-pois-camp-site', 'pm-pois-camp-pitch', 'pm-pois-shelter', 'pm-pois-trailhead']
        );
        const renderedFeatures = Array.isArray(rendered) ? rendered : rendered?.features;
        const tileFeat = renderedFeatures?.[0];
        if (tileFeat?.properties) {
          const kind = tileFeat.properties.kind ?? 'camp_site';
          const name = tileFeat.properties.name ?? kindLabel(kind);
          const coords = tileFeat.geometry?.type === 'Point'
            ? (tileFeat.geometry as GeoJSON.Point).coordinates
            : [lng, lat];
          if (tileFeat.layer?.id === 'trail-pack-line') {
            onTrailTap(name || 'Trail', lat, lng);
            return;
          }
          if (kind === 'trailhead') {
            onTrailTap(name, coords[1] ?? lat, coords[0] ?? lng);
            return;
          }
          if (tileFeat.layer?.id === 'water-poly' || tileFeat.layer?.id === 'water-river') {
            onPoiTap?.(mapWaterPoi(tileFeat.properties, lat, lng));
            return;
          }
          onTileCampTap(name, kind, coords[1] ?? lat, coords[0] ?? lng);
          return;
        }
        const mapboxRendered: any[] = [];
        const [px, py] = pressPoint.map(Number);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          const rectFound = await (mapRef.current as any).queryRenderedFeaturesInRect?.(
            renderedQueryRectAroundPoint(px, py, 72),
            undefined,
            undefined,
          ).catch(() => null);
          const rectFeatures = Array.isArray(rectFound) ? rectFound : rectFound?.features;
          if (Array.isArray(rectFeatures)) mapboxRendered.push(...rectFeatures);
        }
        const pointFound = await mapRef.current.queryRenderedFeaturesAtPoint(
          pressPoint,
          undefined,
          undefined,
        );
        const pointFeatures = Array.isArray(pointFound) ? pointFound : pointFound?.features;
        if (Array.isArray(pointFeatures)) mapboxRendered.push(...pointFeatures);
        const mapboxPoi = bestMapboxPoiFromFeatures(mapboxRendered, lat, lng);
        if (mapboxPoi) {
          onPoiTap?.(mapboxPoi);
          return;
        }
      } catch { /* queryRenderedFeatures may not be supported — fall through */ }
      onMapTap(lat, lng);
    } else {
      onMapTap();
    }
  }, [coordinateFromPress, isExtremeMapbox, onMapTap, onPoiTap, onTileCampTap, onTrailTap, showNautical, suppressFeatureTaps]);

  const handleLongPress = useCallback(async (feat: any) => {
    const lngLat = await coordinateFromPress(feat);
    if (!lngLat) return;
    const [lng, lat] = lngLat;
    onMapLongPress(lat, lng);
  }, [coordinateFromPress, onMapLongPress]);

  const refreshMapSourcesForBounds = useCallback((n: number, s: number, e: number, w: number) => {
    emitDebugEvent('source:refresh:requested', { center: { lat: (n + s) / 2, lng: (e + w) / 2 }, bounds: { n, s, e, w } });
    loadBestContourFile((n + s) / 2, (e + w) / 2).catch(() => {});
    loadBestTrailFile().catch(() => {});

    // Auto-switch region file as map pans only when the live CDN is unreachable.
    // While online, always keep live tiles active even if a downloaded region covers
    // the viewport; otherwise downloaded packs hide online detail outside the pack.
    if (tileServer) {
      const centerLat = (n + s) / 2;
      const centerLng = (e + w) / 2;
      const probeSeq = ++tileProbeSeqRef.current;
      (async () => {
        const online = await probeTileCdn();
        if (probeSeq !== tileProbeSeqRef.current) return;
        onlineTilesRef.current = online;
        onlineProbeStreakRef.current = online ? onlineProbeStreakRef.current + 1 : 0;
        const canUseOnline = online && (!navMode || !localTiles || onlineProbeStreakRef.current >= 2);
        emitDebugEvent('source:refresh:probe', { online, canUseOnline, probeSeq, onlineProbeStreak: onlineProbeStreakRef.current });
        if (online) {
          if (canUseOnline) {
            if (localTiles) setLocalTiles(false);
            setTileDebug('Online maps');
          } else {
            setTileDebug('Verifying online maps');
          }
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
        emitDebugEvent('source:refresh:offline-match', { matched: !!match, fileName: match?.path.split('/').pop() ?? null, localTiles });
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
  }, [emitDebugEvent, localTiles, navMode, getDownloadedFiles, switchFile, loadBestContourFile, loadBestTrailFile]);

  useEffect(() => () => {
    if (deferredSourceRefreshRef.current) clearTimeout(deferredSourceRefreshRef.current);
    clearLocateSettleTimers();
  }, [clearLocateSettleTimers]);

  const handleRegionChange = useCallback(async (feat: GeoJSON.Feature | undefined) => {
    if (!feat?.properties || !mapRef.current) return;
    const { zoomLevel } = feat.properties;
    const bounds = await mapRef.current.getVisibleBounds();
    if (!bounds) return;
    const [[e, n], [w, s]] = bounds;
    const userDriven = isUserCameraEvent(feat) || Date.now() < userCameraGestureUntilRef.current;
    const programmatic = Date.now() < programmaticCameraUntilRef.current;
    emitDebugEvent('region:did-change', {
      center: { lat: (n + s) / 2, lng: (e + w) / 2 },
      zoom: zoomLevel || 10,
      userDriven,
      programmatic,
      isUserInteraction: !!(feat as any)?.properties?.isUserInteraction,
      isAnimatingFromUserInteraction: !!(feat as any)?.properties?.isAnimatingFromUserInteraction,
    });
    if (userDriven || !programmatic) {
      freeCameraDefaultRef.current = {
        centerCoordinate: [(e + w) / 2, (n + s) / 2],
        zoomLevel: Number.isFinite(Number(zoomLevel)) ? Number(zoomLevel) : freeCameraDefaultRef.current.zoomLevel,
        pitch: navMode ? freeCameraDefaultRef.current.pitch : showTerrain ? 68 : 0,
        animationDuration: 0,
      };
    }
    if (!navMode) {
      persistRecentViewport(
        (n + s) / 2,
        (e + w) / 2,
        Number.isFinite(Number(zoomLevel)) ? Number(zoomLevel) : freeCameraDefaultRef.current.zoomLevel,
        showTerrain ? 68 : 0,
      );
    }
    boundsRef.current = { n, s, e, w };
    onBoundsChange({ n, s, e, w, zoom: zoomLevel || 10 });
    if (showMvum) fetchMvum({ n, s, e, w });
    if (userDriven) {
      if (deferredSourceRefreshRef.current) clearTimeout(deferredSourceRefreshRef.current);
      emitDebugEvent('source:refresh:deferred', { delay_ms: 1400, center: { lat: (n + s) / 2, lng: (e + w) / 2 } });
      deferredSourceRefreshRef.current = setTimeout(() => {
        deferredSourceRefreshRef.current = null;
        refreshMapSourcesForBounds(n, s, e, w);
      }, 1400);
    } else if (programmatic) {
      if (deferredSourceRefreshRef.current) clearTimeout(deferredSourceRefreshRef.current);
      emitDebugEvent('source:refresh:programmatic-deferred', { delay_ms: 900, center: { lat: (n + s) / 2, lng: (e + w) / 2 } });
      deferredSourceRefreshRef.current = setTimeout(() => {
        deferredSourceRefreshRef.current = null;
        refreshMapSourcesForBounds(n, s, e, w);
      }, 900);
    } else {
      refreshMapSourcesForBounds(n, s, e, w);
    }
  }, [emitDebugEvent, onBoundsChange, showMvum, fetchMvum, navMode, persistRecentViewport, showTerrain, refreshMapSourcesForBounds]);

  const handleCampPress = useCallback((e: any) => {
    const feat = e.features?.[0];
    if (!feat) return;
    const coords = (feat.geometry as any)?.coordinates;
    if (suppressFeatureTaps) {
      onMapTap(coords?.[1], coords?.[0]);
      return;
    }
    const p = feat.properties;
    let raw: CampsitePin;
    try { raw = JSON.parse(p.raw || '{}'); } catch { raw = p as any; }
    onCampTap(raw);
  }, [onCampTap, onMapTap, suppressFeatureTaps]);

  const mapStatusLabel = localTiles ? compactMapStatus(tileDebug) : 'Online maps';
  const userLocationShape = userLoc
    ? {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [userLoc.lng, userLoc.lat] },
          properties: { accuracy: userLoc.accuracy ?? null },
        }],
      } as GeoJSON.FeatureCollection
    : emptyFC();
  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={styles.mapRoot}>
      <MapGL.MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        {...(isExtremeMapbox ? { styleURL: mapboxStyleURL } : { mapStyle: mapStyleObj })}
        projection={isExtremeMapbox ? 'mercator' : undefined}
        onPress={handlePress}
        onLongPress={handleLongPress}
        onTouchStart={() => markUserCameraGesture('touch-start', {}, false)}
        onRegionWillChange={(feature: any) => {
          if (isUserCameraEvent(feature)) {
            const props = feature?.properties ?? {};
            markUserCameraGesture('region-will-change', {
              zoom: props.zoomLevel ?? null,
              center: Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null,
              isUserInteraction: !!props.isUserInteraction,
              isAnimatingFromUserInteraction: !!props.isAnimatingFromUserInteraction,
            });
            emitDebugEvent('region:will-change:user', {
              zoom: props.zoomLevel ?? null,
              center: Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null,
              isUserInteraction: !!props.isUserInteraction,
              isAnimatingFromUserInteraction: !!props.isAnimatingFromUserInteraction,
            });
          }
        }}
        onRegionIsChanging={handleRegionIsChanging}
        onRegionDidChange={handleRegionChange}
        onDidFinishLoadingMap={handleMapReady}
        onDidFinishLoadingStyle={() => emitDebugEvent('map:style-loaded', { tileSession, effectiveMapLayer, contourMode, trailMode })}
        compassEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        scrollEnabled
        zoomEnabled
        rotateEnabled
        pitchEnabled
      >
        {isExtremeMapbox && mapboxStyleURL.includes('/standard') && MapGL.StyleImport ? (
          <MapGL.StyleImport
            id="basemap"
            existing
            config={mapboxStyleImportConfig}
          />
        ) : null}
        {isExtremeMapbox && showTerrain && MapGL.RasterDemSource && MapGL.Terrain ? (
          <MapGL.RasterDemSource
            id="trailhead-mapbox-dem"
            tileUrlTemplates={[`https://api.mapbox.com/raster/v1/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}.webp?access_token=${mapboxToken}`]}
            maxZoomLevel={14}
            tileSize={512}
          >
            <MapGL.Terrain sourceID="trailhead-mapbox-dem" style={{ exaggeration: 1.55 }} />
          </MapGL.RasterDemSource>
        ) : null}

      {/* ── Camera ────────────────────────────────────────────────────── */}
      {/* Keep one native Camera instance alive. Remounting Camera while an iOS
          pan gesture disables nav follow can crash RNMapbox/MapLibre. */}
      <MapGL.Camera
        ref={camRef}
        defaultSettings={freeCameraDefaultRef.current}
        followUserLocation={!!(navMode && navCameraFollow)}
        followUserMode={(navSpeed ?? 0) > 1.2 ? MapGL.UserTrackingMode.FollowWithCourse : MapGL.UserTrackingMode.FollowWithHeading}
        followZoomLevel={(navSpeed ?? 0) > 20 ? 15.5 : (navSpeed ?? 0) > 9 ? 16.2 : 17}
        followPitch={showTerrain ? 62 : (navSpeed ?? 0) > 2.2 ? 45 : 0}
        onUserTrackingModeChange={(event: any) => {
          const payload = event?.nativeEvent?.payload ?? {};
          if (payload?.followUserLocation === false) {
            markUserCameraGesture('tracking-mode-change', {
              followUserLocation: false,
              reason: payload?.reason ?? null,
            });
          }
        }}
      />

      {/* ── User location ─────────────────────────────────────────────── */}
      {navMode && navCameraFollow ? (
        <MapGL.UserLocation
          visible={!!userLoc}
          renderMode="normal"
          showsUserHeadingIndicator
          animated
        />
      ) : userLoc ? (
        <MapGL.ShapeSource id="trailhead-user-location" shape={userLocationShape}>
          <MapGL.CircleLayer
            id="trailhead-user-location-halo"
            style={{
              circleRadius: 14,
              circleColor: 'rgba(59,130,246,0.18)',
              circleStrokeColor: 'rgba(255,255,255,0.68)',
              circleStrokeWidth: 1,
            }}
          />
          <MapGL.CircleLayer
            id="trailhead-user-location-dot"
            style={{
              circleRadius: 6,
              circleColor: '#2563eb',
              circleStrokeColor: '#ffffff',
              circleStrokeWidth: 2,
            }}
          />
        </MapGL.ShapeSource>
      ) : null}

      {trailHighlight.features.length > 0 && (
        <MapGL.ShapeSource id="selected-trail-highlight" shape={trailHighlight}>
          <MapGL.LineLayer
            id="selected-trail-highlight-glow"
            style={{
              lineColor: '#f97316',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 12, 16, 17],
              lineOpacity: 0.28,
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
          <MapGL.LineLayer
            id="selected-trail-highlight-line"
            style={{
              lineColor: '#ffb000',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 9, 2.8, 13, 4.8, 16, 7],
              lineOpacity: 0.96,
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
          <MapGL.LineLayer
            id="selected-trail-highlight-core"
            style={{
              lineColor: '#ffffff',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 9, 0.8, 13, 1.4, 16, 2],
              lineOpacity: 0.72,
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
        </MapGL.ShapeSource>
      )}

      {traceDraftCoords.length > 1 && (
        <MapGL.ShapeSource id="trail-trace-draft" shape={lineFC(traceDraftCoords)}>
          <MapGL.LineLayer
            id="trail-trace-draft-glow"
            style={{ lineColor: '#38bdf8', lineWidth: 11, lineBlur: 4, lineOpacity: 0.22, lineCap: 'round', lineJoin: 'round' }}
          />
          <MapGL.LineLayer
            id="trail-trace-draft-line"
            style={{ lineColor: '#38bdf8', lineWidth: 4.2, lineOpacity: 0.92, lineCap: 'round', lineJoin: 'round', lineDasharray: [0.8, 1.4] }}
          />
        </MapGL.ShapeSource>
      )}

      {tracePinCoords.length > 0 && (
        <MapGL.ShapeSource
          id="trail-capture-pins"
          shape={pointFC(tracePinCoords.map((coord, idx) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coord },
            properties: { idx: idx + 1 },
          })))}
        >
          <MapGL.CircleLayer
            id="trail-capture-pin-dot"
            style={{
              circleRadius: 8,
              circleColor: '#38bdf8',
              circleOpacity: 0.98,
              circleStrokeWidth: 2,
              circleStrokeColor: '#fff',
            }}
          />
          <MapGL.SymbolLayer
            id="trail-capture-pin-label"
            style={{
              textField: ['to-string', ['get', 'idx']],
              textSize: 10,
              textColor: '#062033',
              textHaloColor: '#ffffff',
              textHaloWidth: 0.5,
              textFont: ['Open Sans Bold'],
              textAllowOverlap: true,
              textIgnorePlacement: true,
            } as any}
          />
        </MapGL.ShapeSource>
      )}

      {traceRouteCoords.length > 1 && (
        <MapGL.ShapeSource id="trail-trace-route" shape={lineFC(traceRouteCoords)}>
          <MapGL.LineLayer
            id="trail-trace-route-glow"
            style={{ lineColor: '#00a7ff', lineWidth: 13, lineBlur: 5, lineOpacity: 0.28, lineCap: 'round', lineJoin: 'round' }}
          />
          <MapGL.LineLayer
            id="trail-trace-route-line"
            style={{ lineColor: '#00a7ff', lineWidth: 5.5, lineOpacity: 0.96, lineCap: 'round', lineJoin: 'round' }}
          />
        </MapGL.ShapeSource>
      )}

      {/* ── Route line ────────────────────────────────────────────────── */}
      {routeCoords.length > 0 && !waterRouteVisualActive && (
        <MapGL.ShapeSource id="route" shape={lineFC(routeCoords)}>
          <MapGL.LineLayer
            id="route-shadow"
            style={{ lineColor: 'rgba(0,0,0,0.35)', lineWidth: 9, lineBlur: 5, lineTranslate: [0, 2] }}
          />
          <MapGL.LineLayer
            id="route-line"
            style={{ lineColor: '#00a7ff', lineWidth: 5, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.96 }}
          />
          {/* Direction arrows along route — ASCII > rotated along line direction */}
          <MapGL.SymbolLayer
            id="route-arrows"
            minZoomLevel={9}
            style={{
              symbolPlacement: 'line',
              symbolSpacing: 70,
              textField: ['literal', '>'],
              textSize: ['interpolate', ['linear'], ['zoom'], 9, 14, 12, 17, 15, 21, 17, 25],
              textColor: '#111827',
              textHaloColor: 'rgba(255,255,255,0.82)',
              textHaloWidth: 1.2,
              textFont: routeArrowFont,
              textIgnorePlacement: true,
              textAllowOverlap: true,
              textRotationAlignment: 'map',
              textPitchAlignment: 'map',
              textKeepUpright: false,
              textLetterSpacing: 0,
            } as any}
          />
        </MapGL.ShapeSource>
      )}

      {routeTurnFC.features.length > 0 && !waterRouteVisualActive && (
        <MapGL.ShapeSource id="route-turns" shape={routeTurnFC}>
          <MapGL.SymbolLayer
            id="route-turn-shadows"
            minZoomLevel={12}
            style={{
              textField: ['get', 'arrow'],
              textSize: ['interpolate', ['linear'], ['zoom'], 12, 28, 15, 36, 17, 44],
              textColor: 'rgba(2,6,23,0.42)',
              textTranslate: [0, 2],
              textFont: routeTurnFont,
              textIgnorePlacement: true,
              textAllowOverlap: true,
            } as any}
          />
          <MapGL.SymbolLayer
            id="route-turn-arrows"
            minZoomLevel={12}
            style={{
              textField: ['get', 'arrow'],
              textSize: ['interpolate', ['linear'], ['zoom'], 12, 25, 15, 34, 17, 42],
              textColor: '#f8c73d',
              textHaloColor: 'rgba(2,6,23,0.82)',
              textHaloWidth: 2.4,
              textFont: routeTurnFont,
              textIgnorePlacement: true,
              textAllowOverlap: true,
            } as any}
          />
        </MapGL.ShapeSource>
      )}

      {/* ── Passed route dimmed overlay ───────────────────────────────── */}
      {passedCoords.length > 1 && !waterRouteVisualActive && (
        <MapGL.ShapeSource id="route-passed" shape={lineFC(passedCoords)}>
          <MapGL.LineLayer
            id="route-passed-line"
            style={{ lineColor: '#374151', lineWidth: 5, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.72 }}
          />
        </MapGL.ShapeSource>
      )}

      {/* ── Breadcrumb trail ──────────────────────────────────────────── */}
      {breadcrumb.length > 1 && !waterRouteVisualActive && (
        <MapGL.ShapeSource id="breadcrumb" shape={lineFC(breadcrumb)}>
          <MapGL.LineLayer
            id="breadcrumb-line"
            style={{ lineColor: '#3b82f6', lineWidth: 2.5, lineOpacity: 0.8, lineDasharray: [2, 4] }}
          />
        </MapGL.ShapeSource>
      )}

      {showNautical && waterNavLineFC.features.length > 0 && (
        <MapGL.ShapeSource id="water-nav-lines" shape={waterNavLineFC}>
          {!waterFollowRoute && (
            <>
              <MapGL.LineLayer
                id="water-nav-line-casing"
                filter={['==', ['geometry-type'], 'LineString'] as any}
                style={{
                  lineColor: '#04111f',
                  lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 4, 13, 7, 16, 10],
                  lineOpacity: 0.82,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <MapGL.LineLayer
                id="water-nav-line"
                filter={['==', ['geometry-type'], 'LineString'] as any}
                style={{
                  lineColor: ['match', ['get', 'kind'],
                    'marked_channel', '#22c55e',
                    'recommended_track', '#38bdf8',
                    'range_line', '#f59e0b',
                    'traffic_lane', '#818cf8',
                    'deep_water_route', '#2563eb',
                    '#06b6d4'],
                  lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 2, 13, 4, 16, 6],
                  lineOpacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <MapGL.LineLayer
                id="water-nav-recommended-glow"
                filter={['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'kind'], 'recommended_track']] as any}
                style={{
                  lineColor: '#67e8f9',
                  lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 6, 13, 11, 16, 15],
                  lineOpacity: 0.22,
                  lineBlur: 2.5,
                  lineCap: 'round',
                  lineJoin: 'round',
                } as any}
              />
            </>
          )}
          <MapGL.CircleLayer
            id="water-nav-hazard-halo"
            filter={['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], 'water_hazard']] as any}
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 20, 16, 28],
              circleColor: '#ef4444',
              circleOpacity: 0.18,
              circleBlur: 0.9,
            } as any}
          />
          <MapGL.CircleLayer
            id="water-nav-aid"
            filter={['==', ['geometry-type'], 'Point'] as any}
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 8, 16, 11],
              circleColor: ['match', ['get', 'marker_color'],
                'red', '#dc2626',
                'green', '#16a34a',
                'yellow', '#eab308',
                'white', '#f8fafc',
                'black', '#111827',
                'hazard', '#ef4444',
                'channel', '#2563eb',
                '#7c3aed'],
              circleOpacity: 0.94,
              circleStrokeWidth: 2,
              circleStrokeColor: '#fff',
            } as any}
          />
          <MapGL.SymbolLayer
            id="water-nav-code"
            filter={['==', ['geometry-type'], 'Point'] as any}
            style={{
              textField: ['coalesce', ['get', 'code'], 'M'],
              textSize: 9.5,
              textColor: '#fff',
              textHaloColor: 'rgba(0,0,0,0.45)',
              textHaloWidth: 0.9,
              textFont: ['Noto Sans Bold'],
              textAllowOverlap: true,
              textIgnorePlacement: true,
            } as any}
          />
        </MapGL.ShapeSource>
      )}

      {waterRouteVisualActive && (
        <MapGL.ShapeSource id="safe-water-corridor" shape={waterCorridorFC}>
          <MapGL.LineLayer
            id="safe-water-corridor-band"
            filter={['==', ['geometry-type'], 'LineString'] as any}
            style={{
              lineColor: '#67e8f9',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 16, 13, 28, 16, 40],
              lineOpacity: 0.18,
              lineBlur: 1.5,
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
          <MapGL.LineLayer
            id="safe-water-corridor-casing"
            filter={['==', ['geometry-type'], 'LineString'] as any}
            style={{
              lineColor: '#03131d',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 7, 13, 11, 16, 15],
              lineOpacity: 0.92,
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
          <MapGL.LineLayer
            id="safe-water-corridor-line"
            filter={['==', ['geometry-type'], 'LineString'] as any}
            style={{
              lineColor: '#67e8f9',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 8, 3, 13, 5, 16, 7],
              lineOpacity: 0.96,
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
          <MapGL.SymbolLayer
            id="safe-water-corridor-arrows"
            filter={['==', ['geometry-type'], 'LineString'] as any}
            style={{
              symbolPlacement: 'line',
              symbolSpacing: ['interpolate', ['linear'], ['zoom'], 8, 120, 13, 80, 16, 54],
              textField: '›',
              textSize: ['interpolate', ['linear'], ['zoom'], 8, 18, 13, 24, 16, 30],
              textColor: '#e0fbff',
              textHaloColor: '#03131d',
              textHaloWidth: 1.4,
              textKeepUpright: false,
              textAllowOverlap: true,
              textIgnorePlacement: true,
            } as any}
          />
          <MapGL.CircleLayer
            id="safe-water-corridor-knots"
            filter={['==', ['geometry-type'], 'Point'] as any}
            style={{
              circleRadius: ['match', ['get', 'role'], 'next', 6.5, 5.5],
              circleColor: ['match', ['get', 'role'], 'start', '#22c55e', 'end', '#f97316', '#67e8f9'],
              circleStrokeColor: '#03131d',
              circleStrokeWidth: 2.5,
              circleOpacity: 0.98,
            } as any}
          />
        </MapGL.ShapeSource>
      )}

      {showNautical && waterSpotFC.features.length > 0 && (
        <MapGL.ShapeSource
          id="safe-water-spots"
          shape={waterSpotFC}
          onPress={(e: any) => {
            const f = e.features?.[0];
            if (!f) return;
            const coords = (f.geometry as any)?.coordinates;
            if (suppressFeatureTaps) {
              onMapTap(coords?.[1], coords?.[0]);
              return;
            }
            if (!onWaterSpotTap) return;
            try {
              const raw = f.properties?.raw ? JSON.parse(String(f.properties.raw)) : null;
              if (raw) onWaterSpotTap(raw);
            } catch {}
          }}
        >
          <MapGL.CircleLayer
            id="safe-water-spot-halo"
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 19, 16, 26],
              circleColor: '#3bcf8e',
              circleOpacity: 0.16,
              circleBlur: 0.8,
            } as any}
          />
          <MapGL.CircleLayer
            id="safe-water-spot-dot"
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 6, 13, 9, 16, 12],
              circleColor: ['match', ['get', 'kind'], 'access', '#67e8f9', 'structure', '#3bcf8e', '#d97745'],
              circleOpacity: 0.95,
              circleStrokeWidth: 2,
              circleStrokeColor: '#04111f',
            } as any}
          />
          <MapGL.SymbolLayer
            id="safe-water-spot-code"
            style={{
              textField: ['match', ['get', 'kind'], 'access', 'A', 'structure', 'S', 'F'],
              textSize: 9,
              textColor: '#04111f',
              textFont: ['Noto Sans Bold'],
              textAllowOverlap: true,
              textIgnorePlacement: true,
            } as any}
          />
          <MapGL.SymbolLayer
            id="safe-water-spot-label"
            minZoomLevel={11}
            style={{
              textField: ['get', 'name'],
              textSize: 9,
              textFont: ['Noto Sans Regular'],
              textOffset: [0, 1.55],
              textAnchor: 'top',
              textColor: '#67e8f9',
              textHaloColor: 'rgba(0,0,0,0.78)',
              textHaloWidth: 1.4,
              textMaxWidth: 9,
              textOptional: true,
            } as any}
          />
        </MapGL.ShapeSource>
      )}

      {/* ── Campsites (clustered) ──────────────────────────────────────── */}
      {camps.length > 0 && (
        <MapGL.ShapeSource
          id="camps"
          shape={campFC}
          cluster
          clusterMaxZoomLevel={11}
          clusterRadius={45}
          onPress={handleCampPress}
        >
          <MapGL.CircleLayer
            id="camp-cluster"
            filter={['has', 'point_count']}
            style={{
              circleColor: ['step', ['get', 'point_count'], '#14b8a6', 10, '#0f766e', 50, '#115e59'],
              circleRadius: ['step', ['get', 'point_count'], 22, 10, 29, 50, 36],
              circleOpacity: 0.94,
              circleStrokeWidth: 3,
              circleStrokeColor: '#fff',
            }}
          />
          <MapGL.SymbolLayer
            id="camp-count"
            filter={['has', 'point_count']}
            style={{
              textField: '{point_count_abbreviated}',
              textColor: '#fff',
              textSize: 12,
            }}
          />
          <MapGL.CircleLayer
            id="camp-circle"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 11],
              circleColor: ['match', ['get', 'camp_kind'],
                'dispersed', '#8b5a2b',
                'primitive', '#92400e',
                'rv', '#2563eb',
                'tent', '#16a34a',
                'blm', '#f97316',
                'usfs', '#22c55e',
                'nps', '#3b82f6',
                'state', '#8b5cf6',
                'corps', '#0284c7',
                'reservable', '#8b5cf6',
                '#14b8a6'],
              circleOpacity: 0.96,
              circleStrokeWidth: ['case', ['==', ['get', 'full'], 1], 4, 3],
              circleStrokeColor: ['case', ['==', ['get', 'full'], 1], '#ef4444', '#fff'],
            }}
          />
          <MapGL.SymbolLayer
            id="camp-code"
            filter={['!', ['has', 'point_count']]}
            style={{
              textField: ['get', 'camp_code'],
              textSize: ['case', ['==', ['get', 'camp_kind'], 'dispersed'], 11, 10],
              textFont: ['Noto Sans Medium'],
              textColor: '#fff',
              textHaloColor: 'rgba(0,0,0,0.35)',
              textHaloWidth: 0.8,
              textIgnorePlacement: true,
              textAllowOverlap: true,
            } as any}
          />
          {/* Camp name labels — visible from z11, hidden when clustered */}
          <MapGL.SymbolLayer
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
        </MapGL.ShapeSource>
      )}

      {/* ── Gas stations ──────────────────────────────────────────────── */}
      {gas.length > 0 && (
        <MapGL.ShapeSource
          id="gas" shape={gasFC}
          onPress={(e: any) => {
            const f = e.features?.[0];
            if (f) {
              const [lng, lat] = (f.geometry as any).coordinates;
              if (suppressFeatureTaps) {
                onMapTap(lat, lng);
                return;
              }
              if (!onGasTap) return;
              onGasTap({ name: f.properties?.name ?? 'Gas Station', lat, lng });
            }
          }}
        >
          <MapGL.CircleLayer
            id="gas-circle"
            style={{ circleRadius: 9, circleColor: '#eab308', circleOpacity: 0.92, circleStrokeWidth: 2, circleStrokeColor: '#fff' }}
          />
          <MapGL.SymbolLayer
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
          <MapGL.SymbolLayer
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
        </MapGL.ShapeSource>
      )}

      {gas.slice(0, 60).map((station, i) => (
        <MapGL.MarkerView
          key={`gas-icon-${station.name}-${station.lat}-${station.lng}-${i}`}
          id={`gas-icon-${i}`}
          coordinate={[station.lng, station.lat]}
        >
          <IconPin
            color="#eab308"
            icon="flash-outline"
            onPress={() => suppressFeatureTaps ? onMapTap(station.lat, station.lng) : onGasTap?.({ name: station.name || 'Gas Station', lat: station.lat, lng: station.lng })}
          />
        </MapGL.MarkerView>
      ))}

      {/* ── POIs (water, trailheads, viewpoints, peaks) ───────────────── */}
      {pois.length > 0 && (
        <MapGL.ShapeSource
          id="pois" shape={poiFC}
          onPress={(e: any) => {
            const f = e.features?.[0];
            if (f) {
              const [lng, lat] = (f.geometry as any).coordinates;
              if (suppressFeatureTaps) {
                onMapTap(lat, lng);
                return;
              }
              if (!onPoiTap) return;
              let raw: OsmPoi | null = null;
              try { raw = f.properties?.raw ? JSON.parse(String(f.properties.raw)) : null; } catch {}
              onPoiTap({ ...(raw || {}), id: raw?.id || f.properties?.id || `${f.properties?.type ?? 'poi'}:${lat}:${lng}`, name: raw?.name || f.properties?.name || '', type: (raw?.type || f.properties?.type || 'poi') as OsmPoi['type'], lat, lng });
            }
          }}
        >
          <MapGL.CircleLayer
            id="poi-circle"
            style={{
              circleRadius: ['case', ['==', ['get', 'type'], 'peak'], 9.5, 8.5],
              circleColor: ['case', ['==', ['get', 'type'], 'water'],
                ['match', ['get', 'subtype'],
                  'boat_ramp', '#1d4ed8',
                  'paddle_launch', '#0f766e',
                  'fishing_access', '#15803d',
                  'marina', '#0891b2',
                  'dock', '#0369a1',
                  'shore_access', '#0e7490',
                  'swimming', '#06b6d4',
                  'gauge', '#64748b',
                  'navigation_aid', '#7c3aed',
                  'channel_marker', '#2563eb',
                  'water_hazard', '#dc2626',
                  'anchorage', '#0f766e',
                  'lock', '#a16207',
                  '#0284c7'],
                ['match', ['get', 'type'], 'trail', '#f97316', 'trailhead', '#22c55e', 'viewpoint', '#a855f7', 'peak', '#92400e', 'hot_spring', '#f97316', 'fuel', '#ea580c', 'propane', '#f97316', 'dump', '#a16207', 'shower', '#06b6d4', 'laundromat', '#0891b2', 'lodging', '#6366f1', 'food', '#0ea5e9', 'grocery', '#06b6d4', 'mechanic', '#f97316', 'parking', '#d97706', 'attraction', '#0ea5e9', 'camping', '#16a34a', 'hardware', '#f59e0b', 'medical', '#ef4444', 'parts', '#f97316', 'wifi', '#2563eb', '#3b82f6']],
              circleOpacity: 0.92, circleStrokeWidth: 2, circleStrokeColor: '#fff',
            }}
          />
          <MapGL.SymbolLayer
            id="poi-code"
            style={{
              textField: ['case', ['==', ['get', 'type'], 'water'],
                ['match', ['get', 'subtype'],
                  'boat_ramp', 'R',
                  'paddle_launch', 'P',
                  'fishing_access', 'F',
                  'marina', 'M',
                  'dock', 'D',
                  'shore_access', 'S',
                  'swimming', 'S',
                  'gauge', 'G',
                  'navigation_aid', 'A',
                  'channel_marker', 'C',
                  'water_hazard', '!',
                  'anchorage', 'A',
                  'lock', 'L',
                  'W'],
                ['match', ['get', 'type'],
                'trail', POI_CODES.trail,
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
                'camping', POI_CODES.camping,
                'hardware', POI_CODES.hardware,
                'medical', POI_CODES.medical,
                'parts', POI_CODES.parts,
                'wifi', POI_CODES.wifi,
                'P']],
              textSize: 9.5,
              textFont: ['Noto Sans Medium'],
              textColor: '#fff',
              textHaloColor: 'rgba(0,0,0,0.35)',
              textHaloWidth: 0.8,
              textIgnorePlacement: true,
              textAllowOverlap: true,
            } as any}
          />
          <MapGL.SymbolLayer
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
        </MapGL.ShapeSource>
      )}

      {pois.slice(0, 70).map((poi, i) => {
        const visual = poiMarkerVisual(poi);
        return (
        <MapGL.MarkerView
          key={`poi-icon-${poi.type}-${poi.name}-${poi.lat}-${poi.lng}-${i}`}
          id={`poi-icon-${i}`}
          coordinate={[poi.lng, poi.lat]}
        >
          <IconPin
            color={visual.color}
            icon={visual.icon}
            onPress={() => suppressFeatureTaps ? onMapTap(poi.lat, poi.lng) : onPoiTap?.(poi)}
          />
        </MapGL.MarkerView>
        );
      })}

      {/* ── Community pins ────────────────────────────────────────────── */}
      {communityPins.slice(0, 150).map((pin, i) => {
        const visual = communityPinVisual(pin.type);
        return (
          <MapGL.MarkerView
            key={`community-pin-${pin.id}-${pin.lat}-${pin.lng}-${i}`}
            id={`community-pin-${pin.id}-${i}`}
            coordinate={[pin.lng, pin.lat]}
          >
            <IconPin
              color={visual.color}
              icon={visual.icon}
              onPress={() => suppressFeatureTaps ? onMapTap(pin.lat, pin.lng) : onCommunityPinTap?.(pin)}
            />
          </MapGL.MarkerView>
        );
      })}

      {/* ── Radar (RainViewer) ───────────────────────────────────────── */}
      {showRadar && radarUrl && (
        <MapGL.RasterSource id="radar-overlay" tileUrlTemplates={[radarUrl]} tileSize={256}>
          <MapGL.RasterLayer id="radar-layer" style={{ rasterOpacity: 0.65 }} />
        </MapGL.RasterSource>
      )}

      {/* ── Active wildfires (USFS) ───────────────────────────────────── */}
      {showFire && fireData && (
        <MapGL.ShapeSource id="fire-overlay" shape={fireData}>
          <MapGL.FillLayer
            id="fire-fill"
            style={{ fillColor: '#dc2626', fillOpacity: 0.3 }}
          />
          <MapGL.LineLayer
            id="fire-line"
            style={{ lineColor: '#ef4444', lineWidth: 1.5, lineOpacity: 0.85 }}
          />
        </MapGL.ShapeSource>
      )}

      {/* ── Avalanche danger zones ────────────────────────────────────── */}
      {showAva && avaData && (
        <MapGL.ShapeSource id="ava-overlay" shape={avaData}>
          <MapGL.FillLayer
            id="ava-fill"
            style={{
              fillColor: ['match', ['get', 'danger_level'],
                '1', '#50C878', '2', '#FFD700', '3', '#FF8C00',
                '4', '#E63946', '5', '#1a0a0a', '#888888'],
              fillOpacity: 0.45,
            }}
          />
        </MapGL.ShapeSource>
      )}

      {/* ── MVUM — USFS Motor Vehicle Use Map ────────────────────────── */}
      {showMvum && mvumRoads && (
        <MapGL.ShapeSource id="mvum-roads" shape={mvumRoads}>
          <MapGL.LineLayer
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
        </MapGL.ShapeSource>
      )}
      {showMvum && mvumTrails && (
        <MapGL.ShapeSource id="mvum-trails" shape={mvumTrails}>
          <MapGL.LineLayer
            id="mvum-trails-line"
            style={{ lineColor: '#a855f7', lineWidth: 1.5, lineOpacity: 0.8, lineDasharray: [3, 2] }}
          />
        </MapGL.ShapeSource>
      )}

      {/* ── BLM / Land ownership overlay ─────────────────────────────── */}
      {showLandOverlay && (
        <MapGL.RasterSource
          id="land-overlay"
          tileUrlTemplates={[`${API_BASE_URL}/api/land-tile/{z}/{y}/{x}`]}
          tileSize={256}
          minZoomLevel={4}
          maxZoomLevel={15}
        >
          <MapGL.RasterLayer
            id="land-overlay-layer"
            style={{ rasterOpacity: 0.45 }}
          />
        </MapGL.RasterSource>
      )}

      {/* ── USGS Topo overlay ─────────────────────────────────────────── */}
      {showUsgsOverlay && (
        <MapGL.RasterSource
          id="usgs-overlay"
          tileUrlTemplates={['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}']}
          tileSize={256}
          minZoomLevel={4}
          maxZoomLevel={16}
        >
          <MapGL.RasterLayer
            id="usgs-overlay-layer"
            style={{ rasterOpacity: 0.7 }}
          />
        </MapGL.RasterSource>
      )}

      {/* ── Report markers ────────────────────────────────────────────── */}
      {reports.map(r => (
        <MapGL.MarkerView key={`rep-${r.id}`} id={`rep-${r.id}`} coordinate={[r.lng, r.lat]}>
          <ReportDot type={r.type} subtype={r.subtype} />
        </MapGL.MarkerView>
      ))}

      {/* ── Search marker ─────────────────────────────────────────────── */}
      {searchMarker && (
        <MapGL.MarkerView id="search" coordinate={[searchMarker.lng, searchMarker.lat]}>
          <View style={styles.searchMarker}>
            <View style={styles.searchPin} />
          </View>
        </MapGL.MarkerView>
      )}

      {/* ── Waypoint markers ──────────────────────────────────────────── */}
      {waypoints.map((wp, i) => (
        <MapGL.MarkerView
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
        </MapGL.MarkerView>
      ))}
      </MapGL.MapView>
      {traceMode && (
        <View
          style={StyleSheet.absoluteFillObject}
          pointerEvents="auto"
          {...tracePanResponder.panHandlers}
        />
      )}
      {!hideMapStatusBadge && (
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
      )}
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

function mapboxPlaceType(props: Record<string, any>): OsmPoi['type'] {
  const raw = String(
    props?.maki
    || props?.poi_category
    || props?.category
    || props?.class
    || props?.feature_type
    || props?.icon
    || props?.symbol
    || props?.type
    || props?.group
    || props?.kind
    || ''
  ).toLowerCase();
  if (/(camp|caravan|rv)/.test(raw)) return 'camp';
  if (/(fuel|gas|charging)/.test(raw)) return 'fuel';
  if (/(restaurant|cafe|bar|pub|bakery|food|pizza|burger|sandwich|coffee)/.test(raw)) return 'food';
  if (/(grocery|supermarket|shop|market)/.test(raw)) return 'grocery';
  if (/(hotel|lodg|motel)/.test(raw)) return 'lodging';
  if (/(view|attraction|museum|monument|landmark)/.test(raw)) return 'attraction';
  if (/(water|drinking)/.test(raw)) return 'water';
  if (/(trailhead|trail|hiking)/.test(raw)) return 'trailhead';
  if (/\bpark\b/.test(raw)) return 'attraction';
  return 'poi';
}

function mapboxFeaturePickScore(feature: any): number {
  const props = feature?.properties ?? {};
  const layerId = String(feature?.layer?.id || feature?.sourceLayer || feature?.source || '').toLowerCase();
  const raw = String(props.maki || props.poi_category || props.category || props.class || props.feature_type || props.icon || props.symbol || props.type || props.group || props.kind || '').toLowerCase();
  const name = String(props.name || props.name_en || props.name_script || props.name_local || props.brand || props.full_address || '').trim();
  const hasPoiSignal = !!String(props.maki || props.poi_category || props.category || props.feature_type || props.icon || props.symbol || props.type || '').trim();
  let score = 100;
  if (layerId.includes('poi')) score -= 55;
  if (layerId.includes('point-of-interest')) score -= 55;
  if (layerId.includes('place-label') || layerId.includes('poi-label')) score -= 38;
  if (layerId.includes('label')) score -= 18;
  if (layerId.includes('transit') || layerId.includes('airport')) score -= 20;
  if (feature?.geometry?.type === 'Point') score -= 14;
  if (name) score -= 10;
  if (hasPoiSignal) score -= 12;
  if (props.mapbox_id || props.id) score -= 8;
  if (/(restaurant|cafe|bar|pub|bakery|food|pizza|burger|sandwich|coffee|fuel|gas|charging|grocery|supermarket|shop|market|hotel|lodg|motel|view|attraction|museum|monument|landmark|tourist|art|gallery|water|drinking|trail|hiking|park|camp|caravan|rv)/.test(raw)) score -= 30;
  if (/(restaurant|cafe|bar|pub|bakery|food|pizza|burger|sandwich|coffee|hotel|lodg|motel)/.test(raw)) score -= 18;
  if (layerId.includes('building')) score += name && hasPoiSignal ? 4 : 26;
  if (layerId.includes('road') || layerId.includes('boundary') || layerId.includes('landuse')) score += 40;
  if (/(country|state|province|settlement|city|town|village|neighborhood|postcode|address|road|street|motorway|primary|secondary|water|ocean|landuse)/.test(raw)) score += 45;
  return score;
}

function mapMapboxFeatureToPoi(feature: any, fallbackLat: number, fallbackLng: number): OsmPoi | null {
  const props = feature?.properties ?? {};
  const layerId = String(feature?.layer?.id || feature?.sourceLayer || feature?.source || '').toLowerCase();
  if (layerId.includes('trailhead-web-route') || layerId.includes('route-line') || layerId.includes('route-shadow') || layerId.includes('breadcrumb')) return null;
  const name = String(
    props.name
    || props.name_en
    || props.name_script
    || props.name_local
    || props.brand
    || props.name_ja
    || props.name_fr
    || props.name_de
    || props.name_es
    || props.full_address
    || props.place_name
    || props.label
    || ''
  ).trim();
  if (!name || name.length < 2) return null;
  const coords = feature?.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : [fallbackLng, fallbackLat];
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const type = mapboxPlaceType(props);
  const subtype = String(props.maki || props.poi_category || props.category || props.class || props.feature_type || props.icon || props.symbol || props.type || props.group || props.kind || '').replace(/[_-]+/g, ' ').trim();
  return {
    id: `mapbox_feature:${String(props.mapbox_id || props.id || `${lat.toFixed(5)}:${lng.toFixed(5)}:${name}`).slice(0, 160)}`,
    name,
    lat,
    lng,
    type,
    subtype: subtype || 'mapbox place',
    source: 'rendered_mapbox_standard',
    selection_source: 'rendered_mapbox_standard',
    source_label: 'Mapbox Standard',
    source_layer: layerId,
    feature_id: props.mapbox_id || props.id || feature?.id,
    provider_place_id: props.mapbox_id || props.id,
    place_id: props.mapbox_id || props.id,
    mapbox_id: props.mapbox_id || props.id || feature?.id,
    attribution: 'Mapbox',
    source_badge: 'Mapbox basemap',
    enrichment_source: 'mapbox_standard',
    enrichment_status: 'pending',
    raw_feature: {
      id: feature?.id,
      layer: feature?.layer,
      source: feature?.source,
      sourceLayer: feature?.sourceLayer,
      properties: props,
      geometry: feature?.geometry,
    },
  } as OsmPoi;
}

function bestMapboxPoiFromFeatures(features: any[] | undefined, fallbackLat: number, fallbackLng: number): OsmPoi | null {
  if (!Array.isArray(features) || !features.length) return null;
  return features
    .map(feature => ({ poi: mapMapboxFeatureToPoi(feature, fallbackLat, fallbackLng), score: mapboxFeaturePickScore(feature) }))
    .filter((item): item is { poi: OsmPoi; score: number } => !!item.poi)
    .sort((a, b) => a.score - b.score)[0]?.poi ?? null;
}

function screenPositionLabel(x: number, y: number, screen = Dimensions.get('window')): MapSelectableFeature['screen_position'] {
  const w = Math.max(1, Number(screen.width) || 1);
  const h = Math.max(1, Number(screen.height) || 1);
  const nx = x / w;
  const ny = y / h;
  if (nx >= 0.34 && nx <= 0.66 && ny >= 0.28 && ny <= 0.68) return 'center';
  if (ny < 0.28) return 'top';
  if (ny > 0.68) return 'bottom';
  return nx < 0.5 ? 'left' : 'right';
}

function renderedQueryRectAroundPoint(x: number, y: number, radius: number): [number, number, number, number] {
  const px = Number(x);
  const py = Number(y);
  const r = Math.max(1, Number(radius) || 1);
  // RNMapbox iOS expects a screen-space rectangle as [top, right, bottom, left].
  return [py - r, px + r, py + r, px - r];
}

function renderedQueryViewportRect(screen = Dimensions.get('window')): [number, number, number, number] {
  return [0, Math.max(1, Number(screen.width) || 1), Math.max(1, Number(screen.height) || 1), 0];
}

function selectableFeatureFromPoi(poi: OsmPoi, resultIndex: number, sourceLayer?: string | null, center?: { lat: number; lng: number } | null): MapSelectableFeature | null {
  const lat = Number(poi.lat);
  const lng = Number(poi.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = String(poi.name || poi.type || 'Place').trim();
  if (!name || name.length < 2) return null;
  const featureId = String(
    poi.id
    || poi.place_id
    || poi.provider_place_id
    || `${poi.source || 'rendered'}:${name}:${lat.toFixed(5)}:${lng.toFixed(5)}`
  ).slice(0, 180);
  return {
    feature_id: featureId,
    result_index: resultIndex,
    name,
    lat,
    lng,
    type: String(poi.type || 'poi'),
    subtype: poi.subtype || null,
    source: poi.source || 'rendered_map',
    source_label: poi.source_label || poi.source_badge || 'Rendered map',
    source_layer: sourceLayer || (poi as any).source_layer || null,
    distance_mi: center ? haversineMiles(center.lat, center.lng, lat, lng) : null,
    confidence: poi.source === 'rendered_mapbox_standard' || poi.source === 'mapbox_feature' || poi.source === 'rendered_map' ? 'medium' : 'high',
    aliases: [name, poi.subtype, poi.source_label, poi.source_badge].filter((item): item is string => !!item),
    address: poi.address || null,
    rating: poi.rating ?? null,
    summary: (poi as any).summary || poi.source_freshness || null,
    raw_feature: (poi as any).raw_feature || null,
    place: poi as unknown as Record<string, unknown>,
  };
}

function normalizeRenderedFeatureList(features: any[] | undefined, center?: { lat: number; lng: number } | null): MapSelectableFeature[] {
  if (!Array.isArray(features) || !features.length) return [];
  const seen = new Set<string>();
  const scored = features
    .map(feature => {
      const props = feature?.properties ?? {};
      const coords = feature?.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
        ? feature.geometry.coordinates
        : center
          ? [center.lng, center.lat]
          : null;
      const lng = Number(coords?.[0]);
      const lat = Number(coords?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const poi = mapMapboxFeatureToPoi(feature, lat, lng);
      if (!poi) return null;
      const layerId = String(feature?.layer?.id || feature?.sourceLayer || feature?.source || '').toLowerCase();
      const score = mapboxFeaturePickScore(feature)
        + (String(props.name || '').trim() ? 0 : 40)
        + (feature?.geometry?.type === 'Point' ? 0 : 24);
      return { poi, layerId, score };
    })
    .filter((item): item is { poi: OsmPoi; layerId: string; score: number } => !!item)
    .sort((a, b) => a.score - b.score);
  const out: MapSelectableFeature[] = [];
  for (const item of scored) {
    const lat = Number(item.poi.lat);
    const lng = Number(item.poi.lng);
    const key = `${String(item.poi.name || '').toLowerCase()}:${lat.toFixed(4)}:${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const feature = selectableFeatureFromPoi(item.poi, out.length, item.layerId, center);
    if (feature) out.push(feature);
    if (out.length >= 24) break;
  }
  return out.map((feature, idx) => ({ ...feature, result_index: idx }));
}

function mapboxStandardFeatureEventToPoi(event: any): OsmPoi | null {
  const lat = Number(event?.lat);
  const lng = Number(event?.lng);
  const name = String(event?.name || '').trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const raw = event?.properties && typeof event.properties === 'object' ? event.properties : {};
  const type = mapboxPlaceType({
    ...raw,
    maki: event?.maki,
    category: event?.category,
    class: event?.class,
    group: event?.group,
    feature_type: event?.featureset,
  });
  const providerId = String(event?.mapbox_id || event?.feature_id || '').trim();
  const subtype = String(event?.maki || event?.category || event?.class || event?.group || event?.featureset || '').replace(/[_-]+/g, ' ').trim();
  return {
    id: `mapbox_standard:${String(providerId || `${lat.toFixed(5)}:${lng.toFixed(5)}:${name}`).slice(0, 160)}`,
    name,
    lat,
    lng,
    type,
    subtype: subtype || 'mapbox standard feature',
    source: 'rendered_mapbox_standard',
    selection_source: 'rendered_mapbox_standard',
    source_label: 'Mapbox Standard',
    source_layer: event?.featureset || null,
    feature_id: providerId || null,
    provider_place_id: providerId || null,
    place_id: providerId || null,
    screen_x: Number.isFinite(Number(event?.screen_x)) ? Number(event.screen_x) : null,
    screen_y: Number.isFinite(Number(event?.screen_y)) ? Number(event.screen_y) : null,
    screen_position: event?.screen_position || null,
    selection_confidence: event?.selection_confidence || 'high',
    attribution: 'Mapbox',
    source_badge: 'Mapbox basemap',
    mapbox_id: providerId || null,
    enrichment_source: 'mapbox_standard',
    enrichment_status: 'pending',
    raw_feature: {
      id: providerId || null,
      source: 'mapbox_standard_feature',
      properties: raw,
      event,
    },
  } as OsmPoi;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clampMapZoom(value: number, fallback = 12) {
  const zoom = Number.isFinite(value) ? value : fallback;
  return Math.max(3, Math.min(18, zoom));
}

function waterKindLabel(kind?: string): string {
  switch (String(kind || '').toLowerCase()) {
    case 'river': return 'River';
    case 'stream': return 'Stream';
    case 'canal': return 'Canal';
    case 'reservoir': return 'Reservoir';
    case 'lake': return 'Lake';
    default: return 'Waterbody';
  }
}

function isLakeOfTheWoods(lat: number, lng: number, name?: string) {
  const text = String(name || '').toLowerCase();
  return text.includes('lake of the woods') || text.includes('lac des bois') || (lat >= 48.35 && lat <= 49.55 && lng >= -95.65 && lng <= -93.35);
}

function isLikelyCanadianWater(lat: number, lng: number, name?: string) {
  if (isLakeOfTheWoods(lat, lng, name)) return true;
  if (lng >= -141.5 && lng <= -52 && lat >= 49) return true;
  if (lng >= -67.5 && lng <= -52 && lat >= 43) return true;
  return false;
}

function waterChartContext(lat: number, lng: number, name?: string) {
  if (isLikelyCanadianWater(lat, lng, name)) {
    return {
      chart_source: 'CHS NONNA bathymetry (non-navigational) for Canadian waters; Lake of the Woods also has CHS chart 6201 official chart context.',
      chart_url: 'https://www.chs.gc.ca/data-gestion/nonna/index-eng.html',
      safety_url: 'https://tc.canada.ca/en/marine-transportation/marine-safety/boating-safety',
      navigation_note: 'NONNA bathymetry is not for navigation. Verify with official CHS charts, local markers, water levels, weather, and required safety gear before boating.',
    };
  }
  return {
    chart_source: 'NOAA chart layer where coverage exists; many inland lakes may not have charted depth or hazard data.',
    chart_url: 'https://www.nauticalcharts.noaa.gov/charts/noaa-enc.html',
    safety_url: 'https://www.uscgboating.org/',
    navigation_note: 'Waterbody context only. Use the NOAA chart layer where available for depth soundings, channels, aids, and hazards; check NWS alerts, water levels, local closures, required safety gear, and official charts before boating.',
  };
}

function mapWaterPoi(props: Record<string, any> | undefined, lat: number, lng: number): OsmPoi {
  const kind = String(props?.kind || props?.water || props?.waterway || '').toLowerCase();
  const waterbodyType = kind || 'waterbody';
  const name = String(props?.name || waterKindLabel(kind));
  const chart = waterChartContext(lat, lng, name);
  return {
    id: `map_water_${lat.toFixed(5)}_${lng.toFixed(5)}`,
    name,
    lat,
    lng,
    type: 'water',
    category: 'water',
    subtype: waterbodyType,
    source: 'map_waterbody',
    source_label: 'Map waterbody',
    source_badge: 'Map waterbody',
    source_freshness: 'Base map water feature. Depths, channels, hazards, and access rules require official/current sources.',
    waterbody_name: name,
    waterbody_type: waterbodyType,
    access: 'see nearby access points',
    craft: 'verify local restrictions',
    fishing_score_label: 'Unknown fishing quality',
    chart_source: chart.chart_source,
    chart_url: chart.chart_url,
    weather_url: `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`,
    tides_url: 'https://tidesandcurrents.noaa.gov/',
    safety_url: chart.safety_url,
    navigation_note: chart.navigation_note,
  } as OsmPoi;
}

function displayWaterText(value: any): string {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function mapWaterNavigationPoi(props: Record<string, any> | undefined, lat: number, lng: number): OsmPoi {
  const subtype = String(props?.subtype || props?.kind || 'navigation_aid').toLowerCase();
  const name = displayWaterText(props?.name || props?.label || props?.navigation_feature || 'Water navigation point');
  const chart = waterChartContext(lat, lng, name);
  return {
    id: String(props?.id || `map_water_nav_${lat.toFixed(5)}_${lng.toFixed(5)}`),
    name,
    lat,
    lng,
    type: 'water',
    category: 'water',
    subtype,
    source: 'openseamap',
    source_label: String(props?.source || 'OpenStreetMap / OpenSeaMap'),
    source_badge: 'OpenSeaMap / OSM',
    source_freshness: String(props?.source_freshness || 'Open seamark data; verify against official charts and local markers.'),
    waterbody_name: name,
    waterbody_type: 'navigation',
    access: 'verify locally',
    craft: 'boating context',
    fishing_score_label: 'Navigation context',
    chart_source: chart.chart_source,
    chart_url: chart.chart_url,
    weather_url: `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`,
    tides_url: 'https://tidesandcurrents.noaa.gov/',
    safety_url: chart.safety_url,
    navigation_feature: displayWaterText(props?.navigation_feature || props?.label || props?.seamark_type || subtype),
    hazard_type: displayWaterText(props?.hazard_type || (subtype === 'water_hazard' ? props?.seamark_type || subtype : '')),
    mark_color: displayWaterText(props?.mark_color || props?.marker_color || ''),
    mark_shape: displayWaterText(props?.mark_shape || ''),
    light_character: displayWaterText(props?.light_character || ''),
    depth_ft: Number.isFinite(Number(props?.depth_ft)) ? Number(props?.depth_ft) : undefined,
    max_draft_ft: Number.isFinite(Number(props?.max_draft_ft)) ? Number(props?.max_draft_ft) : undefined,
    navigation_note: String(props?.navigation_note || 'Open seamark data only. Use official charts, local markers, water levels, weather, and required safety gear before boating.'),
  } as OsmPoi;
}

function mapHydroPoi(props: Record<string, any> | undefined, lat: number, lng: number): OsmPoi {
  const depth = Number.isFinite(Number(props?.depth_ft ?? props?.max_depth_ft))
    ? Number(props?.depth_ft ?? props?.max_depth_ft)
    : undefined;
  const hazard = displayWaterText(props?.label || props?.kind || '');
  const name = depth != null
    ? `${depth.toFixed(depth % 1 === 0 ? 0 : 1)} ft depth`
    : hazard || 'Safe Water structure';
  return {
    id: String(props?.id || `map_hydro_${lat.toFixed(5)}_${lng.toFixed(5)}`),
    name,
    lat,
    lng,
    type: 'water',
    category: 'water',
    subtype: props?.hazard ? 'water_hazard' : 'bathymetry',
    source: String(props?.source_id || props?.source || 'safe_water_hydro'),
    source_label: String(props?.source || 'Safe Water hydro bathymetry'),
    source_badge: 'Hydro awareness',
    source_freshness: String(props?.source_freshness || 'Bathymetry context packaged by Trailhead; source dates and confidence vary by waterbody.'),
    waterbody_name: 'Lake of the Woods',
    waterbody_type: 'bathymetry',
    access: 'verify locally',
    craft: 'boating context',
    fishing_score_label: 'Bathymetry context',
    chart_source: String(props?.chart_source || 'Safe Water hydro bathymetry plus live NOAA/CHS/OpenSeaMap context where available.'),
    chart_url: String(props?.chart_url || 'https://www.chs.gc.ca/data-gestion/nonna/index-eng.html'),
    weather_url: `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`,
    tides_url: 'https://tidesandcurrents.noaa.gov/',
    safety_url: 'https://www.uscgboating.org/',
    navigation_feature: hazard || displayWaterText(props?.depth_band || 'Bathymetry'),
    hazard_type: props?.hazard ? hazard : '',
    depth_ft: depth,
    navigation_note: String(props?.navigation_note || 'Bathymetry awareness only. Not certified navigation; verify with official charts, markers, water levels, weather, and local notices before boating.'),
  } as OsmPoi;
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
    case 'trail': return '#f97316';
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
    case 'camping': return '#16a34a';
    case 'hardware': return '#f59e0b';
    case 'medical': return '#ef4444';
    case 'parts': return '#f97316';
    case 'wifi': return '#2563eb';
    default: return '#3b82f6';
  }
}

function waterSubtypeVisual(subtype?: string): { color: string; code: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (String(subtype || '').toLowerCase().replace(/[\s-]+/g, '_')) {
    case 'boat_ramp':
      return { color: '#1d4ed8', code: 'R', icon: 'boat-outline' };
    case 'paddle_launch':
      return { color: '#0f766e', code: 'P', icon: 'navigate-circle-outline' };
    case 'fishing_access':
      return { color: '#15803d', code: 'F', icon: 'fish-outline' };
    case 'marina':
      return { color: '#0891b2', code: 'M', icon: 'boat-outline' };
    case 'dock':
      return { color: '#0369a1', code: 'D', icon: 'albums-outline' };
    case 'shore_access':
      return { color: '#0e7490', code: 'S', icon: 'map-outline' };
    case 'swimming':
      return { color: '#06b6d4', code: 'S', icon: 'water-outline' };
    case 'gauge':
      return { color: '#64748b', code: 'G', icon: 'speedometer-outline' };
    case 'navigation_aid':
      return { color: '#7c3aed', code: 'A', icon: 'flag-outline' };
    case 'channel_marker':
      return { color: '#2563eb', code: 'C', icon: 'git-branch-outline' };
    case 'water_hazard':
      return { color: '#dc2626', code: '!', icon: 'warning-outline' };
    case 'anchorage':
      return { color: '#0f766e', code: 'A', icon: 'boat-outline' };
    case 'lock':
      return { color: '#a16207', code: 'L', icon: 'lock-closed-outline' };
    default:
      return { color: '#0284c7', code: 'W', icon: 'water-outline' };
  }
}

function poiMarkerVisual(poi: OsmPoi): { color: string; icon: keyof typeof Ionicons.glyphMap } {
  if (poi.type === 'water') {
    const visual = waterSubtypeVisual(poi.subtype);
    return { color: visual.color, icon: visual.icon };
  }
  return { color: poiColor(poi.type), icon: POI_ICON_NAMES[poi.type] || 'location-outline' };
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
    closure: '#dc2626dd', traffic: '#6DA8FFdd', weather: '#6DA8FFdd',
    fire: '#ef4444dd', smoke: '#a78bfadd', water: '#38bdf8dd',
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
    traffic: 'car-outline',
    weather: 'thunderstorm-outline',
    fire: 'flame-outline',
    smoke: 'cloud-outline',
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
