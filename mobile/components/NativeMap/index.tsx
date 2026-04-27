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
import { View, StyleSheet } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import * as SecureStore from 'expo-secure-store';

import { buildMapStyle, MapMode } from './mapStyle';
import { fetchRoute, buildFallbackRoute } from './routing';
import type { RouteResult, RouteStep, RouteOpts, MapBounds, WP } from './types';
import type { CampsitePin, Pin, Report } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';

// ── Types ─────────────────────────────────────────────────────────────────────
export type { WP, RouteOpts, MapBounds, RouteResult, RouteStep } from './types';

export interface NativeMapHandle {
  flyTo:          (lat: number, lng: number, zoom?: number, name?: string) => void;
  locate:         (lat: number, lng: number) => void;
  loadRouteFrom:  (lat: number, lng: number, fromIdx: number) => void;
  rerouteFrom:    (lat: number, lng: number, fromIdx: number) => void;
  routeToSearch:  (lat: number, lng: number, name: string, userLat: number, userLng: number) => void;
  resetRoute:     () => void;
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
  userLoc:     { lat: number; lng: number } | null;
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
  onMapTap:         () => void;
  onMapLongPress:   (lat: number, lng: number) => void;
  onCampTap:        (camp: CampsitePin) => void;
  onBaseCampTap:    (name: string, lat: number, lng: number, landType: string) => void;
  onTrailTap:       (name: string, lat: number, lng: number) => void;
  onWaypointTap:    (idx: number, name: string) => void;
  onRouteReady:     (result: RouteResult & { fromIdx: number }) => void;
  onRoutePersist:   (data: { coords: [number,number][]; steps: RouteStep[]; legs: RouteStep[][]; totalDistance: number; totalDuration: number; tripId: string | null }) => void;
  onError?:         (msg: string) => void;
}

// ── Waypoint type → styles ────────────────────────────────────────────────────
const WP_COLORS: Record<string, string> = {
  start: '#22c55e', camp: '#14b8a6', fuel: '#eab308', motel: '#6366f1',
  shower: '#38bdf8', town: '#94a3b8', waypoint: '#a855f7',
};
const WP_ICONS: Record<string, string> = {
  fuel: '⛽', camp: '⛺', start: 'S', motel: 'M', shower: '💧', town: 'T',
};
const WP_LABELS: Record<string, string> = {
  fuel: 'Fuel', camp: 'Camp', start: 'Start', motel: 'Lodging',
  shower: 'Showers', town: 'Town', waypoint: 'Waypoint',
};

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

// ── Main component ────────────────────────────────────────────────────────────
const NativeMap = forwardRef<NativeMapHandle, NativeMapProps>((props, ref) => {
  const {
    waypoints, camps, gas, pois, reports, communityPins, searchMarker,
    userLoc, navMode, navIdx, navHeading,
    mapLayer, routeOpts,
    onMapReady, onBoundsChange, onMapTap, onMapLongPress,
    onCampTap, onBaseCampTap, onTrailTap, onWaypointTap,
    onRouteReady, onRoutePersist,
  } = props;

  const mapRef = useRef<MapLibreGL.MapViewRef>(null);
  const camRef = useRef<MapLibreGL.CameraRef>(null);

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

  // Route state
  const [routeCoords,  setRouteCoords]  = useState<[number,number][]>([]);
  const [passedCoords, setPassedCoords] = useState<[number,number][]>([]);
  const [breadcrumb,   setBreadcrumb]   = useState<[number,number][]>([]);
  const [navTargetIdx, setNavTargetIdx] = useState(-1);
  const [searchDest,   setSearchDest]   = useState<{ lat: number; lng: number } | null>(null);

  // Route tracking ref
  const routeRef = useRef({ coords: [] as [number,number][], passedIdx: 0 });

  // MLRN v10 uses `mapStyle` — accepts string (style URL) or object (inline JSON).
  const mapStyleObj = useMemo(
    () => buildMapStyle(mapLayer, mapboxToken || ''),
    [mapLayer, mapboxToken],
  );

  // ── Imperative API (replaces postMessage) ───────────────────────────────────
  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom = 14) {
      camRef.current?.setCamera({ centerCoordinate: [lng, lat], zoomLevel: zoom, animationDuration: 600, animationMode: 'flyTo' });
    },
    locate(lat, lng) {
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
      setRouteCoords([]); setPassedCoords([]); setBreadcrumb([]);
      routeRef.current = { coords: [], passedIdx: 0 };
      setSearchDest(null); setNavTargetIdx(-1);
    },
    restoreRoute(coords, steps, legs, td, tt) {
      setRouteCoords(coords);
      routeRef.current.coords = coords;
      onRouteReady({ coords, steps, legs, totalDistance: td, totalDuration: tt, isProper: true, fromIdx: 0 });
    },
    setNavTarget(idx) { setNavTargetIdx(idx); },
  }), [waypoints, searchDest, mapboxToken]);

  // ── Routing ─────────────────────────────────────────────────────────────────
  const doFetchRoute = useCallback(async (pairs: string[], fromIdx: number) => {
    try {
      const result = await fetchRoute(pairs, fromIdx, mapboxToken || '', routeOpts);
      setRouteCoords(result.coords);
      routeRef.current = { coords: result.coords, passedIdx: 0 };
      onRouteReady({ ...result, fromIdx });
      // Persist for offline relaunch
      onRoutePersist({
        coords: result.coords, steps: result.steps, legs: result.legs,
        totalDistance: result.totalDistance, totalDuration: result.totalDuration,
        tripId: activeTrip?.trip_id ?? null,
      });
      SecureStore.setItemAsync('trailhead_active_route', JSON.stringify({
        coords: result.coords, steps: result.steps, legs: result.legs,
        totalDistance: result.totalDistance, totalDuration: result.totalDuration,
        tripId: activeTrip?.trip_id ?? null, ts: Date.now(),
      })).catch(() => {});
    } catch {
      const fb = buildFallbackRoute(pairs);
      setRouteCoords(fb.coords);
      routeRef.current = { coords: fb.coords, passedIdx: 0 };
      onRouteReady({ ...fb, fromIdx });
    }
  }, [mapboxToken, routeOpts, waypoints, activeTrip, onRouteReady, onRoutePersist]);

  // Initial route load when waypoints arrive
  useEffect(() => {
    if (waypoints.length >= 2 && routeCoords.length === 0) {
      doFetchRoute(waypoints.map(w => `${w.lng},${w.lat}`), 0);
    }
  }, [waypoints.length]);

  // ── Nav: track user on route + update passed overlay ────────────────────────
  useEffect(() => {
    if (!navMode || !userLoc || routeRef.current.coords.length === 0) return;
    const { lat, lng } = userLoc;
    const coords = routeRef.current.coords;
    let best = routeRef.current.passedIdx, bestD = Infinity;
    const end = Math.min(coords.length - 1, best + 80);
    for (let i = best; i <= end; i++) {
      const dlat = (coords[i][1] - lat) * 111000;
      const dlng = (coords[i][0] - lng) * 111000 * Math.cos(lat * Math.PI / 180);
      const d = Math.sqrt(dlat * dlat + dlng * dlng);
      if (d < bestD) { bestD = d; best = i; }
      if (d < 15) break;
    }
    if (best > routeRef.current.passedIdx) {
      routeRef.current.passedIdx = best;
      setPassedCoords(coords.slice(0, best + 1));
    }
    // Update breadcrumb
    setBreadcrumb(prev => [...prev, [lng, lat]]);
    // Follow camera in nav mode
    if (navHeading !== null && navHeading >= 0) {
      camRef.current?.setCamera({
        centerCoordinate: [lng, lat],
        zoomLevel: 17,
        heading: navHeading,
        pitch: 45,
        animationDuration: 200,
        animationMode: 'moveTo',
      });
    }
  }, [userLoc, navMode, navHeading]);

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

  const handlePress = useCallback((feat: GeoJSON.Feature | undefined) => {
    if (!feat) { onMapTap(); return; }
    // Camp press comes through ShapeSource onPress — see CampsLayer
    onMapTap();
  }, [onMapTap]);

  const handleLongPress = useCallback((feat: GeoJSON.Feature | undefined) => {
    if (!feat?.geometry || feat.geometry.type !== 'Point') return;
    const [lng, lat] = (feat.geometry as GeoJSON.Point).coordinates;
    onMapLongPress(lat, lng);
  }, [onMapLongPress]);

  const handleRegionChange = useCallback(async (feat: GeoJSON.Feature | undefined) => {
    if (!feat?.properties || !mapRef.current) return;
    const { zoomLevel } = feat.properties;
    const bounds = await mapRef.current.getVisibleBounds();
    if (!bounds) return;
    const [[e, n], [w, s]] = bounds;
    onBoundsChange({ n, s, e, w, zoom: zoomLevel || 10 });
  }, [onBoundsChange]);

  const handleCampPress = useCallback((e: any) => {
    const feat = e.features?.[0];
    if (!feat) return;
    const p = feat.properties;
    let raw: CampsitePin;
    try { raw = JSON.parse(p.raw || '{}'); } catch { raw = p as any; }
    onCampTap(raw);
  }, [onCampTap]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
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
        </MapLibreGL.ShapeSource>
      )}

      {/* ── Gas stations ──────────────────────────────────────────────── */}
      {gas.length > 0 && (
        <MapLibreGL.ShapeSource id="gas" shape={gasFC}>
          <MapLibreGL.CircleLayer
            id="gas-circle"
            style={{ circleRadius: 9, circleColor: '#eab308', circleOpacity: 0.92, circleStrokeWidth: 2, circleStrokeColor: '#fff' }}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── POIs (water, trailheads, viewpoints, peaks) ───────────────── */}
      {pois.length > 0 && (
        <MapLibreGL.ShapeSource id="pois" shape={poiFC}>
          <MapLibreGL.CircleLayer
            id="poi-circle"
            style={{
              circleRadius: ['case', ['==', ['get', 'type'], 'peak'], 9, 8],
              circleColor: ['match', ['get', 'type'], 'water', '#3b82f6', 'trailhead', '#22c55e', 'viewpoint', '#a855f7', 'peak', '#92400e', '#6b7280'],
              circleOpacity: 0.9,
              circleStrokeWidth: 1.5,
              circleStrokeColor: '#fff',
            }}
          />
        </MapLibreGL.ShapeSource>
      )}

      {/* ── Community pins ────────────────────────────────────────────── */}
      {communityPins.length > 0 && (
        <MapLibreGL.ShapeSource
          id="community-pins"
          shape={pointFC(communityPins.map(p => ({
            type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: { name: p.name, type: p.type || 'pin' },
          })))}
        >
          <MapLibreGL.CircleLayer
            id="community-circle"
            style={{ circleRadius: 8, circleColor: '#f97316', circleOpacity: 0.85, circleStrokeWidth: 1.5, circleStrokeColor: '#fff' }}
          />
        </MapLibreGL.ShapeSource>
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
  );
});

NativeMap.displayName = 'NativeMap';
export default NativeMap;

// ── Sub-components ─────────────────────────────────────────────────────────────
function WaypointDot({ wp, index, isNavTarget, onPress }: {
  wp: WP; index: number; isNavTarget: boolean; onPress: () => void;
}) {
  const color = WP_COLORS[wp.type] || '#f97316';
  const icon  = WP_ICONS[wp.type] || String(index + 1);
  return (
    <View
      onTouchEnd={onPress}
      style={[
        styles.wpDot,
        { backgroundColor: isNavTarget ? '#fff' : color },
        isNavTarget && styles.wpDotNavTarget,
      ]}
    >
    </View>
  );
}

function ReportDot({ type, subtype }: { type: string; subtype?: string }) {
  const COLORS: Record<string, string> = {
    police: '#eab308dd', hazard: '#ef4444dd', road_condition: '#f97316dd',
    wildlife: '#a855f7dd', campsite: '#22c55edd', road_closure: '#dc2626dd',
    water: '#38bdf8dd',
  };
  const color = COLORS[type] || '#6b7280dd';
  const ICONS: Record<string, string> = {
    police: '🚔', hazard: '⚠️', road_condition: '🚧',
    wildlife: '🦌', campsite: '⛺', road_closure: '🚫', water: '💧',
  };
  const icon = ICONS[type] || '📍';
  return (
    <View style={[styles.reportDot, { backgroundColor: color }]}>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
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
  reportDot: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45, shadowRadius: 4, elevation: 4,
  },
  searchMarker: {
    alignItems: 'center', justifyContent: 'center',
  },
  searchPin: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(59,130,246,0.2)',
    borderWidth: 2.5, borderColor: '#3b82f6',
  },
});
