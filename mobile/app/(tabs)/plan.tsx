import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
  Share, Animated, Alert, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { api, ApiError, PaywallError, TripResult } from '@/lib/api';
import PaywallModal from '@/components/PaywallModal';
import AppReviewPrompt from '@/components/AppReviewPrompt';
import TourTarget from '@/components/TourTarget';
import { TrailheadButton, TrailheadButtonDock, TrailheadCard } from '@/components/TrailheadUI';
import CopilotBriefCard from '@/components/copilot/CopilotBriefCard';
import PlannerStarterRow from '@/components/planning/PlannerStarterRow';
import AiReportModal from '@/components/AiReportModal';
import { useStore } from '@/lib/store';
import { useTheme, useTag, mono, ColorPalette } from '@/lib/design';
import { saveOfflineTrip, loadOfflineTrip } from '@/lib/offlineTrips';
import { markReviewPromptShown, recordReviewMoment } from '@/lib/reviewPrompt';
import { CREDIT_REWARDS } from '@/lib/credits';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';
const TRAILHEAD_LOGO = require('../../assets/icon.png');

const STARTER_PROMPTS = [
  {
    title: 'Plan 3 days from Moab to Telluride',
    icon: 'trail-sign-outline',
    body: 'Scenic roads, camp options, fuel checks.',
    text: 'Plan a 3-day trip from Moab to Telluride with scenic roads, camp options, fuel checks, and realistic first-day pacing.',
  },
  {
    title: 'Find a quiet weekend near Asheville',
    icon: 'moon-outline',
    body: 'Short drives, legal camps, easy morning exit.',
    text: 'Find a quiet weekend trip near Asheville with short drives, legal camps, and an easy morning exit.',
  },
];

const CHAT_STAGES  = [
  'Reading your trip notes...',
  'Checking the route shape...',
  'Preparing the next step...',
];
// Long trips (7+ days) can take 1-2 minutes — we surface an extra stage at ~20s
const PLAN_STAGES_LONG = [
  'Drafting the route...',
  'Longer trips can take a minute. Keeping the days realistic.',
  'Balancing drive time, fuel, and camp nights...',
  'Checking towns, trailheads, and backup options...',
  'Polishing the trip plan...',
];

type PlanPhase = 'idle' | 'chatting' | 'ready' | 'planning' | 'active' | 'editing';

interface Message {
  role: 'user' | 'ai';
  text?: string;
  trip?: TripResult;
  outline?: string;   // "route ready" card
}

function userFacingPlannerText(text?: string) {
  const clean = (text ?? '').trim();
  if (!clean) return 'I updated the trip. Review the map pins and daily route before you head out.';
  if (/(lat\/lng|latitude|longitude|coordinates|geocod|added .*coord|debug|internal)/i.test(clean)) {
    return 'I updated the trip stops and map pins. Review the route, camps, and fuel stops on the map.';
  }
  return clean;
}

function appendAiMessage(messages: Message[], text?: string): Message[] {
  const clean = userFacingPlannerText(text);
  const last = messages[messages.length - 1];
  if (last?.role === 'ai' && !last.trip && !last.outline && last.text === clean) return messages;
  return [...messages, { role: 'ai', text: clean }];
}

export default function PlanScreen() {
  const C  = useTheme();
  const s  = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 0 : 0);
  const router = useRouter();

  const [messages,  setMessages]  = useState<Message[]>([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [planPhase, setPlanPhase] = useState<PlanPhase>('idle');
  const [stageIdx,  setStageIdx]  = useState(0);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollRef        = useRef<ScrollView>(null);
  const setActiveTrip    = useStore(st => st.setActiveTrip);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const userLoc          = useStore(st => st.userLoc);
  const activeTrip       = useStore(st => st.activeTrip);
  const sessionId        = useStore(st => st.sessionId);
  const user             = useStore(st => st.user);
  const rigProfile       = useStore(st => st.rigProfile);
  const weatherUnitMode  = useStore(st => st.weatherUnitMode);

  useEffect(() => {
    setMessages([]);
    setInput('');
    setLoading(false);
    setPlanPhase('idle');
    stopStages();
  }, [user?.id]);

  const [paywallVisible, setPaywallVisible] = useState(false);
  const [reviewPromptVisible, setReviewPromptVisible] = useState(false);
  const [aiReportVisible, setAiReportVisible] = useState(false);
  const [aiReportKind, setAiReportKind] = useState<'bug' | 'offensive'>('bug');
  const [offlineToast, setOfflineToast] = useState(false);
  const offlineToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function maybeShowReviewPrompt() {
    const shouldShow = await recordReviewMoment('trip_built');
    if (!shouldShow) return;
    await markReviewPromptShown();
    setReviewPromptVisible(true);
  }

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
        Alert.alert('Trip unavailable', 'This trip is not available for the current signed-in account. Sign in again or open a saved copy.');
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

  function isRouteValidationMessage(message = '') {
    return /outside Trail Head|supported planning|too far apart|correct the start|cross-ocean|unsupported/i.test(message);
  }

  // ── Resolve location reference in text ──────────────────────────────────────
  async function resolveLocation(text: string): Promise<string> {
    if (!/\b(my location|from here|current location|where i am|starting from here|starting here)\b/i.test(text)) return text;
    if (!userLoc) return text;
    try {
      const reverse = await api.mapContextReverse({
        lat: userLoc.lat,
        lng: userLoc.lng,
        types: 'place,region',
        limit: 1,
        metadata: { surface: 'planner', source: 'planner_current_location' },
      });
      const place = reverse.selected ?? reverse.places?.[0];
      const baseName = place?.name || `${userLoc.lat.toFixed(3)},${userLoc.lng.toFixed(3)}`;
      const region = typeof place?.region === 'string' && place.region ? place.region : '';
      const placeName = region && !baseName.includes(region) ? `${baseName}, ${region}` : baseName;
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
        else {
          const message = e instanceof ApiError || isRouteValidationMessage(e?.message)
            ? e.message
            : 'I could not safely apply that route change. Try one clearer edit with the start, stops, and destination.';
          setMessages(m => [...m, { role: 'ai', text: message }]);
        }
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

      if (data.type === 'ready') {
        setMessages(m => [
          ...m,
          { role: 'ai', text: data.content },
          { role: 'ai', outline: data.outline ?? 'Route outline is ready. Build the trip to review days, camps, and fuel.' },
        ]);
        setPlanPhase('ready');
      } else {
        setMessages(m => [...m, { role: 'ai', text: data.content }]);
        setPlanPhase('chatting');
      }
    } catch (e: any) {
      if (isOutOfCredits(e)) { handleOutOfCredits(); setPlanPhase('idle'); }
      else {
        // Keep raw responses and JSON out of the visible chat.
        const raw = e?.message ?? '';
        const isTimeout = raw.includes('taking longer') || raw.includes('timeout');
        const isNetwork = raw.includes('Network') || raw.includes('fetch');
        const friendly = isTimeout
              ? 'This route is taking longer than usual. Give it one more try and Trailhead will keep the plan tighter.'
          : isNetwork
          ? 'I lost the signal for a second. Check your connection and send it again.'
          : 'That route note did not land clearly. Try one shorter sentence, or say “build it” again.';
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
    // Prevent screen sleep during long planner runs (can take 2-3 min)
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
      maybeShowReviewPrompt().catch(() => {});
      setPlanPhase('active');
      // Download route weather for offline use (fail silently)
      api.getRouteWeather(result.trip_id, result.plan.waypoints, weatherUnitMode).then(async weather => {
        const path = `${FileSystem.documentDirectory}weather_${result.trip_id}.json`;
        await FileSystem.writeAsStringAsync(path, JSON.stringify(weather), { encoding: FileSystem.EncodingType.UTF8 });
        setWeatherToast('Weather saved for this trip');
        setTimeout(() => setWeatherToast(''), 3000);
      }).catch(() => {});
    } catch (e: any) {
      if (isOutOfCredits(e)) {
        handleOutOfCredits();
        setMessages(m => m); // keep messages unchanged
        setPlanPhase('ready'); // let user try again after buying
      } else {
        const isRateLimit = e.message?.includes('429') || e.message?.toLowerCase().includes('rate limit');
        const isRouteValidation = isRouteValidationMessage(e.message);
        setMessages(m => [
          ...m,
          {
            role: 'ai',
            text: isRateLimit
              ? 'The planner is busy for a moment. Tap Retry in about 30 seconds and I’ll pick it back up.'
              : isRouteValidation
              ? e.message
              : e.message?.includes('taking longer')
              ? 'This trip is taking longer than usual to plan. Tap Retry to keep the route tighter.'
              : e.message?.includes('non-JSON') || e.message?.includes('```')
              ? 'The route outline needs a cleaner rebuild. Tap Retry to try again.'
              : e.message?.includes('Network') || e.message?.includes('fetch')
              ? 'Signal dropped while planning. Check your connection and tap Retry.'
              : 'Trailhead could not finish that route. Tap Retry to try again.',
            outline: '__retry__',
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
      { role: 'ai', text: 'What would you like to change? Trailhead can adjust the route, camp style, days, or area.' },
    ]);
    setPlanPhase('chatting');
  }

  // ── Input hint text ──────────────────────────────────────────────────────
  const inputPlaceholder = planPhase === 'active' || planPhase === 'editing'
    ? 'Change the trip...'
    : planPhase === 'ready'
      ? 'Refine it, or say "build it"...'
      : planPhase === 'planning'
        ? 'Building the route...'
        : 'Ask for a route, camp, or change...';

  const currentStages = planPhase === 'planning' ? PLAN_STAGES_LONG : CHAT_STAGES;

  // ── Login gate ───────────────────────────────────────────────────────────
  if (!user) return (
    <SafeAreaView style={s.container}>
      <View style={s.loginGate}>
        <View style={s.loginGateLogo}>
          <Image source={TRAILHEAD_LOGO} style={s.loginGateLogoImage} resizeMode="cover" />
        </View>
        <Text style={s.loginGateTitle}>Trip Planning</Text>
        <Text style={s.loginGateSub}>
          Build multi-day routes with fuel, camp options, weather, land context, saved trips, and road-condition reports.
        </Text>
        <View style={s.loginGatePerks}>
          {[
            ['flash',          `${CREDIT_REWARDS.signup} trip credits to start`],
            ['map-outline',    'Route days, fuel, camps, and weather'],
            ['download-outline', 'Saved trips and maps for later'],
            ['shield-checkmark-outline', 'Private trips with community reports when useful'],
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
        <Text style={s.loginGateNote}>Browse camps, report conditions, and navigate for free.</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.container}>
      <PlannerAmbientBackground C={C} />
      {/* ── Paywall modal (IAP) ── */}
      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
      />
      <AppReviewPrompt
        visible={reviewPromptVisible}
        onClose={() => setReviewPromptVisible(false)}
      />
      <AiReportModal
        visible={aiReportVisible}
        onClose={() => setAiReportVisible(false)}
        initialKind={aiReportKind}
        surface="planner"
        surfaceLabel="Trip Planner"
        messages={messages.filter(msg => !!msg.text).map(msg => ({ role: msg.role === 'ai' ? 'assistant' : 'user', text: msg.text || '' }))}
        sessionId={sessionId}
        tripId={activeTrip?.trip_id ?? null}
      />

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.logoBadge}>
          <Image source={TRAILHEAD_LOGO} style={s.logoBadgeImage} resizeMode="cover" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.logoName}>Trailhead</Text>
          <Text style={s.logoTag}>PLANNER</Text>
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
          <Text style={s.offlineToastText}>Trip saved for later</Text>
        </View>
      )}

      {/* ── Messages ── */}
      <ScrollView
        ref={scrollRef}
        style={s.messages}
        contentContainerStyle={[s.messagesContent, { paddingBottom: 148 + bottomInset }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Welcome screen */}
        {messages.length === 0 && (
          <View style={s.welcome}>

            {/* ── Resume saved trip card ─────────────────────────────────── */}
            {activeTrip && (
              <TrailheadCard style={s.resumeCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange }} />
                  <Text style={{ color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1.5 }}>SAVED TRIP</Text>
                </View>
                <Text style={{ color: C.text, fontSize: 15, fontFamily: mono, fontWeight: '900', marginBottom: 4 }} numberOfLines={2}>
                  {activeTrip.plan.trip_name}
                </Text>
                <Text style={{ color: C.text3, fontSize: 10, fontFamily: mono, marginBottom: 14 }}>
                  {(activeTrip.plan.states ?? []).join(' · ')}
                  {!!activeTrip.plan.duration_days && `  ·  ${activeTrip.plan.duration_days} days`}
                </Text>
                <TrailheadButtonDock>
                  <TrailheadButton
                    label="Resume Trip"
                    variant="primary"
                    onPress={() => {
                      setMessages([{ role: 'ai', trip: activeTrip }]);
                      setPlanPhase('active');
                    }}
                    style={{ flex: 1 }}
                  />
                  <TrailheadButton
                    label="New Trip"
                    variant="secondary"
                    onPress={() => setActiveTrip(null)}
                    style={{ flex: 1 }}
                  />
                </TrailheadButtonDock>
              </TrailheadCard>
            )}

            <Text style={s.welcomeHeading}>
              {'Where are you\nheaded?'}
            </Text>
            <Text style={s.welcomeSub}>
              Tell Trailhead the start, timing, and travel style. It will turn that into a route outline you can review before building.
            </Text>
            <View style={s.starterList}>
              {STARTER_PROMPTS.map(prompt => (
                <PlannerStarterRow
                  key={prompt.title}
                  title={prompt.title}
                  body={prompt.body}
                  icon={prompt.icon as keyof typeof Ionicons.glyphMap}
                  onPress={() => setInput(prompt.text)}
                />
              ))}
            </View>
          </View>
        )}

        {/* Message list */}
        {messages.map((msg, i) => (
          <View key={i} style={[s.msg, msg.role === 'user' ? s.msgUser : s.msgAi]}>
            {msg.role === 'ai'   && <Text style={s.msgLabel}>TRAILHEAD</Text>}
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
            <Text style={s.msgLabel}>TRAILHEAD</Text>
            <View style={s.thinkingBubble}>
              <View style={s.thinkingOrb}>
                <ThinkingDots C={C} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.thinkingKicker}>WORKING ON IT</Text>
                <Text style={[s.bubbleText, s.thinkingText]}>{currentStages[stageIdx]}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Input ── */}
      <KeyboardAvoidingView style={[s.inputDock, { bottom: 94 + bottomInset }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TourTarget id="plan.input">
          <View style={s.inputWrap}>
            <TouchableOpacity
              style={s.reportIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Report planner response"
              onPress={() => {
                setAiReportKind('bug');
                setAiReportVisible(true);
              }}
            >
              <Ionicons name="flag-outline" size={17} color={C.text2} />
            </TouchableOpacity>
            <TextInput
              style={[s.input, (planPhase === 'active' || planPhase === 'editing') && s.inputEdit]}
              value={input}
              onChangeText={setInput}
              placeholder={inputPlaceholder}
              placeholderTextColor={C.text3}
              multiline
              textAlignVertical="top"
              onFocus={scrollToEnd}
              onContentSizeChange={scrollToEnd}
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
      </KeyboardAvoidingView>
      {!!weatherToast && (
        <View style={[s.weatherToast, { bottom: 176 + bottomInset }]}>
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

function PlannerAmbientBackground({ C }: { C: ColorPalette }) {
  const waveA = useRef(new Animated.Value(0)).current;
  const waveB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loopA = Animated.loop(
      Animated.timing(waveA, { toValue: 1, duration: 5600, useNativeDriver: true })
    );
    const loopB = Animated.loop(
      Animated.sequence([
        Animated.delay(1700),
        Animated.timing(waveB, { toValue: 1, duration: 6400, useNativeDriver: true }),
      ])
    );
    loopA.start();
    loopB.start();
    return () => {
      loopA.stop();
      loopB.stop();
    };
  }, [waveA, waveB]);

  const lineColor = C.bg === '#050505' ? 'rgba(229,231,235,0.10)' : 'rgba(15,23,42,0.055)';
  const glowColor = C.bg === '#050505' ? 'rgba(249,115,22,0.09)' : 'rgba(184,92,56,0.055)';
  const accentColor = C.bg === '#050505' ? 'rgba(148,163,184,0.12)' : 'rgba(71,85,105,0.07)';
  const txA = waveA.interpolate({ inputRange: [0, 0.55, 1], outputRange: [-70, 22, 96] });
  const tyA = waveA.interpolate({ inputRange: [0, 0.55, 1], outputRange: [14, -8, 12] });
  const scaleA = waveA.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.96, 1.075, 1.0] });
  const opacityA = waveA.interpolate({ inputRange: [0, 0.16, 0.62, 1], outputRange: [0.06, 0.30, 0.18, 0.03] });
  const txB = waveB.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-130, -8, 126] });
  const tyB = waveB.interpolate({ inputRange: [0, 0.6, 1], outputRange: [-12, 10, -2] });
  const scaleB = waveB.interpolate({ inputRange: [0, 0.52, 1], outputRange: [0.9, 1.16, 1.02] });
  const opacityB = waveB.interpolate({ inputRange: [0, 0.18, 0.64, 1], outputRange: [0, 0.18, 0.13, 0] });

  return (
    <View pointerEvents="none" style={sAmbient.wrap}>
      <Animated.View style={[sAmbient.gridPlane, { opacity: opacityA, transform: [{ translateX: txA }, { translateY: tyA }, { scale: scaleA }] }]}>
        <PlannerGridLines lineColor={lineColor} glowColor={glowColor} />
      </Animated.View>
      <Animated.View style={[sAmbient.gridPlaneSoft, { opacity: opacityB, transform: [{ translateX: txB }, { translateY: tyB }, { scale: scaleB }] }]}>
        <PlannerGridLines lineColor={accentColor} glowColor={glowColor} />
      </Animated.View>
    </View>
  );
}

function PlannerGridLines({ lineColor, glowColor }: { lineColor: string; glowColor: string }) {
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <View style={[sAmbient.gridGlow, { backgroundColor: glowColor }]} />
      {Array.from({ length: 12 }).map((_, i) => (
        <View key={`v-${i}`} style={[sAmbient.gridLineV, { left: `${i * 9.1}%`, backgroundColor: lineColor }]} />
      ))}
      {Array.from({ length: 16 }).map((_, i) => (
        <View key={`h-${i}`} style={[sAmbient.gridLineH, { top: `${i * 6.66}%`, backgroundColor: lineColor }]} />
      ))}
    </View>
  );
}

const sAmbient = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  gridPlane: {
    position: 'absolute',
    left: -90,
    right: -90,
    top: -90,
    bottom: -90,
  },
  gridPlaneSoft: {
    position: 'absolute',
    left: -120,
    right: -120,
    top: -120,
    bottom: -120,
  },
  gridGlow: {
    position: 'absolute',
    left: '12%',
    right: '8%',
    top: '18%',
    height: '44%',
    borderRadius: 180,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
});

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
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.orange, transform: [{ translateY: dot }] }} />
      ))}
    </View>
  );
}

function OutlineCard({ outline, onBuild, onRefine, loading }: {
  outline: string;
  onBuild: () => void; onRefine: () => void; loading: boolean;
}) {
  const isRetry = outline === '__retry__';
  if (isRetry) {
    return (
      <CopilotBriefCard
        kicker="ROUTE REVIEW"
        title="Retry the route"
        summary="The trip notes are still here. Retry will rebuild from the same conversation."
        tone="review"
        icon="alert-circle-outline"
        sourceLabel="Trip notes"
        reason="A cleaner pass can keep stops and daily pacing easier to review."
        actions={[{
          label: 'RETRY',
          icon: 'refresh',
          variant: 'primary',
          onPress: onBuild,
          loading,
        }]}
      />
    );
  }

  return (
    <CopilotBriefCard
      kicker="ROUTE OUTLINE"
      title="Build this trip"
      summary={outline}
      tone="ready"
      icon="map-outline"
      sourceLabel="Review first"
      reason="Build turns the outline into route days, camps, fuel stops, and map pins."
      actions={[
        {
          label: 'BUILD TRIP',
          icon: 'navigate',
          variant: 'primary',
          onPress: onBuild,
          loading,
        },
        {
          label: 'REFINE',
          icon: 'create-outline',
          variant: 'secondary',
          onPress: onRefine,
        },
      ]}
    />
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
      message: `${p.trip_name}\n${p.duration_days} days · ${p.total_est_miles ?? '?'} miles · ${(p.states ?? []).join(', ')}\n\n${p.overview}\n\nPlanned with Trailhead: ${BASE_URL}`,
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
          <Text style={{ color: C.orange, fontSize: 8.5, fontFamily: mono, letterSpacing: 1.2 }}>TRIP PLAN READY</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', letterSpacing: 0, lineHeight: 22, textTransform: 'uppercase' }} numberOfLines={2}>{p.trip_name}</Text>
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
          <Text style={{ color: C.text2, fontSize: 11, fontFamily: mono }}>EXPLORE</Text>
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
  loginGateLogo: { width: 72, height: 72, borderRadius: 24, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 4, overflow: 'hidden' },
  loginGateLogoImage: { width: 72, height: 72 },
  loginGateTitle: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: 0 },
  loginGateSub: { color: C.text2, fontSize: 14, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  loginGatePerks: { gap: 10, alignSelf: 'stretch', marginVertical: 4 },
  loginGatePerk: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  loginGatePerkText: { color: C.text2, fontSize: 13, flex: 1 },
  loginGateBtn: { backgroundColor: C.bg === '#050505' ? C.silverBright : C.orange, borderRadius: 16, paddingVertical: 15, alignSelf: 'stretch', alignItems: 'center', marginTop: 8, shadowColor: C.orange, shadowOpacity: 0.16, shadowRadius: 18 },
  loginGateBtnText: { color: C.bg === '#050505' ? '#050505' : '#fff', fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  loginGateNote: { color: C.text3, fontSize: 11, textAlign: 'center', fontFamily: mono },

  // Credit pill in header
  creditPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.s2, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  creditPillText: { color: C.orange, fontSize: 12, fontWeight: '700', fontFamily: mono },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border2,
    backgroundColor: C.bg === '#050505' ? 'rgba(17,20,24,0.88)' : C.glassStrong,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  logoBadge: {
    width: 36, height: 36, borderRadius: 14,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    shadowColor: '#E5E7EB', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 14,
  },
  logoBadgeImage: { width: 36, height: 36 },
  logoName: {
    color: C.text, fontSize: 17, fontWeight: '900',
    letterSpacing: 0, lineHeight: 20,
  },
  logoTag: { color: C.text3, fontSize: 8, fontFamily: mono, marginTop: 1, letterSpacing: 1 },
  editBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(200,149,58,0.1)', borderWidth: 1, borderColor: 'rgba(200,149,58,0.25)',
    borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4,
  },
  editBadgeText: { color: C.gold, fontSize: 8.5, fontFamily: mono, letterSpacing: 0.8 },

  // Messages
  messages: { flex: 1 },
  messagesContent: { padding: 16, paddingBottom: 148, gap: 14, flexGrow: 1 },

  // Welcome
  welcome: { gap: 10 },
  resumeCard: {
    backgroundColor: 'rgba(255,255,255,0.055)', borderRadius: 22, padding: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    marginBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  welcomeHeading: {
    color: C.text, fontSize: 34, fontWeight: '800',
    letterSpacing: 0, lineHeight: 38, marginBottom: 8,
  },
  welcomeSub: { color: C.text2, fontSize: 14, lineHeight: 21, marginBottom: 6 },
  starterList: { gap: 10, marginTop: 2 },

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
    gap: 11,
    backgroundColor: C.glassStrong, borderWidth: 1, borderColor: C.border,
    borderRadius: 18,
    paddingHorizontal: 13, paddingVertical: 12, maxWidth: '94%',
    shadowColor: C.orange, shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  thinkingOrb: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.orange + '40',
    backgroundColor: C.orange + '12',
  },
  thinkingKicker: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.9, marginBottom: 3 },
  thinkingText: { color: C.text2, fontSize: 12, fontFamily: mono, flexShrink: 1, lineHeight: 17 },

  // Input
  inputDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 94,
    zIndex: 120,
    elevation: 64,
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
  },
  inputWrap: {
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 22,
    alignItems: 'flex-end',
    backgroundColor: C.glassStrong,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  reportIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 16, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 10, color: C.text, fontSize: 14, minHeight: 42, maxHeight: 108,
  },
  inputEdit: { borderColor: `rgba(184,92,56,0.4)` },
  sendBtn: {
    width: 42, height: 42, borderRadius: 13, backgroundColor: C.orange,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 6,
  },
  sendBtnDisabled: { backgroundColor: C.s3, shadowOpacity: 0 },

  // Offline toast
  offlineToast: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(34,197,94,0.9)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    marginHorizontal: 14, marginBottom: 2,
  },
  offlineToastText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '700', letterSpacing: 0.3 },

  weatherToast: {
    position: 'absolute', bottom: 116, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6,
    zIndex: 90,
    elevation: 44,
  },
  weatherToastText: { color: C.text, fontSize: 12, fontFamily: mono, letterSpacing: 0.3 },
});
