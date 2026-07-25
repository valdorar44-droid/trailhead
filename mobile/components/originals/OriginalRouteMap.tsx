import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import NativeMap, { type NativeMapHandle } from '@/components/NativeMap';
import { useTheme } from '@/lib/design';
import { createMapCameraOwnership } from '@/lib/mapCameraOwnership';
import { originalRouteDisplayModel } from '@/lib/originals/routeDisplay';
import type { OriginalRouteMapProps } from './OriginalRouteMap.types';

function remainingDistanceLabel(distanceM: number) {
  const miles = distanceM / 1609.344;
  if (miles < 0.1) return 'At route end';
  return `${miles >= 10 ? Math.round(miles) : miles.toFixed(1)} mi remaining`;
}

export default function OriginalRouteMap({
  route,
  projectedProgressM,
  currentStoryTitle,
  nextStop,
  overview = false,
}: OriginalRouteMapProps) {
  const C = useTheme();
  const mapRef = useRef<NativeMapHandle | null>(null);
  const mapReadyRef = useRef(false);
  const layoutReadyRef = useRef(false);
  const lastFitKeyRef = useRef('');
  const [mapReadinessRevision, setMapReadinessRevision] = useState(0);
  const [styleGeneration, setStyleGeneration] = useState(0);
  const authoredCoordinates = useMemo(() => originalRouteDisplayModel(
    route.geometry.coordinates,
    route.distance_m,
    null,
  ).coordinates, [route.distance_m, route.geometry.coordinates]);
  const model = useMemo(() => originalRouteDisplayModel(
    authoredCoordinates,
    route.distance_m,
    projectedProgressM,
  ), [authoredCoordinates, projectedProgressM, route.distance_m]);
  const routeSignature = useMemo(() => {
    const first = authoredCoordinates[0];
    const last = authoredCoordinates[authoredCoordinates.length - 1];
    return `${authoredCoordinates.length}:${first?.join(',') ?? ''}:${last?.join(',') ?? ''}`;
  }, [authoredCoordinates]);
  const initialCameraBounds = useMemo(() => {
    if (authoredCoordinates.length < 2) return undefined;
    const lngs = authoredCoordinates.map(coordinate => coordinate[0]);
    const lats = authoredCoordinates.map(coordinate => coordinate[1]);
    return {
      ne: [Math.max(...lngs), Math.max(...lats)] as [number, number],
      sw: [Math.min(...lngs), Math.min(...lats)] as [number, number],
      padding: [54, 28, 104, 28] as [number, number, number, number],
    };
  }, [authoredCoordinates]);
  const routeCameraOwnership = useMemo(
    () => createMapCameraOwnership('originals', `original-route-preview:${routeSignature}`),
    [routeSignature],
  );

  const fitAuthoredRoute = useCallback(() => {
    if (authoredCoordinates.length < 2) return;
    mapRef.current?.fitCoordinates(authoredCoordinates, [54, 28, 104, 28], 500);
  }, [authoredCoordinates]);

  useEffect(() => {
    if (!mapReadyRef.current || !layoutReadyRef.current || styleGeneration <= 0) return;
    const fitKey = `${routeSignature}:${styleGeneration}`;
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;
    fitAuthoredRoute();
  }, [fitAuthoredRoute, mapReadinessRevision, routeSignature, styleGeneration]);

  const routeStops = nextStop ? [{
    id: nextStop.id,
    lat: nextStop.coordinates.lat,
    lng: nextStop.coordinates.lng,
    day: nextStop.sequence,
    type: 'destination' as const,
    name: nextStop.title,
  }] : [];

  return (
    <View
      style={styles.wrap}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (layoutReadyRef.current || width <= 0 || height <= 0) return;
        layoutReadyRef.current = true;
        setMapReadinessRevision(revision => revision + 1);
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
        routeBuildActive={overview || model.progress_known}
        routeBuildCoords={authoredCoordinates}
        routeBuildReveal={overview ? 1 : model.progress_ratio}
        routeBuildStops={routeStops}
        missionBriefActive={!overview && !model.progress_known}
        missionBriefFullRoute={authoredCoordinates}
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
        cameraOwnership={routeCameraOwnership}
        initialCameraBounds={initialCameraBounds}
        onMapReady={() => {
          mapReadyRef.current = true;
          setMapReadinessRevision(revision => revision + 1);
        }}
        onMapStyleLoaded={() => setStyleGeneration(generation => generation + 1)}
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

      <View pointerEvents="none" style={styles.overlays}>
        <View style={styles.overviewBadge}>
          <Text style={[styles.overviewText, { color: C.orange }]}>AUTHORED ROUTE</Text>
          <View style={styles.badgeDivider} />
          <Text style={styles.safetyText}>NOT TURN-BY-TURN</Text>
        </View>

        {!overview ? <View style={styles.storyRail}>
          <View style={styles.storyBlock}>
            <Text style={[styles.storyKicker, { color: C.orange }]}>CURRENT</Text>
            <Text style={styles.storyTitle} numberOfLines={1}>{currentStoryTitle || 'Between stories'}</Text>
          </View>
          <View style={styles.storyDivider} />
          <View style={styles.storyBlock}>
            <Text style={[styles.storyKicker, { color: C.orange }]}>NEXT</Text>
            <Text style={styles.storyTitle} numberOfLines={1}>{nextStop?.title || 'Route complete'}</Text>
          </View>
          <Text style={styles.remaining}>{model.progress_known ? remainingDistanceLabel(model.remaining_m) : 'Locating progress'}</Text>
        </View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#050505', overflow: 'hidden' },
  overlays: { ...StyleSheet.absoluteFillObject },
  overviewBadge: {
    position: 'absolute', left: 14, top: 10, minHeight: 28, borderRadius: 999,
    paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(5,5,5,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)',
  },
  overviewText: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.75 },
  badgeDivider: { width: 1, height: 11, backgroundColor: 'rgba(255,255,255,0.2)' },
  safetyText: { color: '#D6D6D6', fontSize: 7.5, lineHeight: 10, fontWeight: '900', letterSpacing: 0.55 },
  storyRail: {
    position: 'absolute', left: 14, right: 14, bottom: 47, minHeight: 48,
    borderRadius: 14, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(5,5,5,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  storyBlock: { flex: 1, minWidth: 0 },
  storyKicker: { fontSize: 7, lineHeight: 9, fontWeight: '900', letterSpacing: 0.7 },
  storyTitle: { marginTop: 1, color: '#FFFFFF', fontSize: 10, lineHeight: 13, fontWeight: '800' },
  storyDivider: { width: 1, height: 27, backgroundColor: 'rgba(255,255,255,0.16)' },
  remaining: { color: '#B8B8B8', fontSize: 8, lineHeight: 11, fontWeight: '800' },
});
