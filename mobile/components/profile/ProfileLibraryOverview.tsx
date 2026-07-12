import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TrailheadCard, TrailheadMetricRow } from '@/components/TrailheadUI';
import { mono, useTheme } from '@/lib/design';
import type { ColorPalette } from '@/lib/design';
import { useTripRepositorySnapshot } from '@/lib/tripRepository';
import { useStore } from '@/lib/store';

type LibraryOverviewProps = {
  savedTripCount: number;
  offlineTripCount: number;
  offlineOnlyCount: number;
  savedCampCount: number;
  savedPlaceCount: number;
  importedRouteCount: number;
  importedPinCount: number;
  onOpenDownloads: () => void;
  onPlanTrip: () => void;
};

export default function ProfileLibraryOverview({
  savedTripCount,
  offlineTripCount,
  offlineOnlyCount,
  savedCampCount,
  savedPlaceCount,
  importedRouteCount,
  importedPinCount,
  onOpenDownloads,
  onPlanTrip,
}: LibraryOverviewProps) {
  const C = useTheme();
  const s = styles(C);
  const repository = useTripRepositorySnapshot();
  const accountId = useStore(state => state.user?.id ?? null);
  const expectedScope = accountId == null ? 'anonymous' : `account:${accountId}`;
  const canonicalReady = repository.initialized && repository.ownerScope === expectedScope;
  const canonicalTripCount = repository.trips.filter(trip => trip.status !== 'archived').length;
  const canonicalCampCount = repository.savedEntities.filter(item => item.kind === 'camp').length;
  const canonicalPlaceCount = repository.savedEntities.length - canonicalCampCount;
  const resolvedTripCount = canonicalReady ? canonicalTripCount : savedTripCount;
  const resolvedCampCount = canonicalReady ? canonicalCampCount : savedCampCount;
  const resolvedPlaceCount = canonicalReady ? canonicalPlaceCount : savedPlaceCount;
  const savedNearbyCount = resolvedCampCount + resolvedPlaceCount;
  const importedTotal = importedRouteCount + importedPinCount;
  const offlineTotal = Math.max(offlineTripCount, 0) + Math.max(offlineOnlyCount, 0);

  return (
    <View style={s.root}>
      <TrailheadMetricRow
        metrics={[
          { label: 'Trips', value: resolvedTripCount > 0 ? String(resolvedTripCount) : '0', icon: 'map-outline', tone: C.silverBright },
          { label: 'Saved', value: savedNearbyCount > 0 ? String(savedNearbyCount) : '0', icon: 'bookmark-outline', tone: C.orange },
          { label: 'GPX', value: importedTotal > 0 ? String(importedTotal) : '0', icon: 'git-branch-outline', tone: '#38bdf8' },
        ]}
      />

      <TrailheadCard style={s.summaryCard}>
        <View style={s.summaryTop}>
          <View style={s.summaryIcon}>
            <Ionicons name="albums-outline" size={18} color={C.orange} />
          </View>
          <View style={s.summaryCopy}>
            <Text style={s.kicker}>TRIPS & SAVED</Text>
            <Text style={s.summaryTitle}>Trips, saved areas, GPX.</Text>
            <Text style={s.summaryText}>Routes, camps, places, trails, and offline areas.</Text>
          </View>
        </View>
        <View style={s.actionRow}>
          <TouchableOpacity style={s.primaryAction} onPress={onOpenDownloads} activeOpacity={0.84}>
            <Ionicons name="cloud-download-outline" size={15} color="#fff" />
            <Text style={s.primaryActionText}>{offlineTotal > 0 ? `SAVED AREAS (${offlineTotal})` : 'SAVED AREAS'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryAction} onPress={onPlanTrip} activeOpacity={0.84}>
            <Ionicons name="compass-outline" size={15} color={C.orange} />
            <Text style={s.secondaryActionText}>PLAN</Text>
          </TouchableOpacity>
        </View>
      </TrailheadCard>
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  root: {
    gap: 12,
  },
  summaryCard: {
    gap: 12,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orangeGlow,
  },
  summaryCopy: {
    flex: 1,
    gap: 4,
  },
  kicker: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
  },
  summaryTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
    letterSpacing: 0,
  },
  summaryText: {
    color: C.text2,
    fontSize: 12,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryAction: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    backgroundColor: C.orange,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
  },
  secondaryAction: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.orange + '44',
    backgroundColor: C.orangeGlow,
    paddingHorizontal: 16,
  },
  secondaryActionText: {
    color: C.orange,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
  },
});
