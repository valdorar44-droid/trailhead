import React, { useMemo } from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

type IconName = keyof typeof Ionicons.glyphMap;

export type CopilotActionCardItem = {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'quiet';
  loading?: boolean;
  disabled?: boolean;
};

type Props = {
  action: CopilotActionCardItem;
  style?: StyleProp<ViewStyle>;
};

export default function CopilotActionCard({ action, style }: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const variant = action.variant ?? 'secondary';
  const primary = variant === 'primary';
  const quiet = variant === 'quiet';
  const color = primary ? '#fff' : C.text2;
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={action.onPress}
      disabled={action.disabled || action.loading}
      style={[
        s.action,
        primary && s.actionPrimary,
        quiet && s.actionQuiet,
        (action.disabled || action.loading) && s.actionDisabled,
        style,
      ]}
    >
      {action.loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : action.icon ? (
        <Ionicons name={action.icon} size={15} color={color} />
      ) : null}
      <Text style={[s.actionText, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {action.label}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  action: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  actionPrimary: {
    borderColor: C.orange,
    backgroundColor: C.orange,
    shadowColor: C.orange,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
  },
  actionQuiet: {
    backgroundColor: 'transparent',
  },
  actionDisabled: {
    opacity: 0.55,
  },
  actionText: {
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});
