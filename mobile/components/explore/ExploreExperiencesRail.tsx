import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BookableExperience } from '@/lib/api';
import { useTheme } from '@/lib/design';
import { TrailheadRailSkeleton } from '@/components/TrailheadUI';

type Props = {
  experiences: BookableExperience[];
  loading?: boolean;
  error?: string;
  emptySubtitle?: string;
  title?: string;
  attribution?: string;
  variant?: 'rail' | 'list';
  mediaUrl: (url?: string | null) => string;
  onOpen?: (experience: BookableExperience) => void;
  onSave?: (experience: BookableExperience) => void;
  saveActionLabel?: string;
  onShowArea?: (experience: BookableExperience) => void;
  initialVisible?: number;
  showMoreStep?: number;
  onRetry?: () => void;
};

export function ExploreExperiencesRail({ experiences, loading, error, emptySubtitle, title = 'Guided trips', attribution, variant = 'rail', mediaUrl, onOpen, onSave, saveActionLabel = 'Add to trip', onShowArea, initialVisible, showMoreStep, onRetry }: Props) {
  const C = useTheme();
  const listMode = variant === 'list';
  const defaultVisible = initialVisible ?? (listMode ? 12 : 12);
  const step = showMoreStep ?? (listMode ? 12 : 12);
  const [visibleCount, setVisibleCount] = useState(defaultVisible);
  useEffect(() => {
    setVisibleCount(defaultVisible);
  }, [defaultVisible, experiences.length, variant]);
  if (!loading && !error && !experiences.length) return null;
  const subtitle = experiences.length
    ? `${experiences.length} guided trip${experiences.length === 1 ? '' : 's'} nearby`
    : emptySubtitle || (loading ? 'Checking current options' : 'Search a destination to compare options');
  const visibleExperiences = experiences.slice(0, Math.max(1, visibleCount));
  const remainingCount = Math.max(0, experiences.length - visibleExperiences.length);
  return (
    <View style={[listMode ? styles.listShell : styles.shell, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[listMode ? styles.listLabel : styles.label, { color: listMode ? C.text : C.orange }]}>{title}</Text>
          <Text style={[styles.sub, { color: C.text3 }]}>{subtitle}</Text>
        </View>
        {loading ? <ActivityIndicator color={C.orange} size="small" /> : <Ionicons name="ticket-outline" size={23} color={C.orange} />}
      </View>
      {error ? (
        <View style={[styles.empty, { borderColor: C.border, backgroundColor: C.s2 }]}>
          <Ionicons name="alert-circle-outline" size={19} color={C.text3} />
          <Text style={[styles.emptyText, { color: C.text2 }]}>{error}</Text>
          {!!onRetry && (
            <TouchableOpacity style={[styles.retryButton, { borderColor: C.border }]} onPress={onRetry} activeOpacity={0.82}>
              <Ionicons name="refresh" size={15} color={C.orange} />
              <Text style={[styles.retryText, { color: C.orange }]}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
      {experiences.length ? (
        listMode ? (
          <View style={styles.list}>
            {visibleExperiences.map(experience => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                mediaUrl={mediaUrl}
                onOpen={onOpen}
                onSave={onSave}
                saveActionLabel={saveActionLabel}
                onShowArea={onShowArea}
                variant="list"
              />
            ))}
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {visibleExperiences.map(experience => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                mediaUrl={mediaUrl}
                onOpen={onOpen}
                onSave={onSave}
                saveActionLabel={saveActionLabel}
                onShowArea={onShowArea}
                variant="rail"
              />
            ))}
          </ScrollView>
        )
      ) : loading ? (
        listMode ? <GuidedExperienceListSkeleton /> : <TrailheadRailSkeleton count={3} cardWidth={224} />
      ) : null}
      {remainingCount > 0 ? (
        <TouchableOpacity
          style={[styles.showMoreButton, { borderColor: C.border, backgroundColor: C.s2 }]}
          activeOpacity={0.84}
          onPress={() => setVisibleCount(count => Math.min(experiences.length, count + step))}
        >
          <Ionicons name="chevron-down-outline" size={16} color={C.orange} />
          <Text style={[styles.showMoreText, { color: C.orange }]}>
            Show {Math.min(step, remainingCount)} more
          </Text>
        </TouchableOpacity>
      ) : null}
      {experiences.length ? (
        <Text style={[styles.attribution, { color: C.text3 }]}>
          {providerDisclosure(attribution || experiences[0]?.attribution || experiences[0]?.source)}
        </Text>
      ) : null}
    </View>
  );
}

function ExperienceCard({
  experience,
  mediaUrl,
  onOpen,
  onSave,
  saveActionLabel,
  onShowArea,
  variant,
}: {
  experience: BookableExperience;
  mediaUrl: (url?: string | null) => string;
  onOpen?: (experience: BookableExperience) => void;
  onSave?: (experience: BookableExperience) => void;
  saveActionLabel: string;
  onShowArea?: (experience: BookableExperience) => void;
  variant: 'rail' | 'list';
}) {
  const C = useTheme();
  const url = experience.booking_url || experience.affiliate_url || experience.source_url || '';
  const image = experience.hero_image_url || experience.images?.find(item => !!item.url)?.url || '';
  const hasCoords = Number.isFinite(Number(experience.lat)) && Number.isFinite(Number(experience.lng));
  const listMode = variant === 'list';
  const meta = experienceMeta(experience);
  const provider = experienceProvider(experience);
  return (
    <View style={[listMode ? styles.listCard : styles.card, { borderColor: C.border, backgroundColor: C.s2 }]}>
      <View style={listMode ? styles.listImageWrap : styles.imageWrap}>
        {image ? (
          <Image source={{ uri: mediaUrl(image) }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.imageFallback, { backgroundColor: C.s3 }]}>
            <Ionicons name="ticket-outline" size={30} color={C.orange} />
          </View>
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{provider}</Text>
        </View>
      </View>
      <View style={listMode ? styles.listBody : styles.body}>
        <Text style={[listMode ? styles.listTitle : styles.title, { color: C.text }]} numberOfLines={listMode ? undefined : 2}>{experience.title}</Text>
        <Text style={[styles.providerLine, { color: C.text3 }]} numberOfLines={1}>
          {experience.supplier_name ? `${experience.supplier_name} · via ${provider}` : `Provided by ${provider}`}
        </Text>
        <Text style={[listMode ? styles.listMeta : styles.meta, { color: C.text3 }]} numberOfLines={listMode ? undefined : 1}>{meta}</Text>
        {listMode && experience.cancellation_summary ? (
          <Text style={[styles.cancelLine, { color: C.green }]}>{experience.cancellation_summary}</Text>
        ) : !listMode && experience.summary ? (
          <Text style={[styles.summary, { color: C.text2 }]}>{experience.summary}</Text>
        ) : null}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.bookButton, { backgroundColor: C.orange, opacity: url ? 1 : 0.55 }]}
            disabled={!url && !onOpen}
            onPress={() => onOpen ? onOpen(experience) : url && Linking.openURL(url)}
            accessibilityLabel={`Open details for ${experience.title}`}
          >
            <Ionicons name="information-circle-outline" size={15} color="#fff" />
            <Text style={styles.bookText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, { borderColor: C.border }]}
            onPress={() => onSave?.(experience)}
            accessibilityLabel={`${saveActionLabel}: ${experience.title}`}
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
}

function GuidedExperienceListSkeleton({ count = 3 }: { count?: number }) {
  const C = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.46, 0.88] });
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, idx) => (
        <Animated.View key={idx} style={[styles.skeletonCard, { borderColor: C.border, backgroundColor: C.s2, opacity }]}>
          <View style={[styles.skeletonImage, { backgroundColor: C.s3 }]} />
          <View style={styles.skeletonBody}>
            <View style={[styles.skeletonLineWide, { backgroundColor: C.s3 }]} />
            <View style={[styles.skeletonLine, { backgroundColor: C.s3 }]} />
            <View style={[styles.skeletonLineShort, { backgroundColor: C.s3 }]} />
          </View>
        </Animated.View>
      ))}
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
  return bits.join(' · ') || experience.region || 'Guided trip';
}

function money(value: string, currency?: string) {
  const amount = Number(value);
  const symbol = (currency || 'USD').toUpperCase() === 'USD' ? '$' : `${currency || ''} `;
  if (!Number.isFinite(amount)) return `${symbol}${value}`.trim();
  return `${symbol}${amount.toFixed(amount >= 100 ? 0 : 2)}`;
}

function sourceBadgeLabel(value: string) {
  return String(value || 'Trip')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function experienceProvider(experience: BookableExperience) {
  const source = String(experience.source || experience.source_badge || '').trim();
  if (/viator/i.test(source)) return 'Viator';
  return sourceBadgeLabel(source || 'Travel partner');
}

function providerDisclosure(value?: string) {
  const source = String(value || '').trim();
  const provider = /viator/i.test(source) ? 'Viator' : sourceBadgeLabel(source || 'the booking partner');
  return `Trip listings come from ${provider}. Current availability and checkout open there.`;
}

const styles = StyleSheet.create({
  shell: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  listShell: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 18, padding: 14, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 12, fontWeight: '900', letterSpacing: 0 },
  listLabel: { fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: 0 },
  sub: { fontSize: 13, fontWeight: '700', marginTop: 3 },
  rail: { gap: 10, paddingRight: 6 },
  list: { gap: 14 },
  card: { width: 268, borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  listCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  imageWrap: { height: 126, backgroundColor: '#111827' },
  listImageWrap: { height: 178, backgroundColor: '#111827' },
  image: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 10, left: 10, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: 'rgba(15,23,42,0.76)' },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  body: { padding: 12, gap: 7 },
  listBody: { padding: 14, gap: 8 },
  title: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  listTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  providerLine: { fontSize: 11, lineHeight: 15, fontWeight: '800' },
  meta: { fontSize: 12, fontWeight: '800' },
  listMeta: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  cancelLine: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  summary: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 7, paddingTop: 3 },
  bookButton: { flex: 1, minHeight: 40, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  bookText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  iconButton: { width: 40, minHeight: 40, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  retryButton: { minHeight: 36, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  retryText: { fontSize: 11, fontWeight: '900' },
  showMoreButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  showMoreText: { fontSize: 12, fontWeight: '900' },
  attribution: { fontSize: 10.5, lineHeight: 14, fontWeight: '700' },
  skeletonCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  skeletonImage: { height: 160 },
  skeletonBody: { padding: 14, gap: 10 },
  skeletonLineWide: { width: '82%', height: 16, borderRadius: 8 },
  skeletonLine: { width: '64%', height: 12, borderRadius: 6 },
  skeletonLineShort: { width: '42%', height: 12, borderRadius: 6 },
});
