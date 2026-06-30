import React from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BookableExperience } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { TrailheadRailSkeleton } from '@/components/TrailheadUI';

type Props = {
  experiences: BookableExperience[];
  loading?: boolean;
  error?: string;
  emptySubtitle?: string;
  mediaUrl: (url?: string | null) => string;
  onSave?: (experience: BookableExperience) => void;
  onShowArea?: (experience: BookableExperience) => void;
};

export function ExploreExperiencesRail({ experiences, loading, error, emptySubtitle, mediaUrl, onSave, onShowArea }: Props) {
  const C = useTheme();
  if (!loading && !error && !experiences.length) return null;
  const subtitle = experiences.length
    ? `${experiences.length} bookable option${experiences.length === 1 ? '' : 's'} nearby`
    : emptySubtitle || (loading ? 'Checking current options' : 'Search a destination to compare options');
  return (
    <View style={[styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.label, { color: C.orange }]}>Guided Trips</Text>
          <Text style={[styles.sub, { color: C.text3 }]}>{subtitle}</Text>
        </View>
        {loading ? <ActivityIndicator color={C.orange} size="small" /> : <Ionicons name="ticket-outline" size={23} color={C.orange} />}
      </View>
      {error ? (
        <View style={[styles.empty, { borderColor: C.border, backgroundColor: C.s2 }]}>
          <Ionicons name="alert-circle-outline" size={19} color={C.text3} />
          <Text style={[styles.emptyText, { color: C.text2 }]}>{error}</Text>
        </View>
      ) : null}
      {experiences.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
          {experiences.slice(0, 12).map(experience => {
            const url = experience.booking_url || experience.affiliate_url || experience.source_url || '';
            const image = experience.hero_image_url || experience.images?.find(item => !!item.url)?.url || '';
            const hasCoords = Number.isFinite(Number(experience.lat)) && Number.isFinite(Number(experience.lng));
            return (
              <View key={experience.id} style={[styles.card, { borderColor: C.border, backgroundColor: C.s2 }]}>
                <View style={styles.imageWrap}>
                  {image ? (
                    <Image source={{ uri: mediaUrl(image) }} style={styles.image} resizeMode="cover" />
                  ) : (
                    <View style={[styles.imageFallback, { backgroundColor: C.s3 }]}>
                      <Ionicons name="ticket-outline" size={30} color={C.orange} />
                    </View>
                  )}
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{sourceBadgeLabel(experience.source_badge || 'Partner')}</Text>
                  </View>
                </View>
                <View style={styles.body}>
                  <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>{experience.title}</Text>
                  <Text style={[styles.meta, { color: C.text3 }]} numberOfLines={1}>{experienceMeta(experience)}</Text>
                  {!!experience.summary && (
                    <Text style={[styles.summary, { color: C.text2 }]}>{experience.summary}</Text>
                  )}
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.bookButton, { backgroundColor: C.orange, opacity: url ? 1 : 0.55 }]}
                      disabled={!url}
                      onPress={() => url && Linking.openURL(url)}
                      accessibilityLabel={`Open booking for ${experience.title}`}
                    >
                      <Ionicons name="open-outline" size={15} color="#fff" />
                      <Text style={styles.bookText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>Open Booking</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.iconButton, { borderColor: C.border }]}
                      onPress={() => onSave?.(experience)}
                      accessibilityLabel={`Save ${experience.title} to trip`}
                    >
                      <Ionicons name="add-circle-outline" size={17} color={C.text2} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.iconButton, { borderColor: C.border, opacity: hasCoords ? 1 : 0.45 }]}
                      disabled={!hasCoords}
                      onPress={() => onShowArea?.(experience)}
                      accessibilityLabel={hasCoords ? `Show ${experience.title} area on map` : `Map unavailable for ${experience.title}`}
                    >
                      <Ionicons name="map-outline" size={17} color={hasCoords ? C.text2 : C.text3} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : loading ? (
        <TrailheadRailSkeleton count={3} cardWidth={224} />
      ) : null}
      {experiences.length ? (
        <Text style={[styles.attribution, { color: C.text3 }]}>Trailhead may earn from booking links. Availability and payment happen on the booking site.</Text>
      ) : null}
    </View>
  );
}

function experienceMeta(experience: BookableExperience) {
  const bits = [];
  if (experience.price_from) bits.push(`From ${money(experience.price_from, experience.currency)}`);
  if (experience.duration_label) bits.push(experience.duration_label);
  if (typeof experience.rating === 'number') {
    bits.push(`${experience.rating.toFixed(1)}${experience.review_count ? ` (${experience.review_count})` : ''}`);
  }
  if (typeof experience.distance_mi === 'number') bits.push(`${experience.distance_mi.toFixed(experience.distance_mi >= 10 ? 0 : 1)} mi`);
  return bits.join(' · ') || experience.region || 'Partner option';
}

function money(value: string, currency?: string) {
  const amount = Number(value);
  const symbol = (currency || 'USD').toUpperCase() === 'USD' ? '$' : `${currency || ''} `;
  if (!Number.isFinite(amount)) return `${symbol}${value}`.trim();
  return `${symbol}${amount.toFixed(amount >= 100 ? 0 : 2)}`;
}

function sourceBadgeLabel(value: string) {
  return String(value || 'Partner')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

const styles = StyleSheet.create({
  shell: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 12, fontWeight: '900', letterSpacing: 0 },
  sub: { fontSize: 13, fontWeight: '700', marginTop: 3 },
  rail: { gap: 10, paddingRight: 6 },
  card: { width: 268, borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  imageWrap: { height: 126, backgroundColor: '#111827' },
  image: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 10, left: 10, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: 'rgba(15,23,42,0.76)' },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  body: { padding: 12, gap: 7 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  meta: { fontSize: 12, fontWeight: '800' },
  summary: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 7, paddingTop: 3 },
  bookButton: { flex: 1, minHeight: 40, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  bookText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  iconButton: { width: 40, minHeight: 40, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  attribution: { fontSize: 10.5, lineHeight: 14, fontWeight: '700' },
});
