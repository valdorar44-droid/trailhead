import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile, ExploreTrailCard } from '@/lib/api';
import { mono, useTheme } from '@/lib/design';
import { getExploreDisplayTitle, getExploreTrailCards } from './exploreDisplay';

type TrailFilter = 'all' | 'easy' | 'moderate' | 'hard';

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
  const areaPhoto = useMemo(() => primaryAreaPhoto(place), [place]);

  useEffect(() => {
    if (selectedId && !trails.some(trail => trail.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, trails]);

  useEffect(() => {
    if (filter !== 'all' && trails.length > 0 && visibleTrails.length === 0) {
      setFilter('all');
    }
  }, [filter, trails.length, visibleTrails.length]);

  if (!trails.length) return null;

  return (
    <View style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.intro}>
        <Text style={[styles.introTitle, { color: C.text }]}>
          Trails near {getExploreDisplayTitle(place).replace(/\s+Trails$/i, '')}
        </Text>
        <Text style={[styles.introText, { color: C.text2 }]}>
          Pick a route, preview the basics, then open it on the map.
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
          const photo = primaryTrailPhoto(trail) || areaPhoto;
          const featureLabel = trail.feature_label || trail.feature_type?.replace(/_/g, ' ') || 'Trail';
          return (
            <View key={trail.id} style={[styles.trailWrap, { borderColor: selected ? C.orange + '66' : C.border, backgroundColor: C.s2 }]}>
              <TouchableOpacity
                style={styles.trailRow}
                activeOpacity={0.88}
                onPress={() => setSelectedId(current => current === trail.id ? null : trail.id)}
              >
                {photo ? (
                  <Image source={{ uri: mediaUrl(photo) }} style={styles.trailImage} resizeMode="cover" />
                ) : (
                  <View style={styles.trailImageFallback}>
                    <Ionicons name="trail-sign-outline" size={32} color="#64748b" />
                  </View>
                )}
                <View style={styles.trailBody}>
                  <View style={styles.trailTitleRow}>
                    <Text style={[styles.trailTitle, { color: C.text }]} numberOfLines={2}>{trail.title}</Text>
                    <Ionicons name={selected ? 'chevron-up' : 'chevron-down'} size={18} color={C.text3} />
                  </View>
                  <View style={[styles.difficultyPill, difficultyTone(trail.difficulty)]}>
                    <Text style={[styles.difficultyText, { color: difficultyTextColor(trail.difficulty) }]}>
                      {featureLabel} · {trail.difficulty}
                    </Text>
                  </View>
                  <Text style={[styles.trailMeta, { color: C.text2 }]} numberOfLines={1}>
                    {[formatMiles(trail.distance_mi), formatGain(trail.elevation_gain_ft), trail.route_type].filter(Boolean).join(' · ')}
                  </Text>
                  {!!trail.area && <Text style={[styles.trailArea, { color: C.text3 }]} numberOfLines={1}>{trail.area}</Text>}
                </View>
              </TouchableOpacity>
              {selected && (
                <View style={[styles.detail, { borderTopColor: C.border }]}>
                  <View style={styles.statGrid}>
                    <TrailStat label="DISTANCE" value={formatMiles(trail.distance_mi)} />
                    <TrailStat label="GAIN" value={formatGain(trail.elevation_gain_ft) || 'Check'} />
                    <TrailStat label="TIME" value={trail.typical_time || 'Check'} />
                  </View>
                  <Text style={[styles.description, { color: C.text2 }]} numberOfLines={4}>{trail.description || trail.summary}</Text>
                  {!!photoCredit(trail) && (
                    <Text style={[styles.photoCredit, { color: C.text3 }]} numberOfLines={2}>
                      Photo: {photoCredit(trail)}
                    </Text>
                  )}
                  {!!(trail.permit_note || trail.trekking_only) && (
                    <View style={[styles.warningBox, { borderColor: C.orange + '55', backgroundColor: C.orange + '12' }]}>
                      <Ionicons name="warning-outline" size={17} color={C.orange} />
                      <Text style={[styles.warningText, { color: C.text2 }]}>
                        {trail.permit_note || 'Verify route, guide, weather, and local safety before heading out.'}
                      </Text>
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
  if (current === 'easy') return 'moderate';
  if (current === 'moderate') return 'hard';
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

function formatGain(value?: number | null) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  return `${Math.round(Number(value)).toLocaleString()} ft`;
}

function primaryTrailPhoto(trail: ExploreTrailCard) {
  return trail.photos?.find(photo => !!photo.url)?.url || trail.image_url || '';
}

function primaryAreaPhoto(place: ExplorePlaceProfile) {
  return (
    place.summary.image_url
    || place.summary.thumbnail_url
    || place.source_pack?.photos?.find(photo => !!photo.url)?.url
    || ''
  );
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
  trailImageFallback: { width: 126, minHeight: 150, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0' },
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
  warningBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  warningText: { flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
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
