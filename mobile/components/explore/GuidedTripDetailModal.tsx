import React, { useMemo } from 'react';
import { Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BookableExperience } from '@/lib/api';
import { useTheme } from '@/lib/design';

type Props = {
  visible: boolean;
  experience: BookableExperience | null;
  loading?: boolean;
  topInset?: number;
  mediaUrl: (url?: string | null) => string;
  onClose: () => void;
  onSave?: (experience: BookableExperience) => void;
  onShowArea?: (experience: BookableExperience) => void;
};

export function GuidedTripDetailModal({
  visible,
  experience,
  loading,
  topInset = 0,
  mediaUrl,
  onClose,
  onSave,
  onShowArea,
}: Props) {
  const C = useTheme();
  const { width } = useWindowDimensions();
  const heroWidth = Math.max(220, Math.min(Math.max(width - 32, 220), 420));
  const details = useMemo(() => buildTripDetails(experience), [experience]);
  const bookingUrl = experience?.booking_url || experience?.affiliate_url || experience?.source_url || '';
  const canMap = Number.isFinite(Number(experience?.lat)) && Number.isFinite(Number(experience?.lng));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['left', 'right', 'bottom']}>
        <View style={[styles.topBar, { paddingTop: Math.max(8, topInset + 4), borderBottomColor: C.border, backgroundColor: C.bg }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close trip details">
            <Ionicons name="chevron-back" size={20} color={C.text} />
            <Text style={[styles.closeText, { color: C.text }]}>Guided trips</Text>
          </TouchableOpacity>
          {loading ? <Text style={[styles.loadingText, { color: C.text3 }]}>Updating</Text> : null}
        </View>

        {experience ? (
          <>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.gallery}
              >
                {details.images.length ? details.images.map((image, index) => (
                  <View key={`${image.url}:${index}`} style={[styles.heroFrame, { width: heroWidth, backgroundColor: C.s2 }]}>
                    <Image source={{ uri: mediaUrl(image.url) }} style={styles.heroImage} resizeMode="cover" />
                  </View>
                )) : (
                  <View style={[styles.heroFrame, styles.heroFallback, { width: heroWidth, backgroundColor: C.s2 }]}>
                    <Ionicons name="ticket-outline" size={34} color={C.orange} />
                  </View>
                )}
              </ScrollView>

              <View style={styles.headerBlock}>
                <Text style={[styles.title, { color: C.text }]}>{experience.title}</Text>
                {details.meta.length ? (
                  <View style={styles.metaGrid}>
                    {details.meta.map(item => (
                      <View key={item.label} style={styles.metaItem}>
                        <Text style={[styles.metaLabel, { color: C.text3 }]}>{item.label}</Text>
                        <Text style={[styles.metaValue, { color: C.text }]}>{item.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              {details.overview ? (
                <DetailSection title="Overview">
                  <Text style={[styles.bodyText, { color: C.text2 }]}>{details.overview}</Text>
                </DetailSection>
              ) : null}

              {details.highlights.length ? (
                <DetailSection title="Good to know">
                  <View style={styles.listBlock}>
                    {details.highlights.map(item => <DetailRow key={item} icon="checkmark-circle-outline" text={item} />)}
                  </View>
                </DetailSection>
              ) : null}

              {details.inclusions.length ? (
                <DetailSection title="What's included">
                  <View style={styles.listBlock}>
                    {details.inclusions.map(item => <DetailRow key={item} icon="checkmark-outline" text={item} />)}
                  </View>
                </DetailSection>
              ) : null}

              {details.exclusions.length ? (
                <DetailSection title="Not included">
                  <View style={styles.listBlock}>
                    {details.exclusions.map(item => <DetailRow key={item} icon="remove-outline" text={item} />)}
                  </View>
                </DetailSection>
              ) : null}

              {details.itinerary.length ? (
                <DetailSection title="What to expect">
                  <View style={styles.listBlock}>
                    {details.itinerary.map((item: { title: string; text: string }) => (
                      <View key={`${item.title}:${item.text}`} style={styles.itineraryItem}>
                        {!!item.title && <Text style={[styles.itemTitle, { color: C.text }]}>{item.title}</Text>}
                        {!!item.text && <Text style={[styles.bodyText, { color: C.text2 }]}>{item.text}</Text>}
                      </View>
                    ))}
                  </View>
                </DetailSection>
              ) : null}

              {details.meetingPoint ? (
                <DetailSection title="Meeting point">
                  <Text style={[styles.bodyText, { color: C.text2 }]}>{details.meetingPoint}</Text>
                </DetailSection>
              ) : null}

              {details.cancellation ? (
                <DetailSection title="Cancellation">
                  <Text style={[styles.bodyText, { color: C.text2 }]}>{details.cancellation}</Text>
                </DetailSection>
              ) : null}

              {details.extra.length ? (
                <DetailSection title="Before you go">
                  <View style={styles.listBlock}>
                    {details.extra.map(item => <DetailRow key={item} icon="information-circle-outline" text={item} />)}
                  </View>
                </DetailSection>
              ) : null}

              <Text style={[styles.attribution, { color: C.text3 }]}>Tour content from Viator.</Text>
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: C.border, backgroundColor: C.bg }]}>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: C.border, opacity: canMap ? 1 : 0.48 }]}
                disabled={!canMap}
                onPress={() => onShowArea?.(experience)}
                accessibilityLabel="Open trip area"
              >
                <Ionicons name="map-outline" size={17} color={canMap ? C.text2 : C.text3} />
                <Text style={[styles.secondaryButtonText, { color: canMap ? C.text2 : C.text3 }]}>Map</Text>
              </TouchableOpacity>
              {onSave ? (
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: C.border }]}
                  onPress={() => onSave(experience)}
                  accessibilityLabel="Save trip"
                >
                  <Ionicons name="add-circle-outline" size={17} color={C.text2} />
                  <Text style={[styles.secondaryButtonText, { color: C.text2 }]}>Save</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: C.orange, opacity: bookingUrl ? 1 : 0.55 }]}
                disabled={!bookingUrl}
                onPress={() => bookingUrl && Linking.openURL(bookingUrl)}
                accessibilityLabel="Check availability"
              >
                <Text style={styles.primaryButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>Check availability</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="ticket-outline" size={30} color={C.orange} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>Trip unavailable</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  const C = useTheme();
  return (
    <View style={[styles.section, { borderTopColor: C.border }]}>
      <Text style={[styles.sectionTitle, { color: C.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const C = useTheme();
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={17} color={C.orange} />
      <Text style={[styles.rowText, { color: C.text2 }]}>{text}</Text>
    </View>
  );
}

function buildTripDetails(experience: BookableExperience | null) {
  const raw = experience?.raw || {};
  const images = uniqueImages(experience);
  const meta = [
    experience?.price_from ? { label: 'Price', value: money(experience.price_from, experience.currency) } : null,
    experience?.duration_label ? { label: 'Duration', value: experience.duration_label } : null,
    ratingText(experience) ? { label: 'Rating', value: ratingText(experience) } : null,
    experience?.cancellation_summary ? { label: 'Cancel', value: experience.cancellation_summary } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const highlights = uniqueText([
    experience?.availability_summary,
    experience?.cancellation_summary,
    experience?.mobile_ticket ? 'Mobile ticket' : '',
    experience?.instant_confirmation ? 'Instant confirmation' : '',
    ...flagLabels(raw?.flags),
    ...(experience?.languages || []).map(language => `Language: ${language}`),
  ]).slice(0, 6);
  return {
    images,
    meta,
    overview: cleanText(experience?.description || experience?.summary || ''),
    highlights,
    inclusions: uniqueText(experience?.inclusions || []).slice(0, 8),
    exclusions: uniqueText(experience?.exclusions || []).slice(0, 8),
    itinerary: itineraryItems(raw).slice(0, 5),
    meetingPoint: meetingPoint(raw),
    cancellation: cancellationText(raw, experience?.cancellation_summary),
    extra: uniqueText(additionalInfo(raw)).slice(0, 6),
  };
}

function uniqueImages(experience: BookableExperience | null) {
  const seen = new Set<string>();
  const out: Array<{ url: string; caption?: string }> = [];
  const add = (url?: string | null, caption?: string) => {
    const clean = cleanText(url || '');
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({ url: clean, caption });
  };
  add(experience?.hero_image_url, experience?.title);
  for (const image of experience?.images || []) add(image.url, image.caption);
  return out.slice(0, 8);
}

function uniqueText(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = cleanText(value || '');
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

function cleanText(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\bexternal checkout\b/gi, 'checkout')
    .replace(/\broute anchor\b/gi, 'stop')
    .replace(/\bplanning anchor\b/gi, 'stop')
    .trim();
}

function flagLabels(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags.map(flag => {
    const value = String(flag || '').toUpperCase();
    if (value === 'FREE_CANCELLATION') return 'Free cancellation';
    if (value === 'PRIVATE_TOUR') return 'Private trip';
    if (value === 'LIKELY_TO_SELL_OUT') return 'Likely to sell out';
    if (value === 'MOBILE_TICKET') return 'Mobile ticket';
    if (value === 'INSTANT_CONFIRMATION') return 'Instant confirmation';
    return '';
  }).filter(Boolean);
}

function itineraryItems(raw: Record<string, any>) {
  const itinerary = raw?.itinerary || {};
  const items = Array.isArray(itinerary?.itineraryItems)
    ? itinerary.itineraryItems
    : Array.isArray(itinerary?.items)
      ? itinerary.items
      : [];
  return items.map((item: any) => ({
    title: cleanText(item?.title || item?.name || item?.pointOfInterestLocation?.location?.name || ''),
    text: cleanText(item?.description || item?.details || item?.duration || ''),
  })).filter((item: { title: string; text: string }) => item.title || item.text);
}

function meetingPoint(raw: Record<string, any>) {
  const logistics = raw?.logistics || {};
  const start = Array.isArray(logistics?.start) ? logistics.start[0] : logistics?.start;
  const location = start?.location || start?.meetingPoint || raw?.meetingPoint;
  return cleanText([
    location?.name,
    location?.address,
    start?.description,
  ].filter(Boolean).join(', '));
}

function cancellationText(raw: Record<string, any>, fallback?: string) {
  const policy = raw?.cancellationPolicy || raw?.cancellation;
  return cleanText(policy?.description || policy?.policyText || fallback || '');
}

function additionalInfo(raw: Record<string, any>) {
  const values = raw?.additionalInfo || raw?.additional_info || [];
  if (!Array.isArray(values)) return [];
  return values.map((item: any) => typeof item === 'string' ? item : item?.description || item?.text || item?.name);
}

function ratingText(experience: BookableExperience | null) {
  if (typeof experience?.rating !== 'number' || experience.rating <= 0) return '';
  const count = Number(experience.review_count || 0);
  const suffix = count > 0 ? ` (${count} ${count === 1 ? 'review' : 'reviews'})` : '';
  return `${experience.rating.toFixed(1)}${suffix}`;
}

function money(value?: string, currency?: string) {
  const amount = Number(value);
  if (!value || !Number.isFinite(amount) || amount <= 0) return '';
  const symbol = (currency || 'USD').toUpperCase() === 'USD' ? '$' : `${currency || ''} `;
  return `${symbol}${amount.toFixed(amount >= 100 ? 0 : 2)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  closeText: { fontSize: 15, lineHeight: 20, fontWeight: '900' },
  loadingText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  scroll: { flex: 1 },
  content: { paddingBottom: 128 },
  gallery: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  heroFrame: { height: 236, borderRadius: 18, overflow: 'hidden' },
  heroImage: { width: '100%', height: '100%' },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  headerBlock: { paddingHorizontal: 20, paddingTop: 18, gap: 14 },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '900', letterSpacing: 0 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { width: '47%', minHeight: 56, justifyContent: 'center' },
  metaLabel: { fontSize: 11, lineHeight: 15, fontWeight: '800' },
  metaValue: { marginTop: 3, fontSize: 14, lineHeight: 18, fontWeight: '900' },
  section: { marginHorizontal: 20, marginTop: 20, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  sectionTitle: { fontSize: 20, lineHeight: 25, fontWeight: '900', letterSpacing: 0 },
  bodyText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  listBlock: { gap: 10 },
  detailRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  rowText: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  itineraryItem: { gap: 4 },
  itemTitle: { fontSize: 15, lineHeight: 20, fontWeight: '900' },
  attribution: { marginHorizontal: 20, marginTop: 22, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    width: 68,
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  secondaryButtonText: { fontSize: 11, lineHeight: 14, fontWeight: '900' },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryButtonText: { color: '#fff', fontSize: 14, lineHeight: 18, fontWeight: '900' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emptyTitle: { fontSize: 20, lineHeight: 25, fontWeight: '900' },
});
