import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { EXPLORE_VISIBLE_PRIMARY_CATEGORIES } from '@/lib/exploreDestinationRegistry';
import { EXPLORE_CATEGORY_CHIPS, type ExploreCategoryKey } from './exploreDisplay';

type Props = {
  selected: ExploreCategoryKey;
  mode: 'featured' | 'nearby' | 'trip';
  counts?: Partial<Record<ExploreCategoryKey, number>>;
  onSelect: (key: ExploreCategoryKey) => void;
  onMore?: () => void;
};

const CATEGORY_PRIORITY: ExploreCategoryKey[] = [
  'all',
  'guided',
  'camp',
  'trails',
  'parks',
  'water',
  'views',
  'things',
  'land',
  'huts',
  'waterfalls',
  'peaks',
  'trailheads',
  'glamping',
  'springs',
  'climb',
  'scenic',
  'fuel',
  'resupply',
  'nearby',
];

const PRIMARY_KEYS: ExploreCategoryKey[] = [...EXPLORE_VISIBLE_PRIMARY_CATEGORIES];
const DYNAMIC_KEYS = new Set<ExploreCategoryKey>(['fuel', 'resupply']);

export function ExploreCategoryChips({ selected, mode, counts, onSelect, onMore }: Props) {
  const C = useTheme();
  const availableKeys = CATEGORY_PRIORITY.filter(key => {
    if (key === 'all' || key === 'nearby' || DYNAMIC_KEYS.has(key)) return true;
    if (key === selected) return true;
    return Number(counts?.[key] ?? 0) > 0;
  });
  const visibleKeys = PRIMARY_KEYS.filter(key => availableKeys.includes(key));
  if (selected !== 'all' && selected !== 'nearby' && !visibleKeys.includes(selected)) visibleKeys.push(selected);
  const hasMore = availableKeys.some(key => key !== 'nearby' && !visibleKeys.includes(key));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {visibleKeys.map(key => EXPLORE_CATEGORY_CHIPS.find(item => item.key === key)).filter(Boolean).map(item => {
        if (!item) return null;
        const active = item.key === 'nearby' ? mode === 'nearby' : selected === item.key && mode !== 'nearby';
        return (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.chip,
              { borderColor: active ? item.color : C.border, backgroundColor: active ? item.color + '14' : C.s1 },
            ]}
            activeOpacity={0.84}
            onPress={() => onSelect(item.key)}
          >
            <Ionicons name={item.icon as any} size={18} color={item.color} />
            <Text style={[styles.label, { color: active ? item.color : C.text }]} numberOfLines={1}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {hasMore && onMore ? (
        <TouchableOpacity
          style={[styles.chip, { borderColor: C.border, backgroundColor: C.s1 }]}
          activeOpacity={0.84}
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel="Open all Explore filters"
        >
          <Ionicons name="options-outline" size={18} color={C.text2} />
          <Text style={[styles.label, { color: C.text }]}>Filters</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingLeft: 20, paddingRight: 68, paddingTop: 13, paddingBottom: 10 },
  chip: {
    minHeight: 48,
    minWidth: 104,
    maxWidth: 158,
    paddingHorizontal: 14,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  label: { flexShrink: 1, minWidth: 0, fontSize: 12, fontWeight: '900' },
});
