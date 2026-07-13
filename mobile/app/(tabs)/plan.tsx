import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
  Share, Animated, Alert, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { api, ApiError, PaywallError, TripResult } from '@/lib/api';
import PaywallModal from '@/components/PaywallModal';
import AppReviewPrompt from '@/components/AppReviewPrompt';
import TourTarget from '@/components/TourTarget';
import CopilotBriefCard from '@/components/copilot/CopilotBriefCard';
import PlanWorkspaceSwitcher from '@/components/plan/PlanWorkspaceSwitcher';
import AiReportModal from '@/components/AiReportModal';
import { useStore } from '@/lib/store';
import { useTheme, useTag, mono, ColorPalette } from '@/lib/design';
import { saveOfflineTrip, loadOfflineTrip } from '@/lib/offlineTrips';
import { markReviewPromptShown, recordReviewMoment } from '@/lib/reviewPrompt';
import { loadWelcomeSetupPreferences, type WelcomeSetupPreferences } from '@/lib/welcomeGate';
import { mergeTripPreferencesIntoRigContext, tripPreferenceContextFromWelcomePreferences } from '@/lib/tripPreferences';
import { accountStorage } from '@/lib/storage';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.gettrailhead.app';
const TRAILHEAD_LOGO = require('../../assets/icon.png');

const STARTER_PROMPTS = [
  {
    title: 'Plan 3 days from Moab to Telluride',
    icon: 'trail-sign-outline',
    body: 'Scenic roads · Camps · Fuel',
    text: 'Plan a 3-day trip from Moab to Telluride with scenic roads, camp options, fuel checks, and realistic first-day pacing.',
  },
  {
    title: 'Find a quiet weekend near Asheville',
    icon: 'moon-outline',
    body: 'Short drives · Quiet camps · Easy exit',
    text: 'Find a quiet weekend trip near Asheville with short drives, legal camps, and an easy morning exit.',
  },
];

const CHAT_STAGES  = [
  'Reviewing the route',
  'Checking stops and timing',
  'Preparing an update',
];
const PLAN_STAGES_LONG = [
  'Drafting the route',
  'Balancing drive time and camp nights',
  'Checking fuel and backup stops',
  'Reviewing each day',
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
  if (!clean) return 'Trip updated. Review the route and stops before you leave.';
  if (/(lat\/lng|latitude|longitude|coordinates|geocod|added .*coord|debug|internal)/i.test(clean)) {
    return 'Trip stops updated. Review the route, camps, and fuel stops on the map.';
  }
  return clean;
}

function savedPlaceKind(icon: string) {
  if (icon === 'camp') return 'Camp';
  if (icon === 'fuel') return 'Fuel';
  if (icon === 'water') return 'Water';
  if (icon === 'flag') return 'Stop';
  return 'Saved place';
}

function savedPlaceIcon(icon: string): keyof typeof Ionicons.glyphMap {
  if (icon === 'camp') return 'bookmark-outline';
  if (icon === 'fuel') return 'car-outline';
  if (icon === 'water') return 'water-outline';
  if (icon === 'flag') return 'flag-outline';
  if (icon === 'star') return 'star-outline';
  return 'location-outline';
}

function recentDate(timestamp: number) {
  const value = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(value);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((dayStart - dateStart) / 86_400_000);
  if (dayDifference === 0) return 'Today';
  if (dayDifference === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function appendAiMessage(messages: Message[], text?: string): Message[] {
  const clean = userFacingPlannerText(text);
  const last = messages[messages.length - 1];
  if (last?.role === 'ai' && !last.trip && !last.outline && last.text === clean) return messages;
  return [...messages, { role: 'ai', text: clean }];
}

function PlanScreenContent() {
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
  const tripHistory      = useStore(st => st.tripHistory);
  const savedPlaces      = useStore(st => st.savedPlaces);
  const sessionId        = useStore(st => st.sessionId);
  const user             = useStore(st => st.user);
  const rigProfile       = useStore(st => st.rigProfile);
  const weatherUnitMode  = useStore(st => st.weatherUnitMode);
  const [welcomeSetupPreferences, setWelcomeSetupPreferences] = useState<WelcomeSetupPreferences | null>(null);

  useEffect(() => {
    let mounted = true;
    loadWelcomeSetupPreferences()
      .then(preferences => { if (mounted) setWelcomeSetupPreferences(preferences); })
      .catch(() => { if (mounted) setWelcomeSetupPreferences(null); });
    return () => { mounted = false; };
  }, [user?.id]);

  const tripPreferenceContext = useMemo(
    () => tripPreferenceContextFromWelcomePreferences(welcomeSetupPreferences),
    [welcomeSetupPreferences],
  );
  const planningContext = useMemo(
    () => mergeTripPreferencesIntoRigContext(rigProfile as Record<string, unknown> | null, welcomeSetupPreferences),
    [rigProfile, welcomeSetupPreferences],
  );

  function accountRequestIsCurrent(epoch: number, accountId: string | number | null | undefined) {
    return accountStorage.epoch() === epoch
      && String(useStore.getState().user?.id ?? '') === String(accountId ?? '');
  }

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
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    try {
      const cached = await loadOfflineTrip(tripId);
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      if (cached) {
        setActiveTrip(cached, true);
        setMessages([{ role: 'ai', trip: cached }]);
        setPlanPhase('active');
        return;
      }

      const trip = await api.getTrip(tripId);
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
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
  async function send(draft = input) {
    const text = draft.trim();
    if (!text || loading || sendRef.current) return;
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    sendRef.current = true;
    setTimeout(() => { sendRef.current = false; }, 1500);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    activateKeepAwakeAsync('ai-chat');

    const finalText = await resolveLocation(text);
    if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) {
      deactivateKeepAwake('ai-chat');
      return;
    }

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
        const data = await api.chat(finalText, sessionId, activeTrip, planningContext as any);
        if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;

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
        if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
        if (isOutOfCredits(e)) handleOutOfCredits();
        else {
          const message = e instanceof ApiError || isRouteValidationMessage(e?.message)
            ? e.message
            : 'That change could not be applied. Include the start, stops, and destination, then try again.';
          setMessages(m => [...m, { role: 'ai', text: message }]);
        }
        setPlanPhase('active');
      } finally {
        if (accountRequestIsCurrent(requestEpoch, requestAccountId)) {
          stopStages(); setLoading(false); scrollToEnd();
        }
        deactivateKeepAwake('ai-chat');
      }
      return;
    }

    // ── Conversational planning ───────────────────────────────────────────────
    setPlanPhase('chatting');
    startStages(CHAT_STAGES);
    try {
      const data = await api.chat(finalText, sessionId, null, planningContext as any);
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;

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
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
      if (isOutOfCredits(e)) { handleOutOfCredits(); setPlanPhase('idle'); }
      else {
        // Keep raw responses and JSON out of the visible chat.
        const raw = e?.message ?? '';
        const isTimeout = raw.includes('taking longer') || raw.includes('timeout');
        const isNetwork = raw.includes('Network') || raw.includes('fetch');
        const friendly = isTimeout
          ? 'This route is taking longer than usual. Try again in a moment.'
          : isNetwork
          ? 'Connection lost. Check your signal and try again.'
          : 'That request was not clear enough. Shorten it and try again.';
        setMessages(m => [...m, { role: 'ai', text: friendly }]);
        setPlanPhase('ready'); // stay in ready so they can retry
      }
    } finally {
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) {
        stopStages(); setLoading(false); scrollToEnd();
      }
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
    const requestEpoch = accountStorage.epoch();
    const requestAccountId = useStore.getState().user?.id;
    const keepAwakeTag = `trip-build-${requestEpoch}-${Date.now()}`;
    setMessages(m => m.filter(msg => !msg.outline));
    setPlanPhase('planning');
    setLoading(true);
    // Prevent screen sleep during long planner runs (can take 2-3 min)
    await activateKeepAwakeAsync(keepAwakeTag);
    if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) {
      deactivateKeepAwake(keepAwakeTag);
      return;
    }
    // Use the longer stage list so "this can take a minute" shows up for long trips
    startStages(PLAN_STAGES_LONG);
    try {
      const result = await api.planFromSession(sessionId, tripPreferenceContext ? {
        route_style: tripPreferenceContext.route_builder.route_style,
        camp_preference: tripPreferenceContext.route_builder.camp_preference,
        camp_reuse_policy: tripPreferenceContext.route_builder.camp_reuse_policy,
        trip_preferences: tripPreferenceContext,
      } : {});
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
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
      const weatherEpoch = accountStorage.epoch();
      api.getRouteWeather(result.trip_id, result.plan.waypoints, weatherUnitMode).then(async weather => {
        const path = `${FileSystem.documentDirectory}weather_${result.trip_id}.json`;
        const stored = await accountStorage.run(async () => {
          await FileSystem.writeAsStringAsync(path, JSON.stringify(weather), { encoding: FileSystem.EncodingType.UTF8 });
          return true;
        }, weatherEpoch);
        if (!stored) return;
        setWeatherToast('Weather saved for this trip');
        setTimeout(() => setWeatherToast(''), 3000);
      }).catch(() => {});
    } catch (e: any) {
      if (!accountRequestIsCurrent(requestEpoch, requestAccountId)) return;
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
              ? 'The planner is busy. Try again in about 30 seconds.'
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
      if (accountRequestIsCurrent(requestEpoch, requestAccountId)) {
        stopStages(); setLoading(false); scrollToEnd();
      }
      deactivateKeepAwake(keepAwakeTag);
    }
  }

  function keepRefining() {
    setMessages(m => [
      ...m.filter(msg => !msg.outline),
      { role: 'ai', text: 'What would you like to change about the route, camps, days, or area?' },
    ]);
    setPlanPhase('chatting');
  }

  // ── Input hint text ──────────────────────────────────────────────────────
  const inputPlaceholder = planPhase === 'active' || planPhase === 'editing'
    ? 'Add a stop or change the route'
    : planPhase === 'ready'
      ? 'Add changes or build the trip'
      : planPhase === 'planning'
        ? 'Building route'
        : 'Where do you want to go?';

  const currentStages = planPhase === 'planning' ? PLAN_STAGES_LONG : CHAT_STAGES;
  const welcomeSavedPlaces = savedPlaces.slice(0, activeTrip ? 1 : 2);
  const recentTrips = tripHistory
    .filter(trip => trip.trip_id !== activeTrip?.trip_id)
    .slice(0, 2);
  const showStarterRoutes = !activeTrip && welcomeSavedPlaces.length === 0 && recentTrips.length === 0;

  // ── Login gate ───────────────────────────────────────────────────────────
  if (!user) return (
    <SafeAreaView style={s.container}>
      <View style={s.planHeader}>
        <Text style={s.planTitle}>Plan</Text>
      </View>
      <PlanWorkspaceSwitcher active="assisted" />
      <View style={s.loginGate}>
        <View style={s.loginGateLogo}>
          <Image source={TRAILHEAD_LOGO} style={s.loginGateLogoImage} resizeMode="cover" />
        </View>
        <Text style={s.loginGateTitle}>Trip Planner</Text>
        <Text style={s.loginGateSub}>Sign in to plan and save trips.</Text>
        <TouchableOpacity style={s.loginGateBtn} onPress={() => router.push('/(tabs)/profile')}>
          <Text style={s.loginGateBtnText}>Sign in or create account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.container}>
      <View style={s.planHeader}>
        <Text style={s.planTitle}>Plan</Text>
      </View>
      <PlanWorkspaceSwitcher active="assisted" />
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
        contentContainerStyle={[
          s.messagesContent,
          { paddingBottom: (messages.length === 0 ? 32 : 148) + bottomInset },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Welcome screen */}
        {messages.length === 0 && (
          <View style={s.welcome}>
            <Text style={s.welcomeHeading}>Where are you headed?</Text>
            <TourTarget id="plan.input">
              <View style={s.destinationField}>
                <Ionicons name="search-outline" size={20} color={C.text2} />
                <TextInput
                  accessibilityLabel="Trip destination"
                  style={s.destinationInput}
                  value={input}
                  onChangeText={setInput}
                  placeholder="City, park, or trailhead"
                  placeholderTextColor={C.text2}
                  returnKeyType="go"
                  onSubmitEditing={() => { void send(); }}
                  maxLength={500}
                  editable={!loading}
                />
              </View>
            </TourTarget>

            {(welcomeSavedPlaces.length > 0 || activeTrip) && (
              <View style={s.welcomeSection}>
                <Text style={s.welcomeSectionTitle}>Saved places</Text>
                {welcomeSavedPlaces.map(place => (
                  <TouchableOpacity
                    key={place.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Plan a trip to ${place.name}`}
                    activeOpacity={0.72}
                    style={s.welcomeRow}
                    onPress={() => { void send(`Plan a trip to ${place.name}.`); }}
                  >
                    <View style={s.welcomeRowIcon}>
                      <Ionicons name={savedPlaceIcon(place.icon)} size={21} color={C.orange} />
                    </View>
                    <View style={s.welcomeRowCopy}>
                      <Text style={s.welcomeRowTitle} numberOfLines={1}>{place.name}</Text>
                      <Text style={s.welcomeRowMeta}>{savedPlaceKind(place.icon)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.text3} />
                  </TouchableOpacity>
                ))}
                {activeTrip && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Resume ${activeTrip.plan.trip_name}`}
                    activeOpacity={0.72}
                    style={s.welcomeRow}
                    onPress={() => {
                      setMessages([{ role: 'ai', trip: activeTrip }]);
                      setPlanPhase('active');
                    }}
                  >
                    <View style={s.welcomeRowIcon}>
                      <Ionicons name="git-branch-outline" size={21} color={C.orange} />
                    </View>
                    <View style={s.welcomeRowCopy}>
                      <Text style={s.welcomeRowTitle} numberOfLines={1}>{activeTrip.plan.trip_name}</Text>
                      <Text style={s.welcomeRowMeta}>
                        {activeTrip.plan.duration_days ? `${activeTrip.plan.duration_days} days · ` : ''}In progress
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.text3} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {recentTrips.length > 0 && (
              <View style={s.welcomeSection}>
                <Text style={s.welcomeSectionTitle}>Recent</Text>
                {recentTrips.map(trip => (
                  <TouchableOpacity
                    key={trip.trip_id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${trip.trip_name}`}
                    activeOpacity={0.72}
                    style={s.welcomeRow}
                    onPress={() => { void openHistoryTrip(trip.trip_id); }}
                  >
                    <View style={s.welcomeRowIcon}>
                      <Ionicons name="trail-sign-outline" size={21} color={C.orange} />
                    </View>
                    <View style={s.welcomeRowCopy}>
                      <Text style={s.welcomeRowTitle} numberOfLines={1}>{trip.trip_name}</Text>
                      <Text style={s.welcomeRowMeta}>
                        {trip.duration_days ? `${trip.duration_days} days · ` : ''}{recentDate(trip.planned_at)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.text3} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {showStarterRoutes && (
              <View style={s.welcomeSection}>
                <Text style={s.welcomeSectionTitle}>Start here</Text>
                {STARTER_PROMPTS.map(prompt => (
                  <TouchableOpacity
                    key={prompt.title}
                    accessibilityRole="button"
                    accessibilityLabel={prompt.title}
                    activeOpacity={0.72}
                    style={s.welcomeRow}
                    onPress={() => { void send(prompt.text); }}
                  >
                    <View style={s.welcomeRowIcon}>
                      <Ionicons name={prompt.icon as keyof typeof Ionicons.glyphMap} size={21} color={C.orange} />
                    </View>
                    <View style={s.welcomeRowCopy}>
                      <Text style={s.welcomeRowTitle} numberOfLines={1}>{prompt.title}</Text>
                      <Text style={s.welcomeRowMeta} numberOfLines={1}>{prompt.body}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.text3} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Message list */}
        {messages.map((msg, i) => (
          <View key={i} style={[s.msg, msg.role === 'user' ? s.msgUser : s.msgAi]}>
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
            <View style={s.thinkingBubble}>
              <View style={s.thinkingOrb}>
                <ThinkingDots C={C} />
              </View>
              <Text style={[s.bubbleText, s.thinkingText]}>{currentStages[stageIdx]}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Input ── */}
      {messages.length > 0 && (
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
                accessibilityLabel="Trip notes"
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
                accessibilityRole="button"
                accessibilityLabel="Send trip notes"
                style={[s.sendBtn, loading && s.sendBtnDisabled]}
                onPress={() => { void send(); }}
                disabled={loading}
              >
                <Ionicons name="send" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </TourTarget>
        </KeyboardAvoidingView>
      )}
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
        kicker="ROUTE"
        title="Retry the route"
        summary="Your trip details are ready to retry."
        tone="review"
        icon="alert-circle-outline"
        actions={[{
          label: 'Retry',
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
      kicker="TRIP"
      title="Build this trip"
      summary={outline}
      tone="ready"
      icon="map-outline"
      actions={[
        {
          label: 'Build trip',
          icon: 'navigate',
          variant: 'primary',
          onPress: onBuild,
          loading,
        },
        {
          label: 'Make changes',
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
  const stored = await accountStorage.run(async () => {
    await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingType.UTF8 });
    return true;
  });
  if (!stored) return;
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
    const milesPart = p.total_est_miles ? `${p.total_est_miles} miles · ` : '';
    Share.share({
      title: p.trip_name,
      message: `${p.trip_name}\n${p.duration_days} days · ${milesPart}${(p.states ?? []).join(', ')}\n\n${p.overview}\n\nPlanned with Trailhead: ${BASE_URL}`,
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
          <Text style={{ color: C.orange, fontSize: 8.5, fontFamily: mono, letterSpacing: 1.2 }}>TRIP PLAN BUILT</Text>
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

export default function PlanScreen() {
  const pathname = usePathname();
  if (!pathname.includes('/plan')) return null;
  return <PlanScreenContent />;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  planHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  planTitle: {
    color: C.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: 0,
  },

  // Login gate
  loginGate: { flex: 1, padding: 28, justifyContent: 'center', alignItems: 'center', gap: 14 },
  loginGateLogo: { width: 64, height: 64, borderRadius: 18, backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 4, overflow: 'hidden' },
  loginGateLogoImage: { width: 64, height: 64 },
  loginGateTitle: { color: C.text, fontSize: 24, lineHeight: 29, fontWeight: '700', letterSpacing: 0 },
  loginGateSub: { color: C.text2, fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  loginGateBtn: { backgroundColor: C.orange, borderRadius: 8, minHeight: 50, paddingHorizontal: 20, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  loginGateBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0 },

  // Messages
  messages: { flex: 1 },
  messagesContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 148, gap: 14, flexGrow: 1 },

  // Welcome
  welcome: { width: '100%' },
  welcomeHeading: {
    color: C.text, fontSize: 24, fontWeight: '700',
    letterSpacing: 0, lineHeight: 29, marginBottom: 16,
  },
  destinationField: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: C.s1,
  },
  destinationInput: {
    flex: 1,
    minWidth: 0,
    color: C.text,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 0,
  },
  welcomeSection: {
    marginTop: 28,
  },
  welcomeSectionTitle: {
    color: C.text,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 8,
  },
  welcomeRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  welcomeRowIcon: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  welcomeRowTitle: {
    color: C.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    letterSpacing: 0,
  },
  welcomeRowMeta: {
    color: C.text2,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0,
  },

  // Messages
  msg:     { gap: 4 },
  msgUser: { alignItems: 'flex-end' },
  msgAi:   { alignItems: 'flex-start' },

  bubble:     { borderRadius: 12, padding: 12, maxWidth: '90%', flexDirection: 'row', alignItems: 'center' },
  bubbleUser: { backgroundColor: C.orange, borderBottomRightRadius: 4 },
  bubbleAi:   { backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleText: { color: C.text, fontSize: 13.5, lineHeight: 21, flex: 1 },

  thinkingBubble: {
    flexDirection: 'row', alignItems: 'center',
    gap: 11,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 13, paddingVertical: 12, maxWidth: '94%',
  },
  thinkingOrb: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.orange + '40',
    backgroundColor: C.orange + '12',
  },
  thinkingText: { color: C.text2, fontSize: 13, flexShrink: 1, lineHeight: 18 },

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
    borderRadius: 8,
    alignItems: 'flex-end',
    backgroundColor: C.s1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  reportIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 8, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 10, color: C.text, fontSize: 14, minHeight: 42, maxHeight: 108,
  },
  inputEdit: { borderColor: `rgba(184,92,56,0.4)` },
  sendBtn: {
    width: 42, height: 42, borderRadius: 8, backgroundColor: C.orange,
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
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6,
    zIndex: 90,
    elevation: 44,
  },
  weatherToastText: { color: C.text, fontSize: 12, fontFamily: mono, letterSpacing: 0.3 },
});
