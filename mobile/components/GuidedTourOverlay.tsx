import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '@/lib/storage';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { useStore } from '@/lib/store';
import { TrailheadButton, TrailheadSheet } from '@/components/TrailheadUI';

const TOUR_SEEN = 'trailhead_guided_tour_seen';
const TOUR_NEVER = 'trailhead_guided_tour_never';

const STEPS = [
  {
    route: '/(tabs)/map',
    icon: 'map-outline',
    title: 'Start with the map',
    body: 'Pan the map to inspect camps, trails, reports, public-land context, and your route.',
    target: 'MAP',
    targetKind: 'mapCanvas',
    targetKey: 'map.canvas',
  },
  {
    route: '/(tabs)/map',
    icon: 'search-outline',
    title: 'Search and navigate',
    body: 'Use the Map search and filter controls for towns, gas, trailheads, destinations, camps, and trails.',
    target: 'SEARCH BUTTON',
    targetKind: 'mapSearch',
    targetKey: 'map.search',
  },
  {
    route: '/(tabs)/map',
    icon: 'layers-outline',
    title: 'Open map tools',
    body: 'The drawer keeps Safe Water, trails, layers, filters, offline maps, and map style out of the browsing canvas.',
    target: 'TOOLS',
    targetKind: 'mapLayers',
    targetKey: 'map.tools',
  },
  {
    route: '/(tabs)/map',
    icon: 'trail-sign-outline',
    title: 'Discover trails',
    body: 'Open the tools drawer, then use Trails for nearby trailheads and trail places.',
    target: 'TOOLS',
    targetKind: 'mapTrails',
    targetKey: 'map.tools',
  },
  {
    route: '/(tabs)/map',
    icon: 'git-branch-outline',
    title: 'Build trails for free',
    body: 'Trail builder now lives in the tools drawer. Drop anchors along a trail, snap the route, then preview, save, or follow.',
    target: 'TOOLS',
    targetKind: 'mapTrailBuilder',
    targetKey: 'map.tools',
  },
  {
    route: '/(tabs)/map',
    icon: 'download-outline',
    title: 'Download before signal drops',
    body: 'Offline maps moved into the tools drawer with map layers and filters.',
    target: 'TOOLS',
    targetKind: 'mapOffline',
    targetKey: 'map.tools',
  },
  {
    route: '/(tabs)/map',
    icon: 'location-outline',
    title: 'Add pins and reports',
    body: 'Use PIN for places worth keeping. Use the Report tab or contextual cards for hazards, closures, and current trail conditions.',
    target: 'PIN',
    targetKind: 'mapQuick',
    targetKey: 'map.pinReport',
  },
  {
    route: '/(tabs)/guide',
    icon: 'headset-outline',
    title: 'Explore and listen',
    body: 'Guide has Explore cards, Summary and Full Story audio, trip narrations, weather, and What’s Around Me.',
    target: 'GUIDE TAB',
    targetKind: 'tab',
    tabIndex: 4,
    targetKey: 'guide.audio',
  },
  {
    route: '/(tabs)/profile',
    icon: 'person-outline',
    title: 'Set up your profile',
    body: 'Profile keeps your rig, credits, Explorer status, saved trips, GPX tools, checklist, and app settings.',
    target: 'PROFILE TAB',
    targetKind: 'tab',
    tabIndex: 5,
    targetKey: 'profile.main',
  },
  {
    route: '/(tabs)',
    icon: 'compass-outline',
    title: 'Ask the AI planner',
    body: 'Tell Trailhead where you want to go, how many days you have, and what your rig can handle.',
    target: 'PLAN TAB',
    targetKind: 'tab',
    tabIndex: 0,
    targetKey: 'plan.input',
  },
  {
    route: '/(tabs)/route-builder',
    icon: 'trail-sign-outline',
    title: 'Build routes by hand',
    body: 'Route Builder is for control: saved routes, starts, destinations, gas, camps, POIs, and saved trail routes.',
    target: 'ROUTE TAB',
    targetKind: 'tab',
    tabIndex: 2,
    targetKey: 'routeBuilder.search',
  },
] as const;

export default function GuidedTourOverlay() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const runId = useStore(st => st.guidedTourRunId);
  const setGuidedTourActive = useStore(st => st.setGuidedTourActive);
  const [visible, setVisible] = useState(false);
  const [idx, setIdx] = useState(0);
  const [neverShow, setNeverShow] = useState(false);
  const [cardSide, setCardSide] = useState<'top' | 'bottom'>('top');
  const fade = useRef(new Animated.Value(0)).current;

  const step = STEPS[idx];
  const isLast = idx === STEPS.length - 1;

  useEffect(() => {
    if (runId > 0) {
      storage.del(TOUR_NEVER).catch(() => {});
      openTour(0);
    }
  }, [runId]);

  useEffect(() => {
    return () => setGuidedTourActive(false);
  }, [setGuidedTourActive]);

  useEffect(() => {
    if (!visible) return;
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [visible, idx]);

  function openTour(start: number) {
    setIdx(start);
    setNeverShow(false);
    setGuidedTourActive(true);
    setVisible(true);
    router.push(STEPS[start].route as any);
  }

  async function closeTour(markSeen: boolean) {
    setGuidedTourActive(false);
    Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => setVisible(false));
    if (markSeen) await storage.set(TOUR_SEEN, 'true').catch(() => {});
    if (neverShow) await storage.set(TOUR_NEVER, 'true').catch(() => {});
  }

  function next() {
    if (isLast) {
      closeTour(true);
      return;
    }
    const nextIdx = idx + 1;
    setIdx(nextIdx);
    fade.setValue(0);
    router.push(STEPS[nextIdx].route as any);
  }

  function back() {
    if (idx === 0) return;
    const prev = idx - 1;
    setIdx(prev);
    fade.setValue(0);
    router.push(STEPS[prev].route as any);
  }

  if (!visible) return null;

  const cardStyle = cardSide === 'top'
    ? { top: insets.top + 18 }
    : { bottom: insets.bottom + 96 };

  return (
    <Animated.View pointerEvents="box-none" style={[s.overlay, { opacity: fade, width, height }]}>
        <TrailheadSheet handle={false} style={[s.card, cardStyle]} contentStyle={s.cardContent}>
          <View style={s.progressRow}>
            {STEPS.map((_, i) => <View key={i} style={[s.dot, i <= idx && s.dotActive]} />)}
          </View>
          <View style={s.header}>
            <View style={s.iconWrap}>
              <Ionicons name={step.icon as any} size={22} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.kicker}>TRAILHEAD WALKTHROUGH</Text>
              <Text style={s.title}>{step.title}</Text>
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={() => closeTour(true)}>
              <Ionicons name="close" size={18} color={C.text3} />
            </TouchableOpacity>
          </View>

          <Text style={s.body}>{step.body}</Text>
          <View style={s.iconCue}>
            <View style={s.iconCueBadge}>
              <Ionicons name={step.icon as any} size={18} color={C.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.iconCueLabel}>LOOK FOR</Text>
              <Text style={s.iconCueText}>{step.target}</Text>
            </View>
          </View>
          <TouchableOpacity style={s.moveBtn} onPress={() => setCardSide(v => v === 'top' ? 'bottom' : 'top')}>
            <Ionicons name="swap-vertical-outline" size={13} color={C.text3} />
            <Text style={s.moveText}>MOVE CARD</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.checkRow} onPress={() => setNeverShow(v => !v)}>
            <View style={[s.checkBox, neverShow && s.checkBoxOn]}>
              {neverShow && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <Text style={s.checkText}>Never show this automatically again</Text>
          </TouchableOpacity>

          <View style={s.actions}>
            <TrailheadButton label="Hide" variant="secondary" onPress={() => closeTour(true)} style={{ flex: 1 }} />
            {idx > 0 && (
              <TouchableOpacity style={s.backBtn} onPress={back}>
                <Ionicons name="chevron-back" size={14} color={C.text2} />
              </TouchableOpacity>
            )}
            <TrailheadButton label={isLast ? 'Finish' : 'Next'} icon={isLast ? 'checkmark' : 'chevron-forward'} variant="primary" onPress={next} style={{ minWidth: 96 }} />
          </View>
        </TrailheadSheet>
    </Animated.View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    paddingHorizontal: 16,
    zIndex: 10000,
    elevation: 10000,
  },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 18,
  },
  cardContent: { padding: 16 },
  progressRow: { flexDirection: 'row', gap: 5, marginBottom: 14 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.s3 },
  dotActive: { backgroundColor: C.orange },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  iconWrap: {
    width: 42, height: 42, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.orange + '16',
    borderWidth: 1, borderColor: C.orange + '44',
  },
  kicker: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  title: { color: C.text, fontSize: 20, fontWeight: '900', marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2 },
  body: { color: C.text2, fontSize: 14, lineHeight: 21, marginBottom: 14 },
  iconCue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.orange + '3d',
    borderRadius: 14,
    backgroundColor: C.orange + '10',
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginBottom: 12,
  },
  iconCueBadge: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.orange + '55',
  },
  iconCueLabel: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  iconCueText: { color: C.orange, fontSize: 12, fontFamily: mono, fontWeight: '900', marginTop: 2 },
  moveBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: C.s2,
    marginBottom: 10,
  },
  moveText: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '900' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 4, marginBottom: 14 },
  checkBox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.s2,
  },
  checkBoxOn: { backgroundColor: C.orange, borderColor: C.orange },
  checkText: { color: C.text3, fontSize: 12, flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
    backgroundColor: C.s2,
  },
});
