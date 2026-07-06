import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mono } from '@/lib/design';

export type CopilotPresenceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'building'
  | 'flying'
  | 'speaking'
  | 'warning'
  | 'paused'
  | 'complete';

type Props = {
  state: CopilotPresenceState;
  label?: string;
};

const STATE_CONFIG: Record<CopilotPresenceState, {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  animated: boolean;
}> = {
  idle: { color: '#f97316', icon: 'sparkles', label: 'CO-PILOT', animated: false },
  listening: { color: '#38bdf8', icon: 'mic', label: 'LISTENING', animated: true },
  thinking: { color: '#a78bfa', icon: 'sync', label: 'THINKING', animated: true },
  building: { color: '#a78bfa', icon: 'construct', label: 'BUILDING', animated: true },
  flying: { color: '#f97316', icon: 'navigate', label: 'FLYING', animated: true },
  speaking: { color: '#fb923c', icon: 'volume-high', label: 'SPEAKING', animated: true },
  warning: { color: '#f59e0b', icon: 'warning', label: 'REVIEW', animated: true },
  paused: { color: '#94a3b8', icon: 'pause', label: 'PAUSED', animated: false },
  complete: { color: '#22c55e', icon: 'checkmark-circle', label: 'READY', animated: false },
};

export function CopilotPresenceOrb({ state, label }: Props) {
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.idle;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pulse.setValue(0);
    if (!config.animated) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: state === 'speaking' ? 420 : state === 'listening' ? 640 : 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: state === 'speaking' ? 420 : state === 'listening' ? 640 : 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [config.animated, pulse, state]);

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.08] });
  const coreScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, state === 'speaking' ? 1.08 : 1.04] });

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.orbStack}>
        <Animated.View
          style={[
            styles.halo,
            {
              backgroundColor: config.color,
              opacity: config.animated ? haloOpacity : 0.16,
              transform: [{ scale: config.animated ? haloScale : 1 }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.core,
            {
              backgroundColor: config.color,
              shadowColor: config.color,
              transform: [{ scale: config.animated ? coreScale : 1 }],
            },
          ]}
        >
          <Ionicons name={config.icon} size={17} color="#fff" />
        </Animated.View>
      </View>
      <View style={styles.labelPill}>
        <Text style={[styles.labelText, { color: config.color }]} numberOfLines={1}>
          {label || config.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  orbStack: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 20,
  },
  core: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,.55)',
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  labelPill: {
    backgroundColor: 'rgba(8,12,18,.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.14)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  labelText: {
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
