import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { font, radii } from '@/lib/theme';

type Props = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'neutral' | 'success' | 'warning' | 'blue';
  style?: ViewStyle;
};

export function PremiumChip({ label, icon, tone = 'neutral', style }: Props) {
  const color = tone === 'success' ? '#3BCF8E' : tone === 'warning' ? '#D97745' : tone === 'blue' ? '#6DA8FF' : '#C7C9CC';
  return (
    <View style={[s.root, { borderColor: color + '33', backgroundColor: color + '12' }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Text style={[s.text, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontFamily: font.mono,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
});
