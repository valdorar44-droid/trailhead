import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TrailheadCard, TrailheadMetricRow } from '@/components/TrailheadUI';
import { mono, useTheme } from '@/lib/design';
import type { ColorPalette } from '@/lib/design';

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
  const savedNearbyCount = savedCampCount + savedPlaceCount;
  const offlineTotal = Math.max(offlineTripCount, 0) + Math.max(offlineOnlyCount, 0);

  return (
    <View style={s.root}>
      <TrailheadMetricRow
        metrics={[
          { label: 'Trips', value: String(savedTripCount), icon: 'map-outline', tone: C.silverBright },
          { label: 'Saved', value: String(savedNearbyCount), icon: 'bookmark-outline', tone: C.orange },
          { label: 'GPX', value: String(importedRouteCount + importedPinCount), icon: 'git-branch-outline', tone: '#38bdf8' },
        ]}
      />

      <TrailheadCard style={s.summaryCard}>
        <View style={s.summaryTop}>
          <View style={s.summaryIcon}>
            <Ionicons name="albums-outline" size={18} color={C.orange} />
          </View>
          <View style={s.summaryCopy}>
            <Text style={s.kicker}>LIBRARY</Text>
            <Text style={s.summaryTitle}>Your saved Trailhead files stay on the map.</Text>
            <Text style={s.summaryText}>
              Open the map drawer for downloads, route files, camps, places, trails, and GPX folders.
            </Text>
          </View>
        </View>
        <View style={s.actionRow}>
          <TouchableOpacity style={s.primaryAction} onPress={onOpenDownloads} activeOpacity={0.84}>
            <Ionicons name="cloud-download-outline" size={15} color="#fff" />
            <Text style={s.primaryActionText}>{offlineTotal > 0 ? `DOWNLOADS (${offlineTotal})` : 'DOWNLOADS'}</Text>
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
    gap: 14,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
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
    letterSpacing: 0.8,
  },
  summaryTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
    letterSpacing: 0,
  },
  summaryText: {
    color: C.text3,
    fontSize: 12,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryAction: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 14,
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
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
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
