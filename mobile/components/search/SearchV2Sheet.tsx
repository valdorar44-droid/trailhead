import { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrailheadSkeletonLine } from '@/components/TrailheadUI';
import SearchResultRowV2 from '@/components/search/SearchResultRowV2';
import { useTheme, type ColorPalette } from '@/lib/design';
import { trailheadFonts } from '@/lib/typography';
import {
  searchV2ShouldShowEmptyState,
  type SearchPageModeV2,
  type SearchResultV2,
} from '@/lib/searchV2';

type SearchStatus = 'idle' | 'debouncing' | 'loading' | 'ready' | 'offline' | 'disabled' | 'error';

type SearchUnitMode = 'auto' | 'imperial' | 'metric';

type Props = {
  visible: boolean;
  query: string;
  settledQuery?: string;
  results: SearchResultV2[];
  mode: SearchPageModeV2;
  status: SearchStatus;
  loadingPresentation?: 'none' | 'inline' | 'skeleton';
  isEnriching?: boolean;
  resolvingResultId?: string | null;
  selectionError?: string;
  hasMore?: boolean;
  loadMoreError?: string;
  guidedQuery?: string;
  unitMode?: SearchUnitMode;
  onQueryChange: (query: string) => void;
  onSearchAll: () => void;
  onSelect: (result: SearchResultV2) => void;
  onLoadMore?: () => void;
  onOpenGuided?: () => void;
  onClose: () => void;
};

export default function SearchV2Sheet({
  visible,
  query,
  settledQuery = query,
  results,
  mode,
  status,
  loadingPresentation = 'none',
  isEnriching = false,
  resolvingResultId = null,
  selectionError = '',
  hasMore = false,
  loadMoreError = '',
  guidedQuery = '',
  unitMode = 'auto',
  onQueryChange,
  onSearchAll,
  onSelect,
  onLoadMore,
  onOpenGuided,
  onClose,
}: Props) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput | null>(null);
  const cleanQuery = query.trim();
  const loading = status === 'debouncing' || status === 'loading';
  const showInitialSkeleton = loadingPresentation === 'skeleton' && results.length === 0;
  const showEmptyState = searchV2ShouldShowEmptyState({
    displayedQuery: query,
    settledQuery,
    status,
    isEnriching,
    resultCount: results.length,
  });
  const showSearchAll = mode === 'suggest' && cleanQuery.length >= 2;

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => inputRef.current?.focus(), Platform.OS === 'android' ? 170 : 80);
    return () => clearTimeout(timer);
  }, [visible]);

  function close() {
    Keyboard.dismiss();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView
        style={styles.screen}
        edges={['top', 'left', 'right']}
        testID="search-v2.sheet"
      >
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={close}
              testID="search-v2.close"
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <Ionicons name="chevron-back" size={25} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.title}>Search</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={close}
              testID="search-v2.cancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel search"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchField}>
            <Ionicons name="search-outline" size={20} color={C.text2} />
            <TextInput
              ref={inputRef}
              testID="search-v2.input"
              value={query}
              onChangeText={onQueryChange}
              placeholder="Search camps, trails, places"
              placeholderTextColor={C.text3}
              style={styles.input}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={onSearchAll}
            />
            {cleanQuery ? (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => onQueryChange('')}
                testID="search-v2.clear"
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close" size={17} color={C.text2} />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.sectionHeader} testID="search-v2.section-header">
            <Text style={styles.sectionLabel}>{mode === 'results' ? 'RESULTS' : 'SUGGESTIONS'}</Text>
            {(isEnriching || (loading && !showInitialSkeleton)) ? <ActivityIndicator size="small" color={C.orange} /> : null}
          </View>

          {selectionError ? (
            <View style={styles.errorBanner} accessibilityLiveRegion="polite" testID="search-v2.selection-error">
              <Ionicons name="alert-circle-outline" size={18} color={C.orange} />
              <Text style={styles.errorText}>{selectionError}</Text>
            </View>
          ) : null}

          {showInitialSkeleton ? (
            <View
              style={styles.skeletonList}
              accessibilityLabel="Loading search results"
              testID="search-v2.loading"
            >
              {[0, 1, 2].map(index => <SearchRowSkeleton key={index} styles={styles} />)}
            </View>
          ) : (
            <FlatList
              testID="search-v2.results"
              data={results}
              keyExtractor={item => item.result_id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: Math.max(insets.bottom + 28, 40) },
              ]}
              renderItem={({ item }) => (
                <SearchResultRowV2
                  result={item}
                  unitMode={unitMode}
                  resolving={resolvingResultId === item.result_id}
                  onPress={() => onSelect(item)}
                />
              )}
              ListHeaderComponent={guidedQuery && onOpenGuided ? (
                <TouchableOpacity
                  style={styles.guidedAction}
                  onPress={onOpenGuided}
                  testID="search-v2.guided-trips"
                  activeOpacity={0.84}
                  accessibilityRole="button"
                  accessibilityLabel={`Search guided trips for ${guidedQuery}`}
                  accessibilityHint="Opens the separately booked Viator inventory"
                >
                  <View style={styles.guidedIcon}>
                    <Ionicons name="ticket-outline" size={20} color={C.orange} />
                  </View>
                  <View style={styles.resultCopy}>
                    <Text style={styles.resultTitle}>Guided trips</Text>
                    <Text style={styles.resultSubtitle} numberOfLines={1}>Book with Viator</Text>
                  </View>
                  <Ionicons name="open-outline" size={18} color={C.text2} />
                </TouchableOpacity>
              ) : null}
              ListEmptyComponent={showEmptyState ? (
                <View style={styles.emptyState} testID="search-v2.empty">
                  <Ionicons name="search-outline" size={21} color={C.text3} />
                  <Text style={styles.emptyText}>No matches found</Text>
                </View>
              ) : status === 'error' ? (
                <View style={styles.emptyState} testID="search-v2.error">
                  <Ionicons name="cloud-offline-outline" size={21} color={C.text3} />
                  <Text style={styles.emptyText}>Search is not available right now.</Text>
                </View>
              ) : null}
              ListFooterComponent={(
                <>
                  {showSearchAll ? (
                    <TouchableOpacity
                      style={styles.searchAllButton}
                      onPress={onSearchAll}
                      testID="search-v2.search-all"
                      activeOpacity={0.82}
                      accessibilityRole="button"
                      accessibilityLabel={`Search all for ${cleanQuery}`}
                    >
                      <Text style={styles.searchAllText} numberOfLines={1}>Search all for “{cleanQuery}”</Text>
                      <Ionicons name="arrow-forward" size={18} color={C.orange} />
                    </TouchableOpacity>
                  ) : null}
                  {mode === 'results' && (hasMore || loadMoreError) ? (
                    <TouchableOpacity
                      style={styles.loadMoreButton}
                      onPress={onLoadMore}
                      testID="search-v2.load-more"
                      activeOpacity={0.82}
                      disabled={loading}
                      accessibilityRole="button"
                      accessibilityLabel={loadMoreError ? 'Retry loading search results' : 'Show more search results'}
                    >
                      {loading ? <ActivityIndicator size="small" color={C.orange} /> : null}
                      <Text style={styles.loadMoreText}>{loading ? 'Loading' : loadMoreError ? 'Try again' : 'Show more'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              )}
              ItemSeparatorComponent={() => <View style={styles.rowGap} />}
              onEndReached={() => {
                if (mode === 'results' && hasMore && !loading && !loadMoreError) onLoadMore?.();
              }}
              onEndReachedThreshold={0.35}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function SearchRowSkeleton({ styles }: { styles: ReturnType<typeof makeStyles> }) {
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

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: C.bg },
  header: {
    minHeight: 60,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
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
  searchField: {
    minHeight: 48,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.orange,
    backgroundColor: C.s1,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  input: { flex: 1, minHeight: 44, color: C.text, fontSize: 15, lineHeight: 20, fontWeight: '600', paddingVertical: 0 },
  clearButton: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    minHeight: 48,
    marginHorizontal: 16,
    paddingTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: { color: C.text2, fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.2 },
  errorBanner: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { flex: 1, color: C.text2, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  skeletonList: { paddingHorizontal: 16, gap: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 36 },
  rowGap: { height: 8 },
  guidedAction: {
    minHeight: 72,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.orange,
    backgroundColor: C.s1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  guidedIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.s2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultRow: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.s2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCopy: { flex: 1, minWidth: 0, gap: 3 },
  resultTitle: { color: C.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  resultSubtitle: { color: C.text2, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  resultTrailing: { maxWidth: 78, alignItems: 'flex-end', justifyContent: 'center', gap: 3 },
  resultTrailingText: { color: C.text3, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  skeletonIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.s2 },
  skeletonCopy: { flex: 1, gap: 8 },
  emptyState: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyText: { flex: 1, color: C.text2, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  searchAllButton: {
    minHeight: 64,
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  searchAllText: { flex: 1, color: C.orange, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  loadMoreButton: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadMoreText: { color: C.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
