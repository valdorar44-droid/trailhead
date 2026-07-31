import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import NativeMap, {
  prepareNativeMapboxRenderer,
  type NativeMapHandle,
} from '@/components/NativeMap';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { createMapCameraOwnership } from '@/lib/mapCameraOwnership';
import { storage } from '@/lib/storage';
import { useStore } from '@/lib/store';

type Props = Readonly<{
  coordinates: readonly (readonly [number, number])[];
  onReadyChange?: (ready: boolean) => void;
}>;

/**
 * Privacy-review map. The route is rendered from local GeoJSON by NativeMap;
 * it is never encoded into a Static Images URL or another network request.
 */
export default function PrivateTrailRouteMap({ coordinates, onReadyChange }: Props) {
  const C = useTheme();
  const mapRef = useRef<NativeMapHandle | null>(null);
  const mapReadyRef = useRef(false);
  const layoutReadyRef = useRef(false);
  const styleReadyRef = useRef(false);
  const fitKeyRef = useRef('');
  const [readinessRevision, setReadinessRevision] = useState(0);
  const mapboxToken = useStore(state => state.mapboxToken);
  const setMapboxToken = useStore(state => state.setMapboxToken);
  const [credentialState, setCredentialState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  const route = useMemo(() => coordinates
    .filter(point => (
      Array.isArray(point)
      && Number.isFinite(point[0])
      && Number.isFinite(point[1])
      && Math.abs(point[0]) <= 180
      && Math.abs(point[1]) <= 90
    ))
    .map(point => [Number(point[0]), Number(point[1])] as [number, number]), [coordinates]);
  const signature = useMemo(() => {
    const first = route[0];
    const last = route[route.length - 1];
    return `${route.length}:${first?.join(',') ?? ''}:${last?.join(',') ?? ''}`;
  }, [route]);
  const cameraOwnership = useMemo(
    () => createMapCameraOwnership('route_build', `private-route-review:${signature}`),
    [signature],
  );
  const initialCameraBounds = useMemo(() => {
    if (route.length < 2) return undefined;
    const lngs = route.map(point => point[0]);
    const lats = route.map(point => point[1]);
    return {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
      padding: [46, 28, 46, 28] as [number, number, number, number],
    };
  }, [route]);
  const stops = useMemo(() => route.length >= 2 ? [
    { id: 'private-route-start', lat: route[0][1], lng: route[0][0], day: 1, type: 'start' as const, name: 'Start' },
    { id: 'private-route-finish', lat: route[route.length - 1][1], lng: route[route.length - 1][0], day: 1, type: 'destination' as const, name: 'Finish' },
  ] : [], [route]);

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      setCredentialState('loading');
      let token = mapboxToken.trim();
      if (!token) token = String(await storage.get('trailhead_mapbox_token').catch(() => '') || '').trim();
      if (!token) {
        const config = await api.getConfig().catch(() => null);
        token = String(config?.mapbox_token || '').trim();
        if (token) storage.set('trailhead_mapbox_token', token).catch(() => {});
      }
      if (cancelled) return;
      if (!token || !await prepareNativeMapboxRenderer(token)) {
        setCredentialState('unavailable');
        return;
      }
      if (cancelled) return;
      if (token !== mapboxToken) setMapboxToken(token);
      setCredentialState('ready');
    }
    prepare().catch(() => {
      if (!cancelled) setCredentialState('unavailable');
    });
    return () => { cancelled = true; };
  }, [mapboxToken, setMapboxToken]);

  const fitRoute = useCallback(() => {
    if (route.length >= 2) mapRef.current?.fitCoordinates(route, [46, 28, 46, 28], 450);
  }, [route]);

  useEffect(() => {
    const ready = credentialState === 'ready'
      && mapReadyRef.current
      && styleReadyRef.current
      && layoutReadyRef.current
      && route.length >= 2;
    onReadyChange?.(ready);
    if (!ready) return;
    const key = `${signature}:${readinessRevision}`;
    if (fitKeyRef.current === key) return;
    fitKeyRef.current = key;
    fitRoute();
  }, [credentialState, fitRoute, onReadyChange, readinessRevision, route.length, signature]);

  useEffect(() => () => onReadyChange?.(false), [onReadyChange]);

  if (credentialState !== 'ready') {
    return (
      <View style={[styles.wrap, styles.preparing, { backgroundColor: C.s2 }]}>
        {credentialState === 'loading' ? <ActivityIndicator color={C.orange} /> : null}
        <Text style={[styles.preparingText, { color: C.text2 }]}>
          {credentialState === 'loading' ? 'Preparing map preview' : 'Map preview unavailable'}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={styles.wrap}
      onLayout={(event) => {
        if (
          layoutReadyRef.current
          || event.nativeEvent.layout.width <= 0
          || event.nativeEvent.layout.height <= 0
        ) return;
        layoutReadyRef.current = true;
        setReadinessRevision(revision => revision + 1);
      }}
    >
      <NativeMap
        ref={mapRef}
        waypoints={[]}
        camps={[]}
        gas={[]}
        pois={[]}
        reports={[]}
        communityPins={[]}
        searchMarker={null}
        userLoc={null}
        navMode={false}
        navIdx={0}
        navHeading={null}
        navSpeed={null}
        mapLayer="extreme"
        premiumMapStyle="outdoors"
        rendererMode="mapbox"
        routeOpts={{ avoidTolls: false, avoidHighways: false, backRoads: false, noFerries: false }}
        routeBuildActive
        routeBuildCoords={route}
        routeBuildReveal={1}
        routeBuildStops={stops}
        suppressFeatureTaps
        showLandOverlay={false}
        showUsgsOverlay={false}
        showTerrain={false}
        showTrailOverlay={false}
        showMvum={false}
        showFire={false}
        showAva={false}
        showRadar={false}
        hideMapStatusBadge
        cameraOwnership={cameraOwnership}
        initialCameraBounds={initialCameraBounds}
        onMapReady={() => {
          mapReadyRef.current = true;
          setReadinessRevision(revision => revision + 1);
        }}
        onMapStyleLoaded={() => {
          styleReadyRef.current = true;
          setReadinessRevision(revision => revision + 1);
        }}
        onBoundsChange={() => {}}
        onMapTap={() => {}}
        onCampTap={() => {}}
        onTileCampTap={() => {}}
        onBaseCampTap={() => {}}
        onTrailTap={() => {}}
        onWaypointTap={() => {}}
        onRouteReady={() => {}}
        onRoutePersist={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', height: 220, overflow: 'hidden' },
  preparing: { alignItems: 'center', justifyContent: 'center', gap: 9 },
  preparingText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
