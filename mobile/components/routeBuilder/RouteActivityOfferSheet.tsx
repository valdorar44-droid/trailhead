import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type AppStateStatus,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TrailheadSheet } from '@/components/TrailheadUI';
import type { BookableExperience } from '@/lib/api';
import { TRAILHEAD_API_BASE } from '@/lib/apiBase';
import { useTheme } from '@/lib/design';
import {
  isUsableViatorRouteActivity,
  routeActivityBookingUrl,
  type PendingRouteActivityOffer,
} from '@/lib/routeActivityOffer';

type OfferMode = 'invite' | 'away' | 'confirm';

type Props = {
  activeTripId?: string | null;
  bottomInset?: number;
  offer: PendingRouteActivityOffer | null;
  onAdd: (experience: BookableExperience) => void;
  onOpen?: (experience: BookableExperience) => void;
  onDismiss: () => void;
};

function imageUrl(experience: BookableExperience) {
  const url = experience.hero_image_url || experience.images?.find(image => image.url)?.url || '';
  if (!url) return '';
  return url.startsWith('/') ? `${TRAILHEAD_API_BASE}${url}` : url;
}

function offerMeta(experience: BookableExperience) {
  const price = experience.price_from
    ? `From ${money(experience.price_from, experience.currency)}`
    : '';
  const rating = experience.rating
    ? `${Number(experience.rating).toFixed(1)}${experience.review_count ? ` (${experience.review_count})` : ''}`
    : '';
  return [experience.duration_label, price, rating].filter(Boolean).join(' · ');
}

function money(value: string, currency?: string) {
  const amount = Number(value);
  const code = (currency || 'USD').toUpperCase();
  const symbol = code === 'USD' ? '$' : `${code} `;
  if (!Number.isFinite(amount)) return `${symbol}${value}`.trim();
  return `${symbol}${amount.toFixed(amount >= 100 ? 0 : 2)}`;
}

export default function RouteActivityOfferSheet({
  activeTripId,
  bottomInset = 0,
  offer,
  onAdd,
  onOpen,
  onDismiss,
}: Props) {
  const C = useTheme();
  const { height } = useWindowDimensions();
  const [mode, setMode] = useState<OfferMode>('invite');
  const [selected, setSelected] = useState<BookableExperience | null>(null);
  const didLeaveAppRef = useRef(false);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const experiences = useMemo(
    () => (offer?.experiences ?? []).filter(isUsableViatorRouteActivity),
    [offer],
  );
  const visible = Boolean(offer && offer.tripId === activeTripId && experiences.length > 0);

  useEffect(() => {
    setMode('invite');
    setSelected(null);
    didLeaveAppRef.current = false;
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
  }, [offer?.createdAt, offer?.tripId]);

  useEffect(() => {
    if (mode !== 'away' || !selected) return;
    const onAppState = (state: AppStateStatus) => {
      if (state === 'inactive' || state === 'background') didLeaveAppRef.current = true;
      if (state === 'active' && didLeaveAppRef.current) setMode('confirm');
    };
    const subscription = AppState.addEventListener('change', onAppState);
    return () => subscription.remove();
  }, [mode, selected]);

  useEffect(() => () => {
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
  }, []);

  async function openExperience(experience: BookableExperience) {
    const url = routeActivityBookingUrl(experience);
    if (!url) return;
    setSelected(experience);
    setMode('away');
    didLeaveAppRef.current = false;
    onOpen?.(experience);
    try {
      await Linking.openURL(url);
      fallbackRef.current = setTimeout(() => setMode('confirm'), 1200);
    } catch {
      setSelected(null);
      setMode('invite');
      Alert.alert('Could not open Viator', 'Check your connection and try again.');
    }
  }

  function dismiss() {
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
    didLeaveAppRef.current = false;
    setSelected(null);
    setMode('invite');
    onDismiss();
  }

  function confirmBooking() {
    if (!selected) return;
    onAdd(selected);
    dismiss();
  }

  if (!visible || mode === 'away') return null;

  const confirming = mode === 'confirm' && selected;
  const content = (
      <View
        style={[styles.overlay, Platform.OS === 'web' && styles.webOverlay]}
        accessibilityViewIsModal
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Close activity suggestions"
        />
        <TrailheadSheet
          style={styles.sheet}
          contentStyle={[styles.sheetContent, { paddingBottom: Math.max(18, bottomInset + 12) }]}
          maxHeight={Math.min(620, height - 64)}
          scroll
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: C.text }]}>
              {confirming ? `Did you book ${selected.title}?` : 'Add something memorable?'}
            </Text>
            <TouchableOpacity
              style={[styles.closeButton, { borderColor: C.border, backgroundColor: C.s2 }]}
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={18} color={C.text2} />
            </TouchableOpacity>
          </View>

          {confirming ? (
            <View>
              <View style={[styles.confirmedItem, { borderColor: C.border, backgroundColor: C.s2 }]}>
                {imageUrl(selected) ? (
                  <Image source={{ uri: imageUrl(selected) }} style={styles.confirmImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.confirmImage, styles.imageFallback, { backgroundColor: C.s3 }]}>
                    <Ionicons name="ticket-outline" size={24} color={C.orange} />
                  </View>
                )}
                <View style={styles.confirmText}>
                  <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={2}>{selected.title}</Text>
                  <Text style={[styles.provider, { color: C.text3 }]}>Viator</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: C.orange }]}
                activeOpacity={0.84}
                onPress={confirmBooking}
                accessibilityRole="button"
              >
                <Ionicons name="add" size={18} color={C.bg} />
                <Text style={[styles.primaryText, { color: C.bg }]}>Yes, add to route</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: C.border }]}
                activeOpacity={0.84}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel="No, I didn't book this"
              >
                <Text style={[styles.secondaryText, { color: C.text2 }]}>No, I didn't book</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.offerRow}
              >
                {experiences.map(experience => {
                  const media = imageUrl(experience);
                  const meta = offerMeta(experience);
                  return (
                    <View key={`${experience.source}:${experience.id}`} style={[styles.card, { borderColor: C.border, backgroundColor: C.s2 }]}>
                      {media ? (
                        <Image source={{ uri: media }} style={styles.cardImage} resizeMode="cover" />
                      ) : (
                        <View style={[styles.cardImage, styles.imageFallback, { backgroundColor: C.s3 }]}>
                          <Ionicons name="ticket-outline" size={28} color={C.orange} />
                        </View>
                      )}
                      <View style={styles.cardBody}>
                        <Text style={[styles.provider, { color: C.text3 }]}>Viator</Text>
                        <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={2}>{experience.title}</Text>
                        {meta ? <Text style={[styles.meta, { color: C.text3 }]} numberOfLines={1}>{meta}</Text> : null}
                        <TouchableOpacity
                          style={[styles.cardButton, { backgroundColor: C.orange }]}
                          activeOpacity={0.84}
                          onPress={() => { openExperience(experience).catch(() => {}); }}
                          accessibilityRole="link"
                          accessibilityLabel={`View ${experience.title} on Viator`}
                        >
                          <Text style={[styles.cardButtonText, { color: C.bg }]}>View on Viator</Text>
                          <Ionicons name="open-outline" size={15} color={C.bg} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: C.border }]}
                activeOpacity={0.84}
                onPress={dismiss}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryText, { color: C.text2 }]}>Not now</Text>
              </TouchableOpacity>
            </>
          )}
        </TrailheadSheet>
      </View>
  );

  if (Platform.OS === 'web') return content;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  webOverlay: {
    position: 'fixed' as any,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10000,
  },
  sheet: {
    width: '100%',
  },
  sheetContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: 0,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerRow: {
    gap: 12,
    paddingRight: 18,
    paddingBottom: 14,
  },
  card: {
    width: 252,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 132,
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    padding: 12,
    gap: 6,
  },
  provider: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    letterSpacing: 0,
  },
  meta: {
    minHeight: 18,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0,
  },
  cardButton: {
    minHeight: 44,
    marginTop: 4,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cardButtonText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  confirmedItem: {
    minHeight: 86,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  confirmImage: {
    width: 96,
    alignSelf: 'stretch',
  },
  confirmText: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    gap: 5,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0,
  },
  secondaryButton: {
    minHeight: 48,
    marginTop: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
