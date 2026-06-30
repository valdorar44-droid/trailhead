import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

const PAGES: OnboardingPage[] = [
  {
    kicker: 'Explore',
    title: 'Find places worth the drive.',
    body: 'Search camps, trails, parks, fuel, weather, and services from one place. Save what fits the trip.',
    icon: 'sparkles-outline',
    tone: '#d4af37',
    cards: [
      { title: 'Places', body: 'Photos, practical details, nearby trails, and ways to save a stop.', icon: 'compass-outline', tone: '#d4af37' },
      { title: 'Weather', body: 'Check the forecast before a stop becomes part of the route.', icon: 'partly-sunny-outline', tone: '#f59e0b' },
      { title: 'Saved stops', body: 'Keep camps, parks, services, and ideas close while you plan.', icon: 'bookmark-outline', tone: '#0ea5e9' },
    ],
  },
  {
    kicker: 'Route',
    title: 'Shape each day around your pace.',
    body: 'Balance drive time, camp windows, fuel range, and stops before you leave.',
    icon: 'map-outline',
    tone: '#22c55e',
    cards: [
      { title: 'Daily plan', body: 'Turn a destination into days, stops, and overnight windows.', icon: 'navigate-outline', tone: '#22c55e' },
      { title: 'Vehicle fit', body: 'Fuel range, clearance, towing, and comfort help shape the route.', icon: 'car-sport-outline', tone: '#f97316' },
      { title: 'Offline areas', body: 'Keep important regions and trip stops ready without signal.', icon: 'cloud-download-outline', tone: '#8b5cf6' },
    ],
  },
  {
    kicker: 'Scout',
    title: 'Scout the area before you commit.',
    body: 'Search nearby, switch layers, check public land, and save reports while you compare options.',
    icon: 'layers-outline',
    tone: '#38bdf8',
    cards: [
      { title: 'Nearby search', body: 'Find camps, trails, fuel, water, and services around a place.', icon: 'search-outline', tone: '#38bdf8' },
      { title: 'Layers', body: 'Focus on camps, trails, public land, weather, or water safety.', icon: 'options-outline', tone: '#14b8a6' },
      { title: 'Trail tools', body: 'Draw a line, save it, or bring it into a trip.', icon: 'git-branch-outline', tone: '#f59e0b' },
    ],
  },
  {
    kicker: 'Saved',
    title: 'Keep the important pieces together.',
    body: 'Saved places, trip history, downloads, reports, and profile choices stay close for the next drive.',
    icon: 'shield-checkmark-outline',
    tone: '#d4af37',
    cards: [
      { title: 'Saved places', body: 'Keep camps, places, trails, and trips close for the next planning session.', icon: 'bookmark-outline', tone: '#60a5fa' },
      { title: 'Reports', body: 'Add field notes, closures, photos, and confirmations from the route.', icon: 'pin-outline', tone: '#ef4444' },
      { title: 'Profile', body: 'Manage your rig, downloads, saved trips, support, and account settings.', icon: 'person-circle-outline', tone: '#d4af37' },
    ],
  },
];

export default function WelcomeOnboardingModal({
  visible,
  onClose,
  onSetupRig,
}: {
  visible: boolean;
  onClose: () => void;
  onSetupRig: () => void;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const [pageIndex, setPageIndex] = useState(0);
  const page = PAGES[pageIndex] ?? PAGES[0];
  const isLast = pageIndex === PAGES.length - 1;

  useEffect(() => {
    if (visible) setPageIndex(0);
  }, [visible]);

  function goBackOrClose() {
    if (pageIndex <= 0) {
      onClose();
      return;
    }
    setPageIndex(idx => Math.max(0, idx - 1));
  }

  function goNextOrFinish() {
    if (isLast) {
      onSetupRig();
      return;
    }
    setPageIndex(idx => Math.min(PAGES.length - 1, idx + 1));
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View
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
              <Ionicons name={page.icon} size={23} color={page.tone} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.kicker, { color: page.tone }]}>{page.kicker}</Text>
              <Text style={[styles.title, { color: C.text }]}>{page.title}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeButton, { backgroundColor: C.s2, borderColor: C.border }]}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color={C.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={[styles.body, { color: C.text2 }]}>{page.body}</Text>

            <View style={styles.cardStack}>
              {page.cards.map(card => (
                <View key={card.title} style={[styles.featureCard, { backgroundColor: C.s2, borderColor: C.border }]}>
                  <View style={[styles.featureIcon, { backgroundColor: card.tone + '18', borderColor: card.tone + '44' }]}>
                    <Ionicons name={card.icon} size={18} color={card.tone} />
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
            <View style={styles.dots}>
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
                onPress={goBackOrClose}
                style={[styles.secondaryButton, { backgroundColor: C.s2, borderColor: C.border }]}
              >
                <Text style={[styles.secondaryText, { color: C.text2 }]}>{pageIndex <= 0 ? 'Close' : 'Back'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goNextOrFinish} style={[styles.primaryButton, { backgroundColor: isLast ? C.orange : page.tone }]}>
                <Text style={styles.primaryText}>{isLast ? 'Set up vehicle' : 'Next'}</Text>
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
    borderRadius: 24,
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
    width: 34,
    height: 34,
    borderRadius: 17,
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
    borderRadius: 17,
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
    minHeight: 46,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1.35,
    minHeight: 46,
    borderRadius: 15,
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
