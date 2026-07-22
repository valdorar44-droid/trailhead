import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { isRenderableImageUrl } from '@/lib/mediaPolicy';
import {
  getExploreCardSummary,
  getExploreCardSourceLine,
  getExploreCategoryKey,
  getExploreCategoryColor,
  getExploreDisplayCategory,
  getExploreDisplayRegion,
  getExploreDisplayTitle,
  getExploreIcon,
  getExploreQuickFacts,
  normalizeExploreCopyBlock,
  sentenceAwarePreview,
  type ExploreDisplayContext,
} from './exploreDisplay';
import { StaticMapboxPreview } from './StaticMapboxPreview';

type Props = {
  place: ExplorePlaceProfile;
  compact?: boolean;
  lead?: boolean;
  imageUrl: string;
  context?: ExploreDisplayContext;
  saved?: boolean;
  primaryLabel: string;
  primaryIcon?: keyof typeof Ionicons.glyphMap;
  primaryDisabled?: boolean;
  rankReason?: string;
  onOpen: () => void;
  onPrimary: () => void;
  onToggleSave: () => void;
};

export function ExplorePlaceCard({
  place,
  compact,
  lead,
  imageUrl,
  context,
  saved,
  primaryLabel,
  primaryIcon = 'navigate',
  primaryDisabled = false,
  rankReason,
  onOpen,
  onPrimary,
  onToggleSave,
}: Props) {
  const C = useTheme();
  const categoryColor = getExploreCategoryColor(place);
  const facts = getExploreQuickFacts(place, context).slice(0, 2);
  const title = getExploreDisplayTitle(place);
  const region = `${context?.day ? `Day ${context.day} · ` : ''}${context?.distanceMi != null ? `${formatMiles(context.distanceMi)} · ` : ''}${getExploreDisplayRegion(place)}`;
  const summary = cardSummaryPreview(getExploreCardSummary(place));
  const sourceLine = getExploreCardSourceLine(place);
  const lat = Number(place.summary.lat);
  const lng = Number(place.summary.lng);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
  const safeImageUrl = isRenderableImageUrl(imageUrl) ? imageUrl : '';
  const renderMedia = (height: number) => safeImageUrl ? (
    <Image
      source={{ uri: safeImageUrl }}
      style={styles.image}
      resizeMode="cover"
      resizeMethod="resize"
    />
  ) : hasCoordinates ? (
    <StaticMapboxPreview
      pins={[{ id: place.id, title, lat, lng, kind: getExploreCategoryKey(place), active: true }]}
      title={title}
      showBadge={false}
      showCopy={false}
      height={height}
    />
  ) : (
    <View style={[styles.mediaFallback, { backgroundColor: C.s2 }]}>
      <Ionicons name={getExploreIcon(place) as any} size={34} color={C.text3} />
    </View>
  );
  if (compact) {
    return (
      <TouchableOpacity
        style={[styles.railCard, { borderColor: C.border, backgroundColor: C.s1 }]}
        activeOpacity={0.88}
        onPress={onOpen}
      >
        <View style={styles.railImageWrap}>
          {renderMedia(244)}
          <View style={styles.railShade} />
          <View style={[styles.badge, styles.railBadge]}>
            <Ionicons name={getExploreIcon(place) as any} size={11} color="#fff" />
            <Text style={styles.badgeText}>{getExploreDisplayCategory(place)}</Text>
          </View>
          <TouchableOpacity style={[styles.bookmark, styles.railBookmark]} onPress={onToggleSave} hitSlop={8}>
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color="#fff" />
          </TouchableOpacity>
          <View style={styles.railOverlay}>
            <Text style={styles.railTitle} numberOfLines={2}>{title}</Text>
            <Text style={styles.railMeta} numberOfLines={2}>{region}</Text>
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
        {renderMedia(lead ? 286 : 252)}
        <View style={styles.imageShade} />
        <View style={styles.badge}>
          <Ionicons name={getExploreIcon(place) as any} size={12} color="#fff" />
          <Text style={styles.badgeText}>{getExploreDisplayCategory(place)}</Text>
        </View>
        <TouchableOpacity style={styles.bookmark} onPress={onToggleSave} hitSlop={8}>
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.imageTitleBlock}>
          <Text style={styles.imageTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.imageMeta} numberOfLines={2}>{region}</Text>
        </View>
      </View>
      <View style={styles.body}>
        {!!rankReason && (
          <View style={styles.rankLine}>
            <Ionicons name="ribbon-outline" size={14} color={C.orange} />
            <Text style={[styles.rankText, { color: C.text }]} numberOfLines={2}>{rankReason}</Text>
          </View>
        )}
        {!!sourceLine && (
          <View style={styles.sourceLine}>
            <Ionicons name="shield-checkmark-outline" size={13} color={categoryColor} />
            <Text style={[styles.source, { color: categoryColor }]} numberOfLines={1}>{sourceLine}</Text>
          </View>
        )}
        {!!summary && <Text style={[styles.summary, { color: C.text2 }]}>{summary}</Text>}
        {facts.length ? (
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
        ) : null}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryAction, { backgroundColor: C.orange, opacity: primaryDisabled ? 0.5 : 1 }]}
            onPress={onPrimary}
            disabled={primaryDisabled}
          >
            <Ionicons name={primaryIcon} size={17} color="#fff" />
            <Text style={styles.primaryActionText}>{primaryLabel}</Text>
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

function cardSummaryPreview(value?: string | null) {
  const clean = normalizeExploreCopyBlock(value);
  if (!clean) return '';
  const previewModel = sentenceAwarePreview(clean, 260);
  const completeFirstSentence = clean.match(/^.{72,}?[.!?](?=\s|$)/)?.[0]?.trim();
  const preview = previewModel.expandable && completeFirstSentence
    ? completeFirstSentence
    : previewModel.text;
  if (!/\b(?:St|Mt|Ft)\.$/.test(preview)) return preview;
  return sentenceAwarePreview(clean, 220).text.replace(/\s+\b(?:St|Mt|Ft)\.$/, '').trim();
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
  mediaFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    right: 18,
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
  rankLine: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 },
  rankText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: '900' },
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
  primaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryActionText: { color: '#fff', fontSize: 12, fontWeight: '900' },
});
