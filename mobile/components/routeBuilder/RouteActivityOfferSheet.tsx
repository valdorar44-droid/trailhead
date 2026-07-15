import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type AppStateStatus,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TrailheadSheet } from '@/components/TrailheadUI';
import { tripsTabBarWebClearance } from '@/components/trips/TripsTabBar';
import type { BookableExperience } from '@/lib/api';
import { TRAILHEAD_API_BASE } from '@/lib/apiBase';
import { useTheme } from '@/lib/design';
import {
  isUsableViatorRouteActivity,
  routeActivityBookingUrl,
  routeActivityHasExactCoordinates,
  type PendingRouteActivityOffer,
} from '@/lib/routeActivityOffer';

type OfferMode = 'results' | 'away' | 'confirm';

export type RouteActivityOfferSheetProps = {
  activeTripId?: string | null;
  bottomInset?: number;
  offer: PendingRouteActivityOffer | null;
  onAdd: (experience: BookableExperience) => void | Promise<void>;
  onOpen?: (experience: BookableExperience) => void;
  onDismiss: () => void;
  onBrowse?: () => void;
  onCancelSearch?: () => void;
  onSkip?: () => void;
  promptVisible?: boolean;
  searching?: boolean;
};

function imageUrl(experience: BookableExperience) {
  const url = experience.hero_image_url || experience.images?.find(image => image.url)?.url || '';
  if (!url) return '';
  return url.startsWith('/') ? `${TRAILHEAD_API_BASE}${url}` : url;
}

function money(value: string, currency?: string) {
  const amount = Number(value);
  const code = (currency || 'USD').toUpperCase();
  const symbol = code === 'USD' ? '$' : `${code} `;
  if (!Number.isFinite(amount)) return `${symbol}${value}`.trim();
  return `${symbol}${amount.toFixed(amount >= 100 ? 0 : 2)}`;
}

function ratingLabel(experience: BookableExperience) {
  if (!experience.rating) return '';
  const rating = Number(experience.rating).toFixed(1);
  return experience.review_count ? `${rating} (${experience.review_count})` : rating;
}

function priceLabel(experience: BookableExperience) {
  if (!experience.price_from) return '';
  return `From ${money(experience.price_from, experience.currency)}`;
}

function routeMatchLabel(experience: BookableExperience) {
  const rawDay = experience.route_match?.day ?? experience.route_anchor?.day;
  const day = Math.round(Number(rawDay));
  const detour = Number(experience.route_match?.detour_mi);
  const parts: string[] = [];
  if (Number.isFinite(day) && day > 0) parts.push(`Day ${day}`);
  if (routeActivityHasExactCoordinates(experience) && Number.isFinite(detour) && detour >= 0) {
    parts.push(detour <= 0.1 ? 'Along the route' : `${detour.toFixed(detour >= 10 ? 0 : 1)} mi detour`);
  }
  return parts.join(' · ');
}

function ExperienceImage({
  experience,
  style,
}: {
  experience: BookableExperience;
  style: { width: number; height: number; borderRadius?: number };
}) {
  const C = useTheme();
  const source = imageUrl(experience);
  if (source) return <Image source={{ uri: source }} style={style} resizeMode="cover" />;
  return (
    <View style={[style, styles.imageFallback, { backgroundColor: C.s3 }]}>
      <Ionicons name="ticket-outline" size={22} color={C.orange} />
    </View>
  );
}

export default function RouteActivityOfferSheet({
  activeTripId,
  bottomInset = 0,
  offer,
  onAdd,
  onOpen,
  onDismiss,
  onBrowse,
  onCancelSearch,
  onSkip,
  promptVisible = false,
  searching = false,
}: RouteActivityOfferSheetProps) {
  const C = useTheme();
  const { height } = useWindowDimensions();
  const [mode, setMode] = useState<OfferMode>('results');
  const [selected, setSelected] = useState<BookableExperience | null>(null);
  const [adding, setAdding] = useState(false);
  const didLeaveAppRef = useRef(false);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const experiences = useMemo(
    () => (offer?.experiences ?? []).filter(isUsableViatorRouteActivity),
    [offer],
  );
  const hasMatchingOffer = Boolean(
    offer
    && offer.tripId === activeTripId
    && experiences.length > 0,
  );
  const visible = promptVisible || searching || hasMatchingOffer;

  useEffect(() => {
    setMode('results');
    setSelected(null);
    setAdding(false);
    didLeaveAppRef.current = false;
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
  }, [offer?.createdAt, offer?.tripId, promptVisible]);

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

  function resetLocalState() {
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
    didLeaveAppRef.current = false;
    setSelected(null);
    setMode('results');
    setAdding(false);
  }

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
      setMode('results');
      Alert.alert('Could not open Viator', 'Check your connection and try again.');
    }
  }

  function dismiss() {
    resetLocalState();
    onDismiss();
  }

  function skip() {
    resetLocalState();
    if (onSkip) onSkip();
    else onDismiss();
  }

  async function confirmBooking() {
    if (!selected || adding) return;
    setAdding(true);
    try {
      await onAdd(selected);
      dismiss();
    } catch {
      setAdding(false);
      Alert.alert('Could not add booking', 'Open the trip and try again.');
    }
  }

  if (!visible || mode === 'away') return null;

  const confirming = mode === 'confirm' && selected;
  const selectedHasExactCoordinates = Boolean(selected && routeActivityHasExactCoordinates(selected));
  const showPrompt = !confirming && promptVisible;
  const showResults = !confirming && !showPrompt && hasMatchingOffer;
  const showSearching = !confirming && !showPrompt && !showResults && searching;
  const footerInset = Platform.OS === 'web'
    ? tripsTabBarWebClearance(bottomInset)
    : bottomInset;
  const content = (
    <View
      style={[styles.overlay, Platform.OS === 'web' && styles.webOverlay]}
      accessibilityViewIsModal
    >
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={showSearching ? undefined : dismiss}
        disabled={showSearching}
        accessibilityRole="button"
        accessibilityLabel="Close tour suggestions"
      />
      <TrailheadSheet
        style={styles.sheet}
        contentStyle={[styles.sheetContent, { paddingBottom: Math.max(18, footerInset + 12) }]}
        maxHeight={Math.min(640, height - 64)}
        scroll={showResults}
      >
        <View style={styles.header}>
          <View style={styles.headingBlock}>
            <Text style={[styles.title, { color: C.text }]}>
              {confirming
                ? `Did you book ${selected.title}?`
                : showPrompt
                  ? 'Add a guided stop?'
                  : showSearching
                    ? 'Finding tours and attractions'
                    : 'Along your route'}
            </Text>
            {showPrompt ? (
              <Text style={[styles.subtitle, { color: C.text2 }]}>See tours and attractions near this route.</Text>
            ) : null}
            {!confirming ? (
              <Text style={[styles.provider, { color: C.text3 }]}>Tickets from Viator</Text>
            ) : null}
          </View>
          {!showSearching ? (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={C.text2} />
            </TouchableOpacity>
          ) : null}
        </View>

        {confirming ? (
          <View>
            <View style={[styles.confirmedItem, { borderColor: C.border, backgroundColor: C.s2 }]}>
              <ExperienceImage experience={selected} style={styles.confirmImage} />
              <View style={styles.confirmText}>
                <Text style={[styles.resultTitle, { color: C.text }]} numberOfLines={2}>{selected.title}</Text>
                <Text style={[styles.provider, { color: C.text3 }]}>Viator</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: C.orange }]}
              activeOpacity={0.84}
              onPress={() => { confirmBooking().catch(() => {}); }}
              disabled={adding}
              accessibilityRole="button"
              accessibilityLabel={selectedHasExactCoordinates
                ? adding ? `Adding ${selected.title} to route` : `Add ${selected.title} to route`
                : adding ? `Saving ${selected.title} to trip` : `Save ${selected.title} to trip`}
            >
              {adding
                ? <ActivityIndicator size="small" color={C.bg} />
                : <Ionicons name={selectedHasExactCoordinates ? 'add' : 'bookmark-outline'} size={19} color={C.bg} />}
              <Text style={[styles.primaryText, { color: C.bg }]}>
                {selectedHasExactCoordinates
                  ? adding ? 'Adding' : 'Add to route'
                  : adding ? 'Saving' : 'Save to trip'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.textButton}
              activeOpacity={0.72}
              onPress={dismiss}
              accessibilityRole="button"
            >
              <Text style={[styles.textButtonLabel, { color: C.text2 }]}>I didn&apos;t book it</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showPrompt ? (
          <View style={styles.promptActions}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: C.orange }]}
              activeOpacity={0.84}
              onPress={onBrowse}
              disabled={!onBrowse}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryText, { color: C.bg }]}>Browse tours</Text>
              <Ionicons name="arrow-forward" size={18} color={C.bg} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.textButton}
              activeOpacity={0.72}
              onPress={skip}
              accessibilityRole="button"
            >
              <Text style={[styles.textButtonLabel, { color: C.text2 }]}>Skip</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showSearching ? (
          <View style={styles.searching} accessibilityRole="progressbar" accessibilityLabel="Finding tours and attractions">
            <ActivityIndicator size="small" color={C.orange} />
            {onCancelSearch ? (
              <TouchableOpacity
                style={styles.textButton}
                activeOpacity={0.72}
                onPress={onCancelSearch}
                accessibilityRole="button"
                accessibilityLabel="Skip tours"
              >
                <Text style={[styles.textButtonLabel, { color: C.text2 }]}>Skip tours</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {showResults ? (
          <View style={styles.results}>
            {experiences.map(experience => {
              const rating = ratingLabel(experience);
              const price = priceLabel(experience);
              const routeMatch = routeMatchLabel(experience);
              return (
                <TouchableOpacity
                  key={`${experience.source}:${experience.id}`}
                  style={[styles.resultRow, { borderColor: C.border, backgroundColor: C.s2 }]}
                  activeOpacity={0.84}
                  onPress={() => { openExperience(experience).catch(() => {}); }}
                  accessibilityRole="link"
                  accessibilityLabel={`View ${experience.title} on Viator`}
                >
                  <ExperienceImage experience={experience} style={styles.resultImage} />
                  <View style={styles.resultBody}>
                    <Text style={[styles.resultTitle, { color: C.text }]} numberOfLines={2}>{experience.title}</Text>
                    {rating || experience.duration_label ? (
                      <View style={styles.metaLine}>
                        {rating ? (
                          <View style={styles.rating}>
                            <Ionicons name="star" size={13} color={C.orange} />
                            <Text style={[styles.meta, { color: C.text2 }]}>{rating}</Text>
                          </View>
                        ) : null}
                        {rating && experience.duration_label ? <Text style={[styles.separator, { color: C.text3 }]}>·</Text> : null}
                        {experience.duration_label ? (
                          <Text style={[styles.meta, { color: C.text2 }]} numberOfLines={1}>{experience.duration_label}</Text>
                        ) : null}
                      </View>
                    ) : null}
                    <View style={styles.resultFooter}>
                      {routeMatch ? (
                        <Text style={[styles.routeMatch, { color: C.text3 }]} numberOfLines={1}>{routeMatch}</Text>
                      ) : <View style={styles.footerSpacer} />}
                      {price ? <Text style={[styles.price, { color: C.text }]}>{price}</Text> : null}
                    </View>
                  </View>
                  <Ionicons name="open-outline" size={17} color={C.text3} />
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={styles.textButton}
              activeOpacity={0.72}
              onPress={skip}
              accessibilityRole="button"
            >
              <Text style={[styles.textButtonLabel, { color: C.text2 }]}>Skip</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </TrailheadSheet>
    </View>
  );

  if (Platform.OS === 'web') return content;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={showSearching && onCancelSearch ? onCancelSearch : dismiss}
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
    backgroundColor: 'rgba(0,0,0,0.38)',
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
    marginBottom: 16,
  },
  headingBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: 0,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  provider: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
  promptActions: {
    gap: 2,
  },
  searching: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  results: {
    gap: 10,
  },
  resultRow: {
    minHeight: 104,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resultImage: {
    width: 88,
    height: 88,
    borderRadius: 6,
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: 5,
  },
  resultTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
  metaLine: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  meta: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  separator: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  resultFooter: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  routeMatch: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  footerSpacer: {
    flex: 1,
  },
  price: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  confirmedItem: {
    minHeight: 88,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  confirmImage: {
    width: 96,
    height: 88,
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
  textButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  textButtonLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
