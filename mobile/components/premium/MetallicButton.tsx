import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { font, radii, shadows } from '@/lib/theme';

type Props = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  variant?: 'silver' | 'dark' | 'warning';
  loading?: boolean;
  style?: ViewStyle;
};

export function MetallicButton({ label, icon, onPress, variant = 'silver', loading, style }: Props) {
  const colors: readonly [string, string, ...string[]] = variant === 'warning'
    ? ['#F1B07D', '#D97745', '#8A3E22']
    : variant === 'dark'
      ? ['rgba(255,255,255,0.09)', 'rgba(255,255,255,0.035)', 'rgba(255,255,255,0.06)']
      : ['#FFFFFF', '#D7D9DE', '#7E858E'];
  const textColor = variant === 'dark' ? '#F5F5F7' : '#08090B';
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} disabled={loading} style={[s.touch, style]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.inner}>
        {loading ? <ActivityIndicator size="small" color={textColor} /> : icon ? <Ionicons name={icon} size={15} color={textColor} /> : null}
        <Text style={[s.label, { color: textColor }]} numberOfLines={1}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  touch: {
    borderRadius: radii.md,
    overflow: 'hidden',
    ...shadows.glow,
  },
  inner: {
    minHeight: 46,
    paddingHorizontal: 18,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  label: {
    fontFamily: font.mono,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
});
