import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';

type Props = {
  shownCount: number;
  sourceLabel?: string;
  sortLabel?: string;
};

export function ExploreFilterRow({ shownCount, sourceLabel = 'Checked details', sortLabel = 'Best match' }: Props) {
  const C = useTheme();
  const items = [
    { icon: 'list-outline', label: `${shownCount} shown` },
    { icon: 'shield-checkmark-outline', label: sourceLabel },
    { icon: 'filter-outline', label: `Sort: ${sortLabel}` },
  ];
  return (
    <View style={styles.row}>
      {items.map(item => (
        <View key={item.label} style={[styles.pill, { borderColor: C.border, backgroundColor: C.s1 }]}>
          <Ionicons name={item.icon as any} size={16} color={C.text3} />
          <Text style={[styles.label, { color: C.text3 }]} numberOfLines={1}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  pill: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  label: { fontSize: 12, fontWeight: '800' },
});
