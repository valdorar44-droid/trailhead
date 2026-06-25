import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { mono } from '@/lib/design';

type ActivityStatusCardProps = {
  title?: string;
  fallbackLines: string[];
  kicker?: string;
  helper?: string;
  tone?: string;
  style?: StyleProp<ViewStyle>;
};

export default function ActivityStatusCard({
  title,
  fallbackLines,
  kicker = 'CURRENT STEP',
  helper = 'Keeping this screen awake until it finishes.',
  tone = '#f97316',
  style,
}: ActivityStatusCardProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const [lineIdx, setLineIdx] = useState(0);
  const lines = fallbackLines.length > 0 ? fallbackLines : ['Working on the next step'];

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 780, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 780, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    pulseLoop.start();
    sweepLoop.start();
    const timer = setInterval(() => setLineIdx(idx => (idx + 1) % lines.length), 1700);
    return () => {
      pulseLoop.stop();
      sweepLoop.stop();
      clearInterval(timer);
    };
  }, [lines.length, pulse, sweep]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, 220] });

  return (
    <View style={[styles.card, style]}>
      <View style={styles.top}>
        <View style={styles.orbit}>
          <Animated.View style={[styles.pulse, { borderColor: tone, transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
          <View style={[styles.dot, { backgroundColor: tone }]} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.kicker, { color: tone }]}>{kicker}</Text>
          <Text style={styles.title}>{title || lines[lineIdx]}</Text>
          <Text style={styles.sub}>{helper}</Text>
        </View>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.sweep, { backgroundColor: tone, transform: [{ translateX: sweepX }] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 18,
    backgroundColor: 'rgba(5,5,5,0.72)',
    padding: 13,
    overflow: 'hidden',
    gap: 12,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orbit: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  copy: {
    flex: 1,
  },
  kicker: {
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  sub: {
    color: 'rgba(255,255,255,0.64)',
    fontSize: 10,
    fontFamily: mono,
    marginTop: 3,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  sweep: {
    width: 90,
    height: 4,
    borderRadius: 2,
  },
});
