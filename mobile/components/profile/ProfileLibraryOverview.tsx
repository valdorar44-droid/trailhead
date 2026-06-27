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
  recentTripName?: string;
  savedNearbyName?: string;
  onOpenTrips: () => void;
  onOpenDownloads: () => void;
  onOpenSaved: () => void;
  onPlanTrip: () => void;
};

type LibraryGroup = {
  key: string;
  title: string;
  meta: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  action: string;
  onPress: () => void;
};

export default function ProfileLibraryOverview({
  savedTripCount,
  offlineTripCount,
  offlineOnlyCount,
  savedCampCount,
  savedPlaceCount,
  importedRouteCount,
  importedPinCount,
  recentTripName,
  savedNearbyName,
  onOpenTrips,
  onOpenDownloads,
  onOpenSaved,
  onPlanTrip,
}: LibraryOverviewProps) {
  const C = useTheme();
  const s = styles(C);
  const savedNearbyCount = savedCampCount + savedPlaceCount;
  const offlineTotal = Math.max(offlineTripCount, 0) + Math.max(offlineOnlyCount, 0);
  const importDetail = importedRouteCount > 0 || importedPinCount > 0
    ? `${importedRouteCount} route ${importedRouteCount === 1 ? 'preview' : 'previews'} · ${importedPinCount} waypoint ${importedPinCount === 1 ? 'pin' : 'pins'}`
    : 'Imported route previews and waypoint pins will appear here.';

  const groups: LibraryGroup[] = [
    {
      key: 'recent',
      title: 'Routes',
      meta: `${savedTripCount} saved`,
      detail: recentTripName ? `Latest: ${recentTripName}` : 'Saved routes appear here after planning.',
      icon: 'time-outline',
      tone: C.silverBright,
      action: savedTripCount > 0 ? 'OPEN' : 'PLAN',
      onPress: savedTripCount > 0 ? onOpenTrips : onPlanTrip,
    },
    {
      key: 'saved',
      title: 'Camps & Places',
      meta: `${savedNearbyCount} saved`,
      detail: savedNearbyName ? `Latest: ${savedNearbyName}` : 'Saved camps, stays, trailheads, and places.',
      icon: 'bookmark-outline',
      tone: C.orange,
      action: 'OPEN',
      onPress: onOpenSaved,
    },
    {
      key: 'imports',
      title: 'GPX Imports',
      meta: `${importedRouteCount + importedPinCount} items`,
      detail: importDetail,
      icon: 'git-branch-outline',
      tone: '#38bdf8',
      action: 'OPEN',
      onPress: onOpenTrips,
    },
    {
      key: 'photos',
      title: 'Photos',
      meta: '0 local',
      detail: 'Saved place and trip photos will collect here.',
      icon: 'images-outline',
      tone: '#a855f7',
      action: 'OPEN',
      onPress: onOpenSaved,
    },
  ];

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
            <Text style={s.summaryTitle}>Routes, camps, GPX files, and photos.</Text>
          </View>
        </View>
        <TouchableOpacity style={s.primaryAction} onPress={onOpenDownloads} activeOpacity={0.84}>
          <Ionicons name="cloud-download-outline" size={15} color="#fff" />
          <Text style={s.primaryActionText}>{offlineTotal > 0 ? `OPEN DOWNLOADS (${offlineTotal})` : 'OPEN DOWNLOADS'}</Text>
        </TouchableOpacity>
      </TrailheadCard>

      <TrailheadCard style={s.groupCard}>
        {groups.map((group, idx) => (
          <TouchableOpacity key={group.key} style={[s.groupRow, idx > 0 && s.groupRowDivider]} onPress={group.onPress} activeOpacity={0.86}>
            <View style={[s.groupIcon, { borderColor: group.tone + '44', backgroundColor: group.tone + '16' }]}>
              <Ionicons name={group.icon} size={17} color={group.tone} />
            </View>
            <View style={s.groupCopy}>
              <View style={s.groupTitleRow}>
                <Text style={s.groupTitle}>{group.title}</Text>
                <Text style={[s.groupMeta, { color: group.tone }]}>{group.meta}</Text>
              </View>
              <Text style={s.groupDetail} numberOfLines={2}>{group.detail}</Text>
            </View>
            <View style={s.groupAction}>
              <Text style={s.groupActionText}>{group.action}</Text>
              <Ionicons name="chevron-forward" size={14} color={C.text3} />
            </View>
          </TouchableOpacity>
        ))}
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
  primaryAction: {
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
  groupCard: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  groupRow: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  groupRowDivider: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  groupIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupTitle: {
    flex: 1,
    color: C.text,
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0,
  },
  groupMeta: {
    fontSize: 9.5,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
  },
  groupDetail: {
    color: C.text3,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0,
  },
  groupAction: {
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: 82,
  },
  groupActionText: {
    color: C.text3,
    fontSize: 8,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'right',
  },
});
