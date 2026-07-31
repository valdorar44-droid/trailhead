import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import type { SavedEntityKind, SavedEntityV1 } from '@/lib/tripRepository';

type IconName = keyof typeof Ionicons.glyphMap;
const SAVED_ITEM_RENDER_BATCH = 12;

const PLACE_ICONS: Record<SavedEntityKind, IconName> = {
  place: 'location-outline',
  camp: 'bonfire-outline',
  trail: 'trail-sign-outline',
  activity: 'ticket-outline',
  fuel: 'speedometer-outline',
  water: 'water-outline',
  service: 'build-outline',
  trip_pack: 'albums-outline',
};

function placeType(place: SavedEntityV1) {
  switch (place.kind) {
    case 'camp': return 'Camp';
    case 'trail': return 'Trail';
    case 'activity': return 'Activity';
    case 'fuel': return 'Fuel';
    case 'water': return 'Water';
    case 'service': return 'Service';
    case 'trip_pack': return 'Trip pack';
    default: return 'Saved place';
  }
}

function placeMetadata(place: SavedEntityV1) {
  return [place.category || placeType(place), place.region, place.source].filter(Boolean).join(' | ');
}

export default function SavedItemsSection({
  items,
  onOpen,
  onBrowse,
  shareableItemIds,
  onShare,
}: {
  items: SavedEntityV1[];
  onOpen: (item: SavedEntityV1) => void;
  onBrowse: () => void;
  shareableItemIds?: ReadonlySet<string>;
  onShare?: (item: SavedEntityV1) => void;
}) {
  const C = useTheme();
  const [visibleCount, setVisibleCount] = useState(SAVED_ITEM_RENDER_BATCH);
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={[styles.heading, { color: C.text }]}>Saved items</Text>
          <Text style={[styles.subheading, { color: C.text2 }]}>{items.length} ready for future trips</Text>
        </View>
        <TouchableOpacity
          testID="plan.saved.browse"
          accessibilityRole="button"
          accessibilityLabel="Browse places in Explore"
          hitSlop={8}
          activeOpacity={0.72}
          onPress={onBrowse}
          style={styles.headingAction}
        >
          <Text style={[styles.headingActionText, { color: C.orange }]}>Explore</Text>
          <Ionicons name="arrow-forward" size={15} color={C.orange} />
        </TouchableOpacity>
      </View>

      <View style={[styles.list, { borderTopColor: C.border }] }>
        {items.length > 0 ? visibleItems.map(item => {
          const canShare = Boolean(onShare && shareableItemIds?.has(item.id));
          return (
            <View key={item.id} style={[styles.row, { borderBottomColor: C.border }] }>
              <TouchableOpacity
                testID={`plan.saved.item.${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Open saved ${placeType(item).toLowerCase()} ${item.title}`}
                activeOpacity={0.72}
                onPress={() => onOpen(item)}
                style={styles.openRow}
              >
                <View style={[styles.icon, { backgroundColor: C.s2, borderColor: C.border }] }>
                  <Ionicons name={PLACE_ICONS[item.kind]} size={17} color={item.kind === 'camp' ? C.orange : C.text2} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={[styles.meta, { color: C.text2 }]} numberOfLines={1}>{placeMetadata(item)}</Text>
                </View>
                {item.note ? (
                  <View accessible accessibilityLabel="Has a saved note" style={styles.noteMark}>
                    <Ionicons name="document-text-outline" size={15} color={C.silverBright} />
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={17} color={C.text3} />
              </TouchableOpacity>
              {canShare ? (
                <TouchableOpacity
                  testID={`plan.saved.share.${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Share saved trail route ${item.title}`}
                  activeOpacity={0.72}
                  onPress={() => onShare?.(item)}
                  style={styles.shareAction}
                >
                  <Ionicons name="share-outline" size={17} color={C.orange} />
                  <Text style={[styles.shareLabel, { color: C.orange }]}>Share</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        }) : (
          <TouchableOpacity
            testID="plan.saved.empty.browse"
            accessibilityRole="button"
            accessibilityLabel="Browse places to save"
            activeOpacity={0.72}
            onPress={onBrowse}
            style={[styles.emptyRow, { borderBottomColor: C.border }]}
          >
            <Ionicons name="bookmark-outline" size={19} color={C.text3} />
            <View style={styles.rowCopy}>
              <Text style={[styles.title, { color: C.text }]}>Browse places to save</Text>
              <Text style={[styles.meta, { color: C.text2 }]}>Camps, trails, fuel, water, and stops stay within reach.</Text>
            </View>
            <Ionicons name="arrow-forward" size={17} color={C.orange} />
          </TouchableOpacity>
        )}
        {visibleItems.length < items.length ? (
          <TouchableOpacity
            testID="plan.saved.show-more"
            accessibilityRole="button"
            accessibilityLabel="Show more saved items"
            activeOpacity={0.74}
            onPress={() => setVisibleCount(count => count + SAVED_ITEM_RENDER_BATCH)}
            style={[styles.showMoreRow, { borderBottomColor: C.border }]}
          >
            <Text style={[styles.showMoreText, { color: C.text2 }]}>Show more saved items</Text>
            <Ionicons name="chevron-down" size={16} color={C.text2} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 11,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subheading: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  headingAction: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headingActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  openRow: {
    minHeight: 63,
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  shareAction: {
    minWidth: 58,
    minHeight: 48,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  shareLabel: {
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800',
  },
  emptyRow: {
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  meta: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  noteMark: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showMoreRow: {
    minHeight: 46,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
});
