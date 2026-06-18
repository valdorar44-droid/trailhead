import React from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ColorPalette, mono, useTheme } from '@/lib/design';
import { font, radii, shadows, spacing } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function useOverlayTone(C: ColorPalette) {
  const light = C.bg === '#F7F8F6';
  return {
    light,
    sheet: light ? 'rgba(255,255,255,0.88)' : 'rgba(8,9,10,0.82)',
    sheetStrong: light ? 'rgba(255,255,255,0.96)' : 'rgba(8,9,10,0.94)',
    field: light ? 'rgba(17,20,18,0.045)' : 'rgba(255,255,255,0.055)',
    line: light ? 'rgba(18,22,20,0.12)' : 'rgba(255,255,255,0.1)',
  };
}

export function TrailheadScreen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const C = useTheme();
  return <SafeAreaView style={[ui.screen, { backgroundColor: C.bg }, style]}>{children}</SafeAreaView>;
}

export function TrailheadSheet({
  children,
  style,
  contentStyle,
  handle = true,
  scroll = false,
  maxHeight,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  handle?: boolean;
  scroll?: boolean;
  maxHeight?: number;
}) {
  const C = useTheme();
  const tone = useOverlayTone(C);
  const body = (
    <View style={[ui.sheetInner, contentStyle]}>
      {handle && <View style={[ui.handle, { backgroundColor: C.border2 }]} />}
      {children}
    </View>
  );
  const shellStyle = [
    ui.sheet,
    {
      maxHeight,
      borderColor: tone.line,
      backgroundColor: tone.sheet,
    },
    style,
  ];
  if (Platform.OS === 'web') {
    return <View style={shellStyle}>{scroll ? <ScrollView showsVerticalScrollIndicator={false}>{body}</ScrollView> : body}</View>;
  }
  return (
    <BlurView intensity={tone.light ? 46 : 34} tint={tone.light ? 'light' : 'dark'} style={shellStyle}>
      {scroll ? <ScrollView showsVerticalScrollIndicator={false}>{body}</ScrollView> : body}
    </BlurView>
  );
}

export function TrailheadCard({
  children,
  style,
  active,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
  onPress?: () => void;
}) {
  const C = useTheme();
  const tone = useOverlayTone(C);
  const content = (
    <View
      style={[
        ui.card,
        {
          borderColor: active ? C.orange : tone.line,
          backgroundColor: active ? C.orange + '16' : tone.field,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return content;
  return <TouchableOpacity activeOpacity={0.86} onPress={onPress}>{content}</TouchableOpacity>;
}

export function TrailheadTopBar({
  title,
  subtitle,
  icon,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useTheme();
  return (
    <TrailheadSheet handle={false} style={[ui.topBar, style]} contentStyle={ui.topBarInner}>
      {icon ? (
        <View style={[ui.iconBadge, { borderColor: C.orange + '44', backgroundColor: C.orange + '14' }]}>
          <Ionicons name={icon} size={17} color={C.orange} />
        </View>
      ) : null}
      <View style={ui.titleBlock}>
        <Text style={[ui.kicker, { color: C.orange }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[ui.subtitle, { color: C.text2 }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </TrailheadSheet>
  );
}

export function TrailheadListItem({
  title,
  subtitle,
  icon,
  value,
  tone,
  onPress,
  right,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  value?: string;
  tone?: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const C = useTheme();
  const accent = tone ?? C.silverBright;
  return (
    <TrailheadCard onPress={onPress} style={ui.listItem}>
      {icon ? (
        <View style={[ui.smallIcon, { borderColor: accent + '55', backgroundColor: accent + '14' }]}>
          <Ionicons name={icon} size={15} color={accent} />
        </View>
      ) : null}
      <View style={ui.titleBlock}>
        <Text style={[ui.itemTitle, { color: C.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[ui.itemSub, { color: C.text3 }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[ui.itemValue, { color: C.text2 }]} numberOfLines={1}>{value}</Text> : null}
      {right}
    </TrailheadCard>
  );
}

export function TrailheadSearchBar({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  right,
  style,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useTheme();
  const tone = useOverlayTone(C);
  return (
    <View style={[ui.search, { borderColor: tone.line, backgroundColor: tone.field }, style]}>
      <Ionicons name="search" size={17} color={C.text3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.text3}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        style={[ui.searchInput, { color: C.text }]}
      />
      {right}
    </View>
  );
}

export function TrailheadButtonDock({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[ui.buttonDock, style]}>{children}</View>;
}

export function TrailheadButton({
  label,
  icon,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  style,
  textStyle,
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const C = useTheme();
  const tone = useOverlayTone(C);
  const primary = variant === 'primary';
  const danger = variant === 'danger';
  const bg = primary ? C.orange : danger ? C.red + '14' : variant === 'ghost' ? 'transparent' : tone.field;
  const border = primary ? C.orange : danger ? C.red + '55' : tone.line;
  const color = primary ? '#fff' : danger ? C.red : C.text2;
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={onPress}
      disabled={disabled || loading}
      style={[ui.button, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.56 : 1 }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={color} /> : icon ? <Ionicons name={icon} size={15} color={color} /> : null}
      <Text style={[ui.buttonText, { color }, textStyle]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{label}</Text>
    </TouchableOpacity>
  );
}

export function TrailheadPrompt({
  title,
  body,
  icon = 'information-circle-outline',
  tone,
  action,
}: {
  title: string;
  body?: string;
  icon?: IconName;
  tone?: string;
  action?: React.ReactNode;
}) {
  const C = useTheme();
  const accent = tone ?? C.orange;
  return (
    <TrailheadCard style={ui.prompt}>
      <View style={[ui.smallIcon, { borderColor: accent + '55', backgroundColor: accent + '14' }]}>
        <Ionicons name={icon} size={16} color={accent} />
      </View>
      <View style={ui.titleBlock}>
        <Text style={[ui.promptTitle, { color: C.text }]}>{title}</Text>
        {body ? <Text style={[ui.promptBody, { color: C.text2 }]}>{body}</Text> : null}
      </View>
      {action}
    </TrailheadCard>
  );
}

export function TrailheadMetricRow({
  metrics,
  style,
}: {
  metrics: { label: string; value: string; icon?: IconName; tone?: string }[];
  style?: StyleProp<ViewStyle>;
}) {
  const C = useTheme();
  return (
    <View style={[ui.metricRow, style]}>
      {metrics.map(metric => {
        const tone = metric.tone ?? C.silverBright;
        return (
          <View key={metric.label} style={[ui.metricTile, { borderColor: C.border, backgroundColor: C.glass }]}>
            {metric.icon ? <Ionicons name={metric.icon} size={13} color={tone} /> : null}
            <Text style={[ui.metricValue, { color: C.text }]} numberOfLines={1}>{metric.value}</Text>
            <Text style={[ui.metricLabel, { color: C.text3 }]} numberOfLines={1}>{metric.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function TrailheadSectionTitle({ children }: { children: React.ReactNode }) {
  const C = useTheme();
  return <Text style={[ui.sectionTitle, { color: C.text3 }]}>{children}</Text>;
}

export function TrailheadSkeletonLine({
  width = '100%',
  height = 12,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useTheme();
  const tone = useOverlayTone(C);
  return <View style={[ui.skeletonLine, { width, height, backgroundColor: tone.field, borderColor: tone.line }, style]} />;
}

export function TrailheadLoadingRow({
  label = 'Loading nearby options',
  sub,
  icon = 'sync-outline',
  style,
}: {
  label?: string;
  sub?: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useTheme();
  return (
    <TrailheadCard style={[ui.loadingRow, style]}>
      <View style={[ui.smallIcon, { borderColor: C.orange + '55', backgroundColor: C.orange + '14' }]}>
        <ActivityIndicator size="small" color={C.orange} />
      </View>
      <View style={ui.titleBlock}>
        <View style={ui.loadingTitleRow}>
          <Ionicons name={icon} size={13} color={C.orange} />
          <Text style={[ui.loadingTitle, { color: C.text }]} numberOfLines={1}>{label}</Text>
        </View>
        {sub ? <Text style={[ui.loadingSub, { color: C.text3 }]} numberOfLines={2}>{sub}</Text> : null}
      </View>
    </TrailheadCard>
  );
}

export function TrailheadCardSkeleton({
  media = false,
  lines = 3,
  style,
}: {
  media?: boolean;
  lines?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TrailheadCard style={[ui.skeletonCard, style]}>
      {media ? <TrailheadSkeletonLine width={68} height={58} style={ui.skeletonMedia} /> : null}
      <View style={ui.skeletonCopy}>
        <TrailheadSkeletonLine width="72%" height={13} />
        {Array.from({ length: Math.max(1, lines - 1) }).map((_, idx) => (
          <TrailheadSkeletonLine key={idx} width={idx % 2 ? '58%' : '90%'} height={10} />
        ))}
      </View>
    </TrailheadCard>
  );
}

export function TrailheadRailSkeleton({
  label,
  count = 4,
  cardWidth = 176,
  style,
}: {
  label?: string;
  count?: number;
  cardWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {label ? <TrailheadSectionTitle>{label}</TrailheadSectionTitle> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ui.skeletonRail}>
        {Array.from({ length: count }).map((_, idx) => (
          <TrailheadCardSkeleton key={idx} media lines={3} style={[ui.skeletonRailCard, { width: cardWidth }]} />
        ))}
      </ScrollView>
    </View>
  );
}

export function TrailheadGradientLine() {
  const C = useTheme();
  return <LinearGradient colors={[C.orange + '00', C.orange + '88', C.orange + '00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={ui.gradientLine} />;
}

const ui = StyleSheet.create({
  screen: { flex: 1 },
  sheet: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: radii.xl,
    ...shadows.glass,
  },
  sheetInner: { padding: spacing.md },
  handle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  topBar: { borderRadius: radii.lg },
  topBarInner: { minHeight: 54, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBadge: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  smallIcon: { width: 32, height: 32, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  titleBlock: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: mono, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  subtitle: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  listItem: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemTitle: { fontSize: 14, fontWeight: '800' },
  itemSub: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  itemValue: { fontFamily: mono, fontSize: 11, fontWeight: '800', maxWidth: 92 },
  search: { minHeight: 46, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, paddingVertical: 0, fontSize: 14, fontWeight: '700' },
  buttonDock: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  button: { minHeight: 44, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  buttonText: { fontFamily: font.mono, fontSize: 10.5, fontWeight: '900', letterSpacing: 0.7 },
  prompt: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  promptTitle: { fontSize: 13, fontWeight: '900' },
  promptBody: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  metricTile: { flex: 1, minHeight: 58, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 8, justifyContent: 'center' },
  metricValue: { fontFamily: mono, fontSize: 13, fontWeight: '900', marginTop: 2 },
  metricLabel: { fontFamily: mono, fontSize: 8.5, fontWeight: '900', marginTop: 2 },
  sectionTitle: { fontFamily: mono, fontSize: 9, fontWeight: '900', letterSpacing: 0.9, marginBottom: spacing.sm },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loadingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  loadingTitle: { fontSize: 13, fontWeight: '900' },
  loadingSub: { fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  skeletonLine: { borderWidth: 1, borderRadius: 999, opacity: 0.84 },
  skeletonCard: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  skeletonMedia: { borderRadius: radii.md },
  skeletonCopy: { flex: 1, minWidth: 0, gap: 8 },
  skeletonRail: { gap: spacing.sm, paddingRight: spacing.md },
  skeletonRailCard: { flexShrink: 0 },
  gradientLine: { height: 1, opacity: 0.8 },
});
