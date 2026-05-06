import React from 'react';
import { StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { radii, shadows } from '@/lib/theme';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  active?: boolean;
  style?: ViewStyle;
};

export function FloatingButton({ icon, onPress, active, style }: Props) {
  const color = active ? '#D97745' : '#E5E7EB';
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={[s.touch, active && s.active, style]}>
      <BlurView intensity={24} tint="dark" style={s.blur}>
        <Ionicons name={icon} size={19} color={color} />
      </BlurView>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  touch: {
    width: 46,
    height: 46,
    borderRadius: radii.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(5,5,5,0.45)',
    ...shadows.glow,
  },
  active: {
    borderColor: 'rgba(217,119,69,0.44)',
    shadowColor: '#D97745',
    shadowOpacity: 0.28,
  },
  blur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
