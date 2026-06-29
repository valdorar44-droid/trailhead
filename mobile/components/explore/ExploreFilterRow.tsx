import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';

type Props = {
  shownCount: number;
  countLabel?: string;
  sourceLabel?: string;
  sortLabel?: string;
  onCountPress?: () => void;
  onSourcePress?: () => void;
  onSortPress?: () => void;
};

export function ExploreFilterRow({
  shownCount,
  countLabel,
  sourceLabel = 'Sources',
  sortLabel = 'Best match',
  onCountPress,
  onSourcePress,
  onSortPress,
}: Props) {
  const C = useTheme();
  const compactCount = countLabel ?? formatShownCount(shownCount);
  const compactSort = sortLabel === 'Best match' ? 'Best' : sortLabel;
  const countAccessibilityLabel = shownCount <= 0 ? compactCount : `${shownCount} ${shownCount === 1 ? 'place' : 'places'} shown`;
  const items = [
    { icon: 'list-outline', label: compactCount, accessibilityLabel: countAccessibilityLabel, onPress: onCountPress, flex: 0.95 },
    { icon: 'shield-checkmark-outline', label: sourceLabel, accessibilityLabel: 'Sources', onPress: onSourcePress, flex: 1.3 },
    { icon: 'filter-outline', label: compactSort, accessibilityLabel: `Sort: ${sortLabel}`, onPress: onSortPress, flex: 0.95 },
  ];
  return (
    <View style={styles.row}>
      {items.map(item => {
        const content = (
          <>
            <Ionicons name={item.icon as any} size={16} color={C.text3} />
            <Text style={[styles.label, { color: C.text3 }]} numberOfLines={1}>{item.label}</Text>
          </>
        );
        const style = [styles.pill, { flex: item.flex, borderColor: C.border, backgroundColor: C.s1 }];
        if (!item.onPress) {
          return (
            <View key={item.label} style={style} accessibilityLabel={item.accessibilityLabel}>
              {content}
            </View>
          );
        }
        return (
          <TouchableOpacity
            key={item.label}
            style={style}
            activeOpacity={0.78}
            onPress={item.onPress}
            accessibilityLabel={item.accessibilityLabel}
            accessibilityRole="button"
          >
            {content}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function formatShownCount(count: number) {
  if (count < 1000) return `${count}`;
  const compact = count / 1000;
  return `${compact.toFixed(compact >= 10 ? 0 : 1)}K`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 9,
    paddingBottom: 6,
  },
  pill: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  label: { fontSize: 11, fontWeight: '800' },
});
