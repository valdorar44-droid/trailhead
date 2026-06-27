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
    kicker: 'EXPLORE',
    title: 'Start with the places worth building a trip around.',
    body: 'Search trails, camps, parks, tours, fuel, weather, and services from one place. Save a stop or open it on the map when it fits the trip.',
    icon: 'sparkles-outline',
    tone: '#d4af37',
    cards: [
      { title: 'Explore', body: 'Destination cards with photos, details, nearby trails, and map actions.', icon: 'compass-outline', tone: '#d4af37' },
      { title: 'Tours', body: 'Experiences and guided options live beside camps, parks, and trail areas.', icon: 'ticket-outline', tone: '#0ea5e9' },
      { title: 'Weather', body: 'Check the forecast around a stop before it becomes part of the route.', icon: 'partly-sunny-outline', tone: '#f59e0b' },
    ],
  },
  {
    kicker: 'ROUTE',
    title: 'Build the drive around your rig and your pace.',
    body: 'Plan Direct, Balanced, Wild, Loop, or There and back routes. Adjust daily miles, hours, camps, fuel, and stops as the trip takes shape.',
    icon: 'map-outline',
    tone: '#22c55e',
    cards: [
      { title: 'Trip Planner', body: 'Turn a destination into days, route legs, camp windows, and warnings.', icon: 'navigate-outline', tone: '#22c55e' },
      { title: 'Rig Profile', body: 'Fuel range, clearance, towing, and comfort help shape the route.', icon: 'car-sport-outline', tone: '#f97316' },
      { title: 'Downloads', body: 'Keep map, topo, trails, places, navigation, and trip data ready offline.', icon: 'cloud-download-outline', tone: '#8b5cf6' },
    ],
  },
  {
    kicker: 'MAP',
    title: 'Use the map for scouting, filters, and trail work.',
    body: 'Search near a place, switch layers, check filters, build trails, and add reports without leaving the map.',
    icon: 'layers-outline',
    tone: '#38bdf8',
    cards: [
      { title: 'Search', body: 'Find places near a city, camp, trail, or route area and focus the map.', icon: 'search-outline', tone: '#38bdf8' },
      { title: 'Filters', body: 'Show camps, trails, 4WD lines, public land, reports, and travel layers.', icon: 'options-outline', tone: '#14b8a6' },
      { title: 'Trail Builder', body: 'Drop anchors, shape a line, save it, or send it into a trip.', icon: 'git-branch-outline', tone: '#f59e0b' },
    ],
  },
  {
    kicker: 'SAVED',
    title: 'Keep the trip organized before signal drops.',
    body: 'Saved places, trip history, offline maps, reports, and your profile stay together so the next drive is easier to prepare.',
    icon: 'shield-checkmark-outline',
    tone: '#d4af37',
    cards: [
      { title: 'Saved', body: 'Keep camps, places, trails, and trips close for the next planning session.', icon: 'bookmark-outline', tone: '#60a5fa' },
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
              <Text style={[styles.kicker, { color: page.tone }]}>TRAILHEAD {page.kicker}</Text>
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
                <Text style={[styles.secondaryText, { color: C.text2 }]}>{pageIndex <= 0 ? 'CLOSE' : 'BACK'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goNextOrFinish} style={[styles.primaryButton, { backgroundColor: isLast ? C.orange : page.tone }]}>
                <Text style={styles.primaryText}>{isLast ? 'SET UP RIG' : 'NEXT'}</Text>
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
