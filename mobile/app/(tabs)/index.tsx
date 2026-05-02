import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Share, Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { api, ApiError, PaywallError, TripResult, TrailDNA } from '@/lib/api';
import PaywallModal from '@/components/PaywallModal';
import TourTarget from '@/components/TourTarget';
import { useStore } from '@/lib/store';
import { useTheme, useTag, mono, ColorPalette } from '@/lib/design';
import { saveOfflineTrip, loadOfflineTrip } from '@/lib/offlineTrips';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';

const EXAMPLES = [
  { label: '14D', icon: 'moon-outline',     tags: ['DISPERSED', 'DIRT RD', 'UTAH'],    text: '14-day loop through southern Utah — dispersed camping, off-road, a couple paid showers' },
  { label: '7D',  icon: 'triangle-outline', tags: ['HIGH CLEAR', '4WD', 'SAN JUANS'],  text: '7-day overlanding from Denver into the San Juans, high clearance, wild camping only' },
  { label: 'WK',  icon: 'flash-outline',    tags: ['BLM', 'MOAB', 'TRUCK'],            text: 'Weekend run near Moab, BLM land, taking my Tacoma' },
];

const CHAT_STAGES  = ['Checking the trail...', 'On it...', 'Thinking...'];
const PLAN_STAGES  = ['Mapping your route...', 'Finding campsites...', 'Locating fuel stops...', 'Briefing terrain...'];
// Long trips (7+ days) can take 1-2 minutes — we surface an extra stage at ~20s
const PLAN_STAGES_LONG = ['Mapping your route...', 'Building itinerary... (this can take a minute)', 'Finding campsites...', 'Locating fuel stops...', 'Briefing terrain...'];

type PlanPhase = 'idle' | 'chatting' | 'ready' | 'planning' | 'active' | 'editing';

interface Message {
  role: 'user' | 'ai';
  text?: string;
  trip?: TripResult;
  outline?: string;   // "route ready" card
}

function userFacingAiText(text?: string) {
  const clean = (text ?? '').trim();
  if (!clean) return 'I updated the trip. Review the map pins and daily route before you head out.';
  if (/(lat\/lng|latitude|longitude|coordinates|geocod|added .*coord|debug|internal)/i.test(clean)) {
    return 'I updated the trip stops and map pins. Review the route, camps, and fuel stops on the map.';
  }
  return clean;
}

function appendAiMessage(messages: Message[], text?: string): Message[] {
  const clean = userFacingAiText(text);
  const last = messages[messages.length - 1];
  if (last?.role === 'ai' && !last.trip && !last.outline && last.text === clean) return messages;
  return [...messages, { role: 'ai', text: clean }];
}

export default function PlanScreen() {
  const C  = useTheme();
  const s  = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();

  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [planPhase, setPlanPhase] = useState<PlanPhase>('idle');
  const [trailDna,  setTrailDna]  = useState<TrailDNA>({});
  const [stageIdx,  setStageIdx]  = useState(0);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollRef        = useRef<ScrollView>(null);
  const setActiveTrip    = useStore(st => st.setActiveTrip);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const tripHistory      = useStore(st => st.tripHistory);
  const userLoc          = useStore(st => st.userLoc);
  const mapboxToken      = useStore(st => st.mapboxToken);
  const activeTrip       = useStore(st => st.activeTrip);
  const sessionId        = useStore(st => st.sessionId);
  const user             = useStore(st => st.user);
  const rigProfile       = useStore(st => st.rigProfile);

  useEffect(() => {
    setMessages([]);
    setInput('');
    setTrailDna({});
    setLoading(false);
    setPlanPhase('idle');
    stopStages();
  }, [user?.id]);

  const [paywallVisible, setPaywallVisible] = useState(false);
  const [offlineToast, setOfflineToast] = useState(false);
  const offlineToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function openHistoryTrip(tripId: string) {
    try {
      const cached = await loadOfflineTrip(tripId);
      if (cached) {
        setActiveTrip(cached, true);
        setMessages([{ role: 'ai', trip: cached }]);
        setPlanPhase('active');
        return;
      }

      const trip = await api.getTrip(tripId);
      setActiveTrip(trip);
      setMessages([{ role: 'ai', trip }]);
      setPlanPhase('active');
      saveOfflineTrip(trip).catch(() => {});
    } catch (e: any) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        Alert.alert('Trip unavailable', 'This trip is not available for the current signed-in account. Sign in again or open an offline-saved copy.');
        return;
      }
      Alert.alert('Trip unavailable', e?.message ?? 'Could not open this trip.');
    }
  }
  const [weatherToast, setWeatherToast] = useState('');

  const scrollToEnd = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  function startStages(stages: string[]) {
    setStageIdx(0);
    if (stageTimer.current) clearInterval(stageTimer.current);
    stageTimer.current = setInterval(() => {
      setStageIdx(i => (i + 1) % stages.length);
    }, 2000);
  }

  function stopStages() {
    if (stageTimer.current) { clearInterval(stageTimer.current); stageTimer.current = null; }
    setStageIdx(0);
  }

  useEffect(() => () => stopStages(), []);

  function handleOutOfCredits() {
    setPaywallVisible(true);
  }

  function isOutOfCredits(e: any) {
    return e instanceof PaywallError || e?.message?.includes('402') || e?.message?.includes('Not enough credits');
  }

  // ── Resolve location reference in text ──────────────────────────────────────
  async function resolveLocation(text: string): Promise<string> {
    if (!/\b(my location|from here|current location|where i am|starting from here|starting here)\b/i.test(text)) return text;
    if (!userLoc || !mapboxToken) return text;
    try {
      const r = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${userLoc.lng},${userLoc.lat}.json?access_token=${mapboxToken}&types=place,region&limit=1`
      );
      const geo = await r.json();
      const place = geo.features?.[0]?.text ?? `${userLoc.lat.toFixed(3)},${userLoc.lng.toFixed(3)}`;
      const region = geo.features?.[0]?.context?.find((c: any) => c.id?.startsWith('region'))?.short_code?.replace('US-', '') ?? '';
      const placeName = region ? `${place}, ${region}` : place;
      return text.replace(/\b(my location|from here|current location|where i am|starting from here|starting here)\b/gi, placeName);
    } catch { return text; }
  }

  const sendRef = useRef(false);
  // ── Main send handler ───────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    if (!text || loading || sendRef.current) return;
    sendRef.current = true;
    setTimeout(() => { sendRef.current = false; }, 1500);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    activateKeepAwakeAsync('ai-chat');

    const finalText = await resolveLocation(text);

    // ── If route is ready and user types a build phrase, build directly ───────
    // Prevents Claude from returning raw JSON in the chat bubble instead of
    // going through the proper buildTrip() flow.
    const BUILD_PHRASES = /^(build|go|yes|do it|let's go|build it|sounds good|perfect|do that|make it|create it|generate|start building)/i;
    if (planPhase === 'ready' && BUILD_PHRASES.test(text.trim())) {
      setLoading(false);
      stopStages();
      deactivateKeepAwake('ai-chat');
      buildTrip();
      return;
    }

    // ── Edit mode: trip is active ─────────────────────────────────────────────
    if ((planPhase === 'active' || planPhase === 'editing') && activeTrip) {
      setPlanPhase('editing');
      startStages(CHAT_STAGES);
      try {
        const data = await api.chat(finalText, sessionId, activeTrip, rigProfile as any);
        if (data.trail_dna) setTrailDna(data.trail_dna);

        if (data.type === 'trip_update' && data.trip) {
          setActiveTrip(data.trip);
          // Replace or append trip card
          setMessages(m => {
            const filtered = m.filter(msg => !msg.trip);
            return [...appendAiMessage(filtered, data.content), { role: 'ai', trip: data.trip }];
          });
          // Update offline cache with revised trip (fire and forget)
          saveOfflineTrip(data.trip).catch(() => {});
        } else {
          setMessages(m => appendAiMessage(m, data.content));
        }
        setPlanPhase('active');
      } catch (e: any) {
        if (isOutOfCredits(e)) handleOutOfCredits();
        else setMessages(m => [...m, { role: 'ai', text: `⚠ ${e.message}` }]);
        setPlanPhase('active');
      } finally {
        stopStages(); setLoading(false); scrollToEnd();
        deactivateKeepAwake('ai-chat');
      }
      return;
    }

    // ── Conversational planning ───────────────────────────────────────────────
    setPlanPhase('chatting');
    startStages(CHAT_STAGES);
    try {
      const data = await api.chat(finalText, sessionId, null, rigProfile as any);
      if (data.trail_dna) setTrailDna(data.trail_dna);

      if (data.type === 'ready') {
        setMessages(m => [
          ...m,
          { role: 'ai', text: data.content },
          { role: 'ai', outline: data.outline ?? 'Route ready. Build it to see waypoints, camps, and fuel stops.' },
        ]);
        setPlanPhase('ready');
      } else {
        setMessages(m => [...m, { role: 'ai', text: data.content }]);
        setPlanPhase('chatting');
      }
    } catch (e: any) {
      if (isOutOfCredits(e)) { handleOutOfCredits(); setPlanPhase('idle'); }
      else {
        // Don't show raw AI responses or JSON in the chat — clean user-facing message
        const raw = e?.message ?? '';
        const isTimeout = raw.includes('taking longer') || raw.includes('timeout');
        const isNetwork = raw.includes('Network') || raw.includes('fetch');
        const friendly = isTimeout
          ? '⏳ Trip planning is taking a bit longer than usual. Try "build it" again in a moment.'
          : isNetwork
          ? '📡 Network hiccup — check your connection and try again.'
          : '⚠ Something went wrong. Try rephrasing your request or tap "build it" again.';
        setMessages(m => [...m, { role: 'ai', text: friendly }]);
        setPlanPhase('ready'); // stay in ready so they can retry
      }
    } finally {
      stopStages(); setLoading(false); scrollToEnd();
      deactivateKeepAwake('ai-chat');
    }
  }

  // ── Plan Next Leg — start fresh from last waypoint ───────────────────────
  function planNextLeg() {
    if (!activeTrip) return;
    const wps = activeTrip.plan?.waypoints ?? [];
    const lastWp = [...wps].reverse().find(w => w.type === 'camp' || w.type === 'motel' || w.type === 'start');
    const endLocation = lastWp?.name ?? activeTrip.plan?.trip_name ?? 'your last stop';
    Alert.alert(
      'Start Next Leg?',
      `This will clear your current trip plan and start a new conversation from ${endLocation.split(',')[0]}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue', style: 'default',
          onPress: () => {
            setActiveTrip(null);
            setMessages([{
              role: 'ai',
              text: `Ready for leg 2! Picking up from ${endLocation.split(',')[0]}. Where do you want to head next, and how many days do you have?`,
            }]);
            setInput(`Continue from ${endLocation.split(',')[0]} — `);
            setPlanPhase('chatting');
          },
        },
      ]
    );
  }

  // ── Build full trip from conversation ─────────────────────────────────────
  async function buildTrip() {
    setMessages(m => m.filter(msg => !msg.outline));
    setPlanPhase('planning');
    setLoading(true);
    // Prevent screen sleep during long AI planning (can take 2-3 min)
    await activateKeepAwakeAsync('trip-build');
    // Use the longer stage list so "this can take a minute" shows up for long trips
    startStages(PLAN_STAGES_LONG);
    try {
      const result = await api.planFromSession(sessionId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActiveTrip(result);
      setMessages(m => [...m, { role: 'ai', trip: result }]);
      addTripToHistory({
        trip_id:      result.trip_id,
        trip_name:    result.plan.trip_name,
        states:       result.plan.states ?? [],
        duration_days: result.plan.duration_days,
        est_miles:    result.plan.total_est_miles ?? 0,
        planned_at:   Date.now(),
      });
      // Fire-and-forget: cache trip for offline access
      saveOfflineTrip(result).then(() => {
        setOfflineToast(true);
        if (offlineToastTimer.current) clearTimeout(offlineToastTimer.current);
        offlineToastTimer.current = setTimeout(() => setOfflineToast(false), 3000);
      }).catch(() => {});
      setPlanPhase('active');
      // Download route weather for offline use (fail silently)
      api.getRouteWeather(result.trip_id, result.plan.waypoints).then(async weather => {
        const path = `${FileSystem.documentDirectory}weather_${result.trip_id}.json`;
        await FileSystem.writeAsStringAsync(path, JSON.stringify(weather), { encoding: FileSystem.EncodingType.UTF8 });
        setWeatherToast('Weather downloaded for offline use');
        setTimeout(() => setWeatherToast(''), 3000);
      }).catch(() => {});
    } catch (e: any) {
      if (isOutOfCredits(e)) {
        handleOutOfCredits();
        setMessages(m => m); // keep messages unchanged
        setPlanPhase('ready'); // let user try again after buying
      } else {
        const isRateLimit = e.message?.includes('429') || e.message?.toLowerCase().includes('rate limit');
        setMessages(m => [
          ...m,
          {
            role: 'ai',
            text: isRateLimit
              ? '⏱ API is busy right now — tap Retry in ~30 seconds and your route will build normally.'
              : e.message?.includes('taking longer')
              ? '⏳ This trip is taking longer than usual to plan. Tap Retry to try again.'
              : e.message?.includes('non-JSON') || e.message?.includes('```')
              ? '⚠ AI had trouble formatting the route. Tap Retry — it usually works on the second attempt.'
              : e.message?.includes('Network') || e.message?.includes('fetch')
              ? '📡 Network issue during planning. Check your connection and tap Retry.'
              : '⚠ Planning hit a snag. Tap Retry to try again.',
            outline: isRateLimit ? '__retry__' : undefined,
          },
        ]);
        setPlanPhase('ready');
      }
    } finally {
      stopStages(); setLoading(false); scrollToEnd();
    }
  }

  function keepRefining() {
    setMessages(m => [
      ...m.filter(msg => !msg.outline),
      { role: 'ai', text: "No problem — what would you like to adjust? I can tweak the route, change the camping style, add or remove days, or swap out any area." },
    ]);
    setPlanPhase('chatting');
  }

  // ── Input hint text ──────────────────────────────────────────────────────
  const inputPlaceholder = planPhase === 'active' || planPhase === 'editing'
    ? 'Change anything — "skip Day 3", "add a shower stop"...'
    : planPhase === 'ready'
      ? 'Refine the plan, or say "build it"...'
      : planPhase === 'planning'
        ? 'Building your route...'
        : 'Tell me about your adventure...';

  const currentStages = planPhase === 'planning' ? PLAN_STAGES_LONG : CHAT_STAGES;

  // ── Login gate ───────────────────────────────────────────────────────────
  if (!user) return (
    <SafeAreaView style={s.container}>
      <View style={s.loginGate}>
        <View style={s.loginGateLogo}>
          <Ionicons name="compass" size={36} color={C.orange} />
        </View>
        <Text style={s.loginGateTitle}>AI Trip Planning</Text>
        <Text style={s.loginGateSub}>
          Build multi-day overland routes with fuel, legal camp options, weather, land context, offline downloads, and road-condition reports matched to your rig.
        </Text>
        <View style={s.loginGatePerks}>
          {[
            ['flash',          '50 signup credits, then earn more by contributing'],
            ['map-outline',    'Route days, fuel, camps, POIs, and weather'],
            ['download-outline', 'Offline maps, route packs, and trip corridors'],
            ['shield-checkmark-outline', 'Private trips with community reports when needed'],
          ].map(([icon, text]) => (
            <View key={text} style={s.loginGatePerk}>
              <Ionicons name={icon as any} size={16} color={C.orange} />
              <Text style={s.loginGatePerkText}>{text}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={s.loginGateBtn} onPress={() => router.push('/(tabs)/profile')}>
          <Text style={s.loginGateBtnText}>SIGN IN OR CREATE ACCOUNT</Text>
        </TouchableOpacity>
        <Text style={s.loginGateNote}>Browse camps, report conditions, and navigate — always free.</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.container}>
      {/* ── Paywall modal (IAP) ── */}
      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onPlanActivated={() => setPaywallVisible(false)}
      />

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.logoBadge}>
          <Ionicons name="compass" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.logoName}>TRAILHEAD</Text>
          <Text style={s.logoTag}>AI OVERLAND GUIDE</Text>
        </View>
        {user && (
          <TouchableOpacity style={s.creditPill} onPress={() => setPaywallVisible(true)}>
            <Ionicons name="flash" size={12} color={C.orange} />
            <Text style={s.creditPillText}>{user.credits}</Text>
          </TouchableOpacity>
        )}
        {(planPhase === 'active' || planPhase === 'editing') && (
          <View style={s.editBadge}>
            <Ionicons name="pencil" size={11} color={C.gold} />
            <Text style={s.editBadgeText}>EDIT</Text>
          </View>
        )}
      </View>

      {/* ── Offline saved toast ── */}
      {offlineToast && (
        <View style={s.offlineToast}>
          <Ionicons name="download-outline" size={13} color="#fff" />
          <Text style={s.offlineToastText}>Route + weather saved offline</Text>
        </View>
      )}

      {/* ── Trail DNA strip ── */}
      {(Object.keys(trailDna).some(k => trailDna[k as keyof TrailDNA]) || (rigProfile?.make && rigProfile?.model)) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.dnaRow}
          contentContainerStyle={s.dnaRowContent}
        >
          <Text style={s.dnaLabel}>TRAIL DNA</Text>
          {rigProfile?.make && rigProfile?.model && !trailDna.vehicle && (
            <DnaChip C={C} icon="car-outline" label={`${rigProfile.year ? rigProfile.year + ' ' : ''}${rigProfile.make} ${rigProfile.model}`} />
          )}
          {trailDna.vehicle    && <DnaChip C={C} icon="car-outline"       label={trailDna.vehicle} />}
          {trailDna.terrain    && <DnaChip C={C} icon="triangle-outline"  label={trailDna.terrain} />}
          {trailDna.camp_style && <DnaChip C={C} icon="moon-outline"      label={trailDna.camp_style} />}
          {trailDna.duration   && <DnaChip C={C} icon="time-outline"      label={trailDna.duration} />}
          {(trailDna.regions ?? []).map(r => <DnaChip key={r} C={C} icon="location-outline" label={r} />)}
        </ScrollView>
      )}

      {/* ── Messages ── */}
      <ScrollView
        ref={scrollRef}
        style={s.messages}
        contentContainerStyle={s.messagesContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Welcome screen */}
        {messages.length === 0 && (
          <View style={s.welcome}>

            {/* ── Resume saved trip card ─────────────────────────────────── */}
            {activeTrip && (
              <View style={s.resumeCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange }} />
                  <Text style={{ color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1.5 }}>SAVED ROUTE</Text>
                </View>
                <Text style={{ color: C.text, fontSize: 15, fontFamily: mono, fontWeight: '900', marginBottom: 4 }} numberOfLines={2}>
                  {activeTrip.plan.trip_name}
                </Text>
                <Text style={{ color: C.text3, fontSize: 10, fontFamily: mono, marginBottom: 14 }}>
                  {(activeTrip.plan.states ?? []).join(' · ')}
                  {!!activeTrip.plan.duration_days && `  ·  ${activeTrip.plan.duration_days} days`}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: C.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center' }}
                    onPress={() => {
                      setMessages([{ role: 'ai', trip: activeTrip }]);
                      setPlanPhase('active');
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 1 }}>RESUME ROUTE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: C.s2, borderRadius: 8, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: C.border }}
                    onPress={() => setActiveTrip(null)}
                  >
                    <Text style={{ color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '900', letterSpacing: 1 }}>NEW TRIP</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {tripHistory.length > 0 && (
              <View style={s.historySection}>
                <Text style={s.sectionLabel}>RECENT TRIPS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.historyScroll}>
                  {tripHistory.map(t => (
                    <TouchableOpacity
                      key={t.trip_id}
                      style={s.historyCard}
                      onPress={() => { openHistoryTrip(t.trip_id); }}
                    >
                      <Text style={s.historyCardName} numberOfLines={2}>{t.trip_name}</Text>
                      <Text style={s.historyCardStates}>{(t.states ?? []).join(' · ')}</Text>
                      <View style={s.historyCardFooter}>
                        <Text style={s.historyCardStat}>{t.duration_days}D</Text>
                        <Text style={s.historyCardDot}>·</Text>
                        <Text style={s.historyCardStat}>{t.est_miles}MI</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={s.welcomeHeading}>
              {'BUILD A\nTRAIL-READY\n'}
              <Text style={{ color: C.orange }}>ROUTE.</Text>
            </Text>
            <Text style={s.welcomeSub}>
              Start with where you want to go, how long you have, and what you drive. Trailhead shapes the days, finds nearby camp and fuel options, then sends the route to the map for review.
            </Text>
            <View style={s.welcomeChips}>
              {['LEGAL CAMPS', 'FUEL RANGE', 'OFFLINE READY'].map(label => (
                <View key={label} style={s.welcomeChip}>
                  <Text style={s.welcomeChipText}>{label}</Text>
                </View>
              ))}
            </View>

            {EXAMPLES.map((ex, i) => (
              <TouchableOpacity key={i} style={s.example} onPress={() => setInput(ex.text)}>
                <View style={s.exampleIconWrap}>
                  <Ionicons name={ex.icon as any} size={18} color={C.orange} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={s.exampleTagRow}>
                    <View style={s.exampleBadge}><Text style={s.exampleBadgeText}>{ex.label}</Text></View>
                    {ex.tags.map(t => (
                      <View key={t} style={s.exampleTag}><Text style={s.exampleTagText}>{t}</Text></View>
                    ))}
                  </View>
                  <Text style={s.exampleText}>{ex.text}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Message list */}
        {messages.map((msg, i) => (
          <View key={i} style={[s.msg, msg.role === 'user' ? s.msgUser : s.msgAi]}>
            {msg.role === 'ai'   && <Text style={s.msgLabel}>TRAIL GUIDE</Text>}
            {msg.role === 'user' && <Text style={[s.msgLabel, { textAlign: 'right' }]}>YOU</Text>}

            {msg.trip ? (
              <TripCard
                trip={msg.trip}
                C={C}
                onViewMap={() => router.push('/map')}
                onViewGuide={() => router.push('/guide')}
                onNextLeg={planNextLeg}
              />
            ) : msg.outline ? (
              <OutlineCard
                outline={msg.outline}
                C={C}
                onBuild={buildTrip}
                onRefine={keepRefining}
                loading={planPhase === 'planning'}
              />
            ) : (
              <View style={[s.bubble, msg.role === 'user' ? s.bubbleUser : s.bubbleAi]}>
                <MarkdownText text={msg.text ?? ''} C={C} isUser={msg.role === 'user'} />
              </View>
            )}
          </View>
        ))}

        {/* Thinking indicator */}
        {loading && (
          <View style={s.msgAi}>
            <Text style={s.msgLabel}>TRAIL GUIDE</Text>
            <View style={s.thinkingBubble}>
              <ThinkingDots C={C} />
              <Text style={[s.bubbleText, s.thinkingText]}>{currentStages[stageIdx]}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── My Trips quick-access (shown above input when not on welcome screen) ── */}
      {messages.length > 0 && tripHistory.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ maxHeight: 44 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 8, alignItems: 'center' }}
        >
          <Text style={{ color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1, paddingRight: 4 }}>MY TRIPS</Text>
          {tripHistory.slice(0, 6).map(t => (
            <TouchableOpacity
              key={t.trip_id}
              style={{ backgroundColor: C.s2, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 5 }}
              onPress={() => { openHistoryTrip(t.trip_id); }}
            >
              <Ionicons name="map-outline" size={11} color={C.orange} />
              <Text style={{ color: C.text2, fontSize: 11, fontFamily: mono, maxWidth: 120 }} numberOfLines={1}>{t.trip_name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Input ── */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TourTarget id="plan.input">
          <View style={s.inputWrap}>
            <TextInput
              style={[s.input, (planPhase === 'active' || planPhase === 'editing') && s.inputEdit]}
              value={input}
              onChangeText={setInput}
              placeholder={inputPlaceholder}
              placeholderTextColor={C.text3}
              multiline
              maxLength={500}
              editable={!loading || planPhase === 'active'}
            />
            <TouchableOpacity
              style={[s.sendBtn, loading && s.sendBtnDisabled]}
              onPress={send}
              disabled={loading}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </TourTarget>
        {(planPhase === 'active' || planPhase === 'editing') && (
          <View style={s.editHint}>
            <Ionicons name="pencil-outline" size={10} color={C.orange} />
            <Text style={[s.editHintText, { color: C.orange }]}>Edit mode — describe any change to your route</Text>
          </View>
        )}
      </KeyboardAvoidingView>
      {!!weatherToast && (
        <View style={s.weatherToast}>
          <Ionicons name="cloud-download-outline" size={14} color={C.text} />
          <Text style={s.weatherToastText}>{weatherToast}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// Simple inline markdown renderer — handles bold, headers, bullets, tables, and dividers
function MarkdownText({ text, C, isUser }: { text: string; C: ColorPalette; isUser?: boolean }) {
  const baseColor = isUser ? C.white : C.text;
  const dimColor  = isUser ? 'rgba(255,255,255,0.7)' : C.text2;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    // Skip table separator rows (|---|---|)
    if (/^\|[\s\-|:]+\|$/.test(trimmed)) return;

    // Horizontal rule
    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      elements.push(
        <View key={idx} style={{ height: 1, backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : C.border, marginVertical: 6 }} />
      );
      return;
    }

    // H2 or H3 header
    const headerMatch = trimmed.match(/^#{1,3}\s+(.*)/);
    if (headerMatch) {
      elements.push(
        <Text key={idx} style={{ color: isUser ? C.white : C.gold, fontSize: 12, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5, marginTop: 8, marginBottom: 2 }}>
          {headerMatch[1].replace(/\*\*/g, '').replace(/\*/g, '')}
        </Text>
      );
      return;
    }

    // Table row — strip pipes, show as indented list
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      elements.push(
        <Text key={idx} style={{ color: dimColor, fontSize: 12, lineHeight: 18, paddingLeft: 6 }}>
          {'  ' + cells.join('  ·  ')}
        </Text>
      );
      return;
    }

    // Bullet line
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      elements.push(
        <Text key={idx} style={{ color: baseColor, fontSize: 13, lineHeight: 20 }}>
          {'• '}<RichText text={bulletMatch[1]} baseColor={baseColor} />
        </Text>
      );
      return;
    }

    // Empty line
    if (!trimmed) {
      elements.push(<View key={idx} style={{ height: 4 }} />);
      return;
    }

    // Normal line
    elements.push(
      <Text key={idx} style={{ color: baseColor, fontSize: 13, lineHeight: 20 }}>
        <RichText text={trimmed} baseColor={baseColor} />
      </Text>
    );
  });

  return <View style={{ gap: 1 }}>{elements}</View>;
}

// Renders inline **bold** and *italic* within a line
function RichText({ text, baseColor }: { text: string; baseColor: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.*?)\*\*|\*(.*?)\*/g;
  let last = 0, m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(<Text key={key++}>{text.slice(last, m.index)}</Text>);
    if (m[1] !== undefined) parts.push(<Text key={key++} style={{ fontWeight: '700' }}>{m[1]}</Text>);
    else if (m[2] !== undefined) parts.push(<Text key={key++} style={{ fontStyle: 'italic' }}>{m[2]}</Text>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Text key={key++}>{text.slice(last)}</Text>);
  return <>{parts}</>;
}

function DnaChip({ C, label, icon }: { C: ColorPalette; label: string; icon?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(122,170,124,0.1)', borderWidth: 1, borderColor: 'rgba(122,170,124,0.2)', borderRadius: 5, paddingHorizontal: 9, paddingVertical: 3, marginRight: 6 }}>
      {icon && <Ionicons name={icon as any} size={9} color={C.sage} />}
      <Text style={{ color: C.sage, fontSize: 9, fontFamily: mono, letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

function ThinkingDots({ C }: { C: ColorPalette }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    dots.forEach((dot, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(dot, { toValue: -6, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0,  duration: 300, useNativeDriver: true }),
          Animated.delay(600 - i * 180),
        ])
      ).start();
    });
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 5, marginRight: 10 }}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange, transform: [{ translateY: dot }] }} />
      ))}
    </View>
  );
}

function OutlineCard({ outline, C, onBuild, onRefine, loading }: {
  outline: string; C: ColorPalette;
  onBuild: () => void; onRefine: () => void; loading: boolean;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 9, useNativeDriver: true }),
    ]).start();
  }, []);

  const isRetry = outline === '__retry__';

  return (
    <Animated.View style={[{
      backgroundColor: isRetry ? C.orangeGlow : C.gold + '18',
      borderWidth: 1,
      borderColor: isRetry ? C.orange + '44' : C.gold + '44',
      borderRadius: 14, overflow: 'hidden',
      opacity: fadeAnim, transform: [{ translateY: slideAnim }],
    }]}>
      <View style={{ padding: 14 }}>
        {isRetry ? (
          <>
            <Text style={{ color: C.orange, fontSize: 9, fontFamily: mono, letterSpacing: 1, marginBottom: 10 }}>⏱ RATE LIMITED</Text>
            <Text style={{ color: C.text2, fontSize: 13, lineHeight: 20, marginBottom: 14 }}>
              Anthropic is busy — your route is ready to build, just wait ~30 seconds and tap Retry.
            </Text>
            <TouchableOpacity
              onPress={onBuild}
              disabled={loading}
              style={{
                backgroundColor: C.orange, borderRadius: 8, paddingVertical: 12,
                alignItems: 'center',
                shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6,
              }}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: C.white, fontWeight: '700', fontSize: 13, fontFamily: mono, letterSpacing: 0.5 }}>RETRY →</Text>
              }
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={{ color: C.gold, fontSize: 9, fontFamily: mono, letterSpacing: 1, marginBottom: 10 }}>✦ ROUTE READY TO BUILD</Text>
            <Text style={{ color: C.text2, fontSize: 13, lineHeight: 20, fontStyle: 'italic', marginBottom: 14 }}>{outline}</Text>
            <TouchableOpacity
              onPress={onBuild}
              disabled={loading}
              style={{
                backgroundColor: C.orange, borderRadius: 8, paddingVertical: 12,
                alignItems: 'center', marginBottom: 8,
                shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6,
              }}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: C.white, fontWeight: '700', fontSize: 13, fontFamily: mono, letterSpacing: 0.5 }}>BUILD ROUTE →</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onRefine}
              style={{ backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 11, alignItems: 'center' }}
            >
              <Text style={{ color: C.text2, fontSize: 12, fontFamily: mono, letterSpacing: 0.3 }}>KEEP REFINING</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );
}

async function shareGpx(trip: TripResult) {
  const wpts = trip.plan.waypoints
    .filter(w => w.lat && w.lng)
    .map(w => `  <wpt lat="${w.lat!.toFixed(6)}" lon="${w.lng!.toFixed(6)}">\n    <name>${w.name.replace(/[<>&]/g, '')}</name>\n    <desc>Day ${w.day} – ${w.type}</desc>\n  </wpt>`)
    .join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trailhead" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${trip.plan.trip_name}</name></metadata>\n${wpts}\n</gpx>`;
  const path = `${FileSystem.documentDirectory}${trip.plan.trip_name.replace(/[^a-z0-9]/gi, '_')}.gpx`;
  await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(path, { mimeType: 'application/gpx+xml', UTI: 'public.gpx' });
}

function TripCard({ trip, C, onViewMap, onViewGuide, onNextLeg }: {
  trip: TripResult; C: ColorPalette;
  onViewMap: () => void; onViewGuide: () => void;
  onNextLeg?: () => void;
}) {
  const tag = useTag();
  const p = trip.plan;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const [counts, setCounts] = useState({ days: 0, miles: 0, stops: 0, camps: 0 });

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
    const overnights = (p.waypoints ?? []).filter(w => w.type === 'camp' || w.type === 'town' || w.type === 'motel').length;
    const targets = { days: p.duration_days ?? 0, miles: p.total_est_miles ?? 0, stops: p.waypoints?.length ?? 0, stays: overnights };
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      const ease = 1 - Math.pow(1 - Math.min(frame / 24, 1), 3);
      setCounts({ days: Math.round(targets.days * ease), miles: Math.round(targets.miles * ease), stops: Math.round(targets.stops * ease), camps: Math.round(targets.stays * ease) });
      if (frame >= 24) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, []);

  const tags: Array<{ label: string; style: string }> = [];
  const roadTypes = new Set((p.daily_itinerary ?? []).map(d => d.road_type));
  const landTypes = new Set((p.waypoints ?? []).map(w => w.land_type));
  if (roadTypes.has('4wd'))  tags.push({ label: '4WD',  style: '4wd'  });
  if (roadTypes.has('dirt')) tags.push({ label: 'DIRT', style: 'dirt' });
  if (landTypes.has('BLM'))  tags.push({ label: 'BLM',  style: 'blm'  });
  if (landTypes.has('USFS') || landTypes.has('National Forest')) tags.push({ label: 'USFS', style: 'usfs' });
  if (landTypes.has('NPS')  || landTypes.has('National Park'))  tags.push({ label: 'NPS',  style: 'nps'  });

  function shareTrip() {
    Share.share({
      title: p.trip_name,
      message: `🗺 ${p.trip_name}\n${p.duration_days} days · ${p.total_est_miles ?? '?'} miles · ${(p.states ?? []).join(', ')}\n\n${p.overview}\n\nPlanned with Trailhead: ${BASE_URL}`,
    });
  }

  return (
    <Animated.View style={[{
      borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.border,
      opacity: fadeAnim, transform: [{ translateY: slideAnim }],
    }]}>
      {/* Hero */}
      <View style={{ backgroundColor: C.s1, padding: 14, borderBottomWidth: 1, borderColor: C.border }}>
        <View style={{ marginBottom: 4 }}>
          <Text style={{ color: C.orange, fontSize: 8.5, fontFamily: mono, letterSpacing: 1.2 }}>✦ AI TRIP PLAN READY</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.5, lineHeight: 22, textTransform: 'uppercase' }} numberOfLines={2}>{p.trip_name}</Text>
            <Text style={{ color: C.text2, fontSize: 10, fontFamily: mono, letterSpacing: 0.8, marginTop: 3 }}>{(p.states ?? []).join(' · ')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: -2 }}>
            <TouchableOpacity onPress={() => shareGpx(trip)} style={{ padding: 4 }}>
              <Ionicons name="navigate-circle-outline" size={18} color={C.text2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={shareTrip} style={{ padding: 4 }}>
              <Ionicons name="share-outline" size={18} color={C.text2} />
            </TouchableOpacity>
          </View>
        </View>
        {tags.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {tags.map(t => {
              const ts = tag[t.style as keyof typeof tag] ?? tag.mixed;
              return (
                <View key={t.label} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 5, borderWidth: 1, backgroundColor: ts.bg, borderColor: ts.border }}>
                  <Text style={{ fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5, color: ts.text }}>{t.label}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', backgroundColor: C.s2, borderBottomWidth: 1, borderColor: C.border }}>
        {([['DAYS', counts.days], ['MILES', counts.miles], ['STOPS', counts.stops], ['STAYS', counts.camps]] as [string, number][]).map(([label, val], i) => (
          <View key={label} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderLeftWidth: i > 0 ? 1 : 0, borderColor: C.border }}>
            <Text style={{ color: C.orange, fontSize: 22, fontWeight: '800', fontFamily: mono }}>{val}</Text>
            <Text style={{ color: C.text3, fontSize: 8.5, fontFamily: mono, letterSpacing: 0.5, marginTop: 2 }}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Overview */}
      <Text style={{ color: C.text2, fontSize: 12.5, lineHeight: 19, padding: 12, backgroundColor: C.s2, borderBottomWidth: 1, borderColor: C.border, fontStyle: 'italic' }} numberOfLines={3}>{p.overview}</Text>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, backgroundColor: C.s2 }}>
        <TouchableOpacity onPress={onViewMap} style={{ flex: 1, backgroundColor: C.orange, borderRadius: 8, paddingVertical: 11, alignItems: 'center', shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6 }}>
          <Text style={{ color: C.white, fontWeight: '700', fontSize: 12, fontFamily: mono, letterSpacing: 0.5 }}>VIEW ON MAP →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onViewGuide} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.s3 }}>
          <Ionicons name="headset-outline" size={15} color={C.text2} />
          <Text style={{ color: C.text2, fontSize: 11, fontFamily: mono }}>GUIDE</Text>
        </TouchableOpacity>
      </View>
      {/* Plan Next Leg — shown when trip is at or near the 14-day cap */}
      {onNextLeg && (p.duration_days ?? 0) >= 12 && (
        <TouchableOpacity
          onPress={onNextLeg}
          style={{ margin: 12, marginTop: 0, paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: C.green + '55', backgroundColor: C.green + '15', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
        >
          <Ionicons name="arrow-forward-circle-outline" size={16} color={C.green} />
          <Text style={{ color: C.green, fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 }}>PLAN NEXT LEG FROM HERE →</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Login gate
  loginGate: { flex: 1, padding: 28, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loginGateLogo: { width: 72, height: 72, borderRadius: 20, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  loginGateTitle: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  loginGateSub: { color: C.text2, fontSize: 14, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  loginGatePerks: { gap: 10, alignSelf: 'stretch', marginVertical: 4 },
  loginGatePerk: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  loginGatePerkText: { color: C.text2, fontSize: 13, flex: 1 },
  loginGateBtn: { backgroundColor: C.orange, borderRadius: 12, paddingVertical: 14, alignSelf: 'stretch', alignItems: 'center', marginTop: 8 },
  loginGateBtnText: { color: '#fff', fontFamily: mono, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  loginGateNote: { color: C.text3, fontSize: 11, textAlign: 'center', fontFamily: mono },

  // Credit pill in header
  creditPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.s2, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  creditPillText: { color: C.orange, fontSize: 12, fontWeight: '700', fontFamily: mono },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 13,
    borderBottomWidth: 1, borderColor: C.border,
    backgroundColor: C.s1,
  },
  logoBadge: {
    width: 36, height: 36, borderRadius: 9,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 6,
  },
  logoName: {
    color: C.text, fontSize: 17, fontWeight: '900',
    letterSpacing: -0.5, lineHeight: 20,
  },
  logoTag: { color: C.text3, fontSize: 8, fontFamily: mono, marginTop: 1, letterSpacing: 1 },
  editBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(200,149,58,0.1)', borderWidth: 1, borderColor: 'rgba(200,149,58,0.25)',
    borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4,
  },
  editBadgeText: { color: C.gold, fontSize: 8.5, fontFamily: mono, letterSpacing: 0.8 },

  // Trail DNA strip
  dnaRow: { borderBottomWidth: 1, borderColor: C.border2, backgroundColor: C.s1, maxHeight: 36 },
  dnaRowContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  dnaLabel: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 1, marginRight: 4 },

  // Messages
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 14, flexGrow: 1 },

  // Welcome
  welcome: { gap: 10 },
  resumeCard: {
    backgroundColor: C.s1, borderRadius: 12, padding: 16,
    borderLeftWidth: 3, borderLeftColor: C.orange,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 4,
  },
  welcomeHeading: {
    color: C.text, fontSize: 38, fontWeight: '900',
    letterSpacing: -1.5, lineHeight: 40, marginBottom: 8,
    textTransform: 'uppercase',
  },
  welcomeSub: { color: C.text2, fontSize: 14, lineHeight: 21, marginBottom: 2 },
  welcomeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 6 },
  welcomeChip: {
    borderWidth: 1, borderColor: C.border,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5,
    backgroundColor: C.s2,
  },
  welcomeChipText: {
    color: C.text3, fontSize: 8.5, fontFamily: mono,
    fontWeight: '900', letterSpacing: 0.7,
  },

  sectionLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  historySection: { marginBottom: 4 },
  historyScroll: { gap: 8, paddingRight: 4 },
  historyCard: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12, width: 148, gap: 4,
    borderLeftWidth: 3, borderLeftColor: C.orange,
  },
  historyCardName:   { color: C.text, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  historyCardStates: { color: C.orange, fontSize: 9, fontFamily: mono, letterSpacing: 0.5 },
  historyCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  historyCardStat:   { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  historyCardDot:    { color: C.border, fontSize: 9 },

  example: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  exampleIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(184,92,56,0.12)', borderWidth: 1, borderColor: 'rgba(184,92,56,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  exampleTagRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  exampleBadge: {
    height: 20, borderRadius: 5,
    backgroundColor: C.orange, borderWidth: 0,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  exampleBadgeText: { color: '#fff', fontSize: 8.5, fontFamily: mono, fontWeight: '800' },
  exampleTag: {
    height: 20, borderRadius: 5, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.s3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  exampleTagText: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.3 },
  exampleText: { color: C.text2, fontSize: 12.5, lineHeight: 18 },

  // Messages
  msg:     { gap: 4 },
  msgUser: { alignItems: 'flex-end' },
  msgAi:   { alignItems: 'flex-start' },
  msgLabel: { color: C.text3, fontSize: 8.5, fontFamily: mono, paddingHorizontal: 4, letterSpacing: 1 },

  bubble:     { borderRadius: 16, padding: 12, maxWidth: '90%', flexDirection: 'row', alignItems: 'center' },
  bubbleUser: { backgroundColor: C.orange, borderBottomRightRadius: 4 },
  bubbleAi:   { backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleText: { color: C.text, fontSize: 13.5, lineHeight: 21, flex: 1 },

  thinkingBubble: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 4, borderBottomLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12, maxWidth: '85%',
  },
  thinkingText: { color: C.text2, fontSize: 12, fontFamily: mono, letterSpacing: 0.3 },

  // Input
  inputWrap: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6,
    borderTopWidth: 1, borderColor: C.border,
    alignItems: 'flex-end', backgroundColor: C.s1,
  },
  input: {
    flex: 1, backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border,
    borderRadius: 14, padding: 12, color: C.text, fontSize: 14, maxHeight: 120,
  },
  inputEdit: { borderColor: `rgba(184,92,56,0.4)` },
  sendBtn: {
    width: 46, height: 46, borderRadius: 12, backgroundColor: C.orange,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 6,
  },
  sendBtnDisabled: { backgroundColor: C.s3, shadowOpacity: 0 },

  editHint: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingBottom: 8,
    backgroundColor: C.s1,
  },
  editHintText: { fontSize: 9, fontFamily: mono, letterSpacing: 0.4 },

  // Offline toast
  offlineToast: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(34,197,94,0.9)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    marginHorizontal: 14, marginBottom: 2,
  },
  offlineToastText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.3 },

  weatherToast: {
    position: 'absolute', bottom: 90, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6,
  },
  weatherToastText: { color: C.text, fontSize: 12, fontFamily: mono, letterSpacing: 0.3 },
});
