import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/lib/design';
import type { TripLibraryFilter } from './types';

const FILTERS: Array<{ id: TripLibraryFilter; label: string }> = [
  { id: 'draft', label: 'Drafts' },
  { id: 'saved', label: 'Saved' },
  { id: 'archived', label: 'Archived' },
];

export default function TripFilterSegment({
  value,
  counts,
  onChange,
}: {
  value: TripLibraryFilter;
  counts: Record<TripLibraryFilter, number>;
  onChange: (value: TripLibraryFilter) => void;
}) {
  const C = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.control, { backgroundColor: C.s2, borderColor: C.border }]}
    >
      {FILTERS.map(filter => {
        const selected = value === filter.id;
        return (
          <TouchableOpacity
            key={filter.id}
            accessibilityRole="tab"
            accessibilityLabel={`${filter.label}, ${counts[filter.id]} trips`}
            accessibilityState={{ selected }}
            activeOpacity={0.78}
            onPress={() => onChange(filter.id)}
            style={[
              styles.segment,
              selected && { backgroundColor: C.s1, borderColor: C.border2 },
            ]}
          >
            <Text style={[styles.label, { color: selected ? C.text : C.text2 }]} numberOfLines={1}>{filter.label}</Text>
            <Text style={[styles.count, { color: selected ? C.orange : C.text2 }]}>{counts[filter.id]}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    minHeight: 44,
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  label: {
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  count: {
    minWidth: 12,
    textAlign: 'center',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
});
