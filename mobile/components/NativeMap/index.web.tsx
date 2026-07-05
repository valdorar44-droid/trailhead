import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CampsitePin, MapSelectableFeature, Pin, Report, SuggestedWaterCorridorResponse, WaterSpotCard } from '@/lib/api';
import type { WaterRoute } from '@/lib/store';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';
import type { RouteOpts, RouteResult, RouteStep, MapBounds, WP } from './types';
import type { RouteProviderMode } from './types';
import type { PremiumMapStyle } from './mapStyle';
import { campMarkerVisual } from '@/lib/campMarkerVisual';

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

export interface NativeMapHandle {
  flyTo:          (lat: number, lng: number, zoom?: number, name?: string) => void;
  flyToCamera:    (options: NativeMapCameraOptions) => void;
  setZoom:        (zoom: number, focus?: { lat?: number; lng?: number } | null) => Promise<number | null>;
  zoomBy:         (delta: number, focus?: { lat?: number; lng?: number } | null) => Promise<number | null>;
  locate:         (lat: number, lng: number) => void;
  loadRouteFrom:  (lat: number, lng: number, fromIdx: number) => void;
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
  waypoints:     WP[];
  camps:         CampsitePin[];
  gas:           { lat: number; lng: number; name: string }[];
  pois:          { lat: number; lng: number; name: string; type: string }[];
  waterNavLines?: any;
  waterSpotCards?: WaterSpotCard[];
  waterCorridor?: SuggestedWaterCorridorResponse | null;
  waterFollowRoute?: WaterRoute | null;
  reports:       Report[];
  communityPins: Pin[];
  searchMarker:  { lat: number; lng: number; name: string } | null;
  userLoc:       { lat: number; lng: number; accuracy?: number | null } | null;
  navMode:       boolean;
  navIdx:        number;
  navHeading:    number | null;
  navSpeed:      number | null;
  mapLayer:      string;
  premiumMapStyle?: string;
  routeProviderMode?: RouteProviderMode;
  routeOpts:     RouteOpts;
  traceMode?: boolean;
  traceDraftCoords?: [number, number][];
  traceRouteCoords?: [number, number][];
  tracePinCoords?: [number, number][];
  suppressFeatureTaps?: boolean;
  showLandOverlay: boolean;
  showUsgsOverlay: boolean;
  showTrailOverlay?: boolean;
  showTerrain:     boolean;
  showMvum:        boolean;
  showFire:        boolean;
  showAva:         boolean;
  showRadar:       boolean;
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
  onRoutePersist:   (data: { coords: [number,number][]; steps: RouteStep[]; legs: RouteStep[][]; totalDistance: number; totalDuration: number; tripId: string | null; routeSource?: string | null; routeSourceLabel?: string | null }) => void;
  onOffRoute?:      (lat: number, lng: number, distanceM: number) => void;
  onOffRouteWarn?:  (lat: number, lng: number, distanceM: number) => void;
  onBackOnRoute?:   () => void;
  onRouteProgress?: (progress: { distanceM: number; remainingM: number; routeDistanceM: number; deviationM: number; segmentIdx: number }) => void;
  onTraceStart?:    (coord: [number, number]) => void;
  onTraceMove?:     (coord: [number, number]) => void;
  onTraceEnd?:      () => void;
  onError?:         (msg: string) => void;
  children?:         React.ReactNode;
}

const noop = () => {};
const MAPBOX_GL_VERSION = 'v3.11.1';
const WEB_CAMP_MARKER_LIMIT = 360;
const WEB_POI_MARKER_LIMIT = 120;
const WEB_COMMUNITY_MARKER_LIMIT = 120;

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
  satellite_streets: 'day',
  streets: 'day',
  outdoors: 'day',
  navigation_day: 'day',
  navigation_night: 'night',
  dawn: 'dawn',
  dusk: 'dusk',
  night: 'night',
};

declare global {
  interface Window {
    mapboxgl?: any;
    maplibregl?: any;
  }
}

let mapboxGlPromise: Promise<any> | null = null;
let maplibreGlPromise: Promise<any> | null = null;

function ensureMapControlCss() {
  if (typeof document === 'undefined' || document.querySelector('style[data-trailhead-map-controls="true"]')) return;
  const style = document.createElement('style');
  style.dataset.trailheadMapControls = 'true';
  style.textContent = `
    .mapboxgl-ctrl-logo,
    .mapboxgl-ctrl-attrib,
    .maplibregl-ctrl-logo,
    .maplibregl-ctrl-attrib { display: none !important; }
  `;
  document.head.appendChild(style);
}

function loadMapboxGl() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Mapbox GL JS requires a browser runtime'));
  }
  ensureMapControlCss();
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (mapboxGlPromise) return mapboxGlPromise;
  mapboxGlPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-trailhead-mapbox-gl="true"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.css`;
      css.dataset.trailheadMapboxGl = 'true';
      document.head.appendChild(css);
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-trailhead-mapbox-gl="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.mapboxgl), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Mapbox GL JS')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.js`;
    script.async = true;
    script.dataset.trailheadMapboxGl = 'true';
    script.onload = () => resolve(window.mapboxgl);
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
  return mapboxGlPromise;
}

function loadMapLibreGl() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('MapLibre requires a browser runtime'));
  }
  ensureMapControlCss();
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (maplibreGlPromise) return maplibreGlPromise;
  maplibreGlPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-trailhead-maplibre-gl="true"]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://tiles.gettrailhead.app/assets/maplibre-gl.css';
      css.dataset.trailheadMaplibreGl = 'true';
      document.head.appendChild(css);
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-trailhead-maplibre-gl="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.maplibregl), { once: true });
      existing.addEventListener('error', () => reject(new Error('Map could not load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://tiles.gettrailhead.app/assets/maplibre-gl.js';
    script.async = true;
    script.dataset.trailheadMaplibreGl = 'true';
    script.onload = () => resolve(window.maplibregl);
    script.onerror = () => reject(new Error('Map could not load.'));
    document.head.appendChild(script);
  });
  return maplibreGlPromise;
}

function trailheadVectorStyle(): any {
  const tileBase = 'https://tiles.gettrailhead.app';
  const halo = '#f8fafc';
  return {
    version: 8,
    glyphs: `${tileBase}/api/fonts/{fontstack}/{range}.pbf`,
    sources: {
      pm: {
        type: 'vector',
        tiles: [`${tileBase}/api/tiles/{z}/{x}/{y}.pbf`],
        maxzoom: 15,
        attribution: 'OpenStreetMap',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f6f7f2' } },
      { id: 'earth', type: 'fill', source: 'pm', 'source-layer': 'earth', paint: { 'fill-color': '#f0f2ea' } },
      {
        id: 'land-parks',
        type: 'fill',
        source: 'pm',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'park', 'nature_reserve', 'protected_area', 'forest', 'wood']]],
        paint: { 'fill-color': '#dbeed4', 'fill-opacity': 0.82 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'pm',
        'source-layer': 'water',
        filter: ['all', ['!=', ['get', 'kind'], 'river'], ['!=', ['get', 'kind'], 'stream'], ['!=', ['get', 'kind'], 'canal']],
        paint: { 'fill-color': '#b9d8ed' },
      },
      {
        id: 'water-lines',
        type: 'line',
        source: 'pm',
        'source-layer': 'water',
        filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream', 'canal']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#91c5df', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 3] },
      },
      {
        id: 'roads-path',
        type: 'line',
        source: 'pm',
        'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'path'],
        minzoom: 10,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#a46b31', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 2.4], 'line-dasharray': [3, 2] },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'pm',
        'source-layer': 'roads',
        filter: ['==', ['get', 'kind'], 'minor_road'],
        minzoom: 8,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#9ca3af', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 14, 2.2, 17, 6] },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'pm',
        'source-layer': 'roads',
        filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'medium_road']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d18a2d', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 12, 2.6, 16, 7] },
      },
      {
        id: 'park-line',
        type: 'line',
        source: 'pm',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'kind'], ['literal', ['national_park', 'nature_reserve', 'protected_area']]],
        minzoom: 6,
        paint: { 'line-color': '#6aa36d', 'line-width': 1.1, 'line-opacity': 0.75 },
      },
      {
        id: 'pm-pois-camp',
        type: 'circle',
        source: 'pm',
        'source-layer': 'pois',
        filter: ['in', ['get', 'kind'], ['literal', ['camp_site', 'camp_pitch', 'picnic_site', 'shelter']]],
        paint: { 'circle-radius': 5, 'circle-color': '#14b8a6', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
      },
      {
        id: 'pm-pois-trailhead',
        type: 'circle',
        source: 'pm',
        'source-layer': 'pois',
        filter: ['==', ['get', 'kind'], 'trailhead'],
        paint: { 'circle-radius': 5, 'circle-color': '#22c55e', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
      },
      {
        id: 'water-name',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'water',
        filter: ['has', 'name'],
        minzoom: 8,
        layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13], 'text-font': ['Noto Sans Italic'], 'text-max-width': 8 },
        paint: { 'text-color': '#3f8caf', 'text-halo-color': halo, 'text-halo-width': 1.5 },
      },
      {
        id: 'road-name',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'roads',
        minzoom: 12,
        filter: ['all', ['has', 'name'], ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'medium_road', 'minor_road']]]],
        layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 13], 'text-font': ['Noto Sans Medium'], 'symbol-placement': 'line', 'text-max-width': 10 },
        paint: { 'text-color': '#525b6b', 'text-halo-color': halo, 'text-halo-width': 1.6 },
      },
      {
        id: 'place-small',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'places',
        minzoom: 6,
        filter: ['==', ['get', 'kind'], 'locality'],
        layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 13, 15], 'text-font': ['Noto Sans Medium'] },
        paint: { 'text-color': '#475569', 'text-halo-color': halo, 'text-halo-width': 1.8 },
      },
      {
        id: 'park-name',
        type: 'symbol',
        source: 'pm',
        'source-layer': 'pois',
        filter: ['in', ['get', 'kind'], ['literal', ['park', 'national_park', 'nature_reserve']]],
        minzoom: 8,
        layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 13, 12], 'text-font': ['Noto Sans Italic'], 'text-max-width': 9 },
        paint: { 'text-color': '#4d8a55', 'text-halo-color': halo, 'text-halo-width': 1.5 },
      },
    ],
  };
}

function styleConfig(style: PremiumMapStyle, showTerrain = true) {
  return {
    basemap: {
      lightPreset: MAPBOX_LIGHT_PRESETS[style] ?? 'day',
      show3dObjects: showTerrain,
      show3dBuildings: showTerrain,
      show3dLandmarks: showTerrain,
      showLandmarkIcons: true,
      showLandmarkIconLabels: true,
      showPlaceLabels: true,
      showRoadLabels: true,
      showPointOfInterestLabels: true,
      showPointofInterestLabels: true,
      showTransitLabels: false,
    },
  };
}

function firstUsableCenter(props: NativeMapProps): [number, number] {
  if (props.userLoc) return [props.userLoc.lng, props.userLoc.lat];
  if (props.searchMarker) return [props.searchMarker.lng, props.searchMarker.lat];
  const wp = props.waypoints.find(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (wp) return [wp.lng, wp.lat];
  const camp = props.camps.find(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (camp) return [camp.lng, camp.lat];
  return [-104.9903, 39.7392];
}

function currentBounds(map: any): MapBounds {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return { w: sw.lng, s: sw.lat, e: ne.lng, n: ne.lat, zoom: map.getZoom?.() ?? 0 };
}

function clampMapZoom(value: number, fallback = 11) {
  const zoom = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.max(3, Math.min(18, zoom));
}

function premiumStyleLabel(style: PremiumMapStyle) {
  switch (style) {
    case 'standard_satellite':
      return 'Satellite Plus';
    case 'satellite_streets':
      return 'Satellite';
    case 'navigation_day':
      return 'Traffic Day';
    case 'navigation_night':
      return 'Traffic Night';
    default:
      return style.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  }
}

function syncWebRoute(map: any, waypoints: WP[]) {
  if (!map?.getStyle?.()) return;
  const coords = waypoints
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map(p => [p.lng, p.lat]);
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: coords.length > 1 ? [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    }] : [],
  };
  const source = map.getSource('trailhead-web-route');
  if (source?.setData) {
    source.setData(data);
    return;
  }
  if (!map.getSource('trailhead-web-route')) {
    map.addSource('trailhead-web-route', { type: 'geojson', data });
  }
  if (!map.getLayer('trailhead-web-route-casing')) {
    map.addLayer({
      id: 'trailhead-web-route-casing',
      type: 'line',
      source: 'trailhead-web-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#111827', 'line-width': 8, 'line-opacity': 0.75 },
    });
  }
  if (!map.getLayer('trailhead-web-route-line')) {
    map.addLayer({
      id: 'trailhead-web-route-line',
      type: 'line',
      source: 'trailhead-web-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#00a7ff', 'line-width': 4 },
    });
  }
}

function emptyTrailHighlight(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function syncWebTrailHighlight(map: any, data: GeoJSON.FeatureCollection) {
  if (!map?.getStyle?.()) return;
  const source = map.getSource('trailhead-web-trail-highlight');
  if (source?.setData) {
    source.setData(data);
    return;
  }
  if (!map.getSource('trailhead-web-trail-highlight')) {
    map.addSource('trailhead-web-trail-highlight', { type: 'geojson', data });
  }
  if (!map.getLayer('trailhead-web-trail-highlight-casing')) {
    map.addLayer({
      id: 'trailhead-web-trail-highlight-casing',
      type: 'line',
      source: 'trailhead-web-trail-highlight',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#082f49', 'line-width': 10, 'line-opacity': 0.76 },
    });
  }
  if (!map.getLayer('trailhead-web-trail-highlight-line')) {
    map.addLayer({
      id: 'trailhead-web-trail-highlight-line',
      type: 'line',
      source: 'trailhead-web-trail-highlight',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#38bdf8', 'line-width': 5, 'line-opacity': 0.96 },
    });
  }
}

function lineDistanceScore(coords: number[][], lng: number, lat: number) {
  let best = Number.POSITIVE_INFINITY;
  for (const coord of coords) {
    const dx = Number(coord?.[0]) - lng;
    const dy = Number(coord?.[1]) - lat;
    if (Number.isFinite(dx) && Number.isFinite(dy)) best = Math.min(best, dx * dx + dy * dy);
  }
  return best;
}

function webTrailHighlightFromFeatures(features: any[], lng: number, lat: number, name?: string): GeoJSON.FeatureCollection {
  const cleanName = String(name || '').trim().toLowerCase();
  const lineFeatures = features
    .map((feature: any) => {
      const geometry = feature?.geometry;
      const props = feature?.properties ?? {};
      const type = geometry?.type;
      const coords = type === 'LineString'
        ? geometry.coordinates
        : type === 'MultiLineString'
          ? geometry.coordinates?.flat()
          : [];
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const layerId = String(feature?.layer?.id || feature?.sourceLayer || feature?.source || '').toLowerCase();
      const rawClass = String(props.class || props.type || props.maki || props.category || '').toLowerCase();
      const featureName = String(props.name || props.name_en || props.ref || '').toLowerCase();
      const trailSignal = /(trail|path|track|foot|hiking|outdoor|road)/.test(`${layerId} ${rawClass} ${featureName}`);
      const nameSignal = cleanName && featureName.includes(cleanName.split(/\s+/)[0]);
      if (!trailSignal && !nameSignal) return null;
      return {
        feature: {
          type: 'Feature',
          properties: {
            name: props.name || name || 'Selected trail',
            source: 'mapbox_rendered_feature',
            source_layer: feature?.sourceLayer || feature?.layer?.id || null,
          },
          geometry: geometry as GeoJSON.Geometry,
        } as GeoJSON.Feature,
        score: lineDistanceScore(coords, lng, lat) - (nameSignal ? 0.0005 : 0),
      };
    })
    .filter((item): item is { feature: GeoJSON.Feature; score: number } => !!item)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(item => item.feature);
  return { type: 'FeatureCollection', features: lineFeatures };
}

function markerElement(label: string, color: string, ariaLabel?: string, zIndex = 1) {
  const el = document.createElement('button');
  el.type = 'button';
  const cleanLabel = label.trim();
  el.textContent = '';
  const accessibleLabel = String(ariaLabel || (cleanLabel ? `${cleanLabel} marker` : 'Place marker')).trim();
  const markerCode = cleanLabel ? cleanLabel.slice(0, 2).toUpperCase() : '';
  const size = markerCode.length > 1 ? 38 : markerCode ? 34 : 30;
  const plate = document.createElement('span');
  plate.textContent = markerCode;
  plate.style.width = markerCode.length > 1 ? '25px' : '22px';
  plate.style.height = markerCode.length > 1 ? '20px' : '22px';
  plate.style.borderRadius = '999px';
  plate.style.background = 'rgba(15,23,42,0.38)';
  plate.style.color = 'white';
  plate.style.display = 'flex';
  plate.style.alignItems = 'center';
  plate.style.justifyContent = 'center';
  plate.style.fontSize = markerCode.length > 1 ? '9px' : '10.5px';
  plate.style.fontWeight = '900';
  plate.style.letterSpacing = '0';
  plate.style.lineHeight = '1';
  plate.style.textShadow = '0 1px 2px rgba(0,0,0,0.32)';
  plate.style.pointerEvents = 'none';
  el.appendChild(plate);
  el.setAttribute('aria-label', accessibleLabel);
  el.title = accessibleLabel;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = '999px';
  el.style.border = '3px solid white';
  el.style.background = color;
  el.style.color = 'white';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.fontSize = markerCode.length > 1 ? '9px' : '10px';
  el.style.fontWeight = '900';
  el.style.lineHeight = '1';
  el.style.padding = '0';
  el.style.appearance = 'none';
  el.style.boxShadow = `0 0 0 7px ${color}2e, 0 10px 24px rgba(0,0,0,0.34)`;
  el.style.cursor = 'pointer';
  el.style.pointerEvents = 'auto';
  el.style.touchAction = 'manipulation';
  el.style.setProperty('-webkit-tap-highlight-color', 'transparent');
  el.style.zIndex = String(zIndex);
  return el;
}

function poiMarkerCode(type?: string | null) {
  const raw = String(type || '').toLowerCase();
  if (/(fuel|gas|charging)/.test(raw)) return 'G';
  if (/(water|boat|marina|launch)/.test(raw)) return 'W';
  if (/(trail|hike|park)/.test(raw)) return 'T';
  if (/(view|scenic|overlook|photo)/.test(raw)) return 'V';
  if (/(parking|rest)/.test(raw)) return 'P';
  if (/(food|restaurant|cafe)/.test(raw)) return 'F';
  if (/(camp|rv|caravan)/.test(raw)) return 'C';
  return 'P';
}

function syncWebMarkers(
  mapboxgl: any,
  map: any,
  props: NativeMapProps,
  markerRefs: React.MutableRefObject<any[]>,
) {
  markerRefs.current.forEach(marker => marker.remove());
  markerRefs.current = [];
  const add = (
    lng: number,
    lat: number,
    label: string,
    color: string,
    onPress?: () => void,
    ariaLabel?: string,
    zIndex = 1,
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const el = markerElement(label, color, ariaLabel, zIndex);
    const accessibleLabel = String(ariaLabel || el.title || 'Place marker').trim();
    el.onclick = event => {
      event.stopPropagation();
      onPress?.();
    };
    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
    marker.getElement?.()?.setAttribute('aria-label', accessibleLabel);
    marker.getElement?.()?.setAttribute('title', accessibleLabel);
    markerRefs.current.push(marker);
  };
  props.gas.slice(0, 60).forEach(g => add(g.lng, g.lat, 'G', '#eab308', () => props.suppressFeatureTaps ? props.onMapTap(g.lat, g.lng) : props.onGasTap?.(g), `${g.name || 'Fuel'} marker`, 10));
  props.pois.slice(0, WEB_POI_MARKER_LIMIT).forEach(p => add(p.lng, p.lat, poiMarkerCode(p.type), '#38bdf8', () => props.suppressFeatureTaps ? props.onMapTap(p.lat, p.lng) : props.onPoiTap?.(p as any), `${p.name || 'Place'} marker`, 20));
  props.communityPins.slice(0, WEB_COMMUNITY_MARKER_LIMIT).forEach(p => add(p.lng, p.lat, '!', '#a855f7', () => props.suppressFeatureTaps ? props.onMapTap(p.lat, p.lng) : props.onCommunityPinTap?.(p), `${(p as any).title || (p as any).name || p.description || 'Community pin'} marker`, 30));
  props.camps.slice(0, WEB_CAMP_MARKER_LIMIT).forEach(c => {
    const visual = campMarkerVisual(c as any);
    add(c.lng, c.lat, visual.code, visual.color, () => props.onCampTap(c), `${c.name || visual.label} ${visual.label} marker`, 80);
  });
  props.waypoints.slice(0, 24).forEach((p, idx) => add(p.lng, p.lat, String(idx + 1), '#f97316', () => props.onWaypointTap(idx, p.name), `${p.name || `Stop ${idx + 1}`} marker`, 90));
  if (props.searchMarker) add(props.searchMarker.lng, props.searchMarker.lat, 'S', '#ef4444', undefined, `${props.searchMarker.name || 'Search result'} marker`, 95);
  if (props.userLoc) add(props.userLoc.lng, props.userLoc.lat, 'ME', '#22c55e', undefined, 'Your location marker', 100);
}

function mapWebMapboxFeatureToPlace(feature: any, fallbackLat: number, fallbackLng: number) {
  const props = feature?.properties ?? {};
  const name = String(props.name || props.name_en || props.name_script || props.brand || props.full_address || '').trim();
  if (!name || name.length < 2) return null;
  const coords = feature?.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : [fallbackLng, fallbackLat];
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rawType = String(props.maki || props.class || props.category || props.type || 'poi').toLowerCase();
  const type = /(fuel|gas|charging)/.test(rawType) ? 'fuel'
    : /(restaurant|cafe|food)/.test(rawType) ? 'food'
      : /(camp|rv|caravan)/.test(rawType) ? 'camp'
        : /(trail|park)/.test(rawType) ? 'trailhead'
          : 'poi';
  return {
    id: `mapbox_feature:${String(props.mapbox_id || props.id || `${lat.toFixed(5)}:${lng.toFixed(5)}:${name}`).slice(0, 160)}`,
    name,
    lat,
    lng,
    type,
    source: 'mapbox_feature',
    source_label: 'Map data',
    place_id: props.mapbox_id || props.id,
    provider_place_id: props.mapbox_id || props.id,
    attribution: 'Map data',
    summary: 'Selected place from the map.',
  };
}

function mapWebMapboxFeaturePickScore(feature: any) {
  const props = feature?.properties ?? {};
  const layerId = String(feature?.layer?.id || feature?.sourceLayer || feature?.source || '').toLowerCase();
  const raw = String(props.maki || props.class || props.type || props.category || props.group || props.poi_category || '').toLowerCase();
  const hasPoiSignal = !!String(props.maki || props.poi_category || props.category || props.type || '').trim();
  let score = 100;
  if (layerId.includes('poi')) score -= 55;
  if (layerId.includes('label')) score -= 18;
  if (layerId.includes('transit') || layerId.includes('airport')) score -= 20;
  if (feature?.geometry?.type === 'Point') score -= 14;
  if (hasPoiSignal) score -= 12;
  if (/(restaurant|cafe|bar|food|pizza|fuel|gas|charging|grocery|supermarket|shop|market|hotel|lodg|motel|view|attraction|museum|monument|landmark|water|drinking|trail|hiking|park|camp|caravan|rv)/.test(raw)) score -= 30;
  if (layerId.includes('building')) score += 16;
  if (layerId.includes('road') || layerId.includes('boundary') || layerId.includes('landuse')) score += 40;
  if (/(country|state|province|settlement|city|town|village|neighborhood|postcode|address|road|street|motorway|primary|secondary|water|ocean|landuse)/.test(raw)) score += 45;
  return score;
}

function bestWebMapboxPlaceFromFeatures(features: any[], fallbackLat: number, fallbackLng: number) {
  return features
    .map(feature => ({ place: mapWebMapboxFeatureToPlace(feature, fallbackLat, fallbackLng), score: mapWebMapboxFeaturePickScore(feature) }))
    .filter((item): item is { place: NonNullable<ReturnType<typeof mapWebMapboxFeatureToPlace>>; score: number } => !!item.place)
    .sort((a, b) => a.score - b.score)[0]?.place ?? null;
}

function webScreenPosition(x: number, y: number, width: number, height: number): MapSelectableFeature['screen_position'] {
  const nx = x / Math.max(1, width);
  const ny = y / Math.max(1, height);
  if (nx >= 0.34 && nx <= 0.66 && ny >= 0.28 && ny <= 0.68) return 'center';
  if (ny < 0.28) return 'top';
  if (ny > 0.68) return 'bottom';
  return nx < 0.5 ? 'left' : 'right';
}

function webPlaceToCandidate(place: any, idx: number, map: any): MapSelectableFeature | null {
  if (!place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return null;
  const point = map?.project?.([place.lng, place.lat]);
  const canvas = map?.getCanvas?.();
  return {
    feature_id: String(place.id || place.place_id || place.provider_place_id || `${place.source || 'web'}:${place.name}:${place.lat}:${place.lng}`).slice(0, 180),
    result_index: idx,
    name: place.name || 'Place',
    lat: Number(place.lat),
    lng: Number(place.lng),
    type: place.type || 'poi',
    subtype: place.subtype || null,
    source: place.source || 'mapbox_feature',
    source_label: place.source_label || 'Map data',
    source_layer: place.source_layer || null,
    screen_x: Number.isFinite(point?.x) ? point.x : null,
    screen_y: Number.isFinite(point?.y) ? point.y : null,
    screen_position: Number.isFinite(point?.x) && Number.isFinite(point?.y) ? webScreenPosition(point.x, point.y, canvas?.clientWidth || 1, canvas?.clientHeight || 1) : null,
    confidence: 'medium',
    aliases: [place.name, place.type, place.subtype].filter(Boolean),
    summary: place.summary || null,
    place,
  };
}

const mapboxContainerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
};

const NativeMap = forwardRef<NativeMapHandle, NativeMapProps>((props, ref) => {
  const C = useTheme();
  const mapboxToken = useStore(st => st.mapboxToken);
  const isMapboxWeb = !!mapboxToken;
  const isWebMap = true;
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const mapboxGlRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const routeReadyRef = useRef(false);
  const trailHighlightRef = useRef<GeoJSON.FeatureCollection>(emptyTrailHighlight());
  const suppressFeatureTapsRef = useRef(props.suppressFeatureTaps);
  const onMapTapRef = useRef(props.onMapTap);
  const onPoiTapRef = useRef(props.onPoiTap);
  const [mapboxError, setMapboxError] = useState('');
  const initialCenter = useMemo(() => firstUsableCenter(props), [props.userLoc, props.searchMarker, props.waypoints, props.camps]);
  const premiumStyle = (props.premiumMapStyle as PremiumMapStyle | undefined) ?? 'standard';

  useEffect(() => {
    suppressFeatureTapsRef.current = props.suppressFeatureTaps;
    onMapTapRef.current = props.onMapTap;
    onPoiTapRef.current = props.onPoiTap;
  }, [props.suppressFeatureTaps, props.onMapTap, props.onPoiTap]);

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lng: number, zoom = 11) => mapRef.current?.flyTo?.({
      center: [lng, lat],
      zoom,
      ...(isMapboxWeb && props.showTerrain ? { pitch: 58 } : { pitch: 0 }),
      duration: isMapboxWeb && props.showTerrain ? 620 : 300,
      essential: true,
    }),
    flyToCamera: (options: NativeMapCameraOptions) => {
      const map = mapRef.current;
      const lat = Number(options.lat);
      const lng = Number(options.lng);
      if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const camera: Record<string, any> = {
        center: [lng, lat],
        duration: Number.isFinite(Number(options.duration)) ? Number(options.duration) : 520,
        essential: true,
      };
      if (Number.isFinite(Number(options.zoom))) camera.zoom = clampMapZoom(Number(options.zoom));
      if (Number.isFinite(Number(options.pitch))) camera.pitch = Math.max(0, Math.min(75, Number(options.pitch)));
      if (Number.isFinite(Number(options.bearing))) camera.bearing = Number(options.bearing);
      if (options.mode === 'easeTo' && map.easeTo) map.easeTo(camera);
      else map.flyTo?.(camera);
    },
    setZoom: async (zoom: number, focus?: { lat?: number; lng?: number } | null) => {
      const map = mapRef.current;
      if (!map) return null;
      const nextZoom = clampMapZoom(zoom);
      const lat = Number(focus?.lat);
      const lng = Number(focus?.lng);
      const center = Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : undefined;
      if (map.easeTo) map.easeTo({ ...(center ? { center } : {}), zoom: nextZoom, duration: 240, essential: true });
      else map.setZoom?.(nextZoom);
      return nextZoom;
    },
    zoomBy: async (delta: number, focus?: { lat?: number; lng?: number } | null) => {
      const map = mapRef.current;
      if (!map) return null;
      const current = Number(map.getZoom?.());
      const base = Number.isFinite(current) ? current : 11;
      const nextZoom = clampMapZoom(base + (Number.isFinite(Number(delta)) ? Number(delta) : 1));
      const lat = Number(focus?.lat);
      const lng = Number(focus?.lng);
      const center = Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : undefined;
      if (map.easeTo) map.easeTo({ ...(center ? { center } : {}), zoom: nextZoom, duration: 240, essential: true });
      else map.setZoom?.(nextZoom);
      return nextZoom;
    },
    locate: (lat: number, lng: number) => mapRef.current?.flyTo?.({ center: [lng, lat], zoom: 13, essential: true }),
    loadRouteFrom: noop,
    rerouteFrom: noop,
    routeToSearch: (lat: number, lng: number) => mapRef.current?.flyTo?.({
      center: [lng, lat],
      zoom: 12,
      ...(isMapboxWeb && props.showTerrain ? { pitch: 58 } : { pitch: 0 }),
      duration: isMapboxWeb && props.showTerrain ? 620 : 300,
      essential: true,
    }),
    resetRoute: noop,
    stopNavigation: noop,
    highlightTrail: (lat: number, lng: number, name?: string) => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo?.({
        center: [lng, lat],
        zoom: Math.max(13, Number(map.getZoom?.()) || 13),
        ...(isMapboxWeb && props.showTerrain ? { pitch: 58 } : { pitch: 0 }),
        essential: true,
      });
      window.setTimeout(() => {
        const point = map.project?.([lng, lat]);
        if (!point) return;
        const box = [[point.x - 72, point.y - 72], [point.x + 72, point.y + 72]];
        const features = [
          ...(map.queryRenderedFeatures?.(box) ?? []),
          ...(map.queryRenderedFeatures?.([point.x, point.y]) ?? []),
        ];
        trailHighlightRef.current = webTrailHighlightFromFeatures(features, lng, lat, name);
        syncWebTrailHighlight(map, trailHighlightRef.current);
      }, 320);
    },
    clearTrailHighlight: () => {
      trailHighlightRef.current = emptyTrailHighlight();
      syncWebTrailHighlight(mapRef.current, trailHighlightRef.current);
    },
    getTrailHighlight: () => trailHighlightRef.current,
    captureTrailAt: async () => ({ type: 'FeatureCollection', features: [] }),
    screenToCoordinate: async (x: number, y: number) => {
      const point = mapRef.current?.unproject?.([x, y]);
      return point ? [point.lng, point.lat] : null;
    },
    selectFeatureAtScreenPoint: async (x: number, y: number) => {
      const map = mapRef.current;
      if (!map) return null;
      const point = map.unproject?.([x, y]);
      if (!point) return null;
      const box = [[x - 42, y - 42], [x + 42, y + 42]];
      const features = [
        ...(map.queryRenderedFeatures?.(box) ?? []),
        ...(map.queryRenderedFeatures?.([x, y]) ?? []),
      ];
      const place = bestWebMapboxPlaceFromFeatures(features, point.lat, point.lng);
      return webPlaceToCandidate(place, 0, map);
    },
    queryVisibleFeatures: async () => {
      const map = mapRef.current;
      if (!map) return [];
      const canvas = map.getCanvas?.();
      const features = map.queryRenderedFeatures?.([[0, 0], [canvas?.clientWidth || 1, canvas?.clientHeight || 1]]) ?? [];
      const seen = new Set<string>();
      const candidates: MapSelectableFeature[] = [];
      for (const item of features
        .map((feature: any) => ({ place: mapWebMapboxFeatureToPlace(feature, 0, 0), score: mapWebMapboxFeaturePickScore(feature) }))
        .filter((item: any) => item.place)
        .sort((a: any, b: any) => a.score - b.score)) {
        const key = `${String(item.place.name || '').toLowerCase()}:${Number(item.place.lat).toFixed(4)}:${Number(item.place.lng).toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = webPlaceToCandidate(item.place, candidates.length, map);
        if (candidate) candidates.push(candidate);
        if (candidates.length >= 24) break;
      }
      return candidates;
    },
    getVisibleMapCandidates: async () => {
      const map = mapRef.current;
      if (!map) return [];
      const canvas = map.getCanvas?.();
      const features = map.queryRenderedFeatures?.([[0, 0], [canvas?.clientWidth || 1, canvas?.clientHeight || 1]]) ?? [];
      const seen = new Set<string>();
      const candidates: MapSelectableFeature[] = [];
      for (const item of features
        .map((feature: any) => ({ place: mapWebMapboxFeatureToPlace(feature, 0, 0), score: mapWebMapboxFeaturePickScore(feature) }))
        .filter((item: any) => item.place)
        .sort((a: any, b: any) => a.score - b.score)) {
        const key = `${String(item.place.name || '').toLowerCase()}:${Number(item.place.lat).toFixed(4)}:${Number(item.place.lng).toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = webPlaceToCandidate(item.place, candidates.length, map);
        if (candidate) candidates.push(candidate);
        if (candidates.length >= 24) break;
      }
      return candidates;
    },
    getVisibleCenter: async () => {
      const center = mapRef.current?.getCenter?.();
      return center ? [center.lng, center.lat] : null;
    },
    getVisibleBounds: async () => {
      const bounds = mapRef.current?.getBounds?.();
      if (!bounds) return null;
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      return { w: sw.lng, s: sw.lat, e: ne.lng, n: ne.lat, zoom: mapRef.current?.getZoom?.() ?? 0 };
    },
    restoreRoute: noop,
    setNavTarget: noop,
  }));

  useEffect(() => {
    if (!isWebMap || !mapElRef.current || mapRef.current) return;
    let cancelled = false;
    setMapboxError('');
    const loadMapRuntime = isMapboxWeb ? loadMapboxGl : loadMapLibreGl;
    loadMapRuntime()
      .then(mapgl => {
        if (cancelled || !mapElRef.current) return;
        if (isMapboxWeb) mapgl.accessToken = mapboxToken;
        mapboxGlRef.current = mapgl;
        const mapOptions: Record<string, any> = {
          container: mapElRef.current,
          style: isMapboxWeb ? (MAPBOX_STYLE_URLS[premiumStyle] ?? MAPBOX_STYLE_URLS.standard) : trailheadVectorStyle(),
          center: initialCenter,
          zoom: props.userLoc || props.searchMarker ? 11 : 5,
          pitch: isMapboxWeb && props.showTerrain ? 56 : 0,
          bearing: -18,
          attributionControl: false,
        };
        if (isMapboxWeb) {
          mapOptions.projection = 'globe';
          mapOptions.config = styleConfig(premiumStyle, props.showTerrain);
        }
        mapRef.current = new mapgl.Map(mapOptions);
        if (process.env.NODE_ENV !== 'production') {
          (window as any).__trailheadWebMap = mapRef.current;
        }
        mapRef.current.addControl(new mapgl.NavigationControl(isMapboxWeb ? { visualizePitch: true } : { showCompass: true }), 'top-right');
        mapRef.current.on('load', () => {
          routeReadyRef.current = true;
          props.onMapReady?.();
          props.onBoundsChange?.(currentBounds(mapRef.current));
          syncWebRoute(mapRef.current, props.waypoints);
          syncWebTrailHighlight(mapRef.current, trailHighlightRef.current);
          syncWebMarkers(mapgl, mapRef.current, props, markerRefs);
        });
        mapRef.current.on('moveend', () => props.onBoundsChange?.(currentBounds(mapRef.current)));
        mapRef.current.on('click', (e: any) => {
          if (suppressFeatureTapsRef.current) {
            onMapTapRef.current?.(e.lngLat?.lat, e.lngLat?.lng);
            return;
          }
          const box = [
            [e.point.x - 24, e.point.y - 24],
            [e.point.x + 24, e.point.y + 24],
          ];
          const features = [
            ...(mapRef.current?.queryRenderedFeatures?.(box) ?? []),
            ...(mapRef.current?.queryRenderedFeatures?.(e.point) ?? []),
          ];
          const place = bestWebMapboxPlaceFromFeatures(features, e.lngLat?.lat, e.lngLat?.lng);
          if (place) {
            onPoiTapRef.current?.(place as any);
            return;
          }
          onMapTapRef.current?.(e.lngLat?.lat, e.lngLat?.lng);
        });
      })
      .catch(err => setMapboxError(err?.message ?? 'Map could not load.'));
    return () => {
      cancelled = true;
      routeReadyRef.current = false;
      markerRefs.current.forEach(marker => marker.remove());
      markerRefs.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if (process.env.NODE_ENV !== 'production' && (window as any).__trailheadWebMap) {
        delete (window as any).__trailheadWebMap;
      }
    };
  }, [isWebMap, isMapboxWeb, mapboxToken]);

  useEffect(() => {
    if (!isWebMap || !mapRef.current) return;
    routeReadyRef.current = false;
    if (isMapboxWeb) {
      mapRef.current.setStyle(MAPBOX_STYLE_URLS[premiumStyle] ?? MAPBOX_STYLE_URLS.standard, { config: styleConfig(premiumStyle, props.showTerrain) });
    } else {
      mapRef.current.setStyle(trailheadVectorStyle());
    }
    mapRef.current.once('style.load', () => {
      routeReadyRef.current = true;
      syncWebRoute(mapRef.current, props.waypoints);
      syncWebTrailHighlight(mapRef.current, trailHighlightRef.current);
      if (isMapboxWeb && mapRef.current?.setConfigProperty) {
        Object.entries(styleConfig(premiumStyle, props.showTerrain).basemap).forEach(([key, value]) => {
          mapRef.current.setConfigProperty('basemap', key, value);
        });
      }
    });
  }, [isWebMap, isMapboxWeb, premiumStyle, props.showTerrain]);

  useEffect(() => {
    if (!isWebMap || !mapRef.current || !routeReadyRef.current) return;
    syncWebRoute(mapRef.current, props.waypoints);
  }, [isWebMap, props.waypoints]);

  useEffect(() => {
    if (!isWebMap || !mapRef.current || !mapboxGlRef.current) return;
    syncWebMarkers(mapboxGlRef.current, mapRef.current, props, markerRefs);
  }, [isWebMap, props.waypoints, props.camps, props.gas, props.pois, props.searchMarker, props.userLoc, props.suppressFeatureTaps]);

  const pins = [
    ...props.waypoints.map((p, idx) => ({ key: `wp_${idx}`, name: p.name, type: p.type, color: '#c65f39', onPress: () => props.onWaypointTap(idx, p.name) })),
    ...props.camps.map(c => {
      const visual = campMarkerVisual(c as any);
      return { key: `camp_${c.id}`, name: c.name, type: visual.code, label: visual.code, color: visual.color, onPress: () => props.onCampTap(c) };
    }),
    ...props.gas.map(g => ({ key: `gas_${g.lat}_${g.lng}`, name: g.name, type: 'G', label: 'G', color: '#eab308', onPress: () => props.suppressFeatureTaps ? props.onMapTap(g.lat, g.lng) : props.onGasTap?.(g) })),
    ...props.pois.map(p => ({ key: `poi_${p.lat}_${p.lng}_${p.type}`, name: p.name, type: poiMarkerCode(p.type), label: poiMarkerCode(p.type), color: '#38bdf8', onPress: () => props.suppressFeatureTaps ? props.onMapTap(p.lat, p.lng) : props.onPoiTap?.(p) })),
  ].slice(0, 12);
  const hasRouteLine = props.waypoints.length > 1;
  const hasMapContent = pins.length > 0 || !!props.searchMarker || !!props.userLoc;
  const darkStyleFallback = isMapboxWeb && /satellite|night/i.test(premiumStyle);
  const mapFallbackColor = darkStyleFallback ? '#05070a' : '#f6f7f2';
  const footerParts = [
    props.waypoints.length > 0 ? `${props.waypoints.length} stop${props.waypoints.length === 1 ? '' : 's'}` : '',
    props.camps.length > 0 ? `${props.camps.length} camp${props.camps.length === 1 ? '' : 's'}` : '',
    props.gas.length > 0 ? `${props.gas.length} fuel` : '',
    props.pois.length > 0 ? `${props.pois.length} place${props.pois.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const previewFooterText = footerParts.length ? footerParts.join(' · ') : 'No route yet';

  if (isWebMap) {
    return (
      <View style={[styles.wrap, styles.mapboxWrap, { backgroundColor: mapFallbackColor }]}>
        {React.createElement('div', { ref: mapElRef, style: mapboxContainerStyle })}
        {mapboxError ? (
          <View style={styles.emptyState}>
            <Ionicons name="warning-outline" size={24} color={C.orange} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>Map preview unavailable</Text>
            <Text style={[styles.emptyText, { color: C.text3 }]}>{mapboxError}</Text>
          </View>
        ) : null}
        {props.children}
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[styles.wrap, { backgroundColor: C.s2 }]}
      onPress={() => props.onMapTap(39.7392, -104.9903)}
    >
      <View style={styles.grid} />
      <View style={styles.header}>
        <Ionicons name="map-outline" size={16} color="#fff" />
        <Text style={styles.headerText}>Trail map</Text>
      </View>
      {hasRouteLine ? <View style={styles.routeLine} /> : null}
      {!hasMapContent ? (
        <View style={styles.emptyState}>
          <Ionicons name="trail-sign-outline" size={24} color={C.orange} />
          <Text style={[styles.emptyTitle, { color: C.text }]}>Plan a route</Text>
          <Text style={[styles.emptyText, { color: C.text3 }]}>Choose a start and destination to see the line, camps, fuel, and places.</Text>
        </View>
      ) : null}
      <View style={styles.pinCloud}>
        {pins.map((pin, idx) => (
          <TouchableOpacity
            key={pin.key}
            style={[
              styles.pin,
              { backgroundColor: pin.color, left: `${10 + (idx * 17) % 76}%`, top: `${24 + (idx * 23) % 52}%` },
            ]}
            onPress={pin.onPress}
          >
            {'label' in pin && pin.label === '' ? null : (
              <Text style={styles.pinText}>{String(('label' in pin ? pin.label : pin.type) || '?').slice(0, 2).toUpperCase()}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {previewFooterText}
        </Text>
      </View>
      {props.children}
    </TouchableOpacity>
  );
});

export default NativeMap;

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', position: 'relative' },
  mapboxWrap: { minHeight: 320 },
  grid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
    backgroundColor: '#1f2937',
  },
  header: {
    position: 'absolute', left: 12, top: 12,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  headerText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  emptyState: {
    position: 'absolute', left: 24, right: 24, top: 74,
    alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  emptyTitle: { fontSize: 14, fontWeight: '900' },
  emptyText: { fontSize: 11, lineHeight: 15, textAlign: 'center' },
  routeLine: {
    position: 'absolute', left: '12%', right: '12%', top: '52%',
    height: 4, borderRadius: 4, backgroundColor: '#f97316',
    transform: [{ rotate: '-13deg' }],
  },
  pinCloud: { ...StyleSheet.absoluteFillObject },
  pin: {
    position: 'absolute', width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  pinText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  footer: {
    position: 'absolute', right: 12, bottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  footerText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
