import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  children?: React.ReactNode;
  style?: ViewStyle;
};

export function AmbientBackground({ children, style }: Props) {
  return (
    <View style={[s.root, style]}>
      <LinearGradient
        colors={['#050505', '#080A0D', '#050505']}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[s.glow, s.glowTop]} />
      <View style={[s.glow, s.glowBlue]} />
      <View style={s.vignette} />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050505', overflow: 'hidden' },
  glow: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    opacity: 0.14,
  },
  glowTop: {
    top: -140,
    right: -130,
    backgroundColor: '#E5E7EB',
    transform: [{ scaleX: 1.25 }],
  },
  glowBlue: {
    bottom: 80,
    left: -180,
    backgroundColor: '#6DA8FF',
    opacity: 0.12,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
});
