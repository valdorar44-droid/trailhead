import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrailheadSkeletonLine } from '@/components/TrailheadUI';
import SearchResultRowV2, { type SearchDistanceUnitMode } from '@/components/search/SearchResultRowV2';
import { useTheme, type ColorPalette } from '@/lib/design';
import { cleanExploreSourceLabel } from '@/lib/exploreContextFilters';
import {
  searchV2ShouldShowEmptyState,
  type SearchPageModeV2,
  type SearchIntentV2,
  type SearchResultV2,
  type SearchV2SessionStatus,
} from '@/lib/searchV2';
import { trailheadFonts } from '@/lib/typography';

export type MapSearchResultItem = {
  name: string;
  lat?: number;
  lng?: number;
  result_id?: string;
  resolution_required?: boolean;
  resolving?: boolean;
  source?: string;
  source_label?: string;
  type?: string;
  subtype?: string;
  address?: string;
  summary?: string;
  dist?: number | null;
  distance_mi?: number | null;
  rating?: number;
  rating_count?: number;
};

export type MapSearchQuickAction = {
  id?: string;
  label: string;
  query: string;
  icon: keyof typeof Ionicons.glyphMap;
  intent?: SearchIntentV2;
  categories?: string[];
  radiusMeters?: number;
};

type Props = {
  visible: boolean;
  query: string;
  results: MapSearchResultItem[];
  searchV2Results?: SearchResultV2[];
  searchV2SettledQuery?: string;
  searchV2Mode?: SearchPageModeV2;
  searchV2Status?: SearchV2SessionStatus;
  searchV2LoadingPresentation?: 'none' | 'inline' | 'skeleton';
  searchV2IsEnriching?: boolean;
  searchV2ResolvingResultId?: string | null;
  searchV2HasMore?: boolean;
  searchV2LoadMoreError?: string;
  unitMode?: SearchDistanceUnitMode;
  searching: boolean;
  hasLocation: boolean;
  recent: Array<{ name: string; lat?: number; lng?: number; source_label?: string }>;
  quickActions: MapSearchQuickAction[];
  onQueryChange: (query: string) => void;
  onSubmit: (query?: string) => void;
  onSelect: (place: MapSearchResultItem) => void;
  onRoute: (place: MapSearchResultItem) => void;
  onSelectSearchV2?: (result: SearchResultV2) => void;
  onRouteSearchV2?: (result: SearchResultV2) => void;
  onLoadMoreSearchV2?: () => void;
  onQuickAction: (action: MapSearchQuickAction) => void;
  onClose: () => void;
  onClear: () => void;
};

export default function MapSearchSheet({
  visible,
  query,
  results,
  searchV2Results,
  searchV2SettledQuery = query,
  searchV2Mode = 'suggest',
  searchV2Status = 'idle',
  searchV2LoadingPresentation = 'none',
  searchV2IsEnriching = false,
  searchV2ResolvingResultId = null,
  searchV2HasMore = false,
  searchV2LoadMoreError = '',
  unitMode = 'auto',
  searching,
  hasLocation,
  recent,
  quickActions,
  onQueryChange,
  onSubmit,
  onSelect,
  onRoute,
  onSelectSearchV2,
  onRouteSearchV2,
  onLoadMoreSearchV2,
  onQuickAction,
  onClose,
  onClear,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);
  const cleanQuery = query.trim();
  const usingSearchV2 = searchV2Results != null;
  const hasError = results.some(result => result.name === '__error__');
  const usableResults = results.filter(result => result.name !== '__error__');
  const activeResults = usingSearchV2 ? searchV2Results : [];
  const showInitialSkeleton = usingSearchV2
    && searchV2LoadingPresentation === 'skeleton'
    && activeResults.length === 0;
  const showSearchV2Empty = usingSearchV2 && searchV2ShouldShowEmptyState({
    displayedQuery: query,
    settledQuery: searchV2SettledQuery,
    status: searchV2Status,
    isEnriching: searchV2IsEnriching,
    resultCount: activeResults.length,
  });
  const showSearchAll = usingSearchV2 && searchV2Mode === 'suggest' && cleanQuery.length >= 2;
  const hasUsefulRows = usingSearchV2 ? activeResults.length > 0 : usableResults.length > 0;
  const showFieldSpinner = searching && !hasUsefulRows;

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => inputRef.current?.focus(), Platform.OS === 'android' ? 180 : 90);
    return () => clearTimeout(t);
  }, [visible]);

  function close() {
    Keyboard.dismiss();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={s.modal} edges={['top', 'left', 'right']} testID="map.search.sheet">
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.header}>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close search"
              testID="map.search.close"
            >
              <Ionicons name="chevron-back" size={22} color={C.text} />
            </TouchableOpacity>
            <Text style={s.title}>Search</Text>
            <TouchableOpacity
              style={s.cancelButton}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Cancel search"
              testID="map.search.cancel"
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <View style={s.searchBox} testID="map.search.field">
              <Ionicons name="search-outline" size={18} color={C.text3} />
              <TextInput
                ref={inputRef}
                testID="map.search.input"
                value={query}
                onChangeText={onQueryChange}
                placeholder="Search camps, trails, fuel"
                placeholderTextColor={C.text3}
                style={s.input}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                onSubmitEditing={() => onSubmit()}
              />
              {showFieldSpinner ? (
                <ActivityIndicator size="small" color={C.orange} />
              ) : cleanQuery ? (
                <TouchableOpacity
                  style={s.clearButton}
                  onPress={onClear}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  testID="map.search.clear"
                >
                  <Ionicons name="close-circle" size={18} color={C.text3} />
                </TouchableOpacity>
              ) : null}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom + 22, 34) }]}
          >
            {!cleanQuery ? (
              <>
                <View style={s.quickHeader}>
                  <Text style={s.sectionTitle}>{hasLocation ? 'SEARCH NEARBY' : 'QUICK SEARCH'}</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRail}>
                  {quickActions.map(action => (
                    <TouchableOpacity
                      key={action.id || action.label}
                      style={s.quickChip}
                      onPress={() => onQuickAction(action)}
                      activeOpacity={0.84}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      testID={`map.search.quick.${action.id || action.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    >
                      <Ionicons name={action.icon} size={16} color={C.orange} />
                      <Text style={s.quickText}>{action.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {cleanQuery.length >= 2 || searching || hasError || usableResults.length > 0 || activeResults.length > 0 ? (
              <View style={s.resultsBlock}>
                <View style={s.resultsHeader}>
                  <Text style={s.sectionTitle}>{usingSearchV2 && searchV2Mode === 'results' ? 'RESULTS' : 'SUGGESTIONS'}</Text>
                  <View style={s.resultsHeaderStatus}>
                    {usingSearchV2 && searchV2IsEnriching && activeResults.length > 0 ? (
                      <ActivityIndicator testID="map.search.enriching" size="small" color={C.orange} />
                    ) : null}
                    {(usingSearchV2 ? activeResults.length : usableResults.length) ? (
                      <Text style={s.count}>{usingSearchV2 ? activeResults.length : usableResults.length}</Text>
                    ) : null}
                  </View>
                </View>
                {showInitialSkeleton ? (
                  <View style={s.skeletonList} testID="map.search.loading" accessibilityLabel="Loading search results">
                    {[0, 1, 2].map(index => <MapSearchRowSkeleton key={index} styles={s} />)}
                  </View>
                ) : searching && (usingSearchV2 ? activeResults.length === 0 : usableResults.length === 0) ? (
                  <View style={s.stateCard} testID="map.search.loading">
                    <ActivityIndicator size="small" color={C.orange} />
                    <Text style={s.stateText}>Searching</Text>
                  </View>
                ) : usingSearchV2 && searchV2Status === 'error' && activeResults.length === 0 ? (
                  <View style={s.stateCard} testID="map.search.error">
                    <Ionicons name="cloud-offline-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Search is not available right now.</Text>
                  </View>
                ) : !usingSearchV2 && hasError ? (
                  <View style={s.stateCard} testID="map.search.error">
                    <Ionicons name="cloud-offline-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Search is not available right now.</Text>
                  </View>
                ) : usingSearchV2 && showSearchV2Empty ? (
                  <View style={s.stateCard} testID="map.search.empty">
                    <Ionicons name="search-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>No matches found</Text>
                  </View>
                ) : !usingSearchV2 && usableResults.length === 0 ? (
                  <View style={s.stateCard} testID="map.search.empty">
                    <Ionicons name="search-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Try a nearby town, park, or service.</Text>
                  </View>
                ) : usingSearchV2 ? (
                  activeResults.map(result => (
                    <SearchResultRowV2
                      key={result.result_id}
                      result={result}
                      unitMode={unitMode}
                      resolving={searchV2ResolvingResultId === result.result_id}
                      trailingAction={onRouteSearchV2 ? 'route' : 'open'}
                      onTrailingPress={onRouteSearchV2 ? () => onRouteSearchV2(result) : undefined}
                      onPress={() => onSelectSearchV2?.(result)}
                      testID={`map.search.result.${result.result_id}`}
                    />
                  ))
                ) : (
                  usableResults.slice(0, 18).map((place, idx) => (
                    <ResultRow
                      key={place.result_id || `${place.name}:${place.lat ?? 'pending'}:${place.lng ?? 'pending'}:${idx}`}
                      place={place}
                      testID={`map.search.result.${place.result_id || `${place.name}:${place.lat ?? 'pending'}:${place.lng ?? 'pending'}`}`}
                      colors={C}
                      styles={s}
                      onPress={() => onSelect(place)}
                      onRoute={() => onRoute(place)}
                    />
                  ))
                )}
                {showSearchAll ? (
                  <TouchableOpacity
                    style={s.searchAllButton}
                    onPress={() => onSubmit()}
                    testID="map.search.search-all"
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={`Search all for ${cleanQuery}`}
                  >
                    <Text style={s.searchAllText} numberOfLines={1}>Search all for “{cleanQuery}”</Text>
                    <Ionicons name="arrow-forward" size={18} color={C.orange} />
                  </TouchableOpacity>
                ) : null}
                {usingSearchV2 && searchV2Mode === 'results' && (searchV2HasMore || searchV2LoadMoreError) ? (
                  <TouchableOpacity
                    style={s.loadMoreButton}
                    onPress={onLoadMoreSearchV2}
                    testID="map.search.load-more"
                    activeOpacity={0.82}
                    disabled={searching}
                    accessibilityRole="button"
                    accessibilityLabel={searchV2LoadMoreError ? 'Retry loading search results' : 'Show more search results'}
                  >
                    {searching ? <ActivityIndicator size="small" color={C.orange} /> : null}
                    <Text style={s.loadMoreText}>{searching ? 'Loading' : searchV2LoadMoreError ? 'Try again' : 'Show more'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <View style={s.resultsBlock}>
                <Text style={s.sectionTitle}>Recent</Text>
                {recent.length ? (
                  recent.slice(0, 6).map((item, idx) => (
                    <TouchableOpacity
                      key={`${item.name}-${idx}`}
                      style={s.recentRow}
                      testID={`map.search.recent.${idx}`}
                      onPress={() => {
                        onQueryChange(item.name);
                        onSubmit(item.name);
                      }}
                      activeOpacity={0.84}
                    >
                      <View style={s.resultIcon}>
                        <Ionicons name="time-outline" size={15} color={C.text2} />
                      </View>
                      <View style={s.resultCopy}>
                        <Text style={s.resultName}>{item.name}</Text>
                        <Text style={s.resultMeta}>{cleanSearchSourceLabel(item.source_label, 'Recent')}</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={s.stateCard}>
                    <Ionicons name="map-outline" size={18} color={C.text3} />
                    <Text style={s.stateText}>Search for a camp, trail, town, fuel, water, or place to start.</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function MapSearchRowSkeleton({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.resultRow}>
      <View style={styles.skeletonIcon} />
      <View style={styles.skeletonCopy}>
        <TrailheadSkeletonLine width="72%" height={14} />
        <TrailheadSkeletonLine width="48%" height={11} />
      </View>
    </View>
  );
}

function ResultRow({
  place,
  testID,
  colors,
  styles,
  onPress,
  onRoute,
}: {
  place: MapSearchResultItem;
  testID: string;
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
  onRoute: () => void;
}) {
  const dist = typeof place.distance_mi === 'number'
    ? place.distance_mi
    : typeof place.dist === 'number'
      ? place.dist * 0.621371
      : null;
  const source = [
    cleanSearchSourceLabel(place.source_label || place.source, cleanLabel(place.subtype || place.type || 'Place')),
    dist != null ? `${dist >= 10 ? dist.toFixed(0) : dist.toFixed(1)} mi` : '',
    place.rating != null ? `${Number(place.rating).toFixed(1)} rating` : '',
  ].filter(Boolean).join(' · ');
  const detail = searchResultDetail(place);
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={onPress}
      activeOpacity={0.86}
      accessibilityRole="button"
      accessibilityLabel={[place.name, source, detail].filter(Boolean).join(', ')}
      testID={testID}
    >
      <View style={styles.resultIcon}>
        <Ionicons name={iconForPlace(place)} size={16} color={colors.orange} />
      </View>
      <View style={styles.resultCopy}>
        <Text style={styles.resultName}>{place.name}</Text>
        <Text style={styles.resultMeta}>{source}</Text>
        {!!detail && (
          <Text style={styles.resultDetail}>{detail}</Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.routeBtn}
        onPress={onRoute}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Route to ${place.name}`}
        testID={`${testID}.route`}
      >
        {place.resolving ? (
          <ActivityIndicator size="small" color={colors.orange} />
        ) : (
          <Ionicons name="navigate-outline" size={16} color={colors.orange} />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function cleanLabel(value?: string) {
  return String(value || 'Place').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function cleanSearchSourceLabel(value?: string | null, fallback = 'Place') {
  return cleanExploreSourceLabel(value, fallback || 'Place');
}

function searchResultDetail(place: MapSearchResultItem) {
  const raw = place.address || place.summary || cleanLabel(place.subtype);
  if (!raw) return '';
  const clean = raw
    .replace(/\bUse live map results\.?\s*/gi, '')
    .replace(/\bLive map results\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const firstSentence = clean.match(/^[^.!?]+[.!?]/)?.[0] || clean;
  return firstSentence.length > 118 ? firstSentence.slice(0, 115).replace(/\s+\S*$/, '').trim() : firstSentence;
}

function iconForPlace(place: MapSearchResultItem): keyof typeof Ionicons.glyphMap {
  const haystack = `${place.type || ''} ${place.subtype || ''} ${place.source || ''} ${place.name || ''}`.toLowerCase();
  if (haystack.includes('camp')) return 'bonfire-outline';
  if (haystack.includes('fuel') || haystack.includes('gas')) return 'car-sport-outline';
  if (haystack.includes('water')) return 'water-outline';
  if (haystack.includes('trail')) return 'trail-sign-outline';
  if (haystack.includes('grocery') || haystack.includes('market')) return 'cart-outline';
  if (haystack.includes('hotel') || haystack.includes('lodging')) return 'bed-outline';
  return 'location-outline';
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  flex: { flex: 1 },
  modal: { flex: 1, backgroundColor: C.bg },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  iconBtn: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: C.text,
    fontFamily: trailheadFonts.displayBold,
    fontSize: 28,
    lineHeight: 32,
  },
  cancelButton: {
    minWidth: 62,
    minHeight: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  cancelText: { color: C.orange, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  searchBox: {
    minHeight: 48,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.orange,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingLeft: 13,
  },
  input: { flex: 1, minHeight: 48, color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '600', paddingVertical: 0 },
  clearButton: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 16 },
  quickHeader: { gap: 4 },
  sectionTitle: { color: C.text2, fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.2 },
  quickRail: { gap: 8, paddingRight: 8 },
  quickChip: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 12,
  },
  quickText: { color: C.text, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  resultsBlock: { gap: 10 },
  skeletonList: { gap: 8 },
  skeletonIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.s2 },
  skeletonCopy: { flex: 1, gap: 8 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultsHeaderStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { color: C.text3, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  stateCard: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  stateText: { flex: 1, color: C.text2, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  resultRow: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recentRow: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  resultCopy: { flex: 1, minWidth: 0, gap: 3 },
  resultName: { color: C.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  resultMeta: { color: C.text2, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  resultDetail: { color: C.text3, fontSize: 12, lineHeight: 17 },
  routeBtn: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchAllButton: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  searchAllText: { flex: 1, color: C.orange, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  loadMoreButton: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  loadMoreText: { color: C.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
