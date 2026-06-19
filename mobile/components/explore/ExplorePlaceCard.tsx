import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile } from '@/lib/api';
import { useTheme } from '@/lib/design';
import {
  getExploreCardSummary,
  getExploreCardSourceLine,
  getExploreCategoryColor,
  getExploreDisplayCategory,
  getExploreDisplayRegion,
  getExploreDisplayTitle,
  getExploreIcon,
  getExploreQuickFacts,
  sentenceAwarePreviewText,
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
  onNearby?: () => void;
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
  onNearby,
  onToggleSave,
}: Props) {
  const C = useTheme();
  const categoryColor = getExploreCategoryColor(place);
  const facts = getExploreQuickFacts(place, context).slice(0, 2);
  const title = getExploreDisplayTitle(place);
  const region = `${context?.day ? `Day ${context.day} · ` : ''}${context?.distanceMi != null ? `${formatMiles(context.distanceMi)} · ` : ''}${getExploreDisplayRegion(place)}`;
  const summary = sentenceAwarePreviewText(getExploreCardSummary(place), lead ? 220 : 160);
  if (compact) {
    return (
      <TouchableOpacity
        style={[styles.railCard, { borderColor: C.border, backgroundColor: C.s1 }]}
        activeOpacity={0.88}
        onPress={onOpen}
      >
        <View style={styles.railImageWrap}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={[styles.imageFallback, { backgroundColor: C.s2 }]}>
              <Ionicons name={getExploreIcon(place) as any} size={28} color={categoryColor} />
            </View>
          )}
          <View style={styles.railShade} />
          <View style={[styles.badge, styles.railBadge]}>
            <Ionicons name={getExploreIcon(place) as any} size={11} color="#fff" />
            <Text style={styles.badgeText}>{getExploreDisplayCategory(place).toUpperCase()}</Text>
          </View>
          <TouchableOpacity style={[styles.bookmark, styles.railBookmark]} onPress={onToggleSave} hitSlop={8}>
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color="#fff" />
          </TouchableOpacity>
          <View style={styles.railOverlay}>
            <Text style={styles.railTitle} numberOfLines={2}>{title}</Text>
            <Text style={styles.railMeta} numberOfLines={1}>{region}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity
      style={[
        styles.card,
        lead && !compact && styles.leadCard,
        { borderColor: C.border, backgroundColor: C.s1 },
      ]}
      activeOpacity={0.88}
      onPress={onOpen}
    >
      <View style={[styles.imageWrap, lead && styles.leadImageWrap]}>
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
        <View style={styles.imageTitleBlock}>
          <Text style={styles.imageTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.imageMeta} numberOfLines={1}>{region}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.sourceLine}>
          <Ionicons name="shield-checkmark-outline" size={13} color={categoryColor} />
          <Text style={[styles.source, { color: categoryColor }]} numberOfLines={1}>{getExploreCardSourceLine(place)}</Text>
        </View>
        <Text style={[styles.summary, { color: C.text2 }]}>{summary}</Text>
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
          {!!onNearby && (
            <TouchableOpacity style={[styles.action, { borderColor: C.border }]} onPress={onNearby}>
              <Ionicons name="locate-outline" size={16} color={C.text2} />
              <Text style={[styles.actionText, { color: C.text2 }]}>Nearby</Text>
            </TouchableOpacity>
          )}
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
    marginHorizontal: 0,
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
    width: 208,
    height: 244,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
  imageWrap: { height: 252 },
  leadImageWrap: { height: 286 },
  railImageWrap: { flex: 1 },
  image: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  railShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
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
  railBadge: { top: 10, left: 10, maxWidth: 130, paddingHorizontal: 9, paddingVertical: 6 },
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
  railBookmark: {
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 11,
  },
  imageTitleBlock: {
    position: 'absolute',
    left: 18,
    right: 58,
    bottom: 16,
    gap: 4,
  },
  imageTitle: {
    color: '#fff',
    fontSize: 29,
    lineHeight: 33,
    fontWeight: '900',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.42)',
    textShadowRadius: 12,
  },
  imageMeta: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.38)',
    textShadowRadius: 10,
  },
  railOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    gap: 4,
  },
  railTitle: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.46)',
    textShadowRadius: 10,
  },
  railMeta: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.46)',
    textShadowRadius: 8,
  },
  body: { padding: 15, gap: 8 },
  title: { fontSize: 21, lineHeight: 25, fontWeight: '900', letterSpacing: 0 },
  meta: { fontSize: 13, fontWeight: '700' },
  sourceLine: { minHeight: 19, flexDirection: 'row', alignItems: 'center', gap: 5 },
  source: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: '900' },
  summary: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 6 },
  action: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionText: { fontSize: 11, fontWeight: '900' },
});
