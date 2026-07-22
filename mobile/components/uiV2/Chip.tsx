import React, { useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { uiV2Layout, uiV2Typography } from '@/lib/theme/uiV2';
import { useUiV2Theme } from '@/lib/theme/useUiV2Theme';
import { resolveChipVisual, type UiV2ChipState } from '@/lib/uiSystemV2/visualState';

type IconName = keyof typeof Ionicons.glyphMap;

export interface ChipProps {
  label: string;
  onPress?: () => void;
  kind?: 'filter' | 'layer';
  state?: UiV2ChipState;
  selected?: boolean;
  disabled?: boolean;
  error?: boolean;
  icon?: IconName;
  count?: number;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Chip({
  label,
  onPress,
  kind = 'filter',
  state,
  selected = false,
  disabled = false,
  error = false,
  icon,
  count,
  accessibilityHint,
  testID = 'ui-v2-chip',
  style,
}: ChipProps) {
  const colors = useUiV2Theme();
  const resolvedState: UiV2ChipState = state ?? (error ? 'error' : disabled ? 'disabled' : selected ? 'selected' : 'default');
  const inactive = resolvedState === 'disabled';
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={count == null ? label : `${label}, ${count}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: resolvedState === 'selected', disabled: inactive }}
      disabled={inactive}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => {
        const visual = resolveChipVisual(colors, resolvedState, pressed);
        return [
          styles.base,
          {
            backgroundColor: visual.backgroundColor,
            borderColor: focused ? colors.focusRing : visual.borderColor,
            borderWidth: focused ? uiV2Layout.borderWidth.focus : uiV2Layout.borderWidth.hairline,
            opacity: visual.opacity,
          },
          style,
        ];
      }}
    >
      {({ pressed }) => {
        const visual = resolveChipVisual(colors, resolvedState, pressed);
        return (
          <>
            {icon ? <Ionicons name={icon} size={16} color={visual.textColor} importantForAccessibility="no" /> : null}
            <Text numberOfLines={1} style={[styles.label, { color: visual.textColor }]}>{label}</Text>
            {count != null ? <Text style={[styles.count, { color: visual.textColor }]}>{count}</Text> : null}
            {kind === 'filter' ? (
              <Ionicons name="chevron-down" size={14} color={visual.textColor} importantForAccessibility="no" />
            ) : resolvedState === 'selected' ? (
              <Ionicons name="checkmark" size={16} color={visual.textColor} importantForAccessibility="no" />
            ) : null}
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: uiV2Layout.radius.pill,
    flexDirection: 'row',
    gap: 6,
    minHeight: uiV2Layout.control.minimumTarget,
    paddingHorizontal: uiV2Layout.spacing.md,
  },
  label: { ...uiV2Typography.supportMedium, flexShrink: 1 },
  count: { ...uiV2Typography.meta, fontVariant: ['tabular-nums'] },
});
