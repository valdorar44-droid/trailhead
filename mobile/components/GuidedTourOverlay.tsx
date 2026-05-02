import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '@/lib/storage';
import { useTheme, mono, ColorPalette } from '@/lib/design';
import { useStore } from '@/lib/store';

const TOUR_SEEN = 'trailhead_guided_tour_seen';
const TOUR_NEVER = 'trailhead_guided_tour_never';

const STEPS = [
  {
    route: '/(tabs)/',
    icon: 'compass-outline',
    title: 'Plan a trip',
    body: 'Tell Trailhead where you want to go, how many days, and your vehicle style. The planner turns that into days, stops, camps, fuel, and map pins.',
    target: 'PLAN TAB',
    targetKind: 'tab',
    tabIndex: 0,
    targetKey: 'plan.input',
  },
  {
    route: '/(tabs)/map',
    icon: 'map-outline',
    title: 'Use the map',
    body: 'The map is where your trip becomes usable. Search camps, start navigation, download offline regions, switch layers, and check your compass.',
    target: 'MAP',
    targetKind: 'mapCanvas',
    targetKey: 'map.canvas',
  },
  {
    route: '/(tabs)/map',
    icon: 'search-outline',
    title: 'Search from controls',
    body: 'Tap the search icon in the map controls to find camps, towns, gas, or a destination. The top strip only shows route status.',
    target: 'SEARCH BUTTON',
    targetKind: 'mapSearch',
    targetKey: 'map.search',
  },
  {
    route: '/(tabs)/map',
    icon: 'layers-outline',
    title: 'Map settings',
    body: 'Map controls switch online/offline map sources, layers, terrain, radar, fire, avalanche, public land overlays, and campsite filters.',
    target: 'LAYERS',
    targetKind: 'mapLayers',
    targetKey: 'map.layers',
  },
  {
    route: '/(tabs)/map',
    icon: 'download-outline',
    title: 'Offline maps',
    body: 'Download region maps, routing packs, or trip corridors before you leave service. Offline map status appears quietly while you pan.',
    target: 'OFFLINE',
    targetKind: 'mapOffline',
    targetKey: 'map.offline',
  },
  {
    route: '/(tabs)/map',
    icon: 'location-outline',
    title: 'Pins and reports',
    body: 'Use PIN to add community places like propane, water, dumps, camps, or repairs. Use REPORT for short-lived hazards and trail conditions.',
    target: 'PIN / REPORT',
    targetKind: 'mapQuick',
    targetKey: 'map.pinReport',
  },
  {
    route: '/(tabs)/route-builder',
    icon: 'trail-sign-outline',
    title: 'Build manually',
    body: 'Route Builder is for people who want control. Add day starts, destinations, gas between days, POIs, and camps without asking AI.',
    target: 'ROUTE TAB',
    targetKind: 'tab',
    tabIndex: 2,
    targetKey: 'routeBuilder.search',
  },
  {
    route: '/(tabs)/report',
    icon: 'warning-outline',
    title: 'Reports help everyone',
    body: 'Reports keep the map current. Road hazards, closures, water, camp status, and trail notes earn credits and help other travelers.',
    target: 'REPORT TAB',
    targetKind: 'tab',
    tabIndex: 3,
    targetKey: 'report.types',
  },
  {
    route: '/(tabs)/guide',
    icon: 'headset-outline',
    title: 'Audio guide',
    body: 'Guide gives you spoken context about places, weather, and the route. It is useful when you want less screen time on the trail.',
    target: 'GUIDE TAB',
    targetKind: 'tab',
    tabIndex: 4,
    targetKey: 'guide.audio',
  },
  {
    route: '/(tabs)/profile',
    icon: 'person-outline',
    title: 'Profile and downloads',
    body: 'Profile keeps your trips, rig, credits, plan status, GPX tools, app settings, and this walkthrough if you want to see it again.',
    target: 'PROFILE TAB',
    targetKind: 'tab',
    tabIndex: 5,
    targetKey: 'profile.main',
  },
] as const;

export default function GuidedTourOverlay() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const runId = useStore(st => st.guidedTourRunId);
  const tourTargets = useStore(st => st.tourTargets);
  const [visible, setVisible] = useState(false);
  const [idx, setIdx] = useState(0);
  const [neverShow, setNeverShow] = useState(false);
  const [cardSide, setCardSide] = useState<'top' | 'bottom'>('top');
  const fade = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const step = STEPS[idx];
  const isLast = idx === STEPS.length - 1;
  const target = useMemo(() => {
    const measured = 'targetKey' in step ? tourTargets[step.targetKey as string] : null;
    if (measured && measured.width > 4 && measured.height > 4 && Date.now() - measured.updatedAt < 30_000) {
      return {
        left: measured.left,
        top: measured.top,
        width: measured.width,
        height: measured.height,
      };
    }
    if (step.targetKind === 'tab') {
      const tabCount = 6;
      const tabW = width / tabCount;
      const boxW = Math.min(82, Math.max(48, tabW - 8));
      return {
        left: tabW * step.tabIndex + (tabW - boxW) / 2,
        top: height - insets.bottom - 78,
        width: boxW,
        height: 62,
      };
    }
    if (step.targetKind === 'mapCanvas') {
      return {
        left: 16,
        top: insets.top + 110,
        width: width - 32,
        height: Math.min(260, height * 0.34),
      };
    }
    if (step.targetKind === 'mapSearch') {
      return {
        left: Math.max(10, width - 70),
        top: insets.top + 332,
        width: 58,
        height: 58,
      };
    }
    if (step.targetKind === 'mapLayers') {
      return {
        left: Math.max(10, width - 70),
        top: insets.top + 462,
        width: 58,
        height: 58,
      };
    }
    if (step.targetKind === 'mapOffline') {
      return {
        left: Math.max(10, width - 70),
        top: insets.top + 410,
        width: 58,
        height: 58,
      };
    }
    if (step.targetKind === 'mapQuick') {
      return {
        left: 12,
        top: Math.max(insets.top + 300, height - insets.bottom - 205),
        width: 86,
        height: 106,
      };
    }
    return {
      left: 8,
      top: Math.max(insets.top + 128, height - insets.bottom - 284),
      width: 142,
      height: 112,
    };
  }, [height, insets.bottom, insets.top, step, tourTargets, width]);

  useEffect(() => {
    storage.get(TOUR_NEVER).then(never => {
      if (never) return;
      storage.get(TOUR_SEEN).then(seen => {
        if (!seen) openTour(0);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (runId > 0) {
      storage.del(TOUR_NEVER).catch(() => {});
      openTour(0);
    }
  }, [runId]);

  useEffect(() => {
    if (!visible) return;
    setCardSide(target.top > height * 0.45 ? 'top' : 'bottom');
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, idx, target.top, height]);

  function openTour(start: number) {
    setIdx(start);
    setNeverShow(false);
    setVisible(true);
    router.push(STEPS[start].route as any);
  }

  async function closeTour(markSeen: boolean) {
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

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
  const pad = step.targetKind === 'mapCanvas' ? 4 : 8;
  const spotlight = {
    left: Math.max(6, target.left - pad),
    top: Math.max(insets.top + 4, target.top - pad),
    width: Math.min(width - 12, target.width + pad * 2),
    height: Math.min(height - insets.bottom - 8, target.height + pad * 2),
  };
  if (spotlight.left + spotlight.width > width - 6) spotlight.width = width - 6 - spotlight.left;
  if (spotlight.top + spotlight.height > height - insets.bottom - 6) spotlight.height = height - insets.bottom - 6 - spotlight.top;
  const targetCenterX = target.left + target.width / 2;
  const labelTop = spotlight.top > insets.top + 48 ? spotlight.top - 38 : spotlight.top + spotlight.height + 8;
  const labelLeft = Math.min(Math.max(12, targetCenterX - 58), width - 128);
  const cardStyle = cardSide === 'top'
    ? { top: insets.top + 18 }
    : { bottom: insets.bottom + 96 };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => closeTour(false)}>
      <Animated.View style={[s.overlay, { opacity: fade }]}>
        <View pointerEvents="none" style={[s.dimBlock, { left: 0, top: 0, width, height: spotlight.top }]} />
        <View pointerEvents="none" style={[s.dimBlock, { left: 0, top: spotlight.top, width: spotlight.left, height: spotlight.height }]} />
        <View pointerEvents="none" style={[s.dimBlock, { left: spotlight.left + spotlight.width, top: spotlight.top, width: Math.max(0, width - spotlight.left - spotlight.width), height: spotlight.height }]} />
        <View pointerEvents="none" style={[s.dimBlock, { left: 0, top: spotlight.top + spotlight.height, width, height: Math.max(0, height - spotlight.top - spotlight.height) }]} />
        <View
          pointerEvents="none"
          style={[s.spotlight, { left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height }]}
        />
        <TouchableOpacity
          activeOpacity={0.86}
          onPress={next}
          style={[s.targetTouch, { left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height }]}
        >
          <Animated.View style={[s.focusRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
        </TouchableOpacity>
        <View style={[s.focusLabel, { left: labelLeft, top: labelTop }]}>
          <Text style={s.focusText}>{step.target}</Text>
        </View>

        <View style={[s.card, cardStyle]}>
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
            <TouchableOpacity style={s.closeBtn} onPress={() => closeTour(false)}>
              <Ionicons name="close" size={18} color={C.text3} />
            </TouchableOpacity>
          </View>

          <Text style={s.body}>{step.body}</Text>
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
            <TouchableOpacity style={s.secondaryBtn} onPress={() => closeTour(true)}>
              <Text style={s.secondaryText}>HIDE FOR NOW</Text>
            </TouchableOpacity>
            {idx > 0 && (
              <TouchableOpacity style={s.backBtn} onPress={back}>
                <Ionicons name="chevron-back" size={14} color={C.text2} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.primaryBtn} onPress={next}>
              <Text style={s.primaryText}>{isLast ? 'FINISH' : 'NEXT'}</Text>
              <Ionicons name={isLast ? 'checkmark' : 'chevron-forward'} size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  overlay: {
    flex: 1,
    paddingHorizontal: 16,
  },
  dimBlock: {
    position: 'absolute',
    backgroundColor: 'rgba(5,10,15,0.78)',
  },
  spotlight: {
    position: 'absolute',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.26)',
    borderWidth: 2,
    borderColor: C.orange,
    shadowColor: C.orange,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  targetTouch: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  focusRing: {
    width: '100%', height: '100%',
    borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.orange + 'aa',
    backgroundColor: 'transparent',
  },
  focusLabel: {
    position: 'absolute',
    backgroundColor: C.s1,
    borderWidth: 1, borderColor: C.orange + '55',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  focusText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: C.s1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.orange + '55',
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
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
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: C.s2,
  },
  secondaryText: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '900' },
  backBtn: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
    backgroundColor: C.s2,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    minWidth: 96,
    backgroundColor: C.orange,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900' },
});
