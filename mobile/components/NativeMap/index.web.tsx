import React, { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CampsitePin, Pin, Report } from '@/lib/api';
import { useTheme } from '@/lib/design';
import type { RouteOpts, RouteResult, RouteStep, MapBounds, WP } from './types';

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
  reports:       Report[];
  communityPins: Pin[];
  searchMarker:  { lat: number; lng: number; name: string } | null;
  userLoc:       { lat: number; lng: number; accuracy?: number | null } | null;
  navMode:       boolean;
  navIdx:        number;
  navHeading:    number | null;
  navSpeed:      number | null;
  mapLayer:      string;
  routeOpts:     RouteOpts;
  traceMode?: boolean;
  traceDraftCoords?: [number, number][];
  traceRouteCoords?: [number, number][];
  tracePinCoords?: [number, number][];
  showLandOverlay: boolean;
  showUsgsOverlay: boolean;
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

const NativeMap = forwardRef<NativeMapHandle, NativeMapProps>((props, ref) => {
  const C = useTheme();
  useImperativeHandle(ref, () => ({
    flyTo: noop,
    locate: noop,
    loadRouteFrom: noop,
    rerouteFrom: noop,
    routeToSearch: noop,
    resetRoute: noop,
    stopNavigation: noop,
    highlightTrail: noop,
    clearTrailHighlight: noop,
    getTrailHighlight: () => ({ type: 'FeatureCollection', features: [] }),
    captureTrailAt: async () => ({ type: 'FeatureCollection', features: [] }),
    screenToCoordinate: async () => null,
    getVisibleCenter: async () => null,
    getVisibleBounds: async () => null,
    restoreRoute: noop,
    setNavTarget: noop,
  }));

  React.useEffect(() => {
    props.onMapReady?.();
  }, []);

  const pins = [
    ...props.waypoints.map((p, idx) => ({ key: `wp_${idx}`, name: p.name, type: p.type, color: '#c65f39', onPress: () => props.onWaypointTap(idx, p.name) })),
    ...props.camps.map(c => ({ key: `camp_${c.id}`, name: c.name, type: 'camp', color: '#14b8a6', onPress: () => props.onCampTap(c) })),
    ...props.gas.map(g => ({ key: `gas_${g.lat}_${g.lng}`, name: g.name, type: 'fuel', color: '#eab308', onPress: () => props.onGasTap?.(g) })),
    ...props.pois.map(p => ({ key: `poi_${p.lat}_${p.lng}_${p.type}`, name: p.name, type: p.type, color: '#38bdf8', onPress: () => props.onPoiTap?.(p) })),
  ].slice(0, 12);
  const hasRouteLine = props.waypoints.length > 1;
  const hasMapContent = pins.length > 0 || !!props.searchMarker || !!props.userLoc;

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
