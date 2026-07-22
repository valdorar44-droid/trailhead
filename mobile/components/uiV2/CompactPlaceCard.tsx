import React from 'react';
import {
  Image,
  ImageSourcePropType,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { uiV2Layout, uiV2Typography } from '@/lib/theme/uiV2';
import { useUiV2Theme } from '@/lib/theme/useUiV2Theme';

export type CompactPlaceKind = 'trail' | 'camp' | 'trailhead' | 'place';
export type CompactPlaceCardState = 'default' | 'saved' | 'offline' | 'loading';

export interface CompactPlaceCardProps {
  kind: CompactPlaceKind;
  title: string;
  meta: string;
  detail?: string;
  image?: ImageSourcePropType;
  imageAlt?: string;
  state?: CompactPlaceCardState;
  statusLabel?: string;
  onPress?: () => void;
  accessory?: React.ReactNode;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const KIND_ICON: Record<CompactPlaceKind, keyof typeof Ionicons.glyphMap> = {
  trail: 'walk-outline',
  camp: 'bonfire-outline',
  trailhead: 'flag-outline',
  place: 'location-outline',
};

export function CompactPlaceCard({
  kind,
  title,
  meta,
  detail,
  image,
  imageAlt,
  state = 'default',
  statusLabel,
  onPress,
  accessory,
  accessibilityHint,
  testID = 'ui-v2-compact-place-card',
  style,
}: CompactPlaceCardProps) {
  const colors = useUiV2Theme();
  const status = statusLabel ?? (state === 'saved' ? 'Saved' : state === 'offline' ? 'Downloaded' : undefined);
  const accessibilityLabel = [title, meta, detail, status].filter(Boolean).join('. ');

  const content = (
    <>
      <View style={[styles.media, { backgroundColor: colors.surfaceMuted }]}>
        {state === 'loading' ? (
          <View style={[styles.mediaFill, { backgroundColor: colors.skeleton }]} testID={`${testID}-image-loading`} />
        ) : image ? (
          <Image
            accessibilityIgnoresInvertColors
            accessibilityLabel={imageAlt}
            accessible={Boolean(imageAlt)}
            resizeMode="cover"
            source={image}
            style={styles.mediaFill}
          />
        ) : (
          <Ionicons name={KIND_ICON[kind]} size={23} color={colors.textMuted} importantForAccessibility="no" />
        )}
      </View>
      <View style={styles.copy}>
        {state === 'loading' ? (
          <>
            <View style={[styles.skeletonTitle, { backgroundColor: colors.skeleton }]} />
            <View style={[styles.skeletonMeta, { backgroundColor: colors.skeleton }]} />
          </>
        ) : (
          <>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
              {status ? (
                <View style={[styles.status, { backgroundColor: colors.statusPositiveSurface }]}>
                  <Ionicons
                    name={state === 'saved' ? 'bookmark' : 'download-outline'}
                    size={12}
                    color={colors.statusPositiveText}
                    importantForAccessibility="no"
                  />
                  <Text style={[styles.statusText, { color: colors.statusPositiveText }]}>{status}</Text>
                </View>
              ) : null}
            </View>
            <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>{meta}</Text>
            {detail ? <Text numberOfLines={2} style={[styles.detail, { color: colors.textMuted }]}>{detail}</Text> : null}
          </>
        )}
      </View>
      {accessory ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} importantForAccessibility="no" /> : null)}
    </>
  );

  if (!onPress) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        accessible={state !== 'loading'}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
        testID={testID}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
          borderColor: colors.border,
        },
        style,
      ]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: uiV2Layout.radius.lg,
    borderWidth: uiV2Layout.borderWidth.hairline,
    flexDirection: 'row',
    gap: uiV2Layout.spacing.md,
    minHeight: 112,
    padding: uiV2Layout.spacing.md,
  },
  media: {
    alignItems: 'center',
    borderRadius: uiV2Layout.radius.md,
    height: 80,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 80,
  },
  mediaFill: { height: '100%', width: '100%' },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: uiV2Layout.spacing.sm },
  title: { ...uiV2Typography.cardTitle, flex: 1 },
  meta: { ...uiV2Typography.supportMedium },
  detail: { ...uiV2Typography.meta, marginTop: 2 },
  status: {
    alignItems: 'center',
    borderRadius: uiV2Layout.radius.pill,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  statusText: { ...uiV2Typography.micro },
  skeletonTitle: { borderRadius: 4, height: 16, width: '74%' },
  skeletonMeta: { borderRadius: 4, height: 12, marginTop: 7, width: '48%' },
});
