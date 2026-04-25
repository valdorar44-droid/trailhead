import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Share, Animated, Linking, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, TripResult, TrailDNA, CreditPackage } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useTheme, useTag, mono, ColorPalette } from '@/lib/design';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';

const EXAMPLES = [
  { label: '14D', text: '14-day loop through southern Utah — dispersed camping, off-road, a couple paid showers' },
  { label: '7D',  text: '7-day overlanding from Denver into the San Juans, high clearance, wild camping only' },
  { label: 'WK',  text: 'Weekend run near Moab, BLM land, taking my Tacoma' },
];

const CHAT_STAGES  = ['Checking the trail...', 'On it...', 'Thinking...'];
const PLAN_STAGES  = ['Mapping your route...', 'Finding campsites...', 'Locating fuel stops...', 'Briefing terrain...'];

type PlanPhase = 'idle' | 'chatting' | 'ready' | 'planning' | 'active' | 'editing';

interface Message {
  role: 'user' | 'ai';
  text?: string;
  trip?: TripResult;
  outline?: string;   // "route ready" card
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

  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [buyingPkg, setBuyingPkg] = useState<string | null>(null);

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
    setShowCreditsModal(true);
    if (packages.length === 0) {
      api.getCreditPackages().then(setPackages).catch(() => {});
    }
  }

  async function buyPackage(pkgId: string) {
    setBuyingPkg(pkgId);
    try {
      const res = await api.createCheckout(pkgId);
      await Linking.openURL(res.url);
    } catch (e: any) {
      // If Stripe not configured, show message
    } finally {
      setBuyingPkg(null);
    }
  }

  function isOutOfCredits(e: any) {
    return e?.message?.includes('402') || e?.message?.includes('Not enough credits') || e?.message?.includes('credits');
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

  // ── Main send handler ───────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);

    const finalText = await resolveLocation(text);

    // ── Edit mode: trip is active ─────────────────────────────────────────────
    if ((planPhase === 'active' || planPhase === 'editing') && activeTrip) {
      setPlanPhase('editing');
      startStages(CHAT_STAGES);
      try {
        const data = await api.chat(finalText, sessionId, activeTrip);
        if (data.trail_dna) setTrailDna(data.trail_dna);
        setMessages(m => [...m, { role: 'ai', text: data.content }]);

        if (data.type === 'trip_update' && data.trip) {
          setActiveTrip(data.trip);
          // Replace or append trip card
          setMessages(m => {
            const filtered = m.filter(msg => !msg.trip);
            return [...filtered, { role: 'ai', text: data.content }, { role: 'ai', trip: data.trip }];
          });
        }
        setPlanPhase('active');
      } catch (e: any) {
        if (isOutOfCredits(e)) handleOutOfCredits();
        else setMessages(m => [...m, { role: 'ai', text: `⚠ ${e.message}` }]);
        setPlanPhase('active');
      } finally {
        stopStages(); setLoading(false); scrollToEnd();
      }
      return;
    }

    // ── Conversational planning ───────────────────────────────────────────────
    setPlanPhase('chatting');
    startStages(CHAT_STAGES);
    try {
      const data = await api.chat(finalText, sessionId);
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
      else { setMessages(m => [...m, { role: 'ai', text: `⚠ ${e.message}` }]); setPlanPhase('idle'); }
    } finally {
      stopStages(); setLoading(false); scrollToEnd();
    }
  }

  // ── Build full trip from conversation ─────────────────────────────────────
  async function buildTrip() {
    setMessages(m => m.filter(msg => !msg.outline));
    setPlanPhase('planning');
    setLoading(true);
    startStages(PLAN_STAGES);
    try {
      const result = await api.planFromSession(sessionId);
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
      setPlanPhase('active');
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
              : `⚠ ${e.message}`,
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

  const currentStages = planPhase === 'planning' ? PLAN_STAGES : CHAT_STAGES;

  // ── Login gate ───────────────────────────────────────────────────────────
  if (!user) return (
    <SafeAreaView style={s.container}>
      <View style={s.loginGate}>
        <View style={s.loginGateLogo}>
          <Ionicons name="compass" size={36} color={C.orange} />
        </View>
        <Text style={s.loginGateTitle}>AI Trip Planning</Text>
        <Text style={s.loginGateSub}>
          Plan overland routes with AI, get campsite recommendations, packing lists, audio guides and more.
        </Text>
        <View style={s.loginGatePerks}>
          {[
            ['flash', `${75} credits free on signup`],
            ['map-outline', 'AI-planned routes with camps + fuel'],
            ['radio-outline', 'Audio guide for every waypoint'],
            ['people-outline', 'Earn credits by contributing to the map'],
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
        <Text style={s.loginGateNote}>Navigate, browse camps, and report conditions — always free.</Text>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.container}>
      {/* ── Credits modal ── */}
      <Modal visible={showCreditsModal} transparent animationType="fade" onRequestClose={() => setShowCreditsModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.creditsModal}>
            <TouchableOpacity style={s.creditsModalClose} onPress={() => setShowCreditsModal(false)}>
              <Ionicons name="close" size={20} color={C.text3} />
            </TouchableOpacity>
            <Ionicons name="flash" size={32} color={C.orange} />
            <Text style={s.creditsModalTitle}>Out of Credits</Text>
            <Text style={s.creditsModalSub}>
              You have {user?.credits ?? 0} credits. Buy more or earn credits by contributing to the map.
            </Text>
            <View style={s.pkgRow}>
              {packages.map(pkg => (
                <TouchableOpacity
                  key={pkg.id}
                  style={[s.pkgCard, pkg.popular && s.pkgCardPopular]}
                  onPress={() => buyPackage(pkg.id)}
                  disabled={buyingPkg !== null}
                >
                  {pkg.popular && <Text style={s.pkgPopularTag}>BEST VALUE</Text>}
                  <Text style={s.pkgLabel}>{pkg.label}</Text>
                  <Text style={s.pkgCredits}>{pkg.credits}</Text>
                  <Text style={s.pkgCreditsLabel}>credits</Text>
                  <Text style={s.pkgPrice}>{pkg.price_display}</Text>
                  {buyingPkg === pkg.id && <ActivityIndicator size="small" color={C.orange} style={{ marginTop: 4 }} />}
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.earnTip}>
              <Ionicons name="information-circle-outline" size={14} color={C.text3} />
              <Text style={s.earnTipText}>Submit reports on the Map tab to earn free credits</Text>
            </View>
          </View>
        </View>
      </Modal>

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
          <TouchableOpacity style={s.creditPill} onPress={() => setShowCreditsModal(true)}>
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

      {/* ── Trail DNA strip ── */}
      {Object.keys(trailDna).some(k => trailDna[k as keyof TrailDNA]) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.dnaRow}
          contentContainerStyle={s.dnaRowContent}
        >
          <Text style={s.dnaLabel}>TRAIL DNA</Text>
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
            {tripHistory.length > 0 && (
              <View style={s.historySection}>
                <Text style={s.sectionLabel}>RECENT TRIPS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.historyScroll}>
                  {tripHistory.map(t => (
                    <TouchableOpacity
                      key={t.trip_id}
                      style={s.historyCard}
                      onPress={() => {
                        api.getTrip(t.trip_id).then(trip => {
                          setActiveTrip(trip);
                          setMessages([{ role: 'ai', trip }]);
                          setPlanPhase('active');
                        }).catch(() => {});
                      }}
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
              {'PLAN YOUR\nOVERLAND\n'}
              <Text style={{ color: C.orange }}>ADVENTURE.</Text>
            </Text>
            <Text style={s.welcomeSub}>
              Tell me your trip idea — I'll ask a few questions, then build the full route, find dispersed camps, and brief you on terrain.
            </Text>

            {EXAMPLES.map((ex, i) => (
              <TouchableOpacity key={i} style={s.example} onPress={() => setInput(ex.text)}>
                <View style={s.exampleBadge}><Text style={s.exampleBadgeText}>{ex.label}</Text></View>
                <Text style={s.exampleText}>{ex.text}</Text>
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

      {/* ── Input ── */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        {(planPhase === 'active' || planPhase === 'editing') && (
          <View style={s.editHint}>
            <Ionicons name="pencil-outline" size={10} color={C.orange} />
            <Text style={[s.editHintText, { color: C.orange }]}>Edit mode — describe any change to your route</Text>
          </View>
        )}
      </KeyboardAvoidingView>
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
      backgroundColor: isRetry ? 'rgba(184,92,56,0.07)' : 'rgba(200,149,58,0.08)',
      borderWidth: 1,
      borderColor: isRetry ? 'rgba(184,92,56,0.25)' : 'rgba(200,149,58,0.28)',
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

function TripCard({ trip, C, onViewMap, onViewGuide }: {
  trip: TripResult; C: ColorPalette;
  onViewMap: () => void; onViewGuide: () => void;
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
      <View style={{ backgroundColor: '#0a150a', padding: 14, borderBottomWidth: 1, borderColor: '#1e2e20' }}>
        <View style={{ marginBottom: 4 }}>
          <Text style={{ color: C.orange, fontSize: 8.5, fontFamily: mono, letterSpacing: 1.2 }}>✦ AI TRIP PLAN READY</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#e4ddd2', fontSize: 18, fontWeight: '900', letterSpacing: -0.5, lineHeight: 22, textTransform: 'uppercase' }} numberOfLines={2}>{p.trip_name}</Text>
            <Text style={{ color: '#8a9285', fontSize: 10, fontFamily: mono, letterSpacing: 0.8, marginTop: 3 }}>{(p.states ?? []).join(' · ')}</Text>
          </View>
          <TouchableOpacity onPress={shareTrip} style={{ padding: 4, marginTop: -2 }}>
            <Ionicons name="share-outline" size={18} color="#8a9285" />
          </TouchableOpacity>
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

  // Credits modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  creditsModal: { backgroundColor: C.s1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, alignItems: 'center', gap: 10 },
  creditsModalClose: { position: 'absolute', top: 16, right: 16, padding: 4 },
  creditsModalTitle: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  creditsModalSub: { color: C.text2, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  pkgRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  pkgCard: { flex: 1, backgroundColor: C.s2, borderRadius: 14, padding: 12, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: C.border },
  pkgCardPopular: { borderColor: C.orange, backgroundColor: C.s2 },
  pkgPopularTag: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  pkgLabel: { color: C.text, fontSize: 13, fontWeight: '700', fontFamily: mono },
  pkgCredits: { color: C.orange, fontSize: 26, fontWeight: '900', lineHeight: 30 },
  pkgCreditsLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1 },
  pkgPrice: { color: C.text2, fontSize: 13, fontWeight: '600', marginTop: 4 },
  earnTip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  earnTipText: { color: C.text3, fontSize: 11, fontFamily: mono },

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
  welcomeHeading: {
    color: C.text, fontSize: 38, fontWeight: '900',
    letterSpacing: -1.5, lineHeight: 40, marginBottom: 8,
    textTransform: 'uppercase',
  },
  welcomeSub: { color: C.text2, fontSize: 13.5, lineHeight: 21, marginBottom: 4, fontStyle: 'italic' },

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
    borderRadius: 10, padding: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  exampleBadge: {
    minWidth: 28, height: 22, borderRadius: 6,
    backgroundColor: 'rgba(184,92,56,0.15)', borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  exampleBadgeText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  exampleText: { color: C.text, fontSize: 13, lineHeight: 19, flex: 1 },

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
});
