import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile } from '@/lib/api';
import { useTheme } from '@/lib/design';
import {
  getExploreCardSummary,
  getExploreCategoryColor,
  getExploreDisplayCategory,
  getExploreDisplayRegion,
  getExploreDisplayTitle,
  getExploreIcon,
  getExploreQuickFacts,
  getExploreSourceBadge,
  type ExploreDisplayContext,
} from './exploreDisplay';

type Props = {
  place: ExplorePlaceProfile;
  compact?: boolean;
  lead?: boolean;
  imageUrl: string;
  context?: ExploreDisplayContext;
  saved?: boolean;
  canRoute?: boolean;
  onOpen: () => void;
  onArea: () => void;
  onRoute: () => void;
  onToggleSave: () => void;
};

export function ExplorePlaceCard({
  place,
  compact,
  lead,
  imageUrl,
  context,
  saved,
  canRoute = true,
  onOpen,
  onArea,
  onRoute,
  onToggleSave,
}: Props) {
  const C = useTheme();
  const categoryColor = getExploreCategoryColor(place);
  const facts = getExploreQuickFacts(place, context).slice(0, compact ? 2 : 3);
  return (
    <TouchableOpacity
      style={[
        compact ? styles.railCard : styles.card,
        lead && !compact && styles.leadCard,
        { borderColor: C.border, backgroundColor: C.s1 },
      ]}
      activeOpacity={0.88}
      onPress={onOpen}
    >
      <View style={[styles.imageWrap, compact && styles.railImageWrap]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.imageFallback, { backgroundColor: C.s2 }]}>
            <Ionicons name={getExploreIcon(place) as any} size={30} color={categoryColor} />
          </View>
        )}
        <View style={styles.imageShade} />
        <View style={styles.badge}>
          <Ionicons name={getExploreIcon(place) as any} size={12} color="#fff" />
          <Text style={styles.badgeText}>{getExploreDisplayCategory(place).toUpperCase()}</Text>
        </View>
        <TouchableOpacity style={styles.bookmark} onPress={onToggleSave} hitSlop={8}>
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, compact && styles.railTitle, { color: C.text }]} numberOfLines={2}>
          {getExploreDisplayTitle(place)}
        </Text>
        <Text style={[styles.meta, { color: C.text3 }]} numberOfLines={1}>
          {context?.day ? `Day ${context.day} · ` : ''}{context?.distanceMi != null ? `${formatMiles(context.distanceMi)} · ` : ''}{getExploreDisplayRegion(place)}
        </Text>
        <Text style={[styles.source, { color: categoryColor }]} numberOfLines={1}>{getExploreSourceBadge(place)}</Text>
        <Text style={[styles.summary, { color: C.text2 }]} numberOfLines={compact ? 2 : 3}>
          {getExploreCardSummary(place)}
        </Text>
        <View style={styles.factRow}>
          {facts.map(fact => (
            <View key={`${fact.icon}-${fact.label}`} style={[styles.fact, { borderColor: C.border, backgroundColor: C.s2 }]}>
              <Ionicons name={fact.icon as any} size={13} color={fact.tone} />
              <Text style={[styles.factText, { color: C.text2 }]} numberOfLines={1}>
                {fact.value ? `${fact.value} ${fact.label}` : fact.label}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.action, { borderColor: C.border }]} onPress={onArea}>
            <Ionicons name="map-outline" size={17} color={C.text2} />
            <Text style={[styles.actionText, { color: C.text2 }]}>Area</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.action, { borderColor: C.border }]} onPress={onToggleSave}>
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={16} color={C.text2} />
            <Text style={[styles.actionText, { color: C.text2 }]}>{saved ? 'Saved' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, { borderColor: C.border, opacity: canRoute ? 1 : 0.5 }]}
            onPress={onRoute}
            disabled={!canRoute}
          >
            <Ionicons name="navigate" size={16} color={C.orange} />
            <Text style={[styles.actionText, { color: C.text2 }]}>Route</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function formatMiles(mi: number) {
  if (!Number.isFinite(mi)) return '';
  return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginBottom: 18,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  leadCard: { marginTop: 2 },
  railCard: {
    width: 286,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
  imageWrap: { height: 172 },
  railImageWrap: { height: 140 },
  image: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.16)' },
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    maxWidth: 190,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.72)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0 },
  bookmark: {
    position: 'absolute',
    top: 11,
    right: 11,
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.46)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.44)',
  },
  body: { padding: 16, gap: 7 },
  title: { fontSize: 21, lineHeight: 25, fontWeight: '900', letterSpacing: 0 },
  railTitle: { fontSize: 18, lineHeight: 22 },
  meta: { fontSize: 13, fontWeight: '700' },
  source: { fontSize: 13, fontWeight: '900' },
  summary: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingTop: 4 },
  fact: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  factText: { fontSize: 11, fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionText: { fontSize: 13, fontWeight: '900' },
});

