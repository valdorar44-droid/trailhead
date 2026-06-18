import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TRAILHEAD_LOGO = require('../assets/icon.png');

export default function TrailheadLaunchLoader() {
  const insets = useSafeAreaInsets();
  const drift = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 5400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 5400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
      ]),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
      ]),
    );
    driftLoop.start();
    pulseLoop.start();
    return () => {
      driftLoop.stop();
      pulseLoop.stop();
    };
  }, [drift, pulse, useNativeDriver]);

  const contourMotion = {
    transform: [
      {
        translateX: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [-20, 18],
        }),
      },
      {
        translateY: drift.interpolate({
          inputRange: [0, 1],
          outputRange: [8, -12],
        }),
      },
    ],
  };
  const routeMotion = {
    opacity: pulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.58, 1],
    }),
    transform: [
      {
        scaleX: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.94, 1.04],
        }),
      },
    ],
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#05070a', '#071412', '#1a1710']}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.94, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Animated.View style={[styles.contourLayer, contourMotion]}>
        <View style={[styles.contour, styles.contourOne]} />
        <View style={[styles.contour, styles.contourTwo]} />
        <View style={[styles.contour, styles.contourThree]} />
        <View style={[styles.contour, styles.contourFour]} />
        <View style={[styles.contour, styles.contourFive]} />
      </Animated.View>
      <Animated.View style={[styles.routeLayer, routeMotion]}>
        <View style={[styles.routeLine, styles.routeLineOne]} />
        <View style={[styles.routeLine, styles.routeLineTwo]} />
        <View style={[styles.routePin, styles.routePinStart]} />
        <View style={[styles.routePin, styles.routePinCamp]} />
        <View style={[styles.routePin, styles.routePinEnd]} />
      </Animated.View>
      <View style={[styles.content, { paddingTop: Math.max(insets.top, 18), paddingBottom: Math.max(insets.bottom, 18) + 24 }]}>
        <View style={styles.brandLockup}>
          <View style={styles.logoShell}>
            <Image source={TRAILHEAD_LOGO} style={styles.logo} resizeMode="cover" />
          </View>
          <Text style={styles.brand}>TRAILHEAD</Text>
          <Text style={styles.sub}>Loading maps and places</Text>
        </View>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, routeMotion]} />
        </View>
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
    backgroundColor: '#05070a',
  },
  contourLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  contour: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'transparent',
    shadowColor: '#f97316',
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  contourOne: {
    width: 520,
    height: 190,
    borderRadius: 130,
    left: -110,
    top: 96,
    transform: [{ rotate: '-16deg' }],
  },
  contourTwo: {
    width: 560,
    height: 230,
    borderRadius: 150,
    right: -180,
    top: 220,
    borderColor: 'rgba(20,184,166,0.16)',
    transform: [{ rotate: '18deg' }],
  },
  contourThree: {
    width: 500,
    height: 180,
    borderRadius: 140,
    left: -170,
    bottom: 190,
    borderColor: 'rgba(249,115,22,0.16)',
    transform: [{ rotate: '20deg' }],
  },
  contourFour: {
    width: 680,
    height: 240,
    borderRadius: 170,
    right: -230,
    bottom: 42,
    transform: [{ rotate: '-13deg' }],
  },
  contourFive: {
    width: 280,
    height: 112,
    borderRadius: 80,
    left: '22%',
    top: '45%',
    borderColor: 'rgba(255,255,255,0.08)',
    transform: [{ rotate: '-8deg' }],
  },
  routeLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  routeLine: {
    position: 'absolute',
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(249,115,22,0.92)',
    shadowColor: '#f97316',
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  routeLineOne: {
    left: '18%',
    top: '50%',
    width: '30%',
    transform: [{ rotate: '18deg' }],
  },
  routeLineTwo: {
    left: '44%',
    top: '45%',
    width: '34%',
    backgroundColor: 'rgba(20,184,166,0.88)',
    transform: [{ rotate: '-18deg' }],
  },
  routePin: {
    position: 'absolute',
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#f8fafc',
    backgroundColor: '#f97316',
  },
  routePinStart: {
    left: '17%',
    top: '48%',
  },
  routePinCamp: {
    left: '47%',
    top: '47%',
    backgroundColor: '#14b8a6',
  },
  routePinEnd: {
    right: '21%',
    top: '39%',
    backgroundColor: '#22c55e',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  brandLockup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logoShell: {
    width: 92,
    height: 92,
    borderRadius: 28,
    padding: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  logo: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  brand: {
    color: '#f8fafc',
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: 0,
  },
  sub: {
    color: 'rgba(248,250,252,0.68)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  progressTrack: {
    width: '46%',
    maxWidth: 220,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  progressFill: {
    width: '72%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#f97316',
  },
});
