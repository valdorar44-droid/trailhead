import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { uiV2Layout, uiV2Typography } from '@/lib/theme/uiV2';
import { useUiV2Theme } from '@/lib/theme/useUiV2Theme';
import { Button } from './Button';

export type RecoveryStateKind = 'empty' | 'offline' | 'permission' | 'error';

export interface RecoveryStateProps {
  kind: RecoveryStateKind;
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  compact?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_CONTENT: Record<RecoveryStateKind, { title: string; body: string; actionLabel?: string; icon: keyof typeof Ionicons.glyphMap }> = {
  empty: {
    title: 'Nothing here yet',
    body: 'Try changing the area or filters.',
    icon: 'map-outline',
  },
  offline: {
    title: 'You are offline',
    body: 'Downloaded places and routes are still available.',
    actionLabel: 'Try again',
    icon: 'cloud-offline-outline',
  },
  permission: {
    title: 'Location is unavailable',
    body: 'Review location access to use nearby results and navigation.',
    actionLabel: 'Review permissions',
    icon: 'navigate-outline',
  },
  error: {
    title: 'This did not load',
    body: 'Your current screen is still here. Try loading this section again.',
    actionLabel: 'Try again',
    icon: 'alert-circle-outline',
  },
};

export function RecoveryState({
  kind,
  title,
  body,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
  testID = 'ui-v2-recovery-state',
  style,
}: RecoveryStateProps) {
  const colors = useUiV2Theme();
  const defaults = DEFAULT_CONTENT[kind];
  const resolvedActionLabel = actionLabel ?? defaults.actionLabel;
  const critical = kind === 'error';
  const attention = kind === 'permission';
  const tone = critical ? colors.errorText : attention ? colors.warningText : colors.accentText;
  const iconSurface = critical ? colors.errorSurface : attention ? colors.warningSurface : colors.accentSoft;

  return (
    <View
      accessibilityLiveRegion={critical ? 'assertive' : 'polite'}
      style={[styles.base, compact && styles.compact, style]}
      testID={testID}
    >
      <View style={[styles.icon, compact && styles.iconCompact, { backgroundColor: iconSurface }]}>
        <Ionicons name={defaults.icon} size={compact ? 21 : 26} color={tone} importantForAccessibility="no" />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title ?? defaults.title}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{body ?? defaults.body}</Text>
      </View>
      {resolvedActionLabel && onAction ? (
        <View style={[styles.actions, compact && styles.actionsCompact]}>
          <Button label={resolvedActionLabel} onPress={onAction} size="medium" testID={`${testID}-primary`} />
          {secondaryActionLabel && onSecondaryAction ? (
            <Button
              label={secondaryActionLabel}
              onPress={onSecondaryAction}
              size="medium"
              testID={`${testID}-secondary`}
              variant="ghost"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    gap: uiV2Layout.spacing.lg,
    justifyContent: 'center',
    paddingHorizontal: uiV2Layout.spacing.xl,
    paddingVertical: uiV2Layout.spacing.xxl,
  },
  compact: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: uiV2Layout.spacing.md,
    justifyContent: 'flex-start',
    paddingHorizontal: 0,
    paddingVertical: uiV2Layout.spacing.md,
  },
  icon: {
    alignItems: 'center',
    borderRadius: uiV2Layout.radius.pill,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  iconCompact: { height: uiV2Layout.control.minimumTarget, width: uiV2Layout.control.minimumTarget },
  copy: { alignItems: 'center', flex: 1, gap: uiV2Layout.spacing.xs },
  title: { ...uiV2Typography.sectionTitle, textAlign: 'center' },
  body: { ...uiV2Typography.support, maxWidth: 360, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: uiV2Layout.spacing.sm },
  actionsCompact: { alignSelf: 'auto', minWidth: 120 },
});
