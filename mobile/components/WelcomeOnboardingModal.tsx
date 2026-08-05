import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, mono } from '@/lib/design';

type IconName = keyof typeof Ionicons.glyphMap;

type OnboardingCard = {
  title: string;
  body: string;
  icon: IconName;
  tone: string;
};

type OnboardingPage = {
  kicker: string;
  title: string;
  body: string;
  icon: IconName;
  tone: string;
  cards: OnboardingCard[];
};

const WALKTHROUGH_TONE = '#AD5A33';

const PAGES: OnboardingPage[] = [
  {
    kicker: 'Explore',
    title: 'Find the places that fit the trip.',
    body: 'Search camps, trails, parks, fuel, weather, and services. Save a place when it belongs in the plan.',
    icon: 'compass-outline',
    tone: WALKTHROUGH_TONE,
    cards: [
      { title: 'Places', body: 'Open photos, practical details, nearby trails, and source links.', icon: 'compass-outline', tone: WALKTHROUGH_TONE },
      { title: 'Weather', body: 'Check current forecasts before adding a stop.', icon: 'partly-sunny-outline', tone: WALKTHROUGH_TONE },
      { title: 'Saved stops', body: 'Save camps, trails, parks, and services to Plan.', icon: 'bookmark-outline', tone: WALKTHROUGH_TONE },
    ],
  },
  {
    kicker: 'Route',
    title: 'Build the trip one day at a time.',
    body: 'Set drive days, camps, fuel stops, and route options before you leave.',
    icon: 'map-outline',
    tone: WALKTHROUGH_TONE,
    cards: [
      { title: 'Daily plan', body: 'Organize stops and overnight stays by day.', icon: 'navigate-outline', tone: WALKTHROUGH_TONE },
      { title: 'Vehicle fit', body: 'Use your saved rig details when planning routes and stops.', icon: 'car-sport-outline', tone: WALKTHROUGH_TONE },
      { title: 'Offline', body: 'Download maps, places, trails, and routes before the signal drops.', icon: 'cloud-download-outline', tone: WALKTHROUGH_TONE },
    ],
  },
  {
    kicker: 'Map',
    title: 'Check the map before you commit.',
    body: 'Search the visible area, switch layers, and open place details without losing your route.',
    icon: 'layers-outline',
    tone: WALKTHROUGH_TONE,
    cards: [
      { title: 'Nearby search', body: 'Find camps, trails, fuel, water, and services around a place.', icon: 'search-outline', tone: WALKTHROUGH_TONE },
      { title: 'Layers', body: 'Show public land, topo, trails, weather, fire, and available map context.', icon: 'options-outline', tone: WALKTHROUGH_TONE },
      { title: 'Trail tools', body: 'Build, download, follow, or preview a trail from the shared map.', icon: 'git-branch-outline', tone: WALKTHROUGH_TONE },
    ],
  },
  {
    kicker: 'Plan',
    title: 'Keep plans and downloads together.',
    body: 'Plan holds trips, saved places, downloads, and owned Originals.',
    icon: 'shield-checkmark-outline',
    tone: WALKTHROUGH_TONE,
    cards: [
      { title: 'Plan library', body: 'Return to trips, saved places, downloads, and owned Originals.', icon: 'bookmark-outline', tone: WALKTHROUGH_TONE },
      { title: 'Reports', body: 'Review and submit field notes, closures, photos, and confirmations.', icon: 'pin-outline', tone: WALKTHROUGH_TONE },
      { title: 'Profile', body: 'Manage your rig, preferences, membership, support, privacy, and account.', icon: 'person-circle-outline', tone: WALKTHROUGH_TONE },
    ],
  },
];

export default function WelcomeOnboardingModal({
  visible,
  onClose,
  onReviewSetup,
}: {
  visible: boolean;
  onClose: () => void;
  onReviewSetup: () => void;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const [pageIndex, setPageIndex] = useState(0);
  const page = PAGES[pageIndex] ?? PAGES[0];
  const isLast = pageIndex === PAGES.length - 1;

  useEffect(() => {
    if (visible) setPageIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(`Page ${pageIndex + 1} of ${PAGES.length}. ${page.kicker}. ${page.title}`);
    }, 180);
    return () => clearTimeout(timer);
  }, [page.kicker, page.title, pageIndex, visible]);

  function goBackOrClose() {
    if (pageIndex <= 0) {
      onClose();
      return;
    }
    setPageIndex(idx => Math.max(0, idx - 1));
  }

  function goNextOrFinish() {
    if (isLast) {
      onReviewSetup();
      return;
    }
    setPageIndex(idx => Math.min(PAGES.length - 1, idx + 1));
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View testID="welcome-walkthrough" style={styles.overlay}>
        <TouchableOpacity accessible={false} importantForAccessibility="no" style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              marginBottom: Math.max(insets.bottom + 12, 18),
              backgroundColor: C.bg,
              borderColor: C.border,
            },
          ]}
        >
          <View style={styles.header}>
            <View style={[styles.headerIcon, { backgroundColor: page.tone + '1f', borderColor: page.tone + '55' }]}>
              <Ionicons accessible={false} name={page.icon} size={23} color={page.tone} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.kicker, { color: page.tone }]}>{page.kicker}</Text>
              <Text accessibilityRole="header" style={[styles.title, { color: C.text }]}>{page.title}</Text>
            </View>
            <TouchableOpacity
              testID="welcome-walkthrough-close"
              accessibilityRole="button"
              accessibilityLabel="Close walkthrough"
              onPress={onClose}
              style={[styles.closeButton, { backgroundColor: C.s2, borderColor: C.border }]}
              hitSlop={8}
            >
              <Ionicons accessible={false} name="close" size={18} color={C.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={[styles.body, { color: C.text2 }]}>{page.body}</Text>

            <View style={styles.cardStack}>
              {page.cards.map(card => (
                <View key={card.title} style={[styles.featureCard, { backgroundColor: C.s2, borderColor: C.border }]}>
                  <View style={[styles.featureIcon, { backgroundColor: card.tone + '18', borderColor: card.tone + '44' }]}>
                    <Ionicons accessible={false} name={card.icon} size={18} color={card.tone} />
                  </View>
                  <View style={styles.featureCopy}>
                    <Text style={[styles.featureTitle, { color: C.text }]}>{card.title}</Text>
                    <Text style={[styles.featureBody, { color: C.text3 }]}>{card.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: C.border }]}>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Walkthrough progress"
              accessibilityValue={{ min: 1, max: PAGES.length, now: pageIndex + 1, text: `Page ${pageIndex + 1} of ${PAGES.length}` }}
              style={styles.dots}
            >
              {PAGES.map((step, idx) => (
                <View
                  key={step.kicker}
                  style={[
                    styles.dot,
                    {
                      width: idx === pageIndex ? 18 : 7,
                      backgroundColor: idx === pageIndex ? page.tone : C.border2,
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.actions}>
              <TouchableOpacity
                testID="welcome-walkthrough-back"
                accessibilityRole="button"
                accessibilityLabel={pageIndex <= 0 ? 'Close' : 'Back'}
                onPress={goBackOrClose}
                style={[styles.secondaryButton, { backgroundColor: C.s2, borderColor: C.border }]}
              >
                <Text style={[styles.secondaryText, { color: C.text2 }]}>{pageIndex <= 0 ? 'Close' : 'Back'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="welcome-walkthrough-next"
                accessibilityRole="button"
                accessibilityLabel={isLast ? 'Review trip setup' : 'Next'}
                onPress={goNextOrFinish}
                style={[styles.primaryButton, { backgroundColor: isLast ? C.orange : page.tone }]}
              >
                <Text style={styles.primaryText}>{isLast ? 'Review trip setup' : 'Next'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.66)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    marginHorizontal: 12,
    maxHeight: '88%',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 18,
    paddingBottom: 10,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  kicker: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  title: {
    marginTop: 4,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: 0,
  },
  closeButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 10,
    gap: 14,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0,
  },
  cardStack: {
    gap: 10,
  },
  featureCard: {
    flexDirection: 'row',
    gap: 11,
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    letterSpacing: 0,
  },
  featureBody: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
  },
  footer: {
    borderTopWidth: 1,
    padding: 14,
    gap: 12,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 7,
  },
  dot: {
    height: 7,
    borderRadius: 999,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1.35,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  primaryText: {
    color: '#fff',
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
});
