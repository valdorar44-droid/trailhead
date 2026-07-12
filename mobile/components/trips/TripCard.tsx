import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import TripStatusGrid from './TripStatusGrid';
import type { TripLibraryItem } from './types';

function formatMiles(value: number) {
  const miles = Math.max(0, Math.round(value));
  if (miles >= 1000) return `${(miles / 1000).toFixed(miles >= 10_000 ? 0 : 1)}k`;
  return miles.toLocaleString();
}

function formatDate(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function regionLabel(trip: TripLibraryItem) {
  if (trip.regions.length === 0) return 'Route details available when opened';
  if (trip.regions.length <= 3) return trip.regions.join(' / ');
  return `${trip.regions.slice(0, 2).join(' / ')} +${trip.regions.length - 2}`;
}

export default function TripCard({
  trip,
  active = false,
  onOpen,
  onMore,
}: {
  trip: TripLibraryItem;
  active?: boolean;
  onOpen: (trip: TripLibraryItem) => void;
  onMore: (trip: TripLibraryItem) => void;
}) {
  const C = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: C.s1,
          borderColor: active ? C.orange + '88' : C.border,
          boxShadow: C.bg === '#F7F8F6'
            ? '0 3px 14px rgba(17,20,18,0.07)'
            : '0 4px 18px rgba(0,0,0,0.22)',
        },
      ]}
    >
      {active ? <View style={[styles.activeRail, { backgroundColor: C.orange }]} /> : null}
      <View style={styles.headingRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Open ${trip.name}`}
          activeOpacity={0.76}
          onPress={() => onOpen(trip)}
          style={styles.headingAction}
        >
          <View style={[styles.tripIcon, { backgroundColor: active ? C.orange + '15' : C.s2, borderColor: active ? C.orange + '55' : C.border }] }>
            <Ionicons name={active ? 'navigate-outline' : 'trail-sign-outline'} size={19} color={active ? C.orange : C.text2} />
          </View>
          <View style={styles.headingCopy}>
            {active ? <Text style={[styles.eyebrow, { color: C.orange }]}>ACTIVE TRIP</Text> : null}
            <Text style={[styles.title, active && styles.activeTitle, { color: C.text }]} numberOfLines={2}>{trip.name}</Text>
            <Text style={[styles.meta, { color: C.text2 }]} numberOfLines={1}>{regionLabel(trip)} | {formatDate(trip.updatedAt)}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${trip.name}`}
          hitSlop={10}
          activeOpacity={0.72}
          onPress={() => onMore(trip)}
          style={[styles.moreButton, { borderColor: C.border }]}
        >
          <Ionicons name="ellipsis-horizontal" size={19} color={C.text2} />
        </TouchableOpacity>
      </View>

      <View style={[styles.metrics, { borderTopColor: C.border, borderBottomColor: C.border }] }>
        <Metric label="Days" value={`${Math.max(0, Math.round(trip.days))}`} />
        <View style={[styles.metricDivider, { backgroundColor: C.border }]} />
        <Metric label="Miles" value={formatMiles(trip.miles)} />
        <View style={[styles.metricDivider, { backgroundColor: C.border }]} />
        <Metric label="Stops" value={`${trip.stopCount}`} />
      </View>

      <TripStatusGrid trip={trip} compact={!active} />

      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Open ${trip.name} on map`}
          activeOpacity={0.82}
          onPress={() => onOpen(trip)}
          style={[styles.openButton, { backgroundColor: active ? C.orange : C.s2, borderColor: active ? C.orange : C.border2 }]}
        >
          <Ionicons name="map-outline" size={17} color={active ? '#FFFFFF' : C.text} />
          <Text style={[styles.openLabel, { color: active ? '#FFFFFF' : C.text }]}>Open map</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Manage ${trip.name}`}
          activeOpacity={0.78}
          onPress={() => onMore(trip)}
          style={[styles.manageButton, { borderColor: C.border2 }]}
        >
          <Ionicons name="options-outline" size={17} color={C.text2} />
          <Text style={[styles.manageLabel, { color: C.text2 }]}>Manage</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const C = useTheme();
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.metricValue, { color: C.text }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: C.text2 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 15,
  },
  activeRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headingAction: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  tripIcon: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 2,
  },
  title: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: 0,
  },
  activeTitle: {
    fontSize: 20,
    lineHeight: 25,
  },
  meta: {
    marginTop: 3,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  moreButton: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metrics: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  openButton: {
    minHeight: 44,
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  openLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  manageButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 13,
  },
  manageLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
