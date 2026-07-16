import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/design';
import { originalRouteDisplayModel } from '@/lib/originals/routeDisplay';
import type { OriginalRouteMapProps } from './OriginalRouteMap.types';

const VIEW_WIDTH = 430;
const VIEW_HEIGHT = 250;
const VIEW_PADDING = 28;

function remainingDistanceLabel(distanceM: number) {
  const miles = distanceM / 1609.344;
  if (miles < 0.1) return 'At route end';
  return `${miles >= 10 ? Math.round(miles) : miles.toFixed(1)} mi remaining`;
}

function viewportProjector(coordinates: [number, number][]) {
  const lngs = coordinates.map(coordinate => coordinate[0]);
  const lats = coordinates.map(coordinate => coordinate[1]);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const spanX = Math.max(1e-8, east - west);
  const spanY = Math.max(1e-8, north - south);
  const availableWidth = VIEW_WIDTH - VIEW_PADDING * 2;
  const availableHeight = VIEW_HEIGHT - VIEW_PADDING * 2;
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const renderedWidth = spanX * scale;
  const renderedHeight = spanY * scale;
  const offsetX = (VIEW_WIDTH - renderedWidth) / 2;
  const offsetY = (VIEW_HEIGHT - renderedHeight) / 2;
  return ([lng, lat]: [number, number]) => [
    offsetX + (lng - west) * scale,
    offsetY + (north - lat) * scale,
  ] as [number, number];
}

function linePoints(coordinates: [number, number][], project: (coordinate: [number, number]) => [number, number]) {
  return coordinates.map(project).map(point => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ');
}

export default function OriginalRouteMap({
  route,
  projectedProgressM,
  currentStoryTitle,
  nextStop,
  overview = false,
}: OriginalRouteMapProps) {
  const C = useTheme();
  const model = useMemo(() => originalRouteDisplayModel(
    route.geometry.coordinates,
    route.distance_m,
    projectedProgressM,
  ), [projectedProgressM, route.distance_m, route.geometry.coordinates]);
  const drawing = useMemo(() => {
    if (model.coordinates.length < 2) return null;
    const project = viewportProjector(model.coordinates);
    return {
      full: linePoints(model.coordinates, project),
      completed: linePoints(overview ? model.coordinates : model.completed, project),
      marker: model.marker ? project(model.marker) : null,
      next: nextStop ? project([nextStop.coordinates.lng, nextStop.coordinates.lat]) : null,
    };
  }, [model.completed, model.coordinates, model.marker, nextStop, overview]);

  const svgChildren: React.ReactNode[] = [
    React.createElement('rect' as any, { key: 'background', x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT, fill: '#070707' }),
    ...[55, 110, 165, 220, 275, 330, 385].map(x => React.createElement('line' as any, {
      key: `grid-x-${x}`, x1: x, y1: 0, x2: x, y2: VIEW_HEIGHT, stroke: 'rgba(255,255,255,0.035)', strokeWidth: 1,
    })),
    ...[45, 90, 135, 180, 225].map(y => React.createElement('line' as any, {
      key: `grid-y-${y}`, x1: 0, y1: y, x2: VIEW_WIDTH, y2: y, stroke: 'rgba(255,255,255,0.035)', strokeWidth: 1,
    })),
  ];
  if (drawing) {
    svgChildren.push(
      React.createElement('polyline' as any, {
        key: 'route-casing', points: drawing.full, fill: 'none', stroke: '#050505', strokeWidth: 12, strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      React.createElement('polyline' as any, {
        key: 'route-ahead', points: drawing.full, fill: 'none', stroke: 'rgba(235,235,235,0.52)', strokeWidth: 5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      React.createElement('polyline' as any, {
        key: 'route-completed-glow', points: drawing.completed, fill: 'none', stroke: 'rgba(217,119,69,0.22)', strokeWidth: 14, strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      React.createElement('polyline' as any, {
        key: 'route-completed', points: drawing.completed, fill: 'none', stroke: '#D97745', strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
    );
    if (drawing.next) {
      svgChildren.push(
        React.createElement('circle' as any, { key: 'next-halo', cx: drawing.next[0], cy: drawing.next[1], r: 11, fill: '#050505', stroke: '#FFFFFF', strokeWidth: 2 }),
        React.createElement('circle' as any, { key: 'next-dot', cx: drawing.next[0], cy: drawing.next[1], r: 4, fill: '#FFFFFF' }),
      );
    }
    if (drawing.marker) {
      svgChildren.push(
        React.createElement('circle' as any, { key: 'progress-halo', cx: drawing.marker[0], cy: drawing.marker[1], r: 14, fill: 'rgba(217,119,69,0.22)', stroke: 'rgba(255,255,255,0.72)', strokeWidth: 1 }),
        React.createElement('circle' as any, { key: 'progress-dot', cx: drawing.marker[0], cy: drawing.marker[1], r: 6, fill: '#D97745', stroke: '#FFFFFF', strokeWidth: 2 }),
      );
    }
  }

  return (
    <View style={styles.wrap}>
      {React.createElement('svg' as any, {
        viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
        preserveAspectRatio: 'xMidYMid slice',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
        'aria-label': 'Authored route progress overview',
      }, svgChildren)}

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
  wrap: { flex: 1, backgroundColor: '#070707', overflow: 'hidden' },
  overlays: { ...StyleSheet.absoluteFillObject },
  overviewBadge: {
    position: 'absolute', left: 14, top: 10, minHeight: 28, borderRadius: 999,
    paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(5,5,5,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.17)',
  },
  overviewText: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 0.75 },
  badgeDivider: { width: 1, height: 11, backgroundColor: 'rgba(255,255,255,0.2)' },
  safetyText: { color: '#D6D6D6', fontSize: 7.5, lineHeight: 10, fontWeight: '900', letterSpacing: 0.55 },
  storyRail: {
    position: 'absolute', left: 14, right: 14, bottom: 47, minHeight: 48,
    borderRadius: 14, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(5,5,5,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  storyBlock: { flex: 1, minWidth: 0 },
  storyKicker: { fontSize: 7, lineHeight: 9, fontWeight: '900', letterSpacing: 0.7 },
  storyTitle: { marginTop: 1, color: '#FFFFFF', fontSize: 10, lineHeight: 13, fontWeight: '800' },
  storyDivider: { width: 1, height: 27, backgroundColor: 'rgba(255,255,255,0.16)' },
  remaining: { color: '#B8B8B8', fontSize: 8, lineHeight: 11, fontWeight: '800' },
});
