import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, type ColorPalette } from '@/lib/design';
import type { PlaceSheetModel } from '@/lib/placeSheetAdapters';
import { sheetActionTestIDV1 } from '@/lib/sheetActions';
import { trailheadFonts } from '@/lib/typography';

type Props = {
  model: PlaceSheetModel;
  meta: string;
  siteType: string;
  inventory: string;
  fee: string;
  saved: boolean;
  onViewSites: () => void;
  onSave: () => void;
  onClose: () => void;
};

export function cleanCampPeekMeta(value: string): string {
  return value
    .replace(/\u00c3\u201a\u00c2\u00b7/g, ' · ')
    .replace(/\u00c3\u201a\u00b7/g, ' · ')
    .replace(/\u00c2\u00b7/g, ' · ')
    .replace(/\s+·\s+/g, ' · ')
    .trim();
}

export default function CampPlaceSheetPeek({
  model,
  meta,
  siteType,
  inventory,
  fee,
  saved,
  onViewSites,
  onSave,
  onClose,
}: Props) {
  const C = useTheme();
  const s = makeStyles(C);
  return (
    <View style={s.wrap} testID={`${model.testID}-peek`}>
      <View style={s.identityCard}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Open details for ${model.title}`}
          style={s.identityCopy}
          onPress={onViewSites}
          activeOpacity={0.86}
        >
          <Text style={s.kicker}>CAMPGROUND</Text>
          <Text style={s.title} numberOfLines={2}>{model.title}</Text>
          <Text style={s.meta} numberOfLines={1}>{cleanCampPeekMeta(meta)}</Text>
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

      <View style={s.essentials}>
        <Essential label="SITE TYPE" value={siteType} styles={s} />
        <Essential label="INVENTORY" value={inventory} styles={s} />
        <Essential label="FEE" value={fee} styles={s} />
      </View>

      <View style={s.actions}>
        <TouchableOpacity
          testID={`${model.testID}-view-sites`}
          accessibilityRole="button"
          style={s.primaryButton}
          onPress={onViewSites}
        >
          <Text style={s.primaryButtonText}>View sites</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={sheetActionTestIDV1(model.testID, 'save')}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          style={s.secondaryButton}
          onPress={onSave}
        >
          <Ionicons name={saved ? 'heart' : 'heart-outline'} size={18} color={C.text} />
          <Text style={s.secondaryButtonText}>{saved ? 'Saved' : 'Save'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Essential({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.essentialItem}>
      <Text style={styles.essentialLabel}>{label}</Text>
      <Text style={styles.essentialValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    wrap: { gap: 10 },
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
    kicker: { color: C.orange, fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.4 },
    title: { color: C.text, fontSize: 22, lineHeight: 28, fontFamily: trailheadFonts.displaySemibold, marginTop: 3 },
    meta: { color: C.text3, fontSize: 14, lineHeight: 20, marginTop: 4 },
    closeButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -8,
      marginRight: -8,
    },
    essentials: {
      minHeight: 72,
      flexDirection: 'row',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
      overflow: 'hidden',
    },
    essentialItem: { flex: 1, minWidth: 0, paddingHorizontal: 11, paddingVertical: 10 },
    essentialLabel: { color: C.orange, fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.35 },
    essentialValue: { color: C.text, fontSize: 14, lineHeight: 18, fontWeight: '600', marginTop: 3 },
    actions: { minHeight: 48, flexDirection: 'row', gap: 12 },
    primaryButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.orange,
    },
    primaryButtonText: { color: '#fff', fontSize: 16, lineHeight: 20, fontWeight: '700' },
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
    secondaryButtonText: { color: C.text, fontSize: 16, lineHeight: 20, fontWeight: '700' },
  });
}
