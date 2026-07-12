import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ColorPalette } from '@/lib/design';
import type { TripLibraryItem } from './types';

type IconName = keyof typeof Ionicons.glyphMap;

type StatusItem = {
  label: string;
  value: string;
  icon: IconName;
  color: string;
};

function statusesForTrip(item: TripLibraryItem, C: ColorPalette): StatusItem[] {
  const alerts = item.activeMonitorCount > 0
    ? `${item.activeMonitorCount} active`
    : item.monitorState === 'attention'
      ? 'Review needed'
      : item.monitorState === 'inactive' && !item.alertCount
        ? 'None active'
        : item.alertCount == null
          ? 'Check when opened'
          : item.alertCount > 0
            ? `${item.alertCount} to review`
            : 'No alerts';
  const notes = item.noteCount == null
    ? 'Check when opened'
    : item.noteCount > 0
      ? `${item.noteCount} saved`
      : 'No notes';
  return [
    {
      label: 'Offline',
      value: item.isOffline ? 'Ready' : 'Not saved',
      icon: item.isOffline ? 'cloud-done-outline' : 'cloud-outline',
      color: item.isOffline ? C.green : C.text2,
    },
    {
      label: 'Bookings',
      value: item.bookingCount > 0 ? `${item.bookingCount} confirmed` : 'None',
      icon: item.bookingCount > 0 ? 'ticket-outline' : 'calendar-outline',
      color: item.bookingCount > 0 ? C.blueGlow : C.text2,
    },
    {
      label: item.monitorState ? 'Watches' : 'Alerts',
      value: alerts,
      icon: item.activeMonitorCount > 0
        ? 'notifications-outline'
        : item.monitorState === 'attention' || item.alertCount && item.alertCount > 0
          ? 'warning-outline'
          : 'shield-checkmark-outline',
      color: item.activeMonitorCount > 0
        ? C.blueGlow
        : item.monitorState === 'attention' || item.alertCount && item.alertCount > 0
          ? C.yellow
          : C.text2,
    },
    {
      label: 'Notes',
      value: notes,
      icon: item.noteCount && item.noteCount > 0 ? 'document-text-outline' : 'document-outline',
      color: item.noteCount && item.noteCount > 0 ? C.silverBright : C.text2,
    },
  ];
}

export default function TripStatusGrid({ trip, compact = false }: { trip: TripLibraryItem; compact?: boolean }) {
  const C = useTheme();
  const statuses = statusesForTrip(trip, C);
  return (
    <View style={[styles.grid, compact && styles.compactGrid]}>
      {statuses.map(status => (
        <View
          key={status.label}
          accessible
          accessibilityLabel={`${status.label}: ${status.value}`}
          style={[styles.item, compact && styles.compactItem]}
        >
          <Ionicons name={status.icon} size={compact ? 14 : 16} color={status.color} />
          <View style={styles.copy}>
            <Text style={[styles.label, { color: C.text2 }]} numberOfLines={1}>{status.label}</Text>
            <Text style={[styles.value, { color: C.text }]} numberOfLines={1}>{status.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
    columnGap: 8,
  },
  compactGrid: {
    rowGap: 9,
  },
  item: {
    width: '48%',
    minWidth: 132,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactItem: {
    minWidth: 118,
    gap: 7,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  value: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
