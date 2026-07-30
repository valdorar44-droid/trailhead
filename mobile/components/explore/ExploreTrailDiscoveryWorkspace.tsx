import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type TrailDiscoverParams, type TrailDiscoveryItemV2 } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { mergeTrailDiscoveryItems, trailDiscoveryResponseIsCurrent } from '@/lib/trailDiscoveryWorkspace';
import { TrailDiscoveryCard } from './TrailDiscoveryCard';

export type TrailDiscoveryScopeV2 = 'nearby' | 'along_trip';

export type TrailDiscoveryFiltersV2 = {
  activity: string[];
  difficulty: string[];
  routeShape: string[];
  permittedUse: string[];
  downloadable: boolean | null;
  catalog: 'verified' | 'community' | 'all';
};

export type TrailDiscoveryMapRequestV2 = {
  scope: TrailDiscoveryScopeV2 | 'view';
  query: string;
  filters: TrailDiscoveryFiltersV2;
  tripId?: string;
};

type Props = {
  visible: boolean;
  location: { lat: number; lng: number } | null;
  signedIn: boolean;
  activeTripId?: string | null;
  onClose: () => void;
  onOpenMap: (request: TrailDiscoveryMapRequestV2) => void;
  onSelectTrail: (trail: TrailDiscoveryItemV2) => void;
  onRequestLocation: () => void;
};

const EMPTY_FILTERS: TrailDiscoveryFiltersV2 = {
  activity: [], difficulty: [], routeShape: [], permittedUse: [], downloadable: null, catalog: 'verified',
};

const FILTER_GROUPS = [
  { key: 'activity' as const, title: 'Activity', values: ['Hiking', 'Biking', 'Horseback', 'OHV', '4WD'] },
  { key: 'difficulty' as const, title: 'Difficulty', values: ['Easy', 'Moderate', 'Hard'] },
  { key: 'routeShape' as const, title: 'Route shape', values: ['Loop', 'Out and back', 'Point-to-point'] },
  { key: 'permittedUse' as const, title: 'Permitted use', values: ['Hiking', 'Biking', 'Horseback', 'OHV', '4WD'] },
];

function hasFilters(filters: TrailDiscoveryFiltersV2) {
  return filters.activity.length + filters.difficulty.length + filters.routeShape.length + filters.permittedUse.length > 0
    || filters.downloadable != null || filters.catalog !== 'verified';
}

export function ExploreTrailDiscoveryWorkspace({
  visible, location, signedIn, activeTripId, onClose, onOpenMap, onSelectTrail, onRequestLocation,
}: Props) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<TrailDiscoveryScopeV2>('nearby');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<TrailDiscoveryFiltersV2>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<TrailDiscoveryFiltersV2>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<TrailDiscoveryItemV2[]>([]);
  const [mapCandidates, setMapCandidates] = useState<TrailDiscoveryItemV2[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retainedListOffset, setRetainedListOffset] = useState(0);
  const generationRef = useRef(0);
  const listRef = useRef<FlatList<TrailDiscoveryItemV2>>(null);
  const listOffsetRef = useRef(0);
  const restorePendingRef = useRef(false);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestParams = useCallback((nextCursor?: string): TrailDiscoverParams => ({
    mode: scope,
    lat: scope === 'nearby' ? location?.lat : undefined,
    lng: scope === 'nearby' ? location?.lng : undefined,
    tripId: scope === 'along_trip' ? activeTripId || undefined : undefined,
    q: query.trim() || undefined,
    cursor: nextCursor,
    limit: 24,
    activity: filters.activity,
    difficulty: filters.difficulty,
    routeShape: filters.routeShape,
    permittedUse: filters.permittedUse,
    downloadable: filters.downloadable == null ? undefined : filters.downloadable,
    catalog: filters.catalog,
    sort: 'nearby',
  }), [activeTripId, filters, location?.lat, location?.lng, query, scope]);

  const load = useCallback(async (nextCursor?: string) => {
    if (scope === 'nearby' && !location && !query.trim()) return;
    if (scope === 'along_trip' && (!signedIn || !activeTripId)) return;
    const generation = ++generationRef.current;
    nextCursor ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      const response = await api.discoverTrailSystems(requestParams(nextCursor));
      if (!trailDiscoveryResponseIsCurrent(generation, generationRef.current)) return;
      setItems(current => mergeTrailDiscoveryItems(current, response.trails || [], Boolean(nextCursor)));
      setMapCandidates(response.map_candidates || []);
      setCursor(response.next_cursor);
    } catch {
      if (!trailDiscoveryResponseIsCurrent(generation, generationRef.current)) return;
      setError(scope === 'along_trip' ? 'Could not load trails along this trip.' : 'Could not load trails in this area.');
      if (!nextCursor) {
        setItems([]);
        setMapCandidates([]);
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [activeTripId, location, query, requestParams, scope, signedIn]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => { void load(); }, query.trim() ? 220 : 0);
    return () => clearTimeout(timer);
  }, [filters, load, query, scope, visible]);

  useEffect(() => {
    if (scope === 'along_trip' && (!signedIn || !activeTripId)) setScope('nearby');
  }, [activeTripId, scope, signedIn]);

  useEffect(() => {
    listOffsetRef.current = 0;
    setRetainedListOffset(0);
    restorePendingRef.current = false;
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [filters, query, scope]);

  const restoreListOffset = useCallback(() => {
    if (!visible || !items.length || !restorePendingRef.current || listOffsetRef.current <= 0) return;
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    restoreTimerRef.current = setTimeout(() => {
      if (!visible || !restorePendingRef.current) return;
      listRef.current?.scrollToOffset({ offset: listOffsetRef.current, animated: false });
      restoreTimerRef.current = setTimeout(() => {
        restorePendingRef.current = false;
        restoreTimerRef.current = null;
      }, 160);
    }, 48);
  }, [items.length, visible]);

  useEffect(() => {
    restoreListOffset();
    return () => {
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, [restoreListOffset]);

  const resultLabel = useMemo(() => {
    if (loading) return 'Finding trails';
    if (!items.length && !mapCandidates.length) return 'No trails found';
    const count = items.length + mapCandidates.length;
    return `${count} ${count === 1 ? 'trail' : 'trails'}`;
  }, [items.length, loading, mapCandidates.length]);

  function toggleFilter(key: 'activity' | 'difficulty' | 'routeShape' | 'permittedUse', value: string) {
    setDraftFilters(current => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value],
    }));
  }

  function prepareMapReturn() {
    restorePendingRef.current = listOffsetRef.current > 0;
    setRetainedListOffset(listOffsetRef.current);
  }

  function openMap(request: TrailDiscoveryMapRequestV2) {
    prepareMapReturn();
    onOpenMap(request);
  }

  function selectTrail(trail: TrailDiscoveryItemV2) {
    prepareMapReturn();
    onSelectTrail(trail);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.screen, { backgroundColor: C.bg, paddingTop: insets.top }]} testID="explore.trails.workspace">
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <TouchableOpacity style={styles.iconButton} onPress={onClose} accessibilityLabel="Back to Explore" testID="explore.trails.back">
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={styles.heading}>
            <Text style={[styles.kicker, { color: C.orange }]}>EXPLORE</Text>
            <Text style={[styles.title, { color: C.text }]}>Trails</Text>
          </View>
          <TouchableOpacity
            style={[styles.mapButton, { borderColor: C.border }]}
            onPress={() => openMap({ scope, query, filters, tripId: activeTripId || undefined })}
            accessibilityLabel="Show trails on map"
            testID="explore.trails.map"
          >
            <Ionicons name="map-outline" size={18} color={C.orange} />
            <Text style={[styles.mapText, { color: C.text }]}>Map</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.controls}>
          <View style={[styles.search, { backgroundColor: C.s1, borderColor: C.border }]}>
            <Ionicons name="search-outline" size={19} color={C.text3} />
            <TextInput
              testID="explore.trails.search"
              value={query}
              onChangeText={setQuery}
              placeholder="Search trails or destinations"
              placeholderTextColor={C.text3}
              style={[styles.searchInput, { color: C.text }]}
              returnKeyType="search"
              autoCorrect={false}
            />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={19} color={C.text3} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.scopeRow}>
            <TouchableOpacity
              style={[styles.scopeButton, scope === 'nearby' && { backgroundColor: C.text }]}
              onPress={() => setScope('nearby')}
              testID="explore.trails.scope.nearby"
            >
              <Text style={[styles.scopeText, { color: scope === 'nearby' ? C.bg : C.text2 }]}>Nearby</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!signedIn || !activeTripId}
              style={[styles.scopeButton, scope === 'along_trip' && { backgroundColor: C.text }, (!signedIn || !activeTripId) && styles.disabled]}
              onPress={() => setScope('along_trip')}
              testID="explore.trails.scope.trip"
            >
              <Text style={[styles.scopeText, { color: scope === 'along_trip' ? C.bg : C.text2 }]}>Along Trip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterButton, { borderColor: hasFilters(filters) ? C.orange : C.border }]}
              onPress={() => { setDraftFilters(filters); setFilterOpen(true); }}
              testID="explore.trails.filters"
            >
              <Ionicons name="options-outline" size={17} color={hasFilters(filters) ? C.orange : C.text2} />
              <Text style={[styles.filterText, { color: hasFilters(filters) ? C.orange : C.text2 }]}>Filters</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.resultRow}>
            <Text style={[styles.resultCount, { color: C.text2 }]}>{resultLabel}</Text>
            {scope === 'along_trip' ? <Text style={[styles.resultContext, { color: C.text3 }]}>Along saved route</Text> : null}
          </View>
        </View>

        {!loading && scope === 'nearby' && !location && !query.trim() ? (
          <View style={styles.state}>
            <Ionicons name="location-outline" size={30} color={C.orange} />
            <Text style={[styles.stateTitle, { color: C.text }]}>Location is off</Text>
            <Text style={[styles.stateText, { color: C.text2 }]}>Search by name, or turn on location to see nearby trails.</Text>
            <TouchableOpacity style={[styles.retry, { backgroundColor: C.orange }]} onPress={onRequestLocation} testID="explore.trails.location">
              <Text style={styles.retryText}>Use my location</Text>
            </TouchableOpacity>
          </View>
        ) : loading ? (
          <View style={styles.state} testID="explore.trails.loading">
            <ActivityIndicator color={C.orange} />
            <Text style={[styles.stateText, { color: C.text2 }]}>Finding trails…</Text>
          </View>
        ) : error ? (
          <View style={styles.state} testID="explore.trails.error">
            <Ionicons name="cloud-offline-outline" size={30} color={C.orange} />
            <Text style={[styles.stateTitle, { color: C.text }]}>Trails unavailable</Text>
            <Text style={[styles.stateText, { color: C.text2 }]}>{error}</Text>
            <TouchableOpacity style={[styles.retry, { backgroundColor: C.orange }]} onPress={() => void load()}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : !items.length ? (
          <View style={styles.state} testID="explore.trails.empty">
            <Ionicons name="trail-sign-outline" size={30} color={C.orange} />
            <Text style={[styles.stateTitle, { color: C.text }]}>{mapCandidates.length ? 'More trails are on the map' : 'No trails found'}</Text>
            <Text style={[styles.stateText, { color: C.text2 }]}>{mapCandidates.length ? 'Open Map to view nearby trail records.' : 'Try a wider area or fewer filters.'}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            testID="explore.trails.list"
            data={items}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            contentOffset={{ x: 0, y: retainedListOffset }}
            renderItem={({ item }) => (
              <TrailDiscoveryCard item={item} onPress={() => selectTrail(item)} testID={`explore.trails.result.${item.id}`} />
            )}
            onEndReached={() => { if (cursor && !loadingMore) void load(cursor); }}
            onEndReachedThreshold={0.4}
            onScroll={event => {
              if (!visible || restorePendingRef.current) return;
              listOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            onContentSizeChange={restoreListOffset}
            scrollEventThrottle={120}
            ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={C.orange} /> : null}
          />
        )}

        <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
          <View style={styles.overlay}>
            <View style={[styles.filterSheet, { backgroundColor: C.s1, paddingBottom: Math.max(insets.bottom, 18) }]}>
              <View style={styles.filterHeader}>
                <Text style={[styles.filterTitle, { color: C.text }]}>Trail filters</Text>
                <TouchableOpacity style={styles.iconButton} onPress={() => setFilterOpen(false)} accessibilityLabel="Close filters">
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.filterScroll} showsVerticalScrollIndicator={false}>
                {FILTER_GROUPS.map(group => (
                  <View key={group.key} style={styles.group}>
                    <Text style={[styles.groupTitle, { color: C.text2 }]}>{group.title}</Text>
                    {group.values.map(value => {
                      const selected = draftFilters[group.key].includes(value);
                      return (
                        <TouchableOpacity key={value} style={styles.filterRow} onPress={() => toggleFilter(group.key, value)}>
                          <Text style={[styles.rowLabel, { color: C.text }]}>{value}</Text>
                          <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? C.orange : C.text3} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.filterRow}
                  onPress={() => setDraftFilters(current => ({ ...current, downloadable: current.downloadable === true ? null : true }))}
                >
                  <Text style={[styles.rowLabel, { color: C.text }]}>Downloadable route</Text>
                  <Ionicons name={draftFilters.downloadable ? 'checkbox' : 'square-outline'} size={22} color={draftFilters.downloadable ? C.orange : C.text3} />
                </TouchableOpacity>
                <View style={styles.group}>
                  <Text style={[styles.groupTitle, { color: C.text2 }]}>Catalog</Text>
                  {([
                    ['verified', 'Verified trails'],
                    ['community', 'Community routes'],
                    ['all', 'All trails'],
                  ] as const).map(([value, label]) => (
                    <TouchableOpacity
                      key={value}
                      style={styles.filterRow}
                      onPress={() => setDraftFilters(current => ({ ...current, catalog: value }))}
                    >
                      <Text style={[styles.rowLabel, { color: C.text }]}>{label}</Text>
                      <Ionicons name={draftFilters.catalog === value ? 'radio-button-on' : 'radio-button-off'} size={22} color={draftFilters.catalog === value ? C.orange : C.text3} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.filterActions}>
                <TouchableOpacity style={[styles.clearButton, { borderColor: C.border }]} onPress={() => setDraftFilters(EMPTY_FILTERS)}>
                  <Text style={[styles.clearText, { color: C.text }]}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.applyButton, { backgroundColor: C.orange }]} onPress={() => { setFilters(draftFilters); setFilterOpen(false); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }}>
                  <Text style={styles.applyText}>Show trails</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1 },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 31, lineHeight: 32 },
  mapButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 7 },
  mapText: { fontSize: 13, fontWeight: '800' },
  controls: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },
  search: { minHeight: 50, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scopeButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  scopeText: { fontSize: 13, fontWeight: '800' },
  filterButton: { marginLeft: 'auto', minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  filterText: { fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.38 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 22 },
  resultCount: { fontSize: 13, fontWeight: '700' },
  resultContext: { fontSize: 12 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  more: { marginVertical: 18 },
  state: { flex: 1, minHeight: 280, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateTitle: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 25, textAlign: 'center' },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { minHeight: 46, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  filterSheet: { maxHeight: '92%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  filterTitle: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 28 },
  filterScroll: { flexShrink: 1 },
  group: { marginTop: 10 },
  groupTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5, marginBottom: 2 },
  filterRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 15 },
  filterActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  clearButton: { minHeight: 48, width: 96, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 14, fontWeight: '900' },
  applyButton: { minHeight: 48, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
