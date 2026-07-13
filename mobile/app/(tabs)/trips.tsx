import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { useStore, type SavedPlace } from '@/lib/store';
import { useProductFeatures } from '@/lib/useProductFeatures';
import PlanWorkspaceSwitcher from '@/components/plan/PlanWorkspaceSwitcher';
import {
  useTripRepositorySnapshot,
  type SavedEntityV1,
  type TripNoteInput,
  type TripNoteV1,
} from '@/lib/tripRepository';
import AvailabilityWatchManager from '@/components/trips/AvailabilityWatchManager';
import SavedItemsSection from '@/components/trips/SavedItemsSection';
import TripActionSheet from '@/components/trips/TripActionSheet';
import TripCard, { TripPreview } from '@/components/trips/TripCard';
import TripFilterSegment from '@/components/trips/TripFilterSegment';
import TripNotesSheet from '@/components/trips/TripNotesSheet';
import {
  archiveLibraryTrip,
  deleteLibraryDrafts,
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
  const setTabBarHidden = useStore(state => state.setTabBarHidden);

  const [snapshot, setSnapshot] = useState<TripLibrarySnapshot>(EMPTY_SNAPSHOT);
  const [filter, setFilter] = useState<TripLibraryFilter>('draft');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<TripLibraryItem | null>(null);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notesTripId, setNotesTripId] = useState<string | null>(null);
  const [visibleTripCount, setVisibleTripCount] = useState(TRIP_RENDER_BATCH);
  const [notice, setNotice] = useState('');
  const [selectingDrafts, setSelectingDrafts] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(() => new Set());
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] = useState(false);
  const [deletingDrafts, setDeletingDrafts] = useState(false);
  const requestSequence = useRef(0);
  const expectedOwnerScope = userId ? `account:${String(userId)}` : 'anonymous';
  const repositoryReady = repository.initialized && repository.ownerScope === expectedOwnerScope;
  const { features } = useProductFeatures();
  const publicationEnabled = Boolean(userId && features?.community_publications);
  const availabilityEnabled = Boolean(userId && features?.availability_monitors);

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
  }, [refresh, userId]));

  useEffect(() => {
    if (!repositoryReady) {
      setLoading(true);
      setSnapshot(EMPTY_SNAPSHOT);
      setActionSheetVisible(false);
      setNotesTripId(null);
      setSelectingDrafts(false);
      setSelectedDraftIds(new Set());
      setDeleteConfirmationVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      void refreshTripLibraryFromSource()
        .catch(() => {})
        .then(() => refresh('silent'));
    }, 60);
    return () => clearTimeout(timer);
  }, [activeTripId, refresh, repository.ownerScope, repository.revision, repositoryReady]);

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
  useEffect(() => {
    setTabBarHidden(selectingDrafts);
    return () => setTabBarHidden(false);
  }, [selectingDrafts, setTabBarHidden]);
  const draftTrips = useMemo(
    () => snapshot.trips.filter(trip => trip.status === 'draft'),
    [snapshot.trips],
  );
  const selectedDrafts = useMemo(
    () => draftTrips.filter(trip => selectedDraftIds.has(trip.id)),
    [draftTrips, selectedDraftIds],
  );
  useEffect(() => {
    const availableIds = new Set(draftTrips.map(trip => trip.id));
    setSelectedDraftIds(current => {
      const next = new Set([...current].filter(id => availableIds.has(id)));
      return next.size === current.size && [...current].every(id => next.has(id))
        ? current
        : next;
    });
  }, [draftTrips]);
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
      `${trip.name} will be permanently removed from your Trailhead account.`,
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

  const browseExplore = useCallback(() => router.push('/(tabs)/guide'), [router]);

  const beginDraftSelection = useCallback(() => {
    setFilter('draft');
    setSelectedDraftIds(new Set());
    setSelectingDrafts(true);
  }, []);

  const cancelDraftSelection = useCallback(() => {
    if (deletingDrafts) return;
    setDeleteConfirmationVisible(false);
    setSelectedDraftIds(new Set());
    setSelectingDrafts(false);
  }, [deletingDrafts]);

  const toggleDraftSelection = useCallback((id: string) => {
    setSelectedDraftIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllDrafts = useCallback(() => {
    setSelectedDraftIds(current => current.size === draftTrips.length
      ? new Set()
      : new Set(draftTrips.map(trip => trip.id)));
  }, [draftTrips]);

  const deleteSelectedDrafts = useCallback(async () => {
    if (selectedDrafts.length === 0 || deletingDrafts) return;
    setDeletingDrafts(true);
    try {
      const deletedIds = await deleteLibraryDrafts(selectedDrafts);
      setDeleteConfirmationVisible(false);
      setSelectedDraftIds(new Set());
      setSelectingDrafts(false);
      setNotice(`${deletedIds.length} ${deletedIds.length === 1 ? 'draft' : 'drafts'} deleted.`);
      await refresh('silent');
    } catch (error: any) {
      setDeleteConfirmationVisible(false);
      Alert.alert('Drafts not deleted', error?.message || 'Refresh and try again.');
      await refresh('silent');
    } finally {
      setDeletingDrafts(false);
    }
  }, [deletingDrafts, refresh, selectedDrafts]);

  if (selectingDrafts) {
    const selectedCount = selectedDrafts.length;
    const allSelected = draftTrips.length > 0 && selectedCount === draftTrips.length;
    return (
      <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: C.bg }]}>
        <View style={[styles.selectionHeader, { borderBottomColor: C.border }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={allSelected ? 'Clear draft selection' : 'Select all drafts'}
            activeOpacity={0.7}
            disabled={deletingDrafts || draftTrips.length === 0}
            onPress={selectAllDrafts}
            style={styles.selectionHeaderAction}
          >
            <Text style={[styles.selectionHeaderActionText, { color: C.orange }]}>
              {allSelected ? 'Clear' : 'Select all'}
            </Text>
          </TouchableOpacity>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.selectionCount, { color: C.text }]}
          >
            {selectedCount} selected
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancel draft selection"
            activeOpacity={0.7}
            disabled={deletingDrafts}
            onPress={cancelDraftSelection}
            style={[styles.selectionHeaderAction, styles.selectionCancel]}
          >
            <Text style={[styles.selectionHeaderActionText, { color: C.orange }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={draftTrips}
          keyExtractor={trip => trip.id}
          extraData={selectedDraftIds}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.selectionList,
            { paddingBottom: Math.max(insets.bottom + 108, 124) },
          ]}
          renderItem={({ item }) => (
            <DraftSelectionRow
              trip={item}
              selected={selectedDraftIds.has(item.id)}
              disabled={deletingDrafts}
              onPress={() => toggleDraftSelection(item.id)}
            />
          )}
        />
        <View style={[
          styles.selectionTray,
          {
            backgroundColor: C.s1,
            borderTopColor: C.border,
            paddingBottom: Math.max(insets.bottom, 14),
          },
        ]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={selectedCount > 0
              ? `Delete ${selectedCount} ${selectedCount === 1 ? 'draft' : 'drafts'}`
              : 'Select drafts to delete'}
            accessibilityState={{ disabled: selectedCount === 0 || deletingDrafts }}
            activeOpacity={0.82}
            disabled={selectedCount === 0 || deletingDrafts}
            onPress={() => setDeleteConfirmationVisible(true)}
            style={[
              styles.deleteSelectionButton,
              { backgroundColor: selectedCount > 0 ? C.red : C.border2 },
            ]}
          >
            {deletingDrafts ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="trash-outline" size={18} color={selectedCount > 0 ? '#FFFFFF' : C.text3} />
            )}
            <Text style={[
              styles.deleteSelectionLabel,
              { color: selectedCount > 0 ? '#FFFFFF' : C.text3 },
            ]}>
              {selectedCount > 0
                ? `Delete ${selectedCount} ${selectedCount === 1 ? 'draft' : 'drafts'}`
                : 'Delete drafts'}
            </Text>
          </TouchableOpacity>
        </View>
        <DeleteDraftsConfirmation
          count={selectedCount}
          visible={deleteConfirmationVisible}
          busy={deletingDrafts}
          onCancel={() => !deletingDrafts && setDeleteConfirmationVisible(false)}
          onDelete={() => void deleteSelectedDrafts()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: C.bg }]}>
      <ScrollView
        style={styles.screen}
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
            paddingTop: 14,
            paddingBottom: Math.max(insets.bottom + 106, 122),
          },
        ]}
      >
        <View style={styles.content}>
          <View style={styles.pageHeader}>
            <Text style={[styles.pageTitle, { color: C.text }]}>Plan</Text>
          </View>
          <PlanWorkspaceSwitcher active="trips" style={styles.planWorkspaceSwitcher} />

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

          {loading || snapshot.activeTrip ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>In progress</Text>
              {loading ? (
                <LoadingTrip />
              ) : snapshot.activeTrip ? (
                <TripCard trip={snapshot.activeTrip} active onOpen={openTrip} onMore={openActions} />
              ) : null}
            </View>
          ) : null}

          <View style={styles.section}>
            <TripFilterSegment
              value={filter}
              counts={snapshot.counts}
              onChange={setFilter}
              onSelectDrafts={beginDraftSelection}
            />
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
                    style={styles.showMoreButton}
                  >
                    <Text style={[styles.showMoreText, { color: C.text2 }]}>Show more</Text>
                    <Ionicons name="chevron-down" size={16} color={C.text2} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>

          {repositoryReady ? (
            <>
              {availabilityEnabled ? (
                <AvailabilityWatchManager signedIn={Boolean(userId)} knownActiveCount={knownActiveWatchCount} />
              ) : null}
              {snapshot.savedItems.length > 0 ? (
                <SavedItemsSection items={snapshot.savedItems} onOpen={openSavedItem} onBrowse={browseExplore} />
              ) : null}
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
    </SafeAreaView>
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

function draftUpdatedLabel(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startToday - startDate) / 86_400_000);
  if (dayDifference <= 0) return 'Today';
  if (dayDifference === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function DraftSelectionRow({
  trip,
  selected,
  disabled,
  onPress,
}: {
  trip: TripLibraryItem;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const C = useTheme();
  const stopLabel = `${trip.stopCount} ${trip.stopCount === 1 ? 'stop' : 'stops'}`;
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityLabel={`${trip.name}. ${stopLabel}. ${draftUpdatedLabel(trip.updatedAt)}`}
      accessibilityState={{ checked: selected, disabled }}
      activeOpacity={0.72}
      disabled={disabled}
      onPress={onPress}
      style={[styles.selectionRow, { borderBottomColor: C.border }]}
    >
      <View style={[
        styles.checkbox,
        {
          backgroundColor: selected ? C.orange : 'transparent',
          borderColor: selected ? C.orange : C.text2,
        },
      ]}>
        {selected ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
      </View>
      <View style={[styles.selectionThumbnail, { borderColor: C.border, backgroundColor: C.s2 }]}>
        <TripPreview trip={trip} height={52} />
      </View>
      <View style={styles.selectionRowCopy}>
        <Text style={[styles.selectionRowTitle, { color: C.text }]} numberOfLines={2}>{trip.name}</Text>
        <Text style={[styles.selectionRowMeta, { color: C.text2 }]} numberOfLines={1}>
          {stopLabel} · {draftUpdatedLabel(trip.updatedAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function DeleteDraftsConfirmation({
  count,
  visible,
  busy,
  onCancel,
  onDelete,
}: {
  count: number;
  visible: boolean;
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const label = count === 1 ? 'draft' : 'drafts';
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.confirmationRoot}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Cancel deletion"
          activeOpacity={1}
          disabled={busy}
          onPress={onCancel}
          style={styles.confirmationScrim}
        />
        <View style={[
          styles.confirmationSheet,
          { backgroundColor: C.s1, paddingBottom: Math.max(insets.bottom, 18) },
        ]}>
          <View style={[styles.sheetHandle, { backgroundColor: C.border2 }]} />
          <Text style={[styles.confirmationTitle, { color: C.text }]}>Delete {count} {label}?</Text>
          <Text style={[styles.confirmationBody, { color: C.text2 }]}>
            They&apos;ll be permanently removed from your Trailhead account. Saved and archived trips stay in your library.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            activeOpacity={0.78}
            disabled={busy}
            onPress={onCancel}
            style={[styles.confirmationCancel, { backgroundColor: C.s2, borderColor: C.border }]}
          >
            <Text style={[styles.confirmationCancelLabel, { color: C.text }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Delete ${count} ${label}`}
            activeOpacity={0.82}
            disabled={busy}
            onPress={onDelete}
            style={[styles.confirmationDelete, { backgroundColor: C.red }]}
          >
            {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <Text style={styles.confirmationDeleteLabel}>Delete {count} {label}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
    gap: 24,
  },
  planWorkspaceSwitcher: {
    paddingHorizontal: 0,
    marginTop: -8,
    marginBottom: 2,
  },
  pageHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pageTitle: {
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: 0,
  },
  notice: {
    minHeight: 44,
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
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: 0,
  },
  tripList: {
    gap: 0,
  },
  showMoreButton: {
    minHeight: 44,
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
  loadingTrip: {
    minHeight: 78,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  selectionHeader: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  selectionHeaderAction: {
    width: 92,
    minHeight: 44,
    justifyContent: 'center',
  },
  selectionCancel: {
    alignItems: 'flex-end',
  },
  selectionHeaderActionText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  selectionCount: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  selectionList: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 16,
  },
  selectionRow: {
    minHeight: 74,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionThumbnail: {
    width: 52,
    height: 52,
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
  },
  selectionRowCopy: {
    minWidth: 0,
    flex: 1,
  },
  selectionRowTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    letterSpacing: 0,
  },
  selectionRowMeta: {
    marginTop: 3,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '500',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  selectionTray: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  deleteSelectionButton: {
    minHeight: 52,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteSelectionLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
  confirmationRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  confirmationScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  confirmationSheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  confirmationTitle: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: 0,
  },
  confirmationBody: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400',
    letterSpacing: 0,
  },
  confirmationCancel: {
    minHeight: 52,
    marginTop: 24,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmationCancelLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
  confirmationDelete: {
    minHeight: 52,
    marginTop: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmationDeleteLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
