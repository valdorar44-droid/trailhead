import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, type ColorPalette } from '@/lib/design';
import type { PlaceSheetModel } from '@/lib/placeSheetAdapters';
import { trailheadFonts } from '@/lib/typography';

type ShellProps = {
  model: PlaceSheetModel;
  children: ReactNode;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function PlaceSheetShell({
  model,
  children,
  fill = true,
  style,
  testID = model.testID,
}: ShellProps) {
  return (
    <View
      testID={testID}
      accessibilityLabel={`${model.title}, ${model.subtitle}`}
      style={[fill && styles.fill, style]}
    >
      {children}
    </View>
  );
}

export function PlaceSheetShellHeader({
  model,
  loading = false,
  onToggleStage,
  onBack,
  onClose,
}: {
  model: PlaceSheetModel;
  loading?: boolean;
  onToggleStage: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const C = useTheme();
  const s = makeStyles(C);
  return (
    <View style={s.header}>
      <TouchableOpacity
        testID={`${model.testID}-stage-toggle`}
        accessibilityRole="button"
        accessibilityLabel="Resize place details"
        style={s.handleTarget}
        onPress={onToggleStage}
        activeOpacity={0.78}
      >
        <View style={s.handle} />
      </TouchableOpacity>
      <View style={s.titleRow}>
        {onBack ? (
          <TouchableOpacity
            testID={`${model.testID}-back`}
            accessibilityRole="button"
            accessibilityLabel="Back to previous place"
            style={s.iconButton}
            onPress={onBack}
          >
            <Ionicons name="arrow-back" size={18} color={C.text2} />
          </TouchableOpacity>
        ) : null}
        <View style={s.titleCopy}>
          <Text style={s.title} numberOfLines={1}>{model.title}</Text>
          <Text style={s.subtitle} numberOfLines={1}>{model.subtitle}</Text>
        </View>
        {loading ? <ActivityIndicator testID={`${model.testID}-loading`} color={C.orange} size="small" /> : null}
        <TouchableOpacity
          testID={`${model.testID}-close`}
          accessibilityRole="button"
          accessibilityLabel={`Close ${model.title}`}
          style={s.iconButton}
          onPress={onClose}
        >
          <Ionicons name="close" size={18} color={C.text2} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function PlaceSheetHeroChrome({
  model,
  top = 12,
  saved = false,
  onSave,
  onShare,
  onBack,
  onClose,
  children,
}: {
  model: PlaceSheetModel;
  top?: number;
  saved?: boolean;
  onSave?: () => void;
  onShare?: () => void;
  onBack?: () => void;
  onClose?: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {onBack ? (
        <View style={[styles.heroBack, { top }]}>
          <HeroAction testID={`${model.testID}-back`} label="Back to previous place" icon="arrow-back" onPress={onBack} />
        </View>
      ) : null}
      {onSave || onShare || onClose ? (
        <View style={[styles.heroActions, { top }]}>
          {onSave ? (
            <HeroAction
              testID={`${model.testID}-save`}
              label={saved ? `Remove saved ${model.title}` : `Save ${model.title}`}
              icon={saved ? 'heart' : 'heart-outline'}
              color={saved ? '#ef4444' : '#fff'}
              onPress={onSave}
            />
          ) : null}
          {onShare ? <HeroAction testID={`${model.testID}-share`} label={`Share ${model.title}`} icon="share-outline" onPress={onShare} /> : null}
          {onClose ? <HeroAction testID={`${model.testID}-close`} label={`Close ${model.title}`} icon="close" onPress={onClose} /> : null}
        </View>
      ) : null}
      <View style={styles.heroText}>
        <Text style={styles.heroKicker} numberOfLines={1}>{model.subtitle}</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>{model.title}</Text>
        {children}
      </View>
    </>
  );
}

function HeroAction({
  testID,
  label,
  icon,
  color = '#fff',
  onPress,
}: {
  testID: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.heroIconButton}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  heroBack: {
    position: 'absolute',
    left: 12,
    zIndex: 4,
  },
  heroActions: {
    position: 'absolute',
    right: 12,
    zIndex: 4,
    flexDirection: 'row',
    gap: 8,
  },
  heroIconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,20,18,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.34)',
  },
  heroText: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  heroKicker: { color: '#fff', fontSize: 11, lineHeight: 14, fontWeight: '800' },
  heroTitle: { color: '#fff', fontSize: 28, lineHeight: 31, fontFamily: trailheadFonts.displayBold, marginTop: 3 },
});

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    header: {
      paddingTop: 7,
      paddingHorizontal: 14,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.border,
      backgroundColor: C.bg,
    },
    handleTarget: { minHeight: 20, justifyContent: 'center', alignItems: 'center' },
    handle: { width: 46, height: 5, borderRadius: 3, backgroundColor: C.border2 },
    titleRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10 },
    titleCopy: { flex: 1, minWidth: 0 },
    title: { color: C.text, fontSize: 21, lineHeight: 24, fontFamily: trailheadFonts.displaySemibold },
    subtitle: { color: C.text3, fontSize: 12, lineHeight: 16, marginTop: 2 },
    iconButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.glassStrong,
      borderWidth: 1,
      borderColor: C.border,
    },
  });
}
