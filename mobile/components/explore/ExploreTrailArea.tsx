import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile, ExploreTrailCard } from '@/lib/api';
import { mono, useTheme } from '@/lib/design';
import { boundedExploreImageUrl, EXPLORE_IMAGE_BOUNDS, exploreImageSource } from '@/lib/mediaPolicy';
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
  const availableFilters = useMemo(() => {
    const next: TrailFilter[] = [];
    (['easy', 'moderate', 'hard'] as TrailFilter[]).forEach(item => {
      if (trails.some(trail => matchesTrailFilter(trail, item))) next.push(item);
    });
    return next;
  }, [trails]);
  const visibleTrails = useMemo(
    () => filter === 'all' ? trails : trails.filter(trail => matchesTrailFilter(trail, filter)),
    [filter, trails],
  );
  const areaPhoto = useMemo(() => primaryAreaPhoto(place), [place]);
  const areaTitle = getExploreDisplayTitle(place).replace(/\s+Trails$/i, '');

  useEffect(() => {
    if (selectedId && !trails.some(trail => trail.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, trails]);

  useEffect(() => {
    if (filter !== 'all' && !availableFilters.includes(filter)) {
      setFilter('all');
    }
  }, [availableFilters, filter]);

  if (!trails.length) return null;

  return (
    <View style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.intro}>
        <Text style={[styles.introTitle, { color: C.text }]}>
          Trails near {areaTitle}
        </Text>
        <Text style={[styles.introText, { color: C.text2 }]}>
          Pick by distance, climb, grade, and current access.
        </Text>
      </View>

      <View style={styles.sectionTop}>
        <View>
          <Text style={[styles.sectionLabel, { color: C.orange }]}>Trails in this area</Text>
          <Text style={[styles.sectionSub, { color: C.text3 }]}>
            {filter === 'all' ? `${trails.length} trails` : `${visibleTrails.length} ${filter}`}
          </Text>
        </View>
        {availableFilters.length > 0 && (
          <TouchableOpacity
            style={[styles.filterButton, { borderColor: C.border, backgroundColor: C.s2 }]}
            activeOpacity={0.84}
            onPress={() => setFilter(current => nextTrailFilter(current, availableFilters))}
          >
            <Ionicons name="options-outline" size={16} color={C.text2} />
            <Text style={[styles.filterText, { color: C.text2 }]}>
              {filter === 'all' ? 'Filters' : titleCaseFilter(filter)}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.list}>
        {visibleTrails.map(trail => {
          const selected = selectedId === trail.id;
          const photo = primaryTrailPhoto(trail) || areaPhoto;
          const safePhoto = boundedExploreImageUrl(mediaUrl(photo), EXPLORE_IMAGE_BOUNDS.trail);
          const featureLabel = cleanTrailLabel(trail.feature_label || trail.feature_type?.replace(/_/g, ' ') || 'Trail');
          const difficulty = cleanTrailDifficulty(trail.difficulty);
          const routeType = cleanTrailRouteType(trail.route_type);
          const distance = formatMiles(trail.distance_mi);
          const gain = formatGain(trail.elevation_gain_ft);
          const time = trail.typical_time || estimateTrailTime(trail.distance_mi);
          const details = trailPlanRows(trail, featureLabel, routeType);
          const description = trailDescription(trail);
          const metrics = [
            { label: 'Distance', value: distance || 'Check route' },
            { label: 'Gain', value: gain || 'Varies' },
            { label: 'Grade', value: difficulty },
            { label: 'Time', value: time },
          ];
          return (
            <View key={trail.id} style={[styles.trailWrap, { borderColor: selected ? C.orange + '66' : C.border, backgroundColor: C.s2 }]}>
              <TouchableOpacity
                style={styles.trailCardTop}
                activeOpacity={0.88}
                onPress={() => setSelectedId(current => current === trail.id ? null : trail.id)}
              >
                <View style={styles.trailImageShell}>
                  {safePhoto ? (
                    <Image source={exploreImageSource(safePhoto)} style={styles.trailImage} resizeMode="cover" resizeMethod="resize" />
                  ) : (
                    <View style={styles.trailImageFallback}>
                      <Ionicons name="trail-sign-outline" size={32} color="#64748b" />
                    </View>
                  )}
                  <View style={styles.trailImageShade} />
                  <View style={[styles.difficultyBadge, difficultyTone(trail.difficulty)]}>
                    <Text style={[styles.difficultyText, { color: difficultyTextColor(trail.difficulty) }]}>
                      {difficulty}
                    </Text>
                  </View>
                  {!!routeType && (
                    <View style={styles.routeBadge}>
                      <Text style={styles.routeBadgeText}>{routeType}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.trailBody}>
                  <View style={styles.trailTitleRow}>
                    <Text style={[styles.trailTitle, { color: C.text }]}>{trail.title}</Text>
                    <Ionicons name={selected ? 'chevron-up' : 'chevron-down'} size={18} color={C.text3} />
                  </View>
                  <Text style={[styles.trailMeta, { color: C.text2 }]}>
                    {[featureLabel, trail.area].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.metricGrid}>
                    {metrics.map(metric => (
                      <TrailMetric key={`${trail.id}-${metric.label}`} label={metric.label} value={metric.value} />
                    ))}
                  </View>
                </View>
              </TouchableOpacity>
              {selected && (
                <View style={[styles.detail, { borderTopColor: C.border }]}>
                  <Text style={[styles.description, { color: C.text2 }]}>
                    {description}
                  </Text>
                  {details.length > 0 && (
                    <View style={[styles.planRows, { borderColor: C.border }]}>
                      {details.map(row => (
                        <TrailDetailRow key={`${trail.id}-${row.label}`} label={row.label} value={row.value} />
                      ))}
                    </View>
                  )}
                  {!!photoCredit(trail) && (
                    <Text style={[styles.photoCredit, { color: C.text3 }]}>
                      Photo: {photoCredit(trail)}
                    </Text>
                  )}
                  {!!(trail.permit_note || trail.trekking_only) && (
                    <View style={[styles.warningBox, { borderColor: C.orange + '55', backgroundColor: C.orange + '12' }]}>
                      <Ionicons name="warning-outline" size={17} color={C.orange} />
                      <Text style={[styles.warningText, { color: C.text2 }]}>
                        {trail.permit_note || 'Review route, guide, weather, and local safety before heading out.'}
                      </Text>
                    </View>
                  )}
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.action, { backgroundColor: C.orange }]} onPress={() => onTrailRoute?.(trail)}>
                      <Ionicons name="navigate-outline" size={16} color="#fff" />
                      <Text style={styles.actionPrimaryText}>Directions to trailhead</Text>
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

function TrailMetric({ label, value }: { label: string; value: string }) {
  const C = useTheme();
  return (
    <View style={[styles.metric, { borderColor: C.border }]}>
      <Text
        style={[styles.metricValue, { color: C.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: C.text3 }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function nextTrailFilter(current: TrailFilter, available: TrailFilter[]): TrailFilter {
  if (!available.length) return 'all';
  if (current === 'all') return available[0] || 'all';
  const next = available[available.indexOf(current) + 1];
  return next || 'all';
}

function titleCaseFilter(filter: TrailFilter) {
  return filter.replace(/^\w/, char => char.toUpperCase());
}

function TrailDetailRow({ label, value }: { label: string; value: string }) {
  const C = useTheme();
  return (
    <View style={[styles.detailRow, { borderTopColor: C.border }]}>
      <Text style={[styles.detailLabel, { color: C.text2 }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: C.text }]}>{value}</Text>
    </View>
  );
}

function cleanTrailLabel(value?: string | null) {
  const clean = String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || /^(mapped|open|source)$/i.test(clean)) return 'Trail';
  return clean.replace(/\b\w/g, char => char.toUpperCase());
}

function cleanTrailDifficulty(value?: string | null) {
  const clean = String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || /^scout first$/i.test(clean)) return 'Access varies';
  if (/\b(undefined|null|nan)\b/i.test(clean)) return 'Access varies';
  return clean;
}

function cleanTrailRouteType(value?: string | null) {
  const clean = String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || /^(point or route|map|open map)$/i.test(clean)) return '';
  if (/^mapped route$/i.test(clean)) return 'Trail route';
  if (/\b(api|endpoint|feature|layer|schema|database|dump|import|raw|source)\b/i.test(clean)) return '';
  return clean;
}

function cleanTrailCopy(value?: string | null) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (/\b(undefined|null|nan|api|endpoint|feature|schema|database|dump|import|raw)\b/i.test(clean)) return '';
  return clean;
}

function matchesTrailFilter(trail: ExploreTrailCard, filter: TrailFilter) {
  if (filter === 'all') return true;
  return cleanTrailDifficulty(trail.difficulty).toLowerCase().includes(filter);
}

function formatMiles(mi?: number | null) {
  const value = typeof mi === 'number' ? mi : NaN;
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 10) return `${Math.round(value)} mi`;
  const rounded = Number(value.toFixed(1));
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded} mi`;
}

function formatGain(value?: number | null) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  return `${Math.round(Number(value)).toLocaleString()} ft`;
}

function estimateTrailTime(mi?: number | null) {
  const value = typeof mi === 'number' ? mi : NaN;
  if (!Number.isFinite(value) || value <= 0) return 'Check pace';
  const hours = Math.max(1, Math.round(value / 2));
  if (hours <= 1) return 'About 1 hr';
  return `${hours}-${hours + 1} hrs`;
}

function trailDescription(trail: ExploreTrailCard) {
  return (
    cleanTrailCopy(trail.description)
    || cleanTrailCopy(trail.summary)
    || `${trail.title}. Check current access, weather, daylight, and local rules before starting.`
  );
}

function trailPlanRows(trail: ExploreTrailCard, featureLabel: string, routeType: string) {
  const rows: Array<{ label: string; value: string }> = [];
  const route = cleanTrailCopy(routeType || featureLabel);
  const season = cleanTrailCopy(trail.best_season || trail.season_window);
  const dogs = cleanTrailCopy(trail.dogs);
  const bikes = cleanTrailCopy(trail.bikes);
  const permit = cleanTrailCopy(trail.permit_note);
  const area = cleanTrailCopy(trail.area);
  if (route) rows.push({ label: 'Route', value: route });
  if (season) rows.push({ label: 'Season', value: season });
  if (dogs) rows.push({ label: 'Dogs', value: dogs });
  if (bikes) rows.push({ label: 'Bikes', value: bikes });
  if (permit) rows.push({ label: 'Access', value: permit });
  if (!permit && area) rows.push({ label: 'Area', value: area });
  return rows.slice(0, 4);
}

function primaryTrailPhoto(trail: ExploreTrailCard) {
  return trail.photos?.find(photo => !!photo.url)?.url || trail.image_url || '';
}

function primaryAreaPhoto(place: ExplorePlaceProfile) {
  return (
    place.summary.thumbnail_url
    || place.summary.image_url
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
  const text = cleanTrailDifficulty(value).toLowerCase();
  if (text.includes('hard')) return { backgroundColor: '#fee2e2' };
  if (text.includes('moderate')) return { backgroundColor: '#ffedd5' };
  return { backgroundColor: '#dcfce7' };
}

function difficultyTextColor(value: string) {
  const text = cleanTrailDifficulty(value).toLowerCase();
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
  trailWrap: { borderWidth: 1, borderRadius: 15, overflow: 'hidden' },
  trailCardTop: { minHeight: 244 },
  trailImageShell: { height: 188, width: '100%', backgroundColor: '#e2e8f0' },
  trailImage: { width: '100%', height: '100%', backgroundColor: '#e2e8f0' },
  trailImageFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0' },
  trailImageShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 74, backgroundColor: 'rgba(15,23,42,0.28)' },
  trailBody: { flex: 1, minWidth: 0, padding: 13, gap: 10 },
  trailTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  trailTitle: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 25, fontWeight: '900' },
  difficultyBadge: { position: 'absolute', left: 12, bottom: 12, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  difficultyText: { fontSize: 11, fontWeight: '900' },
  routeBadge: { position: 'absolute', right: 12, bottom: 12, maxWidth: 150, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: 'rgba(15,23,42,0.72)' },
  routeBadgeText: { color: '#fff', fontSize: 11, lineHeight: 13, fontWeight: '900' },
  trailMeta: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  trailArea: { fontSize: 12, fontWeight: '700' },
  trailSource: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  tagRail: { gap: 6, paddingRight: 8 },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { fontSize: 9, fontFamily: mono, fontWeight: '900' },
  detail: { borderTopWidth: 1, padding: 12, gap: 12 },
  metricGrid: { flexDirection: 'row', borderWidth: 1, borderColor: 'rgba(148,163,184,0.32)', borderRadius: 13, overflow: 'hidden' },
  metric: { flex: 1, minHeight: 58, borderRightWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  metricValue: { fontSize: 13, lineHeight: 16, fontWeight: '900', textAlign: 'center' },
  metricLabel: { fontSize: 8, fontFamily: mono, fontWeight: '900', marginTop: 5, textAlign: 'center' },
  description: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  photoCredit: { fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  warningBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  warningText: { flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 16, fontWeight: '700' },
  planRows: { borderWidth: 1, borderRadius: 13, overflow: 'hidden' },
  detailRow: { borderTopWidth: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
  detailLabel: { fontSize: 12, fontWeight: '800' },
  detailValue: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 12.5, lineHeight: 17, fontWeight: '900' },
  highlights: { flexDirection: 'row', gap: 8 },
  highlightItem: { flex: 1, alignItems: 'center', gap: 5 },
  highlightText: { fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  actionPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  actionSecondary: { width: 78, minHeight: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  actionSecondaryText: { fontSize: 13, fontWeight: '900' },
});
