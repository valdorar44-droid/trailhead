import { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, type ColorPalette } from '@/lib/design';
import { formatSearchDistanceV2, type SearchResultV2 } from '@/lib/searchV2';

export type SearchDistanceUnitMode = 'auto' | 'imperial' | 'metric';

type Props = {
  result: SearchResultV2;
  onPress: () => void;
  resolving?: boolean;
  unitMode?: SearchDistanceUnitMode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  trailingAction?: 'open' | 'route';
  onTrailingPress?: () => void;
};

/**
 * The shared server-ranked Search V2 row. Surfaces pass SearchResultV2 through
 * untouched and resolve/convert it only after an explicit press.
 */
export default function SearchResultRowV2({
  result,
  onPress,
  resolving = false,
  unitMode = 'auto',
  testID = `search-v2.result.${result.result_id}`,
  style,
  trailingAction = 'open',
  onTrailingPress,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const subtitle = searchResultSubtitleV2(result);
  const trailing = searchResultTrailingLabelV2(result, unitMode);
  const accessibilityCopy = [result.title, subtitle, trailing].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={[s.row, style]}
      onPress={onPress}
      testID={testID}
      disabled={resolving}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel={accessibilityCopy}
    >
      <View style={s.icon} importantForAccessibility="no">
        <Ionicons name={searchResultIconV2(result)} size={20} color={C.orange} />
      </View>
      <View style={s.copy}>
        <Text style={s.title} numberOfLines={1}>{result.title}</Text>
        <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      {resolving ? (
        <View style={s.trailingControl} importantForAccessibility="no">
          <ActivityIndicator size="small" color={C.orange} />
        </View>
      ) : trailingAction === 'route' && onTrailingPress ? (
        <TouchableOpacity
          style={s.trailingControl}
          onPress={event => {
            event.stopPropagation();
            onTrailingPress();
          }}
          testID={`${testID}.route`}
          accessibilityRole="button"
          accessibilityLabel={`Route to ${result.title}`}
        >
          <Ionicons name="navigate-outline" size={18} color={C.orange} />
        </TouchableOpacity>
      ) : (
        <View style={s.trailing} importantForAccessibility="no">
          <Text style={s.trailingText} numberOfLines={1}>{trailing}</Text>
          <Ionicons name="chevron-forward" size={17} color={C.text2} />
        </View>
      )}
    </TouchableOpacity>
  );
}

export function searchResultKindLabelV2(kind: string) {
  const clean = String(kind || 'Place').replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!clean || clean === 'poi') return 'Place';
  return clean.replace(/\b\w/g, value => value.toUpperCase());
}

export function searchResultSubtitleV2(result: SearchResultV2) {
  const fallback = searchResultKindLabelV2(result.kind);
  return String(result.subtitle || result.parent || fallback)
    .replace(/\b(mapbox|geoapify|nominatim|openstreetmap)\b/gi, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*·\s*·\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim() || fallback;
}

export function searchResultTrailingLabelV2(
  result: SearchResultV2,
  unitMode: SearchDistanceUnitMode = 'auto',
) {
  return formatSearchDistanceV2(result.distance_meters, unitMode)
    || searchResultKindLabelV2(result.kind);
}

export function searchResultIconV2(result: SearchResultV2): keyof typeof Ionicons.glyphMap {
  const haystack = `${result.kind} ${(result.categories || []).join(' ')} ${result.title}`.toLowerCase();
  if (/camp|rv|campsite/.test(haystack)) return 'bonfire-outline';
  if (/trailhead/.test(haystack)) return 'flag-outline';
  if (/trail|hike/.test(haystack)) return 'trail-sign-outline';
  if (/fuel|gas/.test(haystack)) return 'car-sport-outline';
  if (/water/.test(haystack)) return 'water-outline';
  if (/park|area|region|city|town/.test(haystack)) return 'map-outline';
  return 'location-outline';
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  row: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: C.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  subtitle: { color: C.text2, fontSize: 14, lineHeight: 20 },
  trailing: { maxWidth: 92, alignItems: 'flex-end', justifyContent: 'center', gap: 4 },
  trailingText: { color: C.text3, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  trailingControl: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
