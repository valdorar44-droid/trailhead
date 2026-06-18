import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { EXPLORE_CATEGORY_CHIPS, type ExploreCategoryKey } from './exploreDisplay';

type Props = {
  selected: ExploreCategoryKey;
  mode: 'featured' | 'nearby' | 'trip';
  onSelect: (key: ExploreCategoryKey) => void;
};

export function ExploreCategoryChips({ selected, mode, onSelect }: Props) {
  const C = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {EXPLORE_CATEGORY_CHIPS.map(item => {
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
