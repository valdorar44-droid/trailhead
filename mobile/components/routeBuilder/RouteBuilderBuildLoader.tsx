import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { TrailheadWayfinder } from '@/components/copilot/TrailheadWayfinder';
import { StaticMapboxPreview, type StaticMapboxPin } from '@/components/explore/StaticMapboxPreview';
import { useTheme } from '@/lib/design';

export type RouteBuildMapPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type?: string;
};

type RouteBuilderBuildLoaderProps = {
  status?: string;
  topInset: number;
  bottomInset: number;
  points?: RouteBuildMapPoint[];
};

type BuildProgress = {
  label: string;
  percent: number;
};

const BUILD_PROGRESS: Array<[RegExp, BuildProgress]> = [
  [/built|prepar|opening|saving|review/i, { label: 'Finishing your route', percent: 92 }],
  [/activit|tour|guided|poi|place|stop/i, { label: 'Finding things to do', percent: 84 }],
  [/fuel|resupply|range/i, { label: 'Checking fuel', percent: 72 }],
  [/overnight|camp|stay/i, { label: 'Finding overnight stops', percent: 54 }],
  [/trace|draw|spine|road|routing/i, { label: 'Drawing the route', percent: 32 }],
  [/setting|setup|start|trip/i, { label: 'Starting route', percent: 16 }],
];

function buildProgress(status?: string): BuildProgress {
  const value = String(status || '').trim();
  return BUILD_PROGRESS.find(([test]) => test.test(value))?.[1]
    ?? { label: 'Building route', percent: 24 };
}

export default function RouteBuilderBuildLoader({
  status,
  topInset,
  bottomInset,
  points = [],
}: RouteBuilderBuildLoaderProps) {
  const C = useTheme();
  const { height: viewportHeight } = useWindowDimensions();
  const scanProgress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useMemo(() => buildProgress(status), [status]);
  const mapPins = useMemo<StaticMapboxPin[]>(() => points
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .map((point, index, source) => ({
      id: point.id,
      title: point.name,
      lat: point.lat,
      lng: point.lng,
      kind: point.type || 'route',
      active: index === 0 || index === source.length - 1,
    })), [points]);
  const dark = C.bg === '#050505';
  const scanTop = Math.max(topInset + 58, 72);
  const scanBottom = Math.max(scanTop + 120, viewportHeight - Math.max(bottomInset, 12) - 152);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    scanProgress.stopAnimation();
    scanProgress.setValue(reduceMotion ? 0.5 : 0);
    if (reduceMotion) return;
    const scan = Animated.loop(
      Animated.sequence([
        Animated.timing(scanProgress, {
          toValue: 1,
          duration: 1900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(180),
        Animated.timing(scanProgress, {
          toValue: 0,
          duration: 1900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(180),
      ]),
    );
    scan.start();
    return () => scan.stop();
  }, [reduceMotion, scanProgress]);

  const scanTranslateY = scanProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [scanTop, scanBottom],
  });

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>
      <StaticMapboxPreview
        pins={mapPins}
        title="Route preview"
        mapboxStyle={dark ? 'mapbox/dark-v11' : 'mapbox/outdoors-v12'}
        showBadge={false}
        showCopy={false}
        showFallbackIcon={false}
        fallbackVariant="route"
        height={Math.max(320, viewportHeight)}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: dark ? 'rgba(5,5,5,0.24)' : 'rgba(247,248,246,0.10)' },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.scanLine,
          {
            backgroundColor: C.orange,
            opacity: dark ? 0.72 : 0.78,
            transform: [{ translateY: scanTranslateY }],
          },
        ]}
      >
        <View style={[styles.scanLead, { backgroundColor: C.orange }]} />
      </Animated.View>

      <View
        pointerEvents="none"
        style={[
          styles.statusDock,
          {
            top: Math.max(topInset, 12) + 16,
            bottom: Math.max(bottomInset, 12) + 20,
          },
        ]}
      >
        <View
          style={[
            styles.statusPanel,
            {
              backgroundColor: dark ? 'rgba(16,17,20,0.94)' : 'rgba(255,255,255,0.94)',
              borderColor: C.border2,
              shadowColor: dark ? '#000' : '#111412',
            },
          ]}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={progress.label}
          accessibilityValue={{ min: 0, max: 100, now: progress.percent, text: progress.label }}
        >
          <TrailheadWayfinder state="building" size={58} colors={C} />
          <View style={styles.statusCopy}>
            <Text
              style={[styles.statusText, { color: C.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
            >
              {progress.label}
            </Text>
            <View style={[styles.progressTrack, { backgroundColor: C.border2 }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress.percent}%`, backgroundColor: C.orange },
                ]}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
  },
  statusDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
  },
  scanLead: {
    position: 'absolute',
    right: 0,
    top: -3,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusPanel: {
    width: '100%',
    minHeight: 82,
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 12,
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  statusText: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: 0,
  },
  progressTrack: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
});
