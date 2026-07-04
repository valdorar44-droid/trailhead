import { useMemo } from 'react';
import {
  Animated,
  Image,
  ImageBackground,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const TRAILHEAD_MARK = require('../../assets/trailhead-mark.png');
const LAUNCH_CAMO = require('../../assets/launch-camo.png');

type RouteBuilderBuildLoaderProps = {
  pulse: Animated.Value;
  status?: string;
  topInset: number;
  bottomInset: number;
};

const STATUS_MAP: Array<[RegExp, string]> = [
  [/setting|setup|start|trip/i, 'Starting route'],
  [/overnight|camp|stay/i, 'Finding stays'],
  [/fuel|resupply|range/i, 'Checking fuel'],
  [/tour|guided|stop|poi|place/i, 'Checking stops'],
  [/built|prepar|opening|saving/i, 'Opening route'],
];

function cleanBuildStatus(status?: string) {
  const value = String(status || '').trim();
  const matched = STATUS_MAP.find(([test]) => test.test(value));
  return matched?.[1] || 'Building route';
}

export default function RouteBuilderBuildLoader({
  pulse,
  status,
  topInset,
  bottomInset,
}: RouteBuilderBuildLoaderProps) {
  const cleanStatus = useMemo(() => cleanBuildStatus(status), [status]);
  const logoMotion = {
    opacity: pulse.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.92, 1, 0.92],
    }),
    transform: [
      {
        scale: pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.96, 1.04, 0.96],
        }),
      },
      {
        translateY: pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [4, -4, 4],
        }),
      },
    ],
  };
  const glowMotion = {
    opacity: pulse.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.18, 0.34, 0.18],
    }),
    transform: [
      {
        scale: pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.82, 1.12, 0.82],
        }),
      },
    ],
  };
  const orbitMotion = {
    opacity: pulse.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.45, 0.95, 0.45],
    }),
    transform: [
      {
        rotate: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: ['-18deg', '342deg'],
        }),
      },
    ],
  };
  const beadMotion = {
    opacity: pulse.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.55, 1, 0.55],
    }),
    transform: [
      {
        translateX: pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [-90, 94, -90],
        }),
      },
      {
        translateY: pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [42, -52, 42],
        }),
      },
    ],
  };
  const progressMotion = {
    transform: [
      {
        scaleX: pulse.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.18, 0.72, 0.18],
        }),
      },
    ],
  };

  return (
    <View style={styles.screen}>
      <ImageBackground source={LAUNCH_CAMO} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      <View style={styles.scrim} />
      <View style={styles.terrain}>
        {Array.from({ length: 8 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.terrainLine,
              {
                top: 120 + index * 58,
                transform: [{ rotate: index % 2 === 0 ? '-8deg' : '7deg' }],
              },
            ]}
          />
        ))}
      </View>
      <View
        style={[
          styles.content,
          {
            paddingTop: Math.max(topInset, 12) + 18,
            paddingBottom: Math.max(bottomInset, 18) + 22,
          },
        ]}
      >
        <View style={styles.centerStage}>
          <Animated.View style={[styles.glow, glowMotion]} />
          <Animated.View style={[styles.orbit, orbitMotion]}>
            <View style={styles.orbitDash} />
          </Animated.View>
          <Animated.View style={[styles.routeBead, beadMotion]} />
          <View style={styles.fixedBeadOne} />
          <View style={styles.fixedBeadTwo} />
          <Animated.View style={[styles.logoWrap, logoMotion]}>
            <Image source={TRAILHEAD_MARK} style={styles.logo} resizeMode="contain" />
          </Animated.View>
        </View>

        <View style={styles.statusBlock}>
          <Text style={styles.statusText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86}>
            {cleanStatus}
          </Text>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, progressMotion]} />
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
    backgroundColor: '#07100f',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  terrain: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.8,
    pointerEvents: 'none',
  },
  terrainLine: {
    position: 'absolute',
    left: -64,
    right: -64,
    height: 1,
    backgroundColor: 'rgba(247,239,225,0.055)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  centerStage: {
    width: 300,
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 286,
    height: 286,
    borderRadius: 143,
    backgroundColor: '#f97316',
    shadowColor: '#f97316',
    shadowOpacity: 0.55,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 0 },
  },
  orbit: {
    position: 'absolute',
    width: 224,
    height: 224,
    borderRadius: 112,
    borderWidth: 2,
    borderColor: 'rgba(249,115,22,0.70)',
    borderStyle: 'dashed',
  },
  orbitDash: {
    position: 'absolute',
    top: -5,
    left: 104,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f7efe1',
  },
  routeBead: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f97316',
    shadowColor: '#f97316',
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  fixedBeadOne: {
    position: 'absolute',
    left: 60,
    top: 154,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(247,239,225,0.92)',
  },
  fixedBeadTwo: {
    position: 'absolute',
    right: 58,
    bottom: 78,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(247,239,225,0.82)',
  },
  logoWrap: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  statusBlock: {
    width: '100%',
    alignItems: 'center',
    gap: 18,
    marginTop: 12,
  },
  statusText: {
    maxWidth: 270,
    color: '#f7efe1',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  progressTrack: {
    width: 108,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(247,239,225,0.20)',
  },
  progressFill: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#f97316',
  },
});
