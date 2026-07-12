import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { useStore, type SavedPlace } from '@/lib/store';
import { useProductFeatures } from '@/lib/useProductFeatures';
import {
  useTripRepositorySnapshot,
  type SavedEntityV1,
  type TripNoteInput,
  type TripNoteV1,
} from '@/lib/tripRepository';
import AvailabilityWatchManager from '@/components/trips/AvailabilityWatchManager';
import SavedItemsSection from '@/components/trips/SavedItemsSection';
import TripActionSheet from '@/components/trips/TripActionSheet';
import TripCard from '@/components/trips/TripCard';
import TripFilterSegment from '@/components/trips/TripFilterSegment';
import TripNotesSheet from '@/components/trips/TripNotesSheet';
import {
  archiveLibraryTrip,
  deleteLibraryTrip,
  deleteLibraryTripNote,
  duplicateLibraryTrip,
  exportLibraryTrip,
  initializeTripLibrary,
  loadTripLibrarySnapshot,
  openLibraryTrip,
  refreshTripLibraryFromSource,
  restoreLibraryTrip,
  saveLibraryTrip,
  saveLibraryTripNote,
} from '@/components/trips/trip-library-adapter';
import type {
  TripAction,
  TripLibraryFilter,
  TripLibraryItem,
  TripLibrarySnapshot,
} from '@/components/trips/types';

const EMPTY_SNAPSHOT: TripLibrarySnapshot = {
  activeTrip: null,
  trips: [],
  savedItems: [],
  counts: { draft: 0, saved: 0, archived: 0 },
};

const TRIP_RENDER_BATCH = 10;

export default function TripsScreen() {
  const C = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const repository = useTripRepositorySnapshot();
  const activeTripId = useStore(state => state.activeTrip?.trip_id ?? '');
  const userId = useStore(state => state.user?.id ?? '');
  const setPendingMapSelection = useStore(state => state.setPendingMapSelection);

  const [snapshot, setSnapshot] = useState<TripLibrarySnapshot>(EMPTY_SNAPSHOT);
  const [filter, setFilter] = useState<TripLibraryFilter>('saved');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<TripLibraryItem | null>(null);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notesTripId, setNotesTripId] = useState<string | null>(null);
  const [visibleTripCount, setVisibleTripCount] = useState(TRIP_RENDER_BATCH);
  const [notice, setNotice] = useState('');
  const requestSequence = useRef(0);
  const expectedOwnerScope = userId ? `account:${String(userId)}` : 'anonymous';
  const repositoryReady = repository.initialized && repository.ownerScope === expectedOwnerScope;
  const { features, loading: featuresLoading } = useProductFeatures();
  const tripsEnabled = Boolean(features?.trips_tab);
  const publicationEnabled = Boolean(userId && features?.community_publications);
  const availabilityEnabled = Boolean(userId && features?.availability_monitors);

  useEffect(() => {
    if (!featuresLoading && !tripsEnabled) router.replace('/(tabs)/guide');
  }, [featuresLoading, router, tripsEnabled]);

  const refresh = useCallback(async (mode: 'loading' | 'refreshing' | 'silent' = 'loading') => {
    const request = ++requestSequence.current;
    if (mode === 'refreshing') setRefreshing(true);
    else if (mode === 'loading') setLoading(true);
    try {
      const state = useStore.getState();
      const next = await loadTripLibrarySnapshot({
        activeTrip: state.activeTrip,
      });
      if (request === requestSequence.current) setSnapshot(next);
    } catch {
      if (request === requestSequence.current) setSnapshot(previous => previous);
    } finally {
      if (request === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!tripsEnabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const ready = await initializeTripLibrary(userId || null);
        if (cancelled || !ready) {
          if (!cancelled) setLoading(true);
          return;
        }
        await refreshTripLibraryFromSource();
        await refresh('loading');
      } catch {
        if (!cancelled) await refresh('loading');
      }
    })();
    return () => { cancelled = true; };
  }, [refresh, tripsEnabled, userId]));

  useEffect(() => {
    if (!tripsEnabled) return;
    if (!repositoryReady) {
      setLoading(true);
      setSnapshot(EMPTY_SNAPSHOT);
      setActionSheetVisible(false);
      setNotesTripId(null);
      return;
    }
    const timer = setTimeout(() => {
      void refreshTripLibraryFromSource()
        .catch(() => {})
        .then(() => refresh('silent'));
    }, 60);
    return () => clearTimeout(timer);
  }, [activeTripId, refresh, repository.ownerScope, repository.revision, repositoryReady, tripsEnabled]);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (!repositoryReady) return;
      await refreshTripLibraryFromSource();
      await refresh('silent');
    } finally {
      setRefreshing(false);
    }
  }, [refresh, repositoryReady]);

  const syncMessage = useMemo(() => {
    const sync = repository.sync;
    if (sync.state === 'offline' && sync.pendingCount > 0) {
      return 'Changes are saved here and will sync when you are back online.';
    }
    return '';
  }, [repository.sync]);

  const filteredTrips = useMemo(
    () => snapshot.trips.filter(trip => trip.status === filter),
    [filter, snapshot.trips],
  );
  const visibleTrips = useMemo(
    () => filteredTrips.slice(0, visibleTripCount),
    [filteredTrips, visibleTripCount],
  );
  useEffect(() => {
    setVisibleTripCount(TRIP_RENDER_BATCH);
  }, [filter, expectedOwnerScope]);
  const notesTrip = useMemo(
    () => notesTripId ? repository.trips.find(trip => trip.id === notesTripId) ?? null : null,
    [notesTripId, repository.trips],
  );
  const knownActiveWatchCount = useMemo(() => {
    const items = snapshot.activeTrip ? [snapshot.activeTrip, ...snapshot.trips] : snapshot.trips;
    return items.reduce((total, trip) => total + trip.activeMonitorCount, 0);
  }, [snapshot.activeTrip, snapshot.trips]);

  const openActions = useCallback((trip: TripLibraryItem) => {
    setSelectedTrip(trip);
    setActionSheetVisible(true);
  }, []);

  const openTrip = useCallback(async (trip: TripLibraryItem) => {
    setBusy(true);
    try {
      await openLibraryTrip(trip);
      setActionSheetVisible(false);
      router.push('/(tabs)/map');
    } catch (error: any) {
      Alert.alert('Trip unavailable', error?.message || 'This trip could not be opened. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [router]);

  const performAction = useCallback(async (action: TripAction, trip: TripLibraryItem) => {
    if (action === 'open') {
      await openTrip(trip);
      return;
    }
    if (action === 'notes') return;
    setBusy(true);
    try {
      switch (action) {
        case 'duplicate':
          await duplicateLibraryTrip(trip);
          setNotice('Copy added to Drafts.');
          break;
        case 'save':
          await saveLibraryTrip(trip);
          setNotice('Trip saved.');
          break;
        case 'archive':
          await archiveLibraryTrip(trip);
          setNotice('Trip moved to Archived.');
          break;
        case 'restore':
          await restoreLibraryTrip(trip);
          setNotice('Trip restored to Saved.');
          break;
        case 'export':
          await exportLibraryTrip(trip);
          break;
        case 'delete':
          await deleteLibraryTrip(trip);
          setNotice('Trip deleted.');
          break;
      }
      setActionSheetVisible(false);
      await refresh('silent');
    } catch (error: any) {
      Alert.alert('Action unavailable', error?.message || 'That trip could not be updated. Try again.');
    } finally {
      setBusy(false);
    }
  }, [openTrip, refresh]);

  const handleAction = useCallback((action: TripAction, trip: TripLibraryItem) => {
    if (action === 'notes') {
      setActionSheetVisible(false);
      setNotesTripId(trip.id);
      return;
    }
    if (action !== 'delete') {
      void performAction(action, trip);
      return;
    }
    setActionSheetVisible(false);
    Alert.alert(
      'Delete trip?',
      `${trip.name} will be removed from your trips. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void performAction('delete', trip) },
      ],
    );
  }, [performAction]);

  const saveNote = useCallback(async (input: TripNoteInput) => {
    if (!notesTrip) throw new Error('This trip is no longer in your library.');
    await saveLibraryTripNote(notesTrip, input);
    setNotice('Private note saved.');
    await refresh('silent');
  }, [notesTrip, refresh]);

  const deleteNote = useCallback(async (note: TripNoteV1) => {
    if (!notesTrip) throw new Error('This trip is no longer in your library.');
    await deleteLibraryTripNote(notesTrip, note);
    setNotice('Private note deleted.');
    await refresh('silent');
  }, [notesTrip, refresh]);

  const openSavedItem = useCallback(async (item: SavedEntityV1) => {
    if (item.coordinates) {
      const icon: SavedPlace['icon'] = item.kind === 'camp'
        ? 'camp'
        : item.kind === 'water'
          ? 'water'
          : item.kind === 'fuel'
            ? 'fuel'
            : 'pin';
      const place: SavedPlace = {
        id: item.id,
        name: item.title,
        lat: item.coordinates.lat,
        lng: item.coordinates.lng,
        icon,
        note: item.note || item.summary,
        trailId: item.kind === 'trail' ? item.sourceId || item.id : undefined,
        sourceLabel: item.source,
        createdAt: item.createdAt,
      };
      if (item.kind === 'trail') setPendingMapSelection({ kind: 'trail', trail: place });
      else setPendingMapSelection({ kind: 'place', place });
      router.push('/(tabs)/map');
      return;
    }
    const destination = item.bookingUrl || item.sourceUrl;
    if (destination) {
      try {
        await Linking.openURL(destination);
      } catch {
        Alert.alert('Link unavailable', 'This saved link could not be opened right now.');
      }
      return;
    }
    router.push('/(tabs)/guide');
  }, [router, setPendingMapSelection]);

  const startPlanning = useCallback(() => router.push('/(tabs)/plan'), [router]);
  const browseExplore = useCallback(() => router.push('/(tabs)/guide'), [router]);

  if (!tripsEnabled) {
    return <View style={[styles.screen, { backgroundColor: C.bg }]} />;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.bg }]}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void pullToRefresh()}
          tintColor={C.orange}
          colors={[C.orange]}
        />
      )}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: Platform.OS === 'ios' ? 14 : Math.max(insets.top, 18) + 8,
          paddingBottom: Math.max(insets.bottom + 106, 122),
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.pageHeader}>
          <View style={styles.pageHeaderCopy}>
            <Text style={[styles.pageTitle, { color: C.text }]}>Trips</Text>
            <Text style={[styles.pageSubtitle, { color: C.text2 }]}>Plans, places, and bookings in one place</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Create a new trip"
            activeOpacity={0.78}
            onPress={startPlanning}
            style={[styles.createButton, { backgroundColor: C.orange, borderColor: C.orange }]}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {notice ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${notice} Dismiss`}
            activeOpacity={0.76}
            onPress={() => setNotice('')}
            style={[styles.notice, { borderTopColor: C.border, borderBottomColor: C.border }]}
          >
            <Ionicons name="checkmark-circle-outline" size={17} color={C.green} />
            <Text style={[styles.noticeText, { color: C.text2 }]}>{notice}</Text>
            <Ionicons name="close" size={16} color={C.text3} />
          </TouchableOpacity>
        ) : null}

        {syncMessage ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.syncNotice, { borderTopColor: C.border, borderBottomColor: C.border }]}
          >
            <Ionicons
              name="cloud-offline-outline"
              size={17}
              color={C.text3}
            />
            <Text style={[styles.syncNoticeText, { color: C.text2 }]}>{syncMessage}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeading title="Underway" subtitle="The trip Trailhead opens across Plan and Map" />
          {loading ? (
            <LoadingTrip />
          ) : snapshot.activeTrip ? (
            <TripCard trip={snapshot.activeTrip} active onOpen={openTrip} onMore={openActions} />
          ) : (
            <View style={[styles.noActive, { borderTopColor: C.border, borderBottomColor: C.border }] }>
              <View style={[styles.noActiveIcon, { backgroundColor: C.s2, borderColor: C.border }] }>
                <Ionicons name="navigate-outline" size={20} color={C.text3} />
              </View>
              <View style={styles.noActiveCopy}>
                <Text style={[styles.noActiveTitle, { color: C.text }]}>No trip underway</Text>
                <Text style={[styles.noActiveBody, { color: C.text2 }]}>Open a saved trip or begin a new plan.</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Start planning a trip"
                activeOpacity={0.76}
                onPress={startPlanning}
                style={[styles.inlineAction, { borderColor: C.border2 }]}
              >
                <Ionicons name="add" size={16} color={C.orange} />
                <Text style={[styles.inlineActionText, { color: C.text }]}>Start</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <SectionHeading title="Trip library" subtitle="Keep unfinished work separate from saved routes" />
          <TripFilterSegment value={filter} counts={snapshot.counts} onChange={setFilter} />
          {loading ? (
            <LoadingTrip />
          ) : filteredTrips.length > 0 ? (
            <View style={styles.tripList}>
              {visibleTrips.map(trip => (
                <TripCard key={trip.id} trip={trip} onOpen={openTrip} onMore={openActions} />
              ))}
              {visibleTrips.length < filteredTrips.length ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Show more ${filter} trips`}
                  activeOpacity={0.74}
                  onPress={() => setVisibleTripCount(count => count + TRIP_RENDER_BATCH)}
                  style={[styles.showMoreButton, { borderColor: C.border2 }]}
                >
                  <Text style={[styles.showMoreText, { color: C.text2 }]}>Show more trips</Text>
                  <Ionicons name="chevron-down" size={16} color={C.text2} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <LibraryMessage filter={filter} onPlan={startPlanning} />
          )}
        </View>

        {repositoryReady ? (
          <>
            {availabilityEnabled ? (
              <AvailabilityWatchManager signedIn={Boolean(userId)} knownActiveCount={knownActiveWatchCount} />
            ) : null}
            <SavedItemsSection items={snapshot.savedItems} onOpen={openSavedItem} onBrowse={browseExplore} />
          </>
        ) : null}
      </View>

      <TripActionSheet
        trip={selectedTrip}
        visible={actionSheetVisible}
        busy={busy}
        onClose={() => !busy && setActionSheetVisible(false)}
        onAction={handleAction}
      />
      <TripNotesSheet
        trip={notesTrip}
        visible={Boolean(notesTrip)}
        publicationEnabled={publicationEnabled && Boolean(userId)}
        onClose={() => setNotesTripId(null)}
        onSave={saveNote}
        onDelete={deleteNote}
      />
    </ScrollView>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const C = useTheme();
  return (
    <View>
      <Text style={[styles.sectionTitle, { color: C.text }]}>{title}</Text>
      <Text style={[styles.sectionSubtitle, { color: C.text2 }]}>{subtitle}</Text>
    </View>
  );
}

function LoadingTrip() {
  const C = useTheme();
  return (
    <View style={[styles.loadingTrip, { borderColor: C.border, backgroundColor: C.s1 }] }>
      <ActivityIndicator size="small" color={C.orange} />
      <Text style={[styles.loadingText, { color: C.text2 }]}>Loading trips</Text>
    </View>
  );
}

function LibraryMessage({ filter, onPlan }: { filter: TripLibraryFilter; onPlan: () => void }) {
  const C = useTheme();
  const copy = filter === 'draft'
    ? 'Trips you duplicate or leave unfinished will stay here.'
    : filter === 'archived'
      ? 'Archived trips stay out of the way until you restore them.'
      : 'Your active trip is shown above. Save another route when it is ready.';
  return (
    <View style={[styles.libraryMessage, { borderTopColor: C.border, borderBottomColor: C.border }] }>
      <Ionicons
        name={filter === 'archived' ? 'archive-outline' : filter === 'draft' ? 'create-outline' : 'bookmark-outline'}
        size={18}
        color={C.text3}
      />
      <Text style={[styles.libraryMessageText, { color: C.text2 }]}>{copy}</Text>
      {filter !== 'archived' ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open Plan"
          activeOpacity={0.74}
          onPress={onPlan}
          style={styles.textAction}
        >
          <Text style={[styles.textActionLabel, { color: C.orange }]}>Plan</Text>
          <Ionicons name="arrow-forward" size={14} color={C.orange} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    gap: 30,
  },
  pageHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pageHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: 0,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0,
  },
  createButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    minHeight: 44,
    marginTop: -15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
  },
  noticeText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
  syncNotice: {
    minHeight: 48,
    marginTop: -15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 7,
  },
  syncNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  noActive: {
    minHeight: 72,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
  },
  noActiveIcon: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noActiveCopy: {
    flex: 1,
    minWidth: 0,
  },
  noActiveTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  noActiveBody: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  inlineAction: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 11,
  },
  inlineActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  tripList: {
    gap: 12,
  },
  showMoreButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  showMoreText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  libraryMessage: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  libraryMessageText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  textAction: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  textActionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  loadingTrip: {
    minHeight: 92,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
