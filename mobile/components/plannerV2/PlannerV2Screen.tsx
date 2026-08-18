import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import PlanWorkspaceSwitcher from '@/components/plan/PlanWorkspaceSwitcher';
import { StaticMapboxPreview } from '@/components/explore/StaticMapboxPreview';
import {
  api,
  ApiError,
  type PlannerQuestion,
  type PlannerV2Finding,
  type PlannerV2Snapshot,
  type PlannerV2Task,
  type TripResult,
} from '@/lib/api';
import { useTheme, type ColorPalette, mono } from '@/lib/design';
import { saveOfflineTrip } from '@/lib/offlineTrips';
import { routeBuildCoordsFromTrip, routeBuildPreviewStopsFromTrip, createRouteBuildRequestId } from '@/lib/routeBuildSession';
import { accountStorage } from '@/lib/storage';
import { useStore } from '@/lib/store';
import {
  mergePlannerEvents,
  newestPlannerMessage,
  plannerDraftSummary,
  plannerMapPins,
  plannerRunIsTerminal,
  plannerRunStorageKey,
  plannerStartRequestStorageKey,
  plannerConversationStorageKey,
  plannerTaskProgress,
  type PlannerV2Message,
  type PlannerV2View,
} from '@/lib/plannerV2/model';

const STARTERS = [
  {
    prompt: 'Help me create a camping trip',
  },
  {
    prompt: 'Where are some of the best campgrounds around Moab?',
  },
  {
    prompt: 'Find campsites around Moab that will fit my RV',
  },
];

const GUIDE_GREETING = "Tell me where you want to go—or just the kind of trip you want. I'll ask what matters, research the route, and show you what I checked.";

function restoreConversation(raw: string | null): {
  messages: PlannerV2Message[];
  outline: string;
  question: PlannerQuestion | null;
} {
  if (!raw || raw.length > 64_000) return { messages: [], outline: '', question: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const messages = Array.isArray(parsed.messages) ? parsed.messages.slice(-40).flatMap((item, index) => {
      if (!item || typeof item !== 'object') return [];
      const source = item as Record<string, unknown>;
      const role: PlannerV2Message['role'] | null = source.role === 'user' ? 'user' : source.role === 'guide' ? 'guide' : null;
      const text = String(source.text || '').trim().slice(0, 2_000);
      return role && text ? [{ id: String(source.id || `restored-${index}`).slice(0, 100), role, text }] : [];
    }) : [];
    const outline = String(parsed.outline || '').trim().slice(0, 2_000);
    const sourceQuestion = parsed.question && typeof parsed.question === 'object'
      ? parsed.question as Record<string, unknown>
      : null;
    const options = Array.isArray(sourceQuestion?.options) ? sourceQuestion.options.slice(0, 6).flatMap((item, index) => {
      if (!item || typeof item !== 'object') return [];
      const source = item as Record<string, unknown>;
      const label = String(source.label || '').trim().slice(0, 100);
      const value = String(source.value || '').trim().slice(0, 1_000);
      if (!label || !value) return [];
      return [{
        id: String(source.id || `restored-option-${index}`).slice(0, 100),
        label,
        value,
        detail: String(source.detail || '').trim().slice(0, 240),
      }];
    }) : [];
    const prompt = String(sourceQuestion?.prompt || '').trim().slice(0, 700);
    const question = prompt && options.length ? {
      kind: String(sourceQuestion?.kind || 'freeform').slice(0, 80),
      prompt,
      allow_freeform: sourceQuestion?.allow_freeform !== false,
      options,
    } : null;
    return { messages, outline, question };
  } catch {
    return { messages: [], outline: '', question: null };
  }
}

function messageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function plannerErrorMessage(error: unknown) {
  const status = error instanceof ApiError ? error.status : 0;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (status === 401 || status === 403) return 'Your sign-in changed. Sign in again, then reopen this plan.';
  if (status === 409) return 'This plan changed on another screen. I refreshed it so you can review the latest version.';
  if (/network|fetch|connection/.test(message)) return 'The connection dropped. Your research is saved, so you can resume when signal returns.';
  if (/timeout|taking longer/.test(message)) return 'This check is taking longer than expected. Your completed research is still saved.';
  return 'Trailhead could not continue that step. Your completed research is still saved.';
}

function taskIcon(task: PlannerV2Task): keyof typeof Ionicons.glyphMap {
  if (task.state === 'completed') return 'checkmark-circle';
  if (task.state === 'running') return 'radio-button-on';
  if (task.state === 'warning') return 'warning';
  if (task.state === 'blocked') return 'close-circle';
  if (task.state === 'needs_input') return 'chatbubble-ellipses';
  if (task.state === 'skipped') return 'remove-circle';
  return 'ellipse-outline';
}

function taskColor(task: PlannerV2Task, C: ColorPalette) {
  if (task.state === 'completed') return C.green;
  if (task.state === 'running') return C.orange;
  if (task.state === 'warning' || task.state === 'needs_input') return C.yellow;
  if (task.state === 'blocked') return C.red;
  return C.text3;
}

function sourceBadge(finding: PlannerV2Finding) {
  if (finding.source_kind === 'official') return 'OFFICIAL SOURCE';
  if (finding.source_kind === 'commercial') return 'COMMERCIAL OPTION';
  return 'DIRECT SOURCE';
}

export default function PlannerV2Screen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useStore(state => state.user);
  const sessionId = useStore(state => state.sessionId);
  const rigProfile = useStore(state => state.rigProfile);
  const setActiveTrip = useStore(state => state.setActiveTrip);
  const addTripToHistory = useStore(state => state.addTripToHistory);
  const [view, setView] = useState<PlannerV2View>('conversation');
  const [messages, setMessages] = useState<PlannerV2Message[]>([]);
  const [input, setInput] = useState('');
  const [question, setQuestion] = useState<PlannerQuestion | null>(null);
  const [outline, setOutline] = useState('');
  const [snapshot, setSnapshot] = useState<PlannerV2Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pollBusyRef = useRef(false);

  const runKey = useMemo(() => plannerRunStorageKey(user?.id), [user?.id]);
  const startRequestKey = useMemo(() => plannerStartRequestStorageKey(user?.id), [user?.id]);
  const conversationKey = useMemo(() => plannerConversationStorageKey(user?.id), [user?.id]);
  const draft = snapshot?.draft ?? null;
  const summary = useMemo(() => plannerDraftSummary(draft), [draft]);
  const route = useMemo(() => draft ? routeBuildCoordsFromTrip(draft) : [], [draft]);
  const mapPins = useMemo(() => plannerMapPins(draft), [draft]);
  const progress = useMemo(() => plannerTaskProgress(snapshot?.tasks ?? []), [snapshot?.tasks]);

  const applySnapshot = useCallback((next: PlannerV2Snapshot) => {
    setSnapshot(previous => ({
      ...next,
      events: mergePlannerEvents(previous?.events ?? [], next.events ?? []),
    }));
    if (['ready_for_review', 'committing', 'committed'].includes(next.status)) setView('reveal');
    else if (next.status !== 'cancelled' && next.status !== 'failed') setView('research');
  }, []);

  useEffect(() => {
    setMessages([]);
    setQuestion(null);
    setOutline('');
    setSnapshot(null);
    setView('conversation');
    setError('');
    setBusy(false);
    if (!user) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    setRestoring(true);
    Promise.all([accountStorage.get(runKey), accountStorage.get(conversationKey)])
      .then(async ([runId, savedConversation]) => {
        if (cancelled) return;
        const restoredConversation = restoreConversation(savedConversation);
        setMessages(restoredConversation.messages);
        setOutline(restoredConversation.outline);
        setQuestion(restoredConversation.question);
        if (!runId) return;
        try {
          const restored = await api.plannerV2Events(runId, 0);
          if (!cancelled) {
            await accountStorage.del(startRequestKey).catch(() => {});
            applySnapshot(restored);
          }
        } catch (restoreError) {
          if (restoreError instanceof ApiError && restoreError.status === 404) {
            await accountStorage.del(runKey).catch(() => {});
          } else if (!cancelled) {
            setError(plannerErrorMessage(restoreError));
          }
        }
      })
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [applySnapshot, conversationKey, runKey, startRequestKey, user?.id]);

  useEffect(() => {
    if (!user || restoring) return;
    accountStorage.set(conversationKey, JSON.stringify({
      messages: messages.slice(-40),
      outline,
      question,
    })).catch(() => {});
  }, [conversationKey, messages, outline, question, restoring, user?.id]);

  useEffect(() => {
    if (!snapshot || plannerRunIsTerminal(snapshot.status)) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const next = await api.plannerV2Events(snapshot.run_id, snapshot.cursor);
        if (!cancelled) {
          applySnapshot(next);
          setError('');
        }
      } catch (pollError) {
        if (!cancelled) setError(plannerErrorMessage(pollError));
      } finally {
        pollBusyRef.current = false;
      }
    };
    const timer = setInterval(poll, 1500);
    poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [applySnapshot, snapshot?.cursor, snapshot?.run_id, snapshot?.status]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages.length, question?.kind, snapshot?.cursor, view]);

  const sendMessage = useCallback(async (draftText = input, visibleText?: string) => {
    const text = draftText.trim();
    if (!text || busy || !user) return;
    const requestEpoch = accountStorage.epoch();
    const accountId = String(user.id);
    const stillCurrent = () => accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === accountId;
    setBusy(true);
    setError('');
    setInput('');
    setQuestion(null);
    setMessages(current => [...current, { id: messageId('user'), role: 'user', text: visibleText || text }]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const response = await api.plannerV2Conversation(text, sessionId, rigProfile as Record<string, unknown> | null);
      if (!stillCurrent()) return;
      setMessages(current => [...current, {
        id: messageId('guide'),
        role: 'guide',
        text: response.content || 'I have enough detail to keep shaping the trip.',
      }]);
      setQuestion(response.question ?? null);
      if (response.type === 'ready') {
        setOutline(response.outline || 'The route brief is ready for sourced research.');
      }
    } catch (sendError) {
      if (stillCurrent()) setError(plannerErrorMessage(sendError));
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }, [busy, input, rigProfile, sessionId, user]);

  const startResearch = useCallback(async () => {
    if (busy || !user) return;
    const requestEpoch = accountStorage.epoch();
    const accountId = String(user.id);
    const stillCurrent = () => accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === accountId;
    setBusy(true);
    setError('');
    try {
      let clientRequestId = String(await accountStorage.get(startRequestKey) || '').trim();
      if (!stillCurrent()) return;
      if (clientRequestId.length < 12) {
        clientRequestId = messageId('planner-run');
        await accountStorage.set(startRequestKey, clientRequestId);
        if (!stillCurrent()) return;
      }
      const next = await api.plannerV2Start(sessionId, clientRequestId, '', {
        trip_preferences: rigProfile as Record<string, unknown> | null,
      });
      if (!stillCurrent()) return;
      await accountStorage.set(runKey, next.run_id);
      await accountStorage.del(startRequestKey).catch(() => {});
      applySnapshot(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (startError) {
      if (stillCurrent()) setError(plannerErrorMessage(startError));
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }, [applySnapshot, busy, rigProfile, runKey, sessionId, startRequestKey, user]);

  const cancelResearch = useCallback(async () => {
    if (!snapshot || busy || !user) return;
    const requestEpoch = accountStorage.epoch();
    const accountId = String(user.id);
    const stillCurrent = () => accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === accountId;
    setBusy(true);
    try {
      const next = await api.plannerV2Action(snapshot.run_id, 'cancel');
      if (stillCurrent()) applySnapshot(next);
    } catch (cancelError) {
      if (stillCurrent()) setError(plannerErrorMessage(cancelError));
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }, [applySnapshot, busy, snapshot, user]);

  const decideDetour = useCallback(async (proposalId: string, approve: boolean) => {
    if (!snapshot || busy || snapshot.status !== 'ready_for_review' || !user) return;
    const requestEpoch = accountStorage.epoch();
    const accountId = String(user.id);
    const stillCurrent = () => accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === accountId;
    setBusy(true);
    setError('');
    try {
      const next = await api.plannerV2Action(
        snapshot.run_id,
        approve ? 'approve_detour' : 'reject_detour',
        proposalId,
        snapshot.revision,
      );
      if (!stillCurrent()) return;
      applySnapshot(next);
      Haptics.notificationAsync(
        approve ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => {});
    } catch (decisionError) {
      if (!stillCurrent()) return;
      if (decisionError instanceof ApiError && decisionError.status === 409) {
        try {
          const next = await api.plannerV2Events(snapshot.run_id, 0);
          if (stillCurrent()) applySnapshot(next);
        } catch {}
      }
      if (stillCurrent()) setError(plannerErrorMessage(decisionError));
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }, [applySnapshot, busy, snapshot, user]);

  const clearRunForAdjustment = useCallback(async () => {
    await accountStorage.del(runKey).catch(() => {});
    setSnapshot(null);
    setOutline('');
    setQuestion(null);
    setView('conversation');
    setMessages(current => [...current, {
      id: messageId('guide'),
      role: 'guide',
      text: "Tell me what you'd change. I'll research the updated route before replacing the draft.",
    }]);
  }, [runKey]);

  const openDraftOnMap = useCallback(() => {
    if (!draft) return;
    setActiveTrip(draft, false, { mirrorRepository: false });
    const requestId = createRouteBuildRequestId();
    useStore.getState().startRouteBuildSession({
      requestId,
      tripId: draft.trip_id,
      routeName: draft.plan?.trip_name || 'Trip preview',
      tripShape: 'one_way',
      source: 'assisted_trip_planner',
      previewStops: routeBuildPreviewStopsFromTrip(draft),
    });
    const distance = Number(draft.route_geometry?.totalDistance ?? draft.route_geometry?.total_distance);
    const duration = Number(draft.route_geometry?.totalDuration ?? draft.route_geometry?.total_duration);
    useStore.getState().updateRouteBuildSession(requestId, {
      phase: 'complete',
      status: 'complete',
      message: 'Trip preview',
      routeCoords: routeBuildCoordsFromTrip(draft),
      totalDistanceMi: Number.isFinite(distance) && distance > 0 ? distance / 1609.344 : summary.miles || null,
      totalDurationHours: Number.isFinite(duration) && duration > 0 ? duration / 3600 : null,
      camps: { completed: draft.campsites?.length ?? 0, total: draft.campsites?.length ?? 0 },
      fuel: { completed: draft.gas_stations?.length ?? 0, total: draft.gas_stations?.length ?? 0 },
      previewStops: routeBuildPreviewStopsFromTrip(draft),
      activityChoice: 'skip',
      finalTripId: null,
      errorMessage: null,
    });
    router.push('/(tabs)/map');
  }, [draft, router, setActiveTrip, summary.miles]);

  const saveTrip = useCallback(async () => {
    if (!snapshot || !draft || busy || !['ready_for_review', 'committing'].includes(snapshot.status) || !user) return;
    const requestEpoch = accountStorage.epoch();
    const accountId = String(user.id);
    const stillCurrent = () => accountStorage.epoch() === requestEpoch
      && String(useStore.getState().user?.id ?? '') === accountId;
    setBusy(true);
    setError('');
    try {
      const committed = await api.plannerV2Commit(snapshot.run_id, snapshot.revision);
      if (!stillCurrent()) return;
      const trip = committed.trip;
      setSnapshot(committed.run);
      setActiveTrip(trip, false, { mirrorRepository: false });
      addTripToHistory({
        trip_id: trip.trip_id,
        trip_name: trip.plan.trip_name,
        states: trip.plan.states ?? [],
        duration_days: trip.plan.duration_days,
        est_miles: trip.plan.total_est_miles ?? 0,
        planned_at: Date.now(),
      });
      await saveOfflineTrip(trip).catch(() => {});
      if (!stillCurrent()) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Saved to Trips', 'Your reviewed trip is ready in Trips and on the map.', [
        { text: 'Stay here', style: 'cancel' },
        { text: 'Open Trips', onPress: () => router.push('/(tabs)/trips') },
      ]);
    } catch (commitError) {
      if (!stillCurrent()) return;
      if (commitError instanceof ApiError && commitError.status === 409) {
        try {
          const next = await api.plannerV2Events(snapshot.run_id, 0);
          if (stillCurrent()) applySnapshot(next);
        } catch {}
      }
      if (stillCurrent()) setError(plannerErrorMessage(commitError));
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  }, [addTripToHistory, applySnapshot, busy, draft, router, setActiveTrip, snapshot, user]);

  if (!user) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.topbar}><Text style={s.eyebrow}>PLAN WITH TRAILHEAD</Text></View>
        <PlanWorkspaceSwitcher active="assisted" />
        <View style={s.signInGate}>
          <View style={s.guideMark}><Ionicons name="sparkles" size={24} color={C.orange} /></View>
          <Text style={s.signInTitle}>Your trip research stays with your account.</Text>
          <Text style={s.signInBody}>Sign in to keep conversations, resume research, and save a reviewed trip.</Text>
          <TouchableOpacity style={s.primaryButton} onPress={() => router.push({ pathname: '/(tabs)/profile', params: { auth: 'login' } } as any)}>
            <Text style={s.primaryButtonText}>Sign in or create an account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (restoring) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.centered}>
          <ActivityIndicator color={C.orange} />
          <Text style={s.loadingLabel}>Reopening your trip research</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.topbar}>
          <View>
            <Text style={s.eyebrow}>PLAN WITH TRAILHEAD</Text>
            <Text style={s.topbarSub}>{view === 'research' ? 'Live trip research' : view === 'review' ? 'Full trip review' : 'TRAILHEAD GUIDE'}</Text>
          </View>
          {snapshot?.findings?.length ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open trip sources" style={s.sourceButton} onPress={() => setSourcesOpen(true)}>
              <Ionicons name="documents-outline" size={17} color={C.text} />
              <Text style={s.sourceButtonText}>{snapshot.source_summary.source_count}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <PlanWorkspaceSwitcher active="assisted" />

        {view === 'conversation' ? (
          <ConversationView
            C={C}
            s={s}
            messages={messages}
            question={question}
            outline={outline}
            busy={busy}
            error={error}
            input={input}
            setInput={setInput}
            sendMessage={sendMessage}
            startResearch={startResearch}
            scrollRef={scrollRef}
            bottomInset={insets.bottom}
          />
        ) : view === 'research' ? (
          <ResearchView
            C={C}
            s={s}
            snapshot={snapshot}
            progress={progress}
            error={error}
            busy={busy}
            onCancel={cancelResearch}
            onReturn={() => setView('conversation')}
            scrollRef={scrollRef}
          />
        ) : view === 'review' ? (
          <FullReview
            C={C}
            s={s}
            trip={draft}
            findings={snapshot?.findings ?? []}
            warnings={snapshot?.warnings ?? []}
            busy={busy}
            saved={Boolean(snapshot?.saved)}
            saving={snapshot?.status === 'committing'}
            onBack={() => setView('reveal')}
            onMap={openDraftOnMap}
            onSources={() => setSourcesOpen(true)}
            onSave={saveTrip}
          />
        ) : (
          <RevealView
            C={C}
            s={s}
            trip={draft}
            snapshot={snapshot}
            summary={summary}
            route={route}
            pins={mapPins}
            error={error}
            busy={busy}
            onReview={() => setView('review')}
            onAdjust={clearRunForAdjustment}
            onMap={openDraftOnMap}
            onSources={() => setSourcesOpen(true)}
            onDetourDecision={decideDetour}
          />
        )}

        <SourcesModal
          C={C}
          s={s}
          visible={sourcesOpen}
          findings={snapshot?.findings ?? []}
          warnings={snapshot?.warnings ?? []}
          onClose={() => setSourcesOpen(false)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type SharedViewProps = { C: ColorPalette; s: ReturnType<typeof makeStyles> };

function ConversationView({
  C, s, messages, question, outline, busy, error, input, setInput, sendMessage,
  startResearch, scrollRef, bottomInset,
}: SharedViewProps & {
  messages: PlannerV2Message[];
  question: PlannerQuestion | null;
  outline: string;
  busy: boolean;
  error: string;
  input: string;
  setInput: (value: string) => void;
  sendMessage: (text?: string, visibleText?: string) => void;
  startResearch: () => void;
  scrollRef: RefObject<ScrollView | null>;
  bottomInset: number;
}) {
  const isWelcome = messages.length === 0;
  const composer = (welcome = false) => (
    <View style={[s.composer, welcome && s.welcomeComposer]}>
      <TextInput
        testID="planner.v2.composer"
        accessibilityLabel="Describe your trip"
        style={[s.composerInput, welcome && s.welcomeComposerInput]}
        value={input}
        onChangeText={setInput}
        placeholder="Describe your trip…"
        placeholderTextColor={C.text3}
        multiline
        maxLength={2000}
        editable={!busy}
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={() => sendMessage()}
      />
      <TouchableOpacity accessibilityLabel="Send trip message" style={[s.sendButton, (!input.trim() || busy) && s.sendButtonDisabled]} disabled={!input.trim() || busy} onPress={() => sendMessage()}>
        <Ionicons name="arrow-up" size={21} color="#fff" />
      </TouchableOpacity>
    </View>
  );
  return (
    <View style={s.flex}>
      <ScrollView
        ref={scrollRef}
        style={s.flex}
        contentContainerStyle={isWelcome ? s.welcomeContent : [s.conversationContent, { paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {isWelcome ? (
          <View style={s.welcomeConversation}>
            <View style={s.welcomeGuideMark}><Ionicons name="sparkles" size={20} color={C.orange} /></View>
            <Text style={s.welcomeTitle}>What kind of trip are you imagining?</Text>
            <Text style={s.welcomeBody}>{GUIDE_GREETING}</Text>
            {composer(true)}
            <Text style={s.welcomePromptLabel}>TRY ASKING</Text>
            <View style={s.starterChipWrap}>
              {STARTERS.map(starter => (
                <TouchableOpacity
                  key={starter.prompt}
                  accessibilityRole="button"
                  accessibilityLabel={starter.prompt}
                  style={s.starterChip}
                  disabled={busy}
                  onPress={() => sendMessage(starter.prompt)}
                  activeOpacity={0.78}
                >
                  <Text style={s.starterChipText}>{starter.prompt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <>
            <View style={[s.chatBubble, s.guideBubble]}>
              <Text style={s.chatRole}>TRAILHEAD GUIDE</Text>
              <Text style={s.chatText}>{GUIDE_GREETING}</Text>
            </View>
            {messages.map(message => (
              <View key={message.id} style={[s.chatBubble, message.role === 'user' ? s.userBubble : s.guideBubble]}>
                <Text style={s.chatRole}>{message.role === 'user' ? 'YOU' : 'TRAILHEAD GUIDE'}</Text>
                <Text style={s.chatText}>{message.text}</Text>
              </View>
            ))}
          </>
        )}

        {question ? (
          <View style={s.questionCard}>
            <View style={s.questionHeader}>
              <Ionicons name="compass-outline" size={18} color={C.orange} />
              <Text style={s.questionPrompt}>{question.prompt}</Text>
            </View>
            {question.options.map(option => (
              <TouchableOpacity key={option.id} style={s.answerCard} disabled={busy} onPress={() => sendMessage(option.value, option.label)}>
                <View style={s.starterCopy}>
                  <Text style={s.answerLabel}>{option.label}</Text>
                  <Text style={s.answerDetail}>{option.detail}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.text3} />
              </TouchableOpacity>
            ))}
            {question.allow_freeform ? <Text style={s.freeformHint}>Or answer in your own words below.</Text> : null}
          </View>
        ) : null}

        {outline ? (
          <View style={s.researchReadyCard}>
            <View style={s.readyIcon}><Ionicons name="search" size={20} color={C.green} /></View>
            <View style={s.flex}>
              <Text style={s.readyTitle}>Ready for real route research</Text>
              <Text style={s.readyBody}>{outline}</Text>
            </View>
            <TouchableOpacity testID="planner.v2.start-research" style={s.primaryButton} disabled={busy} onPress={startResearch}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryButtonText}>Start research</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {busy && !outline ? (
          <View style={s.thinkingRow}><ActivityIndicator size="small" color={C.orange} /><Text style={s.thinkingText}>Shaping the next useful question</Text></View>
        ) : null}
        {error ? <InlineWarning s={s} C={C} text={error} /> : null}
      </ScrollView>

      {!isWelcome ? (
        <View style={[s.composerDock, { paddingBottom: Math.max(bottomInset, 10) }]}>
          {composer()}
        </View>
      ) : null}
    </View>
  );
}

function ResearchView({ C, s, snapshot, progress, error, busy, onCancel, onReturn, scrollRef }: SharedViewProps & {
  snapshot: PlannerV2Snapshot | null;
  progress: { completed: number; total: number; ratio: number };
  error: string;
  busy: boolean;
  onCancel: () => void;
  onReturn: () => void;
  scrollRef: RefObject<ScrollView | null>;
}) {
  const status = snapshot?.status ?? 'pending';
  const failed = status === 'failed';
  const cancelled = status === 'cancelled';
  return (
    <ScrollView ref={scrollRef} style={s.flex} contentContainerStyle={s.researchContent}>
      <LinearGradient colors={[C.s2, C.s1]} style={s.researchHero}>
        <Text style={s.researchKicker}>{failed ? 'RESEARCH NEEDS ATTENTION' : cancelled ? 'RESEARCH STOPPED' : 'RESEARCHING YOUR TRIP'}</Text>
        <Text style={s.researchTitle}>{failed || cancelled ? 'Your completed checks are still here.' : newestPlannerMessage(snapshot)}</Text>
        <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.max(4, progress.ratio * 100)}%` }]} /></View>
        <Text style={s.progressCopy}>{progress.completed} of {progress.total} research sections finished</Text>
      </LinearGradient>

      <View style={s.taskList}>
        {(snapshot?.tasks ?? []).map(task => (
          <View key={task.id} style={[s.taskRow, task.state === 'running' && s.taskRowActive]}>
            {task.state === 'running' ? <ActivityIndicator size="small" color={C.orange} /> : <Ionicons name={taskIcon(task)} size={21} color={taskColor(task, C)} />}
            <View style={s.flex}>
              <Text style={s.taskTitle}>{task.title}</Text>
              <Text style={s.taskMessage}>{task.message}</Text>
            </View>
            <Text style={[s.taskState, { color: taskColor(task, C) }]}>{task.state.replace('_', ' ').toUpperCase()}</Text>
          </View>
        ))}
      </View>

      {error ? <InlineWarning s={s} C={C} text={error} /> : null}
      {failed || cancelled ? (
        <TouchableOpacity style={s.secondaryButton} onPress={onReturn}>
          <Ionicons name="chatbubble-outline" size={17} color={C.text} />
          <Text style={s.secondaryButtonText}>Return to the conversation</Text>
        </TouchableOpacity>
      ) : (
        <>
          <View style={s.researchNotice}>
            <Ionicons name="shield-checkmark-outline" size={18} color={C.green} />
            <Text style={s.researchNoticeText}>A checkmark appears only after that work has finished. Missing evidence stays visible as a warning.</Text>
          </View>
          <TouchableOpacity disabled={busy} style={s.cancelButton} onPress={onCancel}>
            <Text style={s.cancelButtonText}>Stop this research</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function RevealView({ C, s, trip, snapshot, summary, route, pins, error, busy, onReview, onAdjust, onMap, onSources, onDetourDecision }: SharedViewProps & {
  trip: TripResult | null;
  snapshot: PlannerV2Snapshot | null;
  summary: ReturnType<typeof plannerDraftSummary>;
  route: [number, number][];
  pins: ReturnType<typeof plannerMapPins>;
  error: string;
  busy: boolean;
  onReview: () => void;
  onAdjust: () => void;
  onMap: () => void;
  onSources: () => void;
  onDetourDecision: (proposalId: string, approve: boolean) => void;
}) {
  if (!trip || !snapshot) return <View style={s.centered}><ActivityIndicator color={C.orange} /></View>;
  const camps = (trip.campsites ?? []).slice(0, 3);
  const experiences = (trip.route_pois ?? []).slice(0, 3);
  const pendingDetours = (snapshot.detour_proposals ?? []).filter(proposal => !proposal.decision || proposal.decision === 'pending').length;
  const routeStops = trip.plan.waypoints ?? [];
  const startName = routeStops[0]?.name || 'your starting point';
  const destinationName = routeStops[routeStops.length - 1]?.name || 'your destination';
  const dayRhythm = Array.from({ length: Math.max(1, summary.days) }, (_, index) => {
    const names = routeStops.filter(stop => Number(stop.day || 1) === index + 1).map(stop => stop.name).filter(Boolean);
    return names.length ? `Day ${index + 1}: ${names.slice(0, 3).join(' → ')}` : '';
  }).filter(Boolean).slice(0, 2).join('\n');
  return (
    <ScrollView style={s.flex} contentContainerStyle={s.revealContent}>
      <View style={s.revealIntro}>
        <Text style={s.revealKicker}>YOUR RESEARCHED ROUTE</Text>
        <Text style={s.revealTitle}>{trip.plan.trip_name}</Text>
        <Text style={s.revealTagline}>A {summary.days}-day route from {startName} to {destinationName}, with road timing, sourced stops, and current conditions ready to review.</Text>
      </View>

      <View style={s.heroMapShell}>
        <StaticMapboxPreview
          pins={pins}
          route={route}
          title={trip.plan.trip_name}
          subtitle={`${summary.days} days · ${summary.miles.toLocaleString()} miles · ${summary.stops} route stops`}
          badgeLabel="Live route preview"
          fallbackVariant="route"
          height={310}
          onPress={onMap}
        />
        <View style={s.mapLegend}>
          <LegendDot color="#7c4a2a" label="Camp" s={s} />
          <LegendDot color="#334155" label="Fuel" s={s} />
          <LegendDot color="#0891b2" label="Trail" s={s} />
          <LegendDot color="#2563eb" label="Weather" s={s} />
          <LegendDot color="#dc2626" label="Warning" s={s} />
        </View>
      </View>

      <View style={s.bentoGrid}>
        <BentoCard s={s} C={C} icon="navigate-outline" label="DRIVING RHYTHM" title={`${summary.days} days · ${summary.miles.toLocaleString()} miles`} body={dayRhythm || 'Confirmed route anchors are ready for review.'} />
        <BentoCard s={s} C={C} icon="bed-outline" label="OVERNIGHTS" title={`${summary.camps} camp options`} body={camps.map(camp => camp.name).join('\n') || 'No sourced camp was confirmed. Review the warning before leaving.'} warning={!camps.length} />
        <BentoCard s={s} C={C} icon="trail-sign-outline" label="BEST EXPERIENCES" title={`${experiences.length} route-fit ideas`} body={experiences.map(place => place.name).join('\n') || 'No sourced experience was confirmed for this draft.'} warning={!experiences.length} />
        <BentoCard s={s} C={C} icon="car-sport-outline" label="READINESS" title={`${summary.fuel} fuel · ${trip.weather_checks?.length ?? 0} weather areas`} body={`${trip.plan.logistics?.fuel_strategy || 'Review fuel spacing.'}\n${trip.route_conditions?.length ? `${trip.route_conditions.length} current route condition${trip.route_conditions.length === 1 ? '' : 's'} flagged for review.` : 'No current route warning was returned; recheck before departure.'}`} />
      </View>

      {(snapshot.detour_proposals ?? []).length ? (
        <View style={s.detourSection}>
          <Text style={s.sectionLabel}>OPTIONAL DETOURS</Text>
          {(snapshot.detour_proposals ?? []).map(proposal => (
            <View key={proposal.id} style={s.detourCard}>
              <View style={s.detourHeader}>
                <View style={s.detourIcon}><Ionicons name="git-branch-outline" size={19} color={C.orange} /></View>
                <View style={s.flex}>
                  <Text style={s.detourTitle}>{proposal.title}</Text>
                  <Text style={s.detourMeta}>About {proposal.added_drive_minutes} extra min · {proposal.added_distance_miles} mi</Text>
                </View>
                {proposal.decision && proposal.decision !== 'pending' ? (
                  <Text style={[s.detourDecision, { color: proposal.decision === 'approved' ? C.green : C.text3 }]}>{proposal.decision.toUpperCase()}</Text>
                ) : null}
              </View>
              <Text style={s.detourBody}>{proposal.risk_reason || 'This stop adds meaningful road time and needs your approval.'}</Text>
              {proposal.source_url ? (
                <TouchableOpacity style={s.detourSource} onPress={() => Linking.openURL(proposal.source_url || '').catch(() => {})}>
                  <Ionicons name="open-outline" size={14} color={C.green} />
                  <Text style={s.detourSourceText}>Open {proposal.source_label || 'source'}</Text>
                </TouchableOpacity>
              ) : null}
              {proposal.decision === 'pending' || !proposal.decision ? (
                <View style={s.detourActions}>
                  <TouchableOpacity
                    testID={`planner.v2.detour.reject.${proposal.id}`}
                    disabled={busy}
                    style={[s.secondaryButton, s.detourButton]}
                    onPress={() => onDetourDecision(proposal.id, false)}
                  >
                    <Text style={s.secondaryButtonText}>Keep current route</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`planner.v2.detour.approve.${proposal.id}`}
                    disabled={busy}
                    style={[s.primaryButton, s.detourButton]}
                    onPress={() => onDetourDecision(proposal.id, true)}
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryButtonText}>Add and recheck</Text>}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {(snapshot.warnings ?? []).length ? (
        <View style={s.warningPanel}>
          <View style={s.panelHeading}><Ionicons name="warning-outline" size={18} color={C.yellow} /><Text style={s.panelTitle}>What still needs your attention</Text></View>
          {snapshot.warnings.map(warning => <Text key={warning} style={s.warningLine}>• {warning}</Text>)}
        </View>
      ) : null}

      <TouchableOpacity style={s.sourceSummary} onPress={onSources}>
        <View style={s.sourceSummaryIcon}><Ionicons name="documents-outline" size={20} color={C.green} /></View>
        <View style={s.flex}>
          <Text style={s.sourceSummaryTitle}>What Trailhead checked</Text>
          <Text style={s.sourceSummaryBody}>{snapshot.source_summary.source_count} direct sources · {snapshot.source_summary.official_count} official · every shown finding opens its source</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.text3} />
      </TouchableOpacity>

      {error ? <InlineWarning s={s} C={C} text={error} /> : null}
      <TouchableOpacity testID="planner.v2.review-full-trip" style={[s.primaryButton, pendingDetours > 0 && s.actionDisabled]} disabled={busy || pendingDetours > 0} onPress={onReview}>
        <Text style={s.primaryButtonText}>{pendingDetours > 0 ? 'Decide on detours to continue' : 'Review full trip'}</Text><Ionicons name="arrow-forward" size={18} color="#fff" />
      </TouchableOpacity>
      <View style={s.actionRow}>
        <TouchableOpacity style={[s.secondaryButton, s.halfButton]} onPress={onAdjust}><Ionicons name="chatbubble-outline" size={17} color={C.text} /><Text style={s.secondaryButtonText}>Adjust with Trailhead</Text></TouchableOpacity>
        <TouchableOpacity style={[s.secondaryButton, s.halfButton]} onPress={onMap}><Ionicons name="map-outline" size={17} color={C.text} /><Text style={s.secondaryButtonText}>Preview on map</Text></TouchableOpacity>
      </View>
      <Text style={s.saveDisclosure}>Reviewing this draft does not save it to Trips.</Text>
    </ScrollView>
  );
}

function FullReview({ C, s, trip, findings, warnings, busy, saved, saving, onBack, onMap, onSources, onSave }: SharedViewProps & {
  trip: TripResult | null;
  findings: PlannerV2Finding[];
  warnings: string[];
  busy: boolean;
  saved: boolean;
  saving: boolean;
  onBack: () => void;
  onMap: () => void;
  onSources: () => void;
  onSave: () => void;
}) {
  if (!trip) return <View style={s.centered}><Text style={s.loadingLabel}>Trip preview unavailable</Text></View>;
  const stops = trip.plan.waypoints ?? [];
  const startName = stops[0]?.name || 'your starting point';
  const destinationName = stops[stops.length - 1]?.name || 'your destination';
  const days = Array.from({ length: Math.max(1, Number(trip.plan.duration_days || 1)) }, (_, index) => ({
    day: index + 1,
    stops: stops.filter(stop => Number(stop.day || 1) === index + 1),
  }));
  return (
    <ScrollView style={s.flex} contentContainerStyle={s.reviewContent}>
      <TouchableOpacity style={s.backButton} onPress={onBack}><Ionicons name="arrow-back" size={18} color={C.text} /><Text style={s.backButtonText}>Back to trip preview</Text></TouchableOpacity>
      <Text style={s.reviewKicker}>FULL TRIP REVIEW</Text>
      <Text style={s.reviewTitle}>{trip.plan.trip_name}</Text>
      <Text style={s.reviewOverview}>Review the confirmed route from {startName} to {destinationName}. Sourced camps, fuel, experiences, weather, and active conditions remain linked below.</Text>

      {days.map(day => (
        <View key={day.day} style={s.dayCard}>
          <View style={s.dayNumber}><Text style={s.dayNumberText}>{day.day}</Text></View>
          <View style={s.flex}>
            <Text style={s.dayTitle}>{day.stops.length ? day.stops.map(stop => stop.name).slice(0, 3).join(' → ') : 'No fixed stop for this day'}</Text>
            <Text style={s.dayDescription}>{day.stops.length ? 'Located route stops for this day.' : 'Keep this day flexible or adjust it with Trailhead.'}</Text>
            <Text style={s.dayMeta}>{day.stops.length} ROUTE {day.stops.length === 1 ? 'STOP' : 'STOPS'}</Text>
          </View>
        </View>
      ))}

      <View style={s.reviewSection}>
        <Text style={s.sectionLabel}>CAMPS & OVERNIGHTS</Text>
        {(trip.campsites ?? []).length ? trip.campsites.map(camp => (
          <ReviewRow key={camp.id} s={s} C={C} icon="bed-outline" title={camp.name} body={camp.description || (camp.reservable ? 'Reservable camp' : 'Confirm current access')} />
        )) : <InlineWarning s={s} C={C} text="No camp with a direct source was confirmed. Choose an overnight before departure." />}
      </View>

      <View style={s.reviewSection}>
        <Text style={s.sectionLabel}>FUEL, PERMITS & CONDITIONS</Text>
        <ReviewRow s={s} C={C} icon="car-outline" title="Fuel plan" body={`${trip.gas_stations?.length ?? 0} sourced fuel options are included. Open the source list and confirm hours before departure.`} />
        <ReviewRow s={s} C={C} icon="document-text-outline" title="Permits" body="Treat permits as unconfirmed unless a direct agency source appears in What Trailhead checked." />
        <ReviewRow s={s} C={C} icon="partly-sunny-outline" title="Conditions" body={`${trip.weather_checks?.length ?? 0} weather areas checked · ${trip.route_conditions?.length ?? 0} current route conditions returned. Recheck both before departure.`} />
      </View>

      {warnings.length ? <View style={s.warningPanel}>{warnings.map(warning => <Text key={warning} style={s.warningLine}>• {warning}</Text>)}</View> : null}
      <TouchableOpacity style={s.sourceSummary} onPress={onSources}><Ionicons name="documents-outline" size={20} color={C.green} /><View style={s.flex}><Text style={s.sourceSummaryTitle}>{findings.length} sourced findings</Text><Text style={s.sourceSummaryBody}>Open the evidence behind camps, fuel, and worthwhile stops.</Text></View><Ionicons name="chevron-forward" size={18} color={C.text3} /></TouchableOpacity>
      <TouchableOpacity style={s.secondaryButton} onPress={onMap}><Ionicons name="map-outline" size={17} color={C.text} /><Text style={s.secondaryButtonText}>Continue on the full map</Text></TouchableOpacity>
      <TouchableOpacity testID="planner.v2.save-to-trips" style={[s.primaryButton, saved && s.savedButton]} disabled={busy || saved} onPress={onSave}>
        {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name={saved ? 'checkmark-circle' : 'bookmark-outline'} size={19} color="#fff" /><Text style={s.primaryButtonText}>{saved ? 'Saved to Trips' : saving ? 'Finish saving to Trips' : 'Save to Trips'}</Text></>}
      </TouchableOpacity>
      {!saved ? <Text style={s.saveDisclosure}>This is the only action that saves the draft to your Trips.</Text> : null}
    </ScrollView>
  );
}

function SourcesModal({ C, s, visible, findings, warnings, onClose }: SharedViewProps & {
  visible: boolean;
  findings: PlannerV2Finding[];
  warnings: string[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.sourceSheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View><Text style={s.sheetKicker}>WHAT TRAILHEAD CHECKED</Text><Text style={s.sheetTitle}>Sources and findings</Text></View>
            <TouchableOpacity accessibilityLabel="Close sources" onPress={onClose}><Ionicons name="close" size={24} color={C.text} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.sheetContent}>
            {findings.map(finding => (
              <TouchableOpacity key={finding.id} style={s.findingCard} onPress={() => Linking.openURL(finding.source_url).catch(() => {})}>
                <View style={s.findingHeader}><Text style={[s.findingBadge, finding.source_kind === 'commercial' && { color: C.yellow }]}>{sourceBadge(finding)}</Text><Ionicons name="open-outline" size={16} color={C.text3} /></View>
                <Text style={s.findingTitle}>{finding.title}</Text>
                {finding.summary ? <Text style={s.findingSummary}>{finding.summary}</Text> : null}
                <Text style={s.findingSource}>{finding.source_title} · {finding.freshness}</Text>
              </TouchableOpacity>
            ))}
            {!findings.length ? <InlineWarning s={s} C={C} text="No direct source links were available for this draft." /> : null}
            {warnings.map(warning => <InlineWarning key={warning} s={s} C={C} text={warning} />)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BentoCard({ s, C, icon, label, title, body, warning = false }: SharedViewProps & {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  title: string;
  body: string;
  warning?: boolean;
}) {
  return <View style={[s.bentoCard, warning && { borderColor: C.yellow + '88' }]}><Ionicons name={icon} size={20} color={warning ? C.yellow : C.orange} /><Text style={s.bentoLabel}>{label}</Text><Text style={s.bentoTitle}>{title}</Text><Text style={s.bentoBody}>{body}</Text></View>;
}

function ReviewRow({ s, C, icon, title, body }: SharedViewProps & { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return <View style={s.reviewRow}><View style={s.reviewRowIcon}><Ionicons name={icon} size={18} color={C.orange} /></View><View style={s.flex}><Text style={s.reviewRowTitle}>{title}</Text><Text style={s.reviewRowBody}>{body}</Text></View></View>;
}

function InlineWarning({ s, C, text }: SharedViewProps & { text: string }) {
  return <View style={s.inlineWarning}><Ionicons name="warning-outline" size={17} color={C.yellow} /><Text style={s.inlineWarningText}>{text}</Text></View>;
}

function LegendDot({ color, label, s }: { color: string; label: string; s: ReturnType<typeof makeStyles> }) {
  return <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: color }]} /><Text style={s.legendLabel}>{label}</Text></View>;
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: C.bg },
  topbar: { minHeight: 54, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: C.text, fontSize: 22, lineHeight: 24, fontFamily: 'BarlowCondensed_700Bold', letterSpacing: 0.4 },
  topbarSub: { color: C.text3, fontSize: 10, lineHeight: 14, fontFamily: mono, letterSpacing: 1.2, marginTop: 2 },
  sourceButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 11, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1 },
  sourceButtonText: { color: C.text, fontSize: 12, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  loadingLabel: { color: C.text2, fontSize: 14, textAlign: 'center' },
  signInGate: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center' },
  guideMark: { width: 52, height: 52, borderRadius: 18, borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  signInTitle: { color: C.text, fontSize: 31, lineHeight: 34, fontFamily: 'BarlowCondensed_700Bold', textAlign: 'center', maxWidth: 330 },
  signInBody: { color: C.text2, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 350, marginTop: 10, marginBottom: 24 },
  conversationContent: { paddingHorizontal: 16, paddingTop: 16 },
  welcomeContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 26 },
  welcomeConversation: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  welcomeGuideMark: { width: 42, height: 42, borderRadius: 15, borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  welcomeTitle: { color: C.text, fontSize: 29, lineHeight: 31, fontFamily: 'BarlowCondensed_700Bold', maxWidth: 350 },
  welcomeBody: { color: C.text2, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 18, maxWidth: 390 },
  welcomeComposer: { minHeight: 74, borderRadius: 22, borderColor: C.orange + '66', backgroundColor: C.s1, padding: 10 },
  welcomeComposerInput: { minHeight: 52, fontSize: 15, lineHeight: 21 },
  welcomePromptLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 1.1, marginTop: 16, marginBottom: 9 },
  starterChipWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 },
  starterChip: { maxWidth: '100%', minHeight: 36, justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8 },
  starterChipText: { color: C.text2, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  sectionLabel: { color: C.text3, fontSize: 10, fontFamily: mono, fontWeight: '800', letterSpacing: 1.2, marginBottom: 10 },
  starterCopy: { flex: 1 },
  chatBubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, marginBottom: 10, borderWidth: 1 },
  guideBubble: { alignSelf: 'flex-start', borderColor: C.border, backgroundColor: C.s1, borderBottomLeftRadius: 4 },
  userBubble: { alignSelf: 'flex-end', borderColor: C.orange + '55', backgroundColor: C.orangeGlow, borderBottomRightRadius: 4 },
  chatRole: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 1, marginBottom: 5 },
  chatText: { color: C.text, fontSize: 14, lineHeight: 21 },
  questionCard: { borderWidth: 1, borderColor: C.orange + '55', backgroundColor: C.s1, borderRadius: 18, padding: 15, marginTop: 8, marginBottom: 14 },
  questionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 12 },
  questionPrompt: { flex: 1, color: C.text, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  answerCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, borderRadius: 12, padding: 13, marginBottom: 8 },
  answerLabel: { color: C.text, fontSize: 14, fontWeight: '800' },
  answerDetail: { color: C.text3, fontSize: 12, lineHeight: 17, marginTop: 3 },
  freeformHint: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 4 },
  researchReadyCard: { borderWidth: 1, borderColor: C.green + '66', backgroundColor: C.green + '0D', borderRadius: 18, padding: 16, marginTop: 8, marginBottom: 12 },
  readyIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.green + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  readyTitle: { color: C.text, fontSize: 18, fontWeight: '900' },
  readyBody: { color: C.text2, fontSize: 13, lineHeight: 19, marginTop: 5, marginBottom: 16 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10 },
  thinkingText: { color: C.text3, fontSize: 12 },
  composerDock: { borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg, paddingHorizontal: 12, paddingTop: 10 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, backgroundColor: C.s1, borderWidth: 1, borderColor: C.border2, borderRadius: 18, padding: 9 },
  composerInput: { flex: 1, color: C.text, minHeight: 42, maxHeight: 112, paddingHorizontal: 8, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  sendButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.36 },
  primaryButton: { minHeight: 50, borderRadius: 14, backgroundColor: C.orange, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  actionDisabled: { opacity: 0.45 },
  secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: C.border2, backgroundColor: C.s1, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondaryButtonText: { color: C.text, fontSize: 13, fontWeight: '800' },
  inlineWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: C.yellow + '55', backgroundColor: C.yellow + '0F', borderRadius: 13, padding: 12, marginVertical: 8 },
  inlineWarningText: { flex: 1, color: C.text2, fontSize: 12, lineHeight: 18 },
  researchContent: { padding: 16, paddingBottom: 120 },
  researchHero: { borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 20, marginBottom: 16 },
  researchKicker: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 1.2 },
  researchTitle: { color: C.text, fontSize: 28, lineHeight: 31, fontFamily: 'BarlowCondensed_700Bold', marginTop: 10 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: C.s3, overflow: 'hidden', marginTop: 18 },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: C.orange },
  progressCopy: { color: C.text3, fontSize: 11, marginTop: 8 },
  taskList: { borderWidth: 1, borderColor: C.border, borderRadius: 18, overflow: 'hidden', marginBottom: 12 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 74, padding: 14, backgroundColor: C.s1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  taskRowActive: { backgroundColor: C.orangeGlow },
  taskTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  taskMessage: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 3 },
  taskState: { fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.7 },
  researchNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10, padding: 13 },
  researchNoticeText: { flex: 1, color: C.text3, fontSize: 11, lineHeight: 17 },
  cancelButton: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12, marginTop: 8 },
  cancelButtonText: { color: C.text3, fontSize: 12, textDecorationLine: 'underline' },
  revealContent: { padding: 16, paddingBottom: 130 },
  revealIntro: { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 18 },
  revealKicker: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 1.4 },
  revealTitle: { color: C.text, fontSize: 40, lineHeight: 41, fontFamily: 'BarlowCondensed_700Bold', marginTop: 8 },
  revealTagline: { color: C.text2, fontSize: 14, lineHeight: 21, marginTop: 9 },
  heroMapShell: { overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  mapLegend: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 8, backgroundColor: C.s1 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { color: C.text3, fontSize: 9, fontFamily: mono },
  bentoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  bentoCard: { width: '48.5%', minHeight: 178, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 15, backgroundColor: C.s1 },
  bentoLabel: { color: C.text3, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 1, marginTop: 14 },
  bentoTitle: { color: C.text, fontSize: 18, lineHeight: 21, fontFamily: 'BarlowCondensed_700Bold', marginTop: 5 },
  bentoBody: { color: C.text2, fontSize: 11, lineHeight: 17, marginTop: 8 },
  detourSection: { marginTop: 2, marginBottom: 12 },
  detourCard: { borderWidth: 1, borderColor: C.orange + '55', borderRadius: 18, padding: 15, backgroundColor: C.s1, marginBottom: 10 },
  detourHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detourIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center' },
  detourTitle: { color: C.text, fontSize: 16, lineHeight: 20, fontWeight: '900' },
  detourMeta: { color: C.orange, fontSize: 10, fontFamily: mono, marginTop: 3 },
  detourDecision: { fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  detourBody: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 12 },
  detourSource: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4 },
  detourSourceText: { color: C.green, fontSize: 11, fontWeight: '800' },
  detourActions: { flexDirection: 'row', gap: 9, marginTop: 14 },
  detourButton: { flex: 1, minHeight: 44, paddingHorizontal: 8 },
  warningPanel: { borderWidth: 1, borderColor: C.yellow + '55', backgroundColor: C.yellow + '0A', borderRadius: 16, padding: 15, marginBottom: 12 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  panelTitle: { color: C.text, fontSize: 14, fontWeight: '900' },
  warningLine: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 4 },
  sourceSummary: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: C.green + '44', backgroundColor: C.green + '0A', borderRadius: 16, padding: 14, marginBottom: 12 },
  sourceSummaryIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.green + '18', alignItems: 'center', justifyContent: 'center' },
  sourceSummaryTitle: { color: C.text, fontSize: 14, fontWeight: '900' },
  sourceSummaryBody: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 3 },
  actionRow: { flexDirection: 'row', gap: 9, marginTop: 10 },
  halfButton: { flex: 1, paddingHorizontal: 9 },
  saveDisclosure: { color: C.text3, fontSize: 10, textAlign: 'center', marginTop: 10 },
  reviewContent: { padding: 16, paddingBottom: 130 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 14 },
  backButtonText: { color: C.text, fontSize: 12, fontWeight: '800' },
  reviewKicker: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '900', letterSpacing: 1.2 },
  reviewTitle: { color: C.text, fontSize: 38, lineHeight: 40, fontFamily: 'BarlowCondensed_700Bold', marginTop: 8 },
  reviewOverview: { color: C.text2, fontSize: 14, lineHeight: 21, marginTop: 9, marginBottom: 18 },
  dayCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, borderWidth: 1, borderColor: C.border, borderRadius: 17, backgroundColor: C.s1, padding: 15, marginBottom: 10 },
  dayNumber: { width: 34, height: 34, borderRadius: 12, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  dayNumberText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  dayTitle: { color: C.text, fontSize: 17, fontWeight: '900' },
  dayDescription: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 5 },
  dayMeta: { color: C.orange, fontSize: 10, fontFamily: mono, marginTop: 8 },
  dayHighlight: { color: C.text3, fontSize: 11, lineHeight: 17, marginTop: 3 },
  reviewSection: { marginTop: 12, marginBottom: 12 },
  reviewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: C.s1, padding: 13, marginBottom: 8 },
  reviewRowIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.orangeGlow, alignItems: 'center', justifyContent: 'center' },
  reviewRowTitle: { color: C.text, fontSize: 13, fontWeight: '900' },
  reviewRowBody: { color: C.text3, fontSize: 11, lineHeight: 17, marginTop: 3 },
  savedButton: { backgroundColor: C.green },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sourceSheet: { maxHeight: '86%', minHeight: '58%', backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: C.border },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: C.border2, alignSelf: 'center', marginTop: 9 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetKicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 1 },
  sheetTitle: { color: C.text, fontSize: 25, fontFamily: 'BarlowCondensed_700Bold', marginTop: 3 },
  sheetContent: { padding: 14, paddingBottom: 40 },
  findingCard: { borderWidth: 1, borderColor: C.border, borderRadius: 15, padding: 14, backgroundColor: C.s1, marginBottom: 9 },
  findingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  findingBadge: { color: C.green, fontSize: 8, fontFamily: mono, fontWeight: '900', letterSpacing: 0.8 },
  findingTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginTop: 8 },
  findingSummary: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 5 },
  findingSource: { color: C.text3, fontSize: 10, lineHeight: 15, marginTop: 9 },
});
