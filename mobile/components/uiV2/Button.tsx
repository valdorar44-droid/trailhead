import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { uiV2Layout, uiV2Typography } from '@/lib/theme/uiV2';
import { useUiV2Theme } from '@/lib/theme/useUiV2Theme';
import { resolveButtonVisual, type UiV2ButtonVariant } from '@/lib/uiSystemV2/visualState';

type IconName = keyof typeof Ionicons.glyphMap;

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: UiV2ButtonVariant;
  size?: 'medium' | 'large';
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'medium',
  icon,
  iconPosition = 'leading',
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID = 'ui-v2-button',
  style,
}: ButtonProps) {
  const colors = useUiV2Theme();
  const inactive = disabled || loading;
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => {
        const visual = resolveButtonVisual(colors, variant, { pressed, disabled: inactive });
        return [
          styles.base,
          size === 'large' ? styles.large : styles.medium,
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
        const visual = resolveButtonVisual(colors, variant, { pressed, disabled: inactive });
        const leadingIcon = loading ? (
          <ActivityIndicator color={visual.textColor} size="small" testID={`${testID}-loading`} />
        ) : icon && iconPosition === 'leading' ? (
          <Ionicons name={icon} size={18} color={visual.textColor} importantForAccessibility="no" />
        ) : null;
        return (
          <>
            {leadingIcon}
            <Text numberOfLines={1} style={[styles.label, { color: visual.textColor }]}>
              {label}
            </Text>
            {!loading && icon && iconPosition === 'trailing' ? (
              <Ionicons name={icon} size={18} color={visual.textColor} importantForAccessibility="no" />
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
    borderRadius: uiV2Layout.radius.md,
    flexDirection: 'row',
    gap: uiV2Layout.spacing.sm,
    justifyContent: 'center',
    minWidth: uiV2Layout.control.minimumTarget,
    paddingHorizontal: uiV2Layout.spacing.lg,
  },
  medium: { minHeight: uiV2Layout.control.medium },
  large: { minHeight: uiV2Layout.control.large, paddingHorizontal: uiV2Layout.spacing.xl },
  label: { ...uiV2Typography.bodyMedium, flexShrink: 1, textAlign: 'center' },
});
