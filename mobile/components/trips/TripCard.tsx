import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import { StaticMapboxPreview } from '@/components/explore/StaticMapboxPreview';
import type { TripLibraryItem } from './types';

function formatUpdatedAt(value: number) {
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

function tripMeta(trip: TripLibraryItem) {
  const stops = `${trip.stopCount} ${trip.stopCount === 1 ? 'stop' : 'stops'}`;
  return `${stops} · ${formatUpdatedAt(trip.updatedAt)}`;
}

export function TripPreview({ trip, height }: { trip: TripLibraryItem; height: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [trip.previewImageUrl]);

  return trip.previewImageUrl && !imageFailed ? (
    <Image
      source={{ uri: trip.previewImageUrl }}
      accessibilityLabel={`${trip.name} preview`}
      resizeMode="cover"
      style={styles.previewFill}
      onError={() => setImageFailed(true)}
    />
  ) : (
    <StaticMapboxPreview
      pins={trip.previewPins}
      title={trip.name}
      height={height}
      showBadge={false}
      showCopy={false}
      style={styles.previewFill}
    />
  );
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

  if (active) {
    return (
      <View style={[styles.activeBlock, { borderBottomColor: C.border }]}>
        <TouchableOpacity
          testID={`plan.trip.${trip.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Open ${trip.name}. ${tripMeta(trip)}`}
          activeOpacity={0.82}
          onPress={() => onOpen(trip)}
          style={styles.activeOpenArea}
        >
          <View style={[styles.activeMedia, { borderColor: C.border, backgroundColor: C.s2 }]}>
            <TripPreview trip={trip} height={146} />
          </View>
          <View style={styles.activeCopyRow}>
            <View style={styles.copy}>
              <Text style={[styles.activeTitle, { color: C.text }]} numberOfLines={2}>{trip.name}</Text>
              <Text style={[styles.meta, { color: C.text2 }]} numberOfLines={1}>{tripMeta(trip)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color={C.text3} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          testID={`plan.trip.${trip.id}.more`}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${trip.name}`}
          activeOpacity={0.76}
          onPress={() => onMore(trip)}
          style={[styles.activeMoreButton, { backgroundColor: C.s1, borderColor: C.border }]}
        >
          <Ionicons name="ellipsis-horizontal" size={19} color={C.text} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.row, { borderBottomColor: C.border }]}>
      <TouchableOpacity
        testID={`plan.trip.${trip.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Open ${trip.name}. ${tripMeta(trip)}`}
        activeOpacity={0.72}
        onPress={() => onOpen(trip)}
        style={styles.openArea}
      >
        <View style={[styles.thumbnail, { borderColor: C.border, backgroundColor: C.s2 }]}>
          <TripPreview trip={trip} height={58} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>
            {trip.name}
          </Text>
          <Text style={[styles.meta, { color: C.text2 }]} numberOfLines={1}>{tripMeta(trip)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.text3} />
      </TouchableOpacity>
      <TouchableOpacity
        testID={`plan.trip.${trip.id}.more`}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${trip.name}`}
        hitSlop={6}
        activeOpacity={0.72}
        onPress={() => onMore(trip)}
        style={styles.moreButton}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={C.text2} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  activeBlock: {
    position: 'relative',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 13,
  },
  activeOpenArea: {
    gap: 11,
  },
  activeMedia: {
    width: '100%',
    height: 146,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  activeCopyRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activeMoreButton: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 38,
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    minHeight: 78,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  openArea: {
    minWidth: 0,
    flex: 1,
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
  },
  thumbnail: {
    width: 58,
    height: 58,
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
  },
  copy: {
    minWidth: 0,
    flex: 1,
  },
  title: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    letterSpacing: 0,
  },
  activeTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    letterSpacing: 0,
  },
  meta: {
    marginTop: 3,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '500',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  moreButton: {
    width: 40,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewFill: {
    ...StyleSheet.absoluteFillObject,
  },
});
