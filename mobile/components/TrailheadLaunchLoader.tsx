import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, ImageBackground, Platform, StyleSheet, View } from 'react-native';

const TRAILHEAD_MARK = require('../assets/trailhead-mark.png');
const LAUNCH_CAMO = require('../assets/launch-camo.png');

export default function TrailheadLaunchLoader() {
  const pulse = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1250,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1250,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver,
        }),
      ]),
    );
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 4200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 4200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
      ]),
    );
    pulseLoop.start();
    driftLoop.start();
    return () => {
      pulseLoop.stop();
      driftLoop.stop();
    };
  }, [drift, pulse, useNativeDriver]);

  const logoMotion = {
    opacity: pulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.9, 1],
    }),
    transform: [
      {
        scale: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.94, 1.03],
        }),
      },
      {
        translateY: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [5, -5],
        }),
      },
    ],
  };
  const glowMotion = {
    opacity: pulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.18, 0.34],
    }),
    transform: [
      {
        scale: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.82, 1.18],
        }),
      },
    ],
  };

  return (
    <View style={styles.root}>
      <ImageBackground source={LAUNCH_CAMO} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      <View style={styles.scrim} />
      <View style={styles.content}>
        <Animated.View style={[styles.glow, glowMotion]} />
        <Animated.View style={[styles.logoWrap, logoMotion]}>
          <Image source={TRAILHEAD_MARK} style={styles.logo} resizeMode="contain" />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100000,
    elevation: 1000,
    overflow: 'hidden',
    backgroundColor: '#090c0d',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: '#f97316',
    shadowColor: '#f97316',
    shadowOpacity: 0.45,
    shadowRadius: 38,
    shadowOffset: { width: 0, height: 0 },
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
});
