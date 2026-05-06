import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { radii, shadows } from '@/lib/theme';

type Props = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
};

export function FrostedPanel({ children, style, intensity = 28 }: Props) {
  const content = (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.035)', 'rgba(255,255,255,0.07)']}
        locations={[0, 0.46, 1]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </>
  );

  if (Platform.OS === 'web') {
    return <View style={[s.panel, style]}>{content}</View>;
  }

  return (
    <BlurView tint="dark" intensity={intensity} style={[s.panel, style]}>
      {content}
    </BlurView>
  );
}

const s = StyleSheet.create({
  panel: {
    overflow: 'hidden',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(10,10,12,0.58)',
    ...shadows.glass,
  },
});
