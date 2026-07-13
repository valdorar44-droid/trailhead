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
  onSelectDrafts,
}: {
  value: TripLibraryFilter;
  counts: Record<TripLibraryFilter, number>;
  onChange: (value: TripLibraryFilter) => void;
  onSelectDrafts?: () => void;
}) {
  const C = useTheme();
  return (
    <View style={[styles.control, { borderBottomColor: C.border }]}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {FILTERS.map(filter => {
          const selected = value === filter.id;
          const count = counts[filter.id];
          return (
            <TouchableOpacity
              key={filter.id}
              accessibilityRole="tab"
              accessibilityLabel={`${filter.label}, ${count} trips`}
              accessibilityState={{ selected }}
              activeOpacity={0.7}
              onPress={() => onChange(filter.id)}
              style={styles.tab}
            >
              <Text style={[styles.label, { color: selected ? C.text : C.text2 }]} numberOfLines={1}>
                {filter.label}{selected && count > 0 ? ` ${count}` : ''}
              </Text>
              {selected ? <View style={[styles.activeRule, { backgroundColor: C.orange }]} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {value === 'draft' && counts.draft > 0 && onSelectDrafts ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Select drafts"
          activeOpacity={0.7}
          onPress={onSelectDrafts}
          style={styles.selectAction}
        >
          <Text style={[styles.selectLabel, { color: C.orange }]}>Select</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tabs: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
  },
  tab: {
    position: 'relative',
    minHeight: 45,
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  label: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
  activeRule: {
    position: 'absolute',
    left: 7,
    right: 7,
    bottom: -1,
    height: 3,
    borderRadius: 2,
  },
  selectAction: {
    minHeight: 45,
    justifyContent: 'center',
    paddingLeft: 10,
    paddingRight: 2,
  },
  selectLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
