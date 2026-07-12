import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { ExploreCategoryChips } from './ExploreCategoryChips';
import { ExploreFilterRow } from './ExploreFilterRow';
import { ExploreModeTabs } from './ExploreModeTabs';
import type { ExploreCategoryKey, ExploreMode } from './exploreDisplay';

export type ExploreSortMode = 'best' | 'nearest' | 'source';

type Props = {
  category: ExploreCategoryKey;
  mode: ExploreMode;
  savedOnly: boolean;
  hasQuery?: boolean;
  shownCount: number;
  countLabel?: string;
  categoryCounts?: Partial<Record<ExploreCategoryKey, number>>;
  sortMode: ExploreSortMode;
  guidedMode?: boolean;
  onModeChange: (mode: ExploreMode) => void;
  onCategorySelect: (key: ExploreCategoryKey) => void;
  onOpenFilters?: () => void;
  onClearCategory: () => void;
  onClearSaved: () => void;
  onShowMore?: () => void;
  onSortCycle: () => void;
};

export function ExploreHomeControls({
  category,
  mode,
  savedOnly,
  hasQuery,
  shownCount,
  countLabel: countLabelOverride,
  categoryCounts,
  sortMode,
  guidedMode = false,
  onModeChange,
  onCategorySelect,
  onOpenFilters,
  onClearCategory,
  onClearSaved,
  onShowMore,
  onSortCycle,
}: Props) {
  const C = useTheme();
  const sortLabel = sortLabelForMode(sortMode);
  const countLabel = countLabelOverride || ((category === 'guided' || category === 'tours') && shownCount === 0 ? (hasQuery ? 'Try a new search' : 'Search trips') : shownLabel(shownCount));
  return (
    <View style={styles.shell}>
      <ExploreModeTabs value={mode} onChange={onModeChange} />
      <ExploreCategoryChips selected={category} mode={mode} counts={categoryCounts} onSelect={onCategorySelect} onMore={onOpenFilters} />
      <ExploreFilterRow
        shownCount={shownCount}
        countLabel={countLabel}
        sourceLabel={sortMode === 'source' ? 'Most detail first' : 'Trip details'}
        sortLabel={sortLabel}
        showSourceStatus={!guidedMode}
        showSort={!guidedMode}
        onCountPress={onShowMore}
        onSortPress={guidedMode ? undefined : onSortCycle}
      />
      {category !== 'all' ? (
        <ClearControl
          label="Show all places"
          color={C.orange}
          onPress={onClearCategory}
        />
      ) : null}
      {savedOnly ? (
        <ClearControl
          label="Show all places"
          color={C.orange}
          onPress={onClearSaved}
        />
      ) : null}
    </View>
  );
}

function ClearControl({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.clearButton} onPress={onPress} activeOpacity={0.82}>
      <Ionicons name="close" size={14} color={color} />
      <Text style={[styles.clearText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function sortLabelForMode(sortMode: ExploreSortMode) {
  if (sortMode === 'nearest') return 'Nearest';
  if (sortMode === 'source') return 'Most detail';
  return 'Best match';
}

function shownLabel(count: number) {
  if (count <= 0) return 'Search places';
  if (count < 1000) return `${count} shown`;
  const compact = count / 1000;
  return `${compact.toFixed(compact >= 10 ? 0 : 1)}K shown`;
}

const styles = StyleSheet.create({
  shell: {
    paddingBottom: 8,
  },
  clearButton: {
    alignSelf: 'flex-start',
    marginHorizontal: 20,
    marginTop: 6,
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  clearText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
});
