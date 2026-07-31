import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import type { TrailDiscoveryItemV2 } from '@/lib/api';

type Props = {
  item: TrailDiscoveryItemV2;
  onPress: () => void;
  testID?: string;
};

function compactFacts(item: TrailDiscoveryItemV2) {
  const facts = [
    item.facts.distance_mi != null ? `${item.facts.distance_mi.toFixed(item.facts.distance_mi >= 10 ? 0 : 1)} mi` : '',
    item.facts.difficulty || '',
    item.facts.route_shape || '',
    item.facts.elevation_gain_ft != null ? `${Math.round(item.facts.elevation_gain_ft).toLocaleString()} ft gain` : '',
  ].filter(Boolean);
  return facts.slice(0, 3).join(' · ');
}

export function TrailDiscoveryCard({ item, onPress, testID }: Props) {
  const C = useTheme();
  const media = item.media[0];
  const source = item.sources[0]?.label;
  const facts = compactFacts(item);
  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.card, { backgroundColor: C.s1, borderColor: C.border }]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}`}
    >
      {media ? (
        <Image source={{ uri: media.thumbnail_url || media.url }} style={styles.media} resizeMode="cover" />
      ) : (
        <View style={[styles.media, styles.fallback, { backgroundColor: C.s2 }]}>
          <Ionicons name="trail-sign-outline" size={28} color={C.orange} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>{item.name}</Text>
          <Ionicons name="chevron-forward" size={16} color={C.text3} />
        </View>
        {item.catalog === 'community' ? (
          <Text style={[styles.community, { color: C.orange }]}>Community route</Text>
        ) : null}
        {!!facts && <Text style={[styles.facts, { color: C.text2 }]} numberOfLines={1}>{facts}</Text>}
        {!!item.activities.length && (
          <Text style={[styles.meta, { color: C.text3 }]} numberOfLines={1}>{item.activities.slice(0, 3).join(' · ')}</Text>
        )}
        <View style={styles.footer}>
          <Text style={[styles.source, { color: C.text3 }]} numberOfLines={1}>
            {item.catalog === 'community' && item.community
              ? `by ${item.community.contributor_handle} · ${item.community.approved_contributions} approved`
              : source || 'Trail details'}
          </Text>
          {item.distance_from_center_mi != null ? (
            <Text style={[styles.distance, { color: C.text2 }]}>{item.distance_from_center_mi.toFixed(item.distance_from_center_mi >= 10 ? 0 : 1)} mi away</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 132, borderWidth: 1, borderRadius: 20, overflow: 'hidden', marginBottom: 12 },
  media: { width: '100%', height: 112 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1, fontFamily: 'BarlowCondensed_700Bold', fontSize: 22, lineHeight: 24 },
  community: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  facts: { fontSize: 13, fontWeight: '700' },
  meta: { fontSize: 12 },
  footer: { minHeight: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  source: { flex: 1, fontSize: 11 },
  distance: { fontSize: 11, fontWeight: '700' },
});
