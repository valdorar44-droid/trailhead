import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
    align: 'bottom',
  },
  {
    route: '/(tabs)/map',
    icon: 'map-outline',
    title: 'Use the map',
    body: 'The map is where your trip becomes usable. Search camps, start navigation, download offline states, switch layers, and check your compass.',
    target: 'MAP TAB',
    align: 'top',
  },
  {
    route: '/(tabs)/map',
    icon: 'location-outline',
    title: 'Pins and reports',
    body: 'Use PIN to add community places like propane, water, dumps, camps, or repairs. Use REPORT for short-lived hazards and trail conditions.',
    target: 'PIN / REPORT',
    align: 'left',
  },
  {
    route: '/(tabs)/route-builder',
    icon: 'trail-sign-outline',
    title: 'Build manually',
    body: 'Route Builder is for people who want control. Add day starts, destinations, gas between days, POIs, and camps without asking AI.',
    target: 'ROUTE TAB',
    align: 'bottom',
  },
  {
    route: '/(tabs)/report',
    icon: 'warning-outline',
    title: 'Reports help everyone',
    body: 'Reports keep the map current. Road hazards, closures, water, camp status, and trail notes earn credits and help other travelers.',
    target: 'REPORT TAB',
    align: 'bottom',
  },
  {
    route: '/(tabs)/guide',
    icon: 'headset-outline',
    title: 'Audio guide',
    body: 'Guide gives you spoken context about places, weather, and the route. It is useful when you want less screen time on the trail.',
    target: 'GUIDE TAB',
    align: 'bottom',
  },
  {
    route: '/(tabs)/profile',
    icon: 'person-outline',
    title: 'Profile and downloads',
    body: 'Profile keeps your trips, rig, credits, plan status, GPX tools, app settings, and this walkthrough if you want to see it again.',
    target: 'PROFILE TAB',
    align: 'bottom',
  },
] as const;

export default function GuidedTourOverlay() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const runId = useStore(st => st.guidedTourRunId);
  const [visible, setVisible] = useState(false);
  const [idx, setIdx] = useState(0);
  const [neverShow, setNeverShow] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const step = STEPS[idx];
  const isLast = idx === STEPS.length - 1;

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
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, idx]);

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

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => closeTour(false)}>
      <Animated.View style={[s.overlay, { opacity: fade, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 92 }]}>
        <View style={[s.focusRow, step.align === 'left' && s.focusLeft, step.align === 'top' && s.focusTop]}>
          <Animated.View style={[s.focusRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}>
            <Ionicons name={step.icon as any} size={24} color={C.orange} />
          </Animated.View>
          <View style={s.focusLabel}>
            <Text style={s.focusText}>{step.target}</Text>
          </View>
        </View>

        <View style={[s.card, step.align === 'top' && s.cardTop]}>
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
    backgroundColor: 'rgba(0,0,0,0.64)',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  focusRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: 74 },
  focusTop: { marginTop: 110, alignSelf: 'flex-start' },
  focusLeft: { marginTop: 'auto' as any, marginBottom: 190, alignSelf: 'flex-start' },
  focusRing: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.orange,
    backgroundColor: C.orange + '22',
  },
  focusLabel: {
    marginLeft: 10,
    backgroundColor: C.s1,
    borderWidth: 1, borderColor: C.orange + '55',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  focusText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  card: {
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
  cardTop: { marginTop: 'auto' as any },
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
