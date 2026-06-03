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

export type { WP, RouteOpts, MapBounds, RouteResult, RouteStep } from './types';

export interface NativeMapHandle {
  flyTo:          (lat: number, lng: number, zoom?: number, name?: string) => void;
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
  onRoutePersist:   (data: { coords: [number,number][]; steps: RouteStep[]; legs: RouteStep[][]; totalDistance: number; totalDuration: number; tripId: string | null }) => void;
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
  }
}

let mapboxGlPromise: Promise<any> | null = null;

function loadMapboxGl() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Mapbox GL JS requires a browser runtime'));
  }
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

function styleConfig(style: PremiumMapStyle) {
  return {
    basemap: {
      lightPreset: MAPBOX_LIGHT_PRESETS[style] ?? 'day',
      show3dObjects: true,
      showPlaceLabels: true,
      showRoadLabels: true,
      showPointOfInterestLabels: true,
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
      paint: { 'line-color': '#f97316', 'line-width': 4 },
    });
  }
}

function markerElement(label: string, color: string) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label.slice(0, 2).toUpperCase();
  el.style.width = '28px';
  el.style.height = '28px';
  el.style.borderRadius = '999px';
  el.style.border = '2px solid white';
  el.style.background = color;
  el.style.color = 'white';
  el.style.fontSize = '10px';
  el.style.fontWeight = '900';
  el.style.boxShadow = '0 8px 20px rgba(0,0,0,0.35)';
  el.style.cursor = 'pointer';
  return el;
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
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const el = markerElement(label, color);
    el.onclick = event => {
      event.stopPropagation();
      onPress?.();
    };
    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
    markerRefs.current.push(marker);
  };
  props.waypoints.slice(0, 24).forEach((p, idx) => add(p.lng, p.lat, String(idx + 1), '#f97316', () => props.onWaypointTap(idx, p.name)));
  props.camps.slice(0, 80).forEach(c => add(c.lng, c.lat, 'C', '#14b8a6', () => props.onCampTap(c)));
  props.gas.slice(0, 40).forEach(g => add(g.lng, g.lat, 'F', '#eab308', () => props.onGasTap?.(g)));
  props.pois.slice(0, 80).forEach(p => add(p.lng, p.lat, 'P', '#38bdf8', () => props.onPoiTap?.(p as any)));
  props.communityPins.slice(0, 80).forEach(p => add(p.lng, p.lat, 'U', '#a855f7', () => props.onCommunityPinTap?.(p)));
  if (props.searchMarker) add(props.searchMarker.lng, props.searchMarker.lat, 'S', '#ef4444');
  if (props.userLoc) add(props.userLoc.lng, props.userLoc.lat, 'ME', '#22c55e');
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
    source_label: 'Mapbox',
    place_id: props.mapbox_id || props.id,
    provider_place_id: props.mapbox_id || props.id,
    attribution: 'Mapbox',
    summary: 'Temporary Mapbox basemap feature selected from EXTREME.',
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
    source_label: place.source_label || 'Mapbox',
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
  const isExtremeWeb = props.mapLayer === 'extreme' && !!mapboxToken;
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const mapboxGlRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const routeReadyRef = useRef(false);
  const [mapboxError, setMapboxError] = useState('');
  const initialCenter = useMemo(() => firstUsableCenter(props), [props.userLoc, props.searchMarker, props.waypoints, props.camps]);
  const premiumStyle = (props.premiumMapStyle as PremiumMapStyle | undefined) ?? 'standard';

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lng: number, zoom = 11) => mapRef.current?.flyTo?.({ center: [lng, lat], zoom, essential: true }),
    locate: (lat: number, lng: number) => mapRef.current?.flyTo?.({ center: [lng, lat], zoom: 13, essential: true }),
    loadRouteFrom: noop,
    rerouteFrom: noop,
    routeToSearch: (lat: number, lng: number) => mapRef.current?.flyTo?.({ center: [lng, lat], zoom: 12, essential: true }),
    resetRoute: noop,
    stopNavigation: noop,
    highlightTrail: noop,
    clearTrailHighlight: noop,
    getTrailHighlight: () => ({ type: 'FeatureCollection', features: [] }),
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

  React.useEffect(() => {
    if (!isExtremeWeb) props.onMapReady?.();
  }, [isExtremeWeb]);

  useEffect(() => {
    if (!isExtremeWeb || !mapElRef.current || mapRef.current) return;
    let cancelled = false;
    setMapboxError('');
    loadMapboxGl()
      .then(mapboxgl => {
        if (cancelled || !mapElRef.current) return;
        mapboxgl.accessToken = mapboxToken;
        mapboxGlRef.current = mapboxgl;
        mapRef.current = new mapboxgl.Map({
          container: mapElRef.current,
          style: MAPBOX_STYLE_URLS[premiumStyle] ?? MAPBOX_STYLE_URLS.standard,
          center: initialCenter,
          zoom: props.userLoc || props.searchMarker ? 11 : 5,
          pitch: 56,
          bearing: -18,
          projection: 'globe',
          config: styleConfig(premiumStyle),
        });
        mapRef.current.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
        mapRef.current.on('load', () => {
          routeReadyRef.current = true;
          props.onMapReady?.();
          props.onBoundsChange?.(currentBounds(mapRef.current));
          syncWebRoute(mapRef.current, props.waypoints);
          syncWebMarkers(mapboxgl, mapRef.current, props, markerRefs);
        });
        mapRef.current.on('moveend', () => props.onBoundsChange?.(currentBounds(mapRef.current)));
        mapRef.current.on('click', (e: any) => {
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
            props.onPoiTap?.(place as any);
            return;
          }
          props.onMapTap?.(e.lngLat?.lat, e.lngLat?.lng);
        });
      })
      .catch(err => setMapboxError(err?.message ?? 'Failed to load Mapbox GL JS'));
    return () => {
      cancelled = true;
      routeReadyRef.current = false;
      markerRefs.current.forEach(marker => marker.remove());
      markerRefs.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [isExtremeWeb, mapboxToken]);

  useEffect(() => {
    if (!isExtremeWeb || !mapRef.current) return;
    routeReadyRef.current = false;
    mapRef.current.setStyle(MAPBOX_STYLE_URLS[premiumStyle] ?? MAPBOX_STYLE_URLS.standard, { config: styleConfig(premiumStyle) });
    mapRef.current.once('style.load', () => {
      routeReadyRef.current = true;
      syncWebRoute(mapRef.current, props.waypoints);
      if (mapRef.current?.setConfigProperty) {
        Object.entries(styleConfig(premiumStyle).basemap).forEach(([key, value]) => {
          mapRef.current.setConfigProperty('basemap', key, value);
        });
      }
    });
  }, [isExtremeWeb, premiumStyle]);

  useEffect(() => {
    if (!isExtremeWeb || !mapRef.current || !routeReadyRef.current) return;
    syncWebRoute(mapRef.current, props.waypoints);
  }, [isExtremeWeb, props.waypoints]);

  useEffect(() => {
    if (!isExtremeWeb || !mapRef.current || !mapboxGlRef.current) return;
    syncWebMarkers(mapboxGlRef.current, mapRef.current, props, markerRefs);
  }, [isExtremeWeb, props.waypoints, props.camps, props.gas, props.pois, props.searchMarker, props.userLoc]);

  const pins = [
    ...props.waypoints.map((p, idx) => ({ key: `wp_${idx}`, name: p.name, type: p.type, color: '#c65f39', onPress: () => props.onWaypointTap(idx, p.name) })),
    ...props.camps.map(c => ({ key: `camp_${c.id}`, name: c.name, type: 'camp', color: '#14b8a6', onPress: () => props.onCampTap(c) })),
    ...props.gas.map(g => ({ key: `gas_${g.lat}_${g.lng}`, name: g.name, type: 'fuel', color: '#eab308', onPress: () => props.onGasTap?.(g) })),
    ...props.pois.map(p => ({ key: `poi_${p.lat}_${p.lng}_${p.type}`, name: p.name, type: p.type, color: '#38bdf8', onPress: () => props.onPoiTap?.(p) })),
  ].slice(0, 12);
  const hasRouteLine = props.waypoints.length > 1;
  const hasMapContent = pins.length > 0 || !!props.searchMarker || !!props.userLoc;

  if (isExtremeWeb) {
    return (
      <View style={[styles.wrap, styles.mapboxWrap, { backgroundColor: '#05070a' }]}>
        {React.createElement('div', { ref: mapElRef, style: mapboxContainerStyle })}
        <View style={styles.header}>
          <Ionicons name="planet-outline" size={16} color="#fff" />
          <Text style={styles.headerText}>EXTREME · MAPBOX GL JS {MAPBOX_GL_VERSION.toUpperCase()}</Text>
        </View>
        {mapboxError ? (
          <View style={styles.emptyState}>
            <Ionicons name="warning-outline" size={24} color={C.orange} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>Mapbox GL JS did not load</Text>
            <Text style={[styles.emptyText, { color: C.text3 }]}>{mapboxError}</Text>
          </View>
        ) : null}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {premiumStyle.replace(/_/g, ' ').toUpperCase()} · {props.camps.length} camps · {props.pois.length} places
          </Text>
        </View>
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
        <Text style={styles.headerText}>WEB MAP PREVIEW</Text>
      </View>
      {hasRouteLine ? <View style={styles.routeLine} /> : null}
      {!hasMapContent ? (
        <View style={styles.emptyState}>
          <Ionicons name="trail-sign-outline" size={24} color={C.orange} />
          <Text style={[styles.emptyTitle, { color: C.text }]}>Build the base route</Text>
          <Text style={[styles.emptyText, { color: C.text3 }]}>Add a start and destination to preview the line, camps, fuel, and places.</Text>
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
            <Text style={styles.pinText}>{String(pin.type || '?').slice(0, 1).toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {props.waypoints.length} stops · {props.camps.length} camps · {props.gas.length} fuel · {props.pois.length} places
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
