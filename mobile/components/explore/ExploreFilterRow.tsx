import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';

type Props = {
  shownCount: number;
  countLabel?: string;
  sourceLabel?: string;
  sortLabel?: string;
  showSourceStatus?: boolean;
  showSort?: boolean;
  onCountPress?: () => void;
  onSortPress?: () => void;
};

export function ExploreFilterRow({
  shownCount,
  countLabel,
  sourceLabel = 'Trip details',
  sortLabel = 'Best match',
  showSourceStatus = true,
  showSort = true,
  onCountPress,
  onSortPress,
}: Props) {
  const C = useTheme();
  const compactCount = countLabel ?? formatShownCount(shownCount);
  const displayCount = compactCount.replace(/^(\d+)\s+featured picks$/i, '$1 picks');
  const compactSort = sortLabel === 'Best match' ? 'Best' : sortLabel;
  const countAccessibilityLabel = shownCount <= 0 ? compactCount : `${shownCount} ${shownCount === 1 ? 'place' : 'places'} shown`;
  return (
    <View style={[styles.row, { borderBottomColor: C.border }]}>
      <TouchableOpacity
        style={styles.status}
        activeOpacity={onCountPress ? 0.72 : 1}
        onPress={onCountPress}
        disabled={!onCountPress}
        accessibilityLabel={countAccessibilityLabel}
        accessibilityRole={onCountPress ? 'button' : undefined}
      >
        <Ionicons name="list-outline" size={16} color={C.text3} />
        <Text style={[styles.label, { color: C.text2 }]} numberOfLines={1}>{displayCount}</Text>
        {onCountPress ? <Ionicons name="chevron-down" size={14} color={C.orange} /> : null}
      </TouchableOpacity>
      {showSourceStatus ? (
        <View style={styles.sourceStatus} accessibilityLabel="Place details">
          <Ionicons name="shield-checkmark-outline" size={15} color={C.green} />
          <Text style={[styles.sourceLabel, { color: C.text3 }]} numberOfLines={1}>{sourceLabel}</Text>
        </View>
      ) : null}
      {showSort ? (
        <TouchableOpacity
          style={[styles.sortButton, { borderColor: C.border, backgroundColor: C.s1 }]}
          activeOpacity={0.78}
          onPress={onSortPress}
          disabled={!onSortPress}
          accessibilityLabel={`Sort: ${sortLabel}`}
          accessibilityRole="button"
        >
          <Ionicons name="swap-vertical-outline" size={16} color={C.text2} />
          <Text style={[styles.sortLabel, { color: C.text }]} numberOfLines={1}>{compactSort}</Text>
        </TouchableOpacity>
      ) : null}
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
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  status: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourceStatus: { maxWidth: 112, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  sortButton: {
    minWidth: 88,
    maxWidth: 124,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  label: { flexShrink: 1, minWidth: 0, fontSize: 11, fontWeight: '800' },
  sourceLabel: { flexShrink: 1, minWidth: 0, fontSize: 10.5, fontWeight: '700' },
  sortLabel: { flexShrink: 1, minWidth: 0, fontSize: 11, fontWeight: '800' },
});
