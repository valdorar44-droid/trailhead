import React, { type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, type ColorPalette } from '@/lib/design';
import type { PlaceSheetModel } from '@/lib/placeSheetAdapters';
import { sheetActionTestIDV1 } from '@/lib/sheetActions';
import { trailSheetMetricDisplayValue } from '@/lib/trailSheetMetricPresentation';
import { trailheadFonts } from '@/lib/typography';

export type TrailSheetMetric = {
  label: string;
  value: string;
};

type PeekProps = {
  model: PlaceSheetModel;
  meta: string;
  metrics: TrailSheetMetric[];
  primaryLabel: string;
  saved?: boolean;
  onOpenDetails?: () => void;
  onPrimary: () => void;
  onSave: () => void;
  onClose: () => void;
};

export function TrailPlaceSheetPeek({
  model,
  meta,
  metrics,
  primaryLabel,
  saved = false,
  onOpenDetails,
  onPrimary,
  onSave,
  onClose,
}: PeekProps) {
  const C = useTheme();
  const s = makeStyles(C);
  return (
    <View style={s.peekWrap} testID={`${model.testID}-peek`}>
      <View style={s.identityCard}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Open details for ${model.title}`}
          style={s.identityCopy}
          onPress={onOpenDetails ?? onPrimary}
          activeOpacity={0.86}
        >
          <Text style={s.kicker}>{model.identity.kind === 'trailhead' ? 'TRAILHEAD' : 'TRAIL'}</Text>
          <Text style={s.title} numberOfLines={2}>{model.title}</Text>
          <Text style={s.meta} numberOfLines={1}>{meta}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={`${model.testID}-peek-close`}
          accessibilityRole="button"
          accessibilityLabel={`Close ${model.title}`}
          style={s.closeButton}
          onPress={onClose}
        >
          <Ionicons name="close" size={18} color={C.text2} />
        </TouchableOpacity>
      </View>

      <TrailSheetMetricGrid metrics={metrics} compact />

      <View style={s.actions}>
        <TouchableOpacity
          testID={`${model.testID}-peek-primary`}
          accessibilityRole="button"
          style={s.primaryButton}
          onPress={onPrimary}
        >
          <Text style={s.primaryButtonText}>{primaryLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={`${model.testID}-peek-save`}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          style={s.secondaryButton}
          onPress={onSave}
        >
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color={C.text} />
          <Text style={s.secondaryButtonText}>{saved ? 'Saved' : 'Save'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function TrailSheetIdentityCard({
  model,
  meta,
  trust,
}: {
  model: PlaceSheetModel;
  meta: string;
  trust?: string;
}) {
  const C = useTheme();
  const s = makeStyles(C);
  return (
    <View style={s.fullIdentityCard} testID={`${model.testID}-identity`}>
      <Text style={s.kicker}>{model.identity.kind === 'trailhead' ? 'TRAILHEAD' : 'TRAIL'}</Text>
      <Text style={s.title} numberOfLines={3}>{model.title}</Text>
      {!!meta && <Text style={s.meta} numberOfLines={2}>{meta}</Text>}
      {!!trust && <Text style={s.trust} numberOfLines={2}>{trust}</Text>}
    </View>
  );
}

export function TrailSheetActionRow({
  model,
  primaryLabel,
  saved = false,
  onPrimary,
  onSave,
  onMore,
}: {
  model: PlaceSheetModel;
  primaryLabel: string;
  saved?: boolean;
  onPrimary: () => void;
  onSave: () => void;
  onMore: () => void;
}) {
  const C = useTheme();
  const s = makeStyles(C);
  return (
    <View style={s.fullActions}>
      <TouchableOpacity
        testID={sheetActionTestIDV1(model.testID, 'navigate')}
        accessibilityRole="button"
        style={s.fullPrimary}
        onPress={onPrimary}
      >
        <Text style={s.primaryButtonText}>{primaryLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID={sheetActionTestIDV1(model.testID, 'save')}
        accessibilityRole="button"
        accessibilityState={{ selected: saved }}
        style={s.fullSecondary}
        onPress={onSave}
      >
        <Text style={s.secondaryButtonText}>{saved ? 'Saved' : 'Save'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        testID={`${model.testID}-more`}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${model.title}`}
        style={s.moreButton}
        onPress={onMore}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={C.text} />
      </TouchableOpacity>
    </View>
  );
}

export function TrailSheetSectionTitle({ children }: { children: ReactNode }) {
  const C = useTheme();
  const s = makeStyles(C);
  return <Text style={s.sectionTitle}>{children}</Text>;
}

export function TrailSheetMetricGrid({
  metrics,
  compact = false,
}: {
  metrics: TrailSheetMetric[];
  compact?: boolean;
}) {
  const C = useTheme();
  const s = makeStyles(C);
  const visible = metrics
    .map(metric => ({
      ...metric,
      value: trailSheetMetricDisplayValue(metric.label, metric.value),
    }))
    .filter(metric => metric.value)
    .slice(0, 3);
  if (!visible.length) return null;
  return (
    <View style={[s.metricGrid, compact && s.metricGridCompact]}>
      {visible.map(metric => (
        <View key={metric.label} style={s.metricCell}>
          <Text style={[s.metricLabel, compact && s.metricLabelAccent]} numberOfLines={1}>{metric.label.toUpperCase()}</Text>
          <Text style={s.metricValue}>{metric.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function TrailSheetLinkRow({
  testID,
  title,
  subtitle,
  actionLabel,
  onPress,
}: {
  testID?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  const C = useTheme();
  const s = makeStyles(C);
  const content = (
    <>
      <View style={s.linkCopy}>
        <Text style={s.linkTitle} numberOfLines={2}>{title}</Text>
        {!!subtitle && <Text style={s.linkSubtitle} numberOfLines={2}>{subtitle}</Text>}
      </View>
      {onPress ? (
        actionLabel
          ? <Text style={s.linkAction}>{actionLabel}</Text>
          : <Ionicons name="chevron-forward" size={17} color={C.text3} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={s.linkRow}>{content}</View>;
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      style={s.linkRow}
      activeOpacity={0.82}
      onPress={onPress}
    >
      {content}
    </TouchableOpacity>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    peekWrap: { gap: 10 },
    identityCard: {
      minHeight: 104,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
    },
    identityCopy: { flex: 1, minWidth: 0 },
    fullIdentityCard: {
      padding: 20,
      gap: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
    },
    kicker: { color: C.orange, fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.4 },
    title: { color: C.text, fontSize: 22, lineHeight: 29, fontFamily: trailheadFonts.displaySemibold, marginTop: 3 },
    meta: { color: C.text2, fontSize: 14, lineHeight: 20, marginTop: 2 },
    trust: { color: C.text3, fontSize: 12, lineHeight: 17, marginTop: 2 },
    closeButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -8,
      marginRight: -8,
    },
    metricGrid: {
      minHeight: 72,
      flexDirection: 'row',
      gap: 8,
    },
    metricGridCompact: {
      minHeight: 68,
      gap: 0,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
      overflow: 'hidden',
    },
    metricCell: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
      paddingHorizontal: 11,
      paddingVertical: 9,
      borderRadius: 12,
      backgroundColor: C.s2,
    },
    metricLabel: { color: C.text3, fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.35 },
    metricLabelAccent: { color: C.orange },
    metricValue: { color: C.text, fontSize: 14, lineHeight: 18, fontWeight: '700', marginTop: 3 },
    actions: { minHeight: 48, flexDirection: 'row', gap: 12 },
    primaryButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.orange,
    },
    primaryButtonText: { color: '#fff', fontSize: 15, lineHeight: 20, fontWeight: '700' },
    secondaryButton: {
      flex: 1,
      minHeight: 48,
      flexDirection: 'row',
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.bg,
    },
    secondaryButtonText: { color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    fullActions: { minHeight: 46, flexDirection: 'row', gap: 8 },
    fullPrimary: {
      flex: 1,
      minHeight: 46,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.orange,
    },
    fullSecondary: {
      width: 88,
      minHeight: 46,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.bg,
    },
    moreButton: {
      width: 86,
      minHeight: 46,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.bg,
    },
    sectionTitle: { color: C.text, fontSize: 20, lineHeight: 24, fontFamily: trailheadFonts.displayBold, marginTop: 8 },
    linkRow: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 0,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.border,
    },
    linkCopy: { flex: 1, minWidth: 0 },
    linkTitle: { color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    linkSubtitle: { color: C.text3, fontSize: 13, lineHeight: 18, marginTop: 2 },
    linkAction: { color: C.orange, fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.3 },
  });
}
