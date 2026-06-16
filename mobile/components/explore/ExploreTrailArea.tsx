import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile, ExploreTrailCard } from '@/lib/api';
import { mono, useTheme } from '@/lib/design';
import { getExploreDisplayTitle, getExploreTrailCards } from './exploreDisplay';

type TrailFilter = 'all' | 'easy' | 'hard';

type Props = {
  place: ExplorePlaceProfile;
  mediaUrl: (url?: string | null) => string;
  onTrailMap?: (trail: ExploreTrailCard) => void;
  onTrailRoute?: (trail: ExploreTrailCard) => void;
};

export function ExploreTrailArea({ place, mediaUrl, onTrailMap, onTrailRoute }: Props) {
  const C = useTheme();
  const trails = getExploreTrailCards(place);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrailFilter>('all');
  const visibleTrails = useMemo(
    () => filter === 'all' ? trails : trails.filter(trail => trail.difficulty.toLowerCase().includes(filter)),
    [filter, trails],
  );

  if (!trails.length) return null;

  return (
    <View style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.intro}>
        <Text style={[styles.introTitle, { color: C.text }]}>
          Explore trails in and around {getExploreDisplayTitle(place).replace(/\s+Trails$/i, '')}.
        </Text>
        <Text style={[styles.introText, { color: C.text2 }]}>
          Pick by distance, type, elevation, and time.
        </Text>
      </View>

      <View style={styles.sectionTop}>
        <View>
          <Text style={[styles.sectionLabel, { color: C.orange }]}>TRAILS IN THIS AREA</Text>
          <Text style={[styles.sectionSub, { color: C.text3 }]}>
            {filter === 'all' ? `${trails.length} trails found` : `${visibleTrails.length} ${filter} trails`}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.filterButton, { borderColor: C.border, backgroundColor: C.s2 }]}
          activeOpacity={0.84}
          onPress={() => setFilter(current => nextTrailFilter(current))}
        >
          <Ionicons name="options-outline" size={16} color={C.text2} />
          <Text style={[styles.filterText, { color: C.text2 }]}>
            {filter === 'all' ? 'FILTERS' : filter.toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.list}>
        {visibleTrails.map(trail => {
          const selected = selectedId === trail.id;
          const photo = primaryTrailPhoto(trail);
          const sourceLabel = trail.source_label || trail.source_pack?.primary || trail.image_credit || '';
          return (
            <View key={trail.id} style={[styles.trailWrap, { borderColor: selected ? C.orange + '66' : C.border, backgroundColor: C.s2 }]}>
              <TouchableOpacity
                style={styles.trailRow}
                activeOpacity={0.88}
                onPress={() => setSelectedId(current => current === trail.id ? null : trail.id)}
              >
                <Image source={{ uri: mediaUrl(photo || trail.image_url) }} style={styles.trailImage} resizeMode="cover" />
                <View style={styles.trailBody}>
                  <View style={styles.trailTitleRow}>
                    <Text style={[styles.trailTitle, { color: C.text }]} numberOfLines={2}>{trail.title}</Text>
                    <Ionicons name={selected ? 'chevron-up' : 'chevron-down'} size={18} color={C.text3} />
                  </View>
                  <View style={[styles.difficultyPill, difficultyTone(trail.difficulty)]}>
                    <Text style={[styles.difficultyText, { color: difficultyTextColor(trail.difficulty) }]}>
                      {trail.difficulty}
                    </Text>
                  </View>
                  <Text style={[styles.trailMeta, { color: C.text2 }]} numberOfLines={1}>
                    {formatMiles(trail.distance_mi)} · {trail.route_type}
                  </Text>
                  {!!trail.area && <Text style={[styles.trailArea, { color: C.text3 }]} numberOfLines={1}>{trail.area}</Text>}
                  {!!sourceLabel && <Text style={[styles.trailSource, { color: C.text3 }]} numberOfLines={1}>{sourceLabel}</Text>}
                  {!!trail.tags?.length && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRail}>
                      {trail.tags.slice(0, 3).map((tag: string) => (
                        <View key={`${trail.id}-${tag}`} style={[styles.tag, { backgroundColor: C.s3 }]}>
                          <Text style={[styles.tagText, { color: C.text3 }]}>{tag.toUpperCase()}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </TouchableOpacity>
              {selected && (
                <View style={[styles.detail, { borderTopColor: C.border }]}>
                  <View style={styles.statGrid}>
                    <TrailStat label="DISTANCE" value={formatMiles(trail.distance_mi)} />
                    <TrailStat label="TYPE" value={trail.route_type} />
                    <TrailStat label="GAIN" value={trail.elevation_gain_ft ? `${trail.elevation_gain_ft} ft` : 'Check'} />
                    <TrailStat label="TIME" value={trail.typical_time || 'Check'} />
                  </View>
                  <Text style={[styles.description, { color: C.text2 }]}>{trail.description || trail.summary}</Text>
                  {!!photoCredit(trail) && (
                    <Text style={[styles.photoCredit, { color: C.text3 }]} numberOfLines={2}>
                      Photo: {photoCredit(trail)}
                    </Text>
                  )}
                  <View style={styles.detailsTable}>
                    {[
                      ['Difficulty', trail.difficulty],
                      ['Best Season', trail.best_season],
                      ['Map', trail.geometry_ref ? 'Trail line available' : 'Map point'],
                      ['Dogs', trail.dogs],
                      ['Bikes', trail.bikes],
                    ].filter(([, value]) => !!value).map(([label, value]) => (
                      <View key={label} style={[styles.detailRow, { borderTopColor: C.border }]}>
                        <Text style={[styles.detailLabel, { color: C.text2 }]}>{label}</Text>
                        <Text style={[styles.detailValue, { color: C.text }]} numberOfLines={2}>{value}</Text>
                      </View>
                    ))}
                  </View>
                  {!!trail.highlights?.length && (
                    <View style={styles.highlights}>
                      {trail.highlights.slice(0, 4).map((highlight: string) => (
                        <View key={`${trail.id}-${highlight}`} style={styles.highlightItem}>
                          <Ionicons name={highlightIcon(highlight) as any} size={22} color="#5f8f3f" />
                          <Text style={[styles.highlightText, { color: C.text2 }]} numberOfLines={2}>{highlight}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.action, { backgroundColor: C.orange }]} onPress={() => onTrailRoute?.(trail)}>
                      <Ionicons name="navigate" size={16} color="#fff" />
                      <Text style={styles.actionPrimaryText}>Route</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionSecondary, { borderColor: C.border, backgroundColor: C.s1 }]} onPress={() => onTrailMap?.(trail)}>
                      <Ionicons name="map-outline" size={16} color={C.text2} />
                      <Text style={[styles.actionSecondaryText, { color: C.text2 }]}>Map</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function nextTrailFilter(current: TrailFilter): TrailFilter {
  if (current === 'all') return 'easy';
  if (current === 'easy') return 'hard';
  return 'all';
}

function TrailStat({ label, value }: { label: string; value: string }) {
  const C = useTheme();
  return (
    <View style={[styles.stat, { borderColor: C.border }]}>
      <Text style={[styles.statValue, { color: C.text }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.statLabel, { color: C.text3 }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function formatMiles(mi?: number | null) {
  const value = typeof mi === 'number' ? mi : NaN;
  if (!Number.isFinite(value) || value <= 0) return 'Check';
  return `${value.toFixed(value >= 10 ? 0 : 1)} mi`;
}

function primaryTrailPhoto(trail: ExploreTrailCard) {
  return trail.photos?.find(photo => !!photo.url)?.url || trail.image_url || '';
}

function photoCredit(trail: ExploreTrailCard) {
  const photo = trail.photos?.find(item => !!item.url);
  return compactCredit([
    photo?.credit || trail.image_credit,
    photo?.license || trail.image_license,
    photo?.commercial_restricted ? 'limited reuse' : '',
  ]);
}

function compactCredit(parts: Array<string | undefined>) {
  return parts.map(part => String(part || '').trim()).filter(Boolean).join(' · ');
}

function difficultyTone(value: string) {
  const text = value.toLowerCase();
  if (text.includes('hard')) return { backgroundColor: '#fee2e2' };
  if (text.includes('moderate')) return { backgroundColor: '#ffedd5' };
  return { backgroundColor: '#dcfce7' };
}

function difficultyTextColor(value: string) {
  const text = value.toLowerCase();
  if (text.includes('hard')) return '#b91c1c';
  if (text.includes('moderate')) return '#c2410c';
  return '#4d7c0f';
}

function highlightIcon(value: string) {
  const text = value.toLowerCase();
  if (text.includes('water')) return 'water-outline';
  if (text.includes('view') || text.includes('summit')) return 'image-outline';
  if (text.includes('flower') || text.includes('forest') || text.includes('sequoia')) return 'leaf-outline';
  if (text.includes('family') || text.includes('easy')) return 'people-outline';
  if (text.includes('permit')) return 'ticket-outline';
  if (text.includes('exposure') || text.includes('cliff')) return 'warning-outline';
  return 'trail-sign-outline';
}

const styles = StyleSheet.create({
  shell: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 16, padding: 14, gap: 14 },
  intro: { borderRadius: 14, borderWidth: 1, borderColor: 'rgba(148,163,184,0.28)', padding: 14, gap: 6 },
  introTitle: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  introText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionLabel: { fontSize: 12, fontFamily: mono, fontWeight: '900', letterSpacing: 0 },
  sectionSub: { fontSize: 13, marginTop: 5 },
  filterButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterText: { fontSize: 11, fontFamily: mono, fontWeight: '900' },
  list: { gap: 10 },
  trailWrap: { borderWidth: 1, borderRadius: 13, overflow: 'hidden' },
  trailRow: { flexDirection: 'row', minHeight: 150 },
  trailImage: { width: 126, minHeight: 150, backgroundColor: '#e2e8f0' },
  trailBody: { flex: 1, minWidth: 0, padding: 13, gap: 6 },
  trailTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  trailTitle: { flex: 1, minWidth: 0, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  difficultyPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  difficultyText: { fontSize: 11, fontWeight: '900' },
  trailMeta: { fontSize: 13, fontWeight: '800' },
  trailArea: { fontSize: 12, fontWeight: '700' },
  trailSource: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  tagRail: { gap: 6, paddingRight: 8 },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { fontSize: 9, fontFamily: mono, fontWeight: '900' },
  detail: { borderTopWidth: 1, padding: 12, gap: 12 },
  statGrid: { flexDirection: 'row', gap: 0 },
  stat: { flex: 1, minHeight: 64, borderRightWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  statValue: { fontSize: 13, lineHeight: 16, fontWeight: '900', textAlign: 'center' },
  statLabel: { fontSize: 8, fontFamily: mono, fontWeight: '900', marginTop: 5, textAlign: 'center' },
  description: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  photoCredit: { fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  detailsTable: { gap: 0 },
  detailRow: { borderTopWidth: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  detailLabel: { fontSize: 13, fontWeight: '700' },
  detailValue: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 13, lineHeight: 17, fontWeight: '900' },
  highlights: { flexDirection: 'row', gap: 8 },
  highlightItem: { flex: 1, alignItems: 'center', gap: 5 },
  highlightText: { fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  actionPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  actionSecondary: { width: 78, minHeight: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  actionSecondaryText: { fontSize: 13, fontWeight: '900' },
});
