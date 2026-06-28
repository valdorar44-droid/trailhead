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
  shownCount: number;
  sortMode: ExploreSortMode;
  onModeChange: (mode: ExploreMode) => void;
  onCategorySelect: (key: ExploreCategoryKey) => void;
  onClearCategory: () => void;
  onClearSaved: () => void;
  onShowMore?: () => void;
  onSourcePress?: () => void;
  onSortCycle: () => void;
};

export function ExploreHomeControls({
  category,
  mode,
  savedOnly,
  shownCount,
  sortMode,
  onModeChange,
  onCategorySelect,
  onClearCategory,
  onClearSaved,
  onShowMore,
  onSourcePress,
  onSortCycle,
}: Props) {
  const C = useTheme();
  const sortLabel = sortLabelForMode(sortMode);
  const countLabel = shownLabel(shownCount);
  return (
    <View style={styles.shell}>
      <ExploreModeTabs value={mode} onChange={onModeChange} />
      <ExploreCategoryChips selected={category} mode={mode} onSelect={onCategorySelect} />
      <ExploreFilterRow
        shownCount={shownCount}
        countLabel={countLabel}
        sourceLabel="Official + community"
        sortLabel={sortLabel}
        onCountPress={onShowMore}
        onSourcePress={onSourcePress}
        onSortPress={onSortCycle}
      />
      {category !== 'all' ? (
        <ClearControl
          label="Show all Explore places"
          color={C.orange}
          onPress={onClearCategory}
        />
      ) : null}
      {savedOnly ? (
        <ClearControl
          label="Show all Explore places"
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
  if (sortMode === 'source') return 'Trusted first';
  return 'Best match';
}

function shownLabel(count: number) {
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
