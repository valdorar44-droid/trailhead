import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Share, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, TripResult } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useTheme, useTag, mono, ColorPalette } from '@/lib/design';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://trailhead-production-2049.up.railway.app';

const EXAMPLES = [
  { label: '14D', text: '14-day loop through southern Utah — dispersed camping, off-road, a couple paid showers' },
  { label: '7D',  text: '7-day overlanding trip from Denver into the San Juans, high clearance, wild camping only' },
  { label: 'WK',  text: 'Weekend run near Moab, BLM land, taking my Tacoma' },
];

interface Message { role: 'user' | 'ai'; text?: string; trip?: TripResult }

export default function PlanScreen() {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const setActiveTrip = useStore(st => st.setActiveTrip);
  const addTripToHistory = useStore(st => st.addTripToHistory);
  const tripHistory = useStore(st => st.tripHistory);
  const userLoc = useStore(st => st.userLoc);
  const mapboxToken = useStore(st => st.mapboxToken);
  const router = useRouter();

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      // Resolve "my location" to a real place name via reverse geocoding
      let finalText = text;
      if (/\b(my location|from here|current location|where i am|starting from here|starting here)\b/i.test(text) && userLoc && mapboxToken) {
        try {
          const r = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${userLoc.lng},${userLoc.lat}.json?access_token=${mapboxToken}&types=place,region&limit=1`
          );
          const geo = await r.json();
          const place = geo.features?.[0]?.text ?? `${userLoc.lat.toFixed(3)},${userLoc.lng.toFixed(3)}`;
          const region = geo.features?.[0]?.context?.find((c: any) => c.id?.startsWith('region'))?.short_code?.replace('US-', '') ?? '';
          const placeName = region ? `${place}, ${region}` : place;
          finalText = finalText.replace(/\b(my location|from here|current location|where i am|starting from here|starting here)\b/gi, placeName);
        } catch {}
      }
      const result = await api.plan(finalText);
      setActiveTrip(result);
      setMessages(m => [...m, { role: 'ai', trip: result }]);
      addTripToHistory({
        trip_id: result.trip_id,
        trip_name: result.plan.trip_name,
        states: result.plan.states ?? [],
        duration_days: result.plan.duration_days,
        est_miles: result.plan.total_est_miles ?? 0,
        planned_at: Date.now(),
      });
    } catch (e: any) {
      setMessages(m => [...m, { role: 'ai', text: `⚠ ${e.message}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={s.logoBadge}><Text style={s.logoEmoji}>⛺</Text></View>
        <View>
          <Text style={s.logoName}>Trailhead</Text>
          <Text style={s.logoTag}>KNOW THE TRAIL BEFORE YOU HIT IT</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.messages}
        contentContainerStyle={s.messagesContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={s.welcome}>
            {tripHistory.length > 0 && (
              <View style={s.historySection}>
                <Text style={s.historyLabel}>RECENT TRIPS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.historyScroll}>
                  {tripHistory.map(t => (
                    <TouchableOpacity
                      key={t.trip_id}
                      style={s.historyCard}
                      onPress={() => {
                        api.getTrip(t.trip_id).then(trip => {
                          setActiveTrip(trip);
                          setMessages([{ role: 'ai', trip }]);
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
            <Text style={s.welcomeText}>
              Tell me your next adventure — I'll plan the route, find dispersed campsites, map fuel stops, and brief you on terrain.
            </Text>
            {EXAMPLES.map((ex, i) => (
              <TouchableOpacity key={i} style={s.example} onPress={() => setInput(ex.text)}>
                <View style={s.exampleBadge}><Text style={s.exampleBadgeText}>{ex.label}</Text></View>
                <Text style={s.exampleText}>{ex.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {messages.map((msg, i) => (
          <View key={i} style={[s.msg, msg.role === 'user' ? s.msgUser : s.msgAi]}>
            {msg.role === 'ai' && <Text style={s.msgLabel}>TRAILHEAD AI</Text>}
            {msg.role === 'user' && <Text style={[s.msgLabel, { textAlign: 'right' }]}>YOU</Text>}
            {msg.trip
              ? <TripCard trip={msg.trip} onViewMap={() => router.push('/map')} onViewGuide={() => router.push('/guide')} />
              : <View style={[s.bubble, msg.role === 'user' ? s.bubbleUser : s.bubbleAi]}>
                  <Text style={[s.bubbleText, msg.role === 'user' && { color: '#fff' }]}>{msg.text}</Text>
                </View>
            }
          </View>
        ))}

        {loading && (
          <View style={s.msgAi}>
            <Text style={s.msgLabel}>TRAILHEAD AI</Text>
            <View style={s.bubbleAi}>
              <ActivityIndicator color={C.orange} size="small" />
              <Text style={[s.bubbleText, { marginLeft: 10 }]}>Mapping your adventure...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Describe your adventure..."
            placeholderTextColor={C.text3}
            multiline
            maxLength={500}
            onSubmitEditing={send}
          />
          <TouchableOpacity
            style={[s.sendBtn, loading && s.sendBtnDisabled]}
            onPress={send}
            disabled={loading}
          >
            <Ionicons name="send" size={19} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TripCard({ trip, onViewMap, onViewGuide }: { trip: TripResult; onViewMap: () => void; onViewGuide: () => void }) {
  const C = useTheme();
  const tag = useTag();
  const tc = useMemo(() => makeTripCardStyles(C), [C]);
  const p = trip.plan;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Count-up values
  const [counts, setCounts] = useState({ days: 0, miles: 0, stops: 0, camps: 0 });

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    // Count up stats
    const targets = {
      days: p.duration_days ?? 0,
      miles: p.total_est_miles ?? 0,
      stops: p.waypoints?.length ?? 0,
      camps: trip.campsites?.length ?? 0,
    };
    let frame = 0;
    const total = 24;
    const timer = setInterval(() => {
      frame++;
      const prog = Math.min(frame / total, 1);
      const ease = 1 - Math.pow(1 - prog, 3);
      setCounts({
        days:  Math.round(targets.days  * ease),
        miles: Math.round(targets.miles * ease),
        stops: Math.round(targets.stops * ease),
        camps: Math.round(targets.camps * ease),
      });
      if (frame >= total) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, []);

  // Terrain tags
  const tags: Array<{ label: string; style: string }> = [];
  const roadTypes = new Set((p.daily_itinerary ?? []).map(d => d.road_type));
  const landTypes = new Set((p.waypoints ?? []).map(w => w.land_type));
  if (roadTypes.has('4wd'))  tags.push({ label: '4WD',  style: '4wd'  });
  if (roadTypes.has('dirt')) tags.push({ label: 'DIRT', style: 'dirt' });
  if (landTypes.has('BLM'))  tags.push({ label: 'BLM',  style: 'blm'  });
  if (landTypes.has('USFS')) tags.push({ label: 'USFS', style: 'usfs' });
  if (landTypes.has('NPS'))  tags.push({ label: 'NPS',  style: 'nps'  });

  function shareTrip() {
    Share.share({
      title: p.trip_name,
      message: `🗺 ${p.trip_name}\n${p.duration_days} days · ${p.total_est_miles ?? '?'} miles · ${(p.states ?? []).join(', ')}\n\n${p.overview}\n\nPlanned with Trailhead AI: ${BASE_URL}`,
    });
  }

  return (
    <Animated.View style={[tc.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      {/* Hero */}
      <View style={tc.hero}>
        <View style={tc.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={tc.name} numberOfLines={1}>{p.trip_name}</Text>
            <Text style={tc.states}>{(p.states ?? []).join(' · ')}</Text>
          </View>
          <TouchableOpacity onPress={shareTrip} style={tc.shareBtn}>
            <Ionicons name="share-outline" size={18} color={C.text2} />
          </TouchableOpacity>
        </View>
        {tags.length > 0 && (
          <View style={tc.tags}>
            {tags.map(t => {
              const ts = tag[t.style as keyof typeof tag] ?? tag.mixed;
              return (
                <View key={t.label} style={[tc.tag, { backgroundColor: ts.bg, borderColor: ts.border }]}>
                  <Text style={[tc.tagText, { color: ts.text }]}>{t.label}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={tc.stats}>
        {[
          ['DAYS',  counts.days ],
          ['MILES', counts.miles],
          ['STOPS', counts.stops],
          ['CAMPS', counts.camps],
        ].map(([label, val], i) => (
          <View key={label as string} style={[tc.stat, i > 0 && tc.statBorder]}>
            <Text style={tc.statVal}>{val}</Text>
            <Text style={tc.statLabel}>{label as string}</Text>
          </View>
        ))}
      </View>

      {/* Overview */}
      <Text style={tc.overview} numberOfLines={3}>{p.overview}</Text>

      {/* Actions */}
      <View style={tc.actions}>
        <TouchableOpacity style={tc.btnPrimary} onPress={onViewMap}>
          <Text style={tc.btnPrimaryText}>VIEW ON MAP →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={tc.btnGhost} onPress={onViewGuide}>
          <Ionicons name="headset-outline" size={15} color={C.text2} />
          <Text style={tc.btnGhostText}>GUIDE</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const makeTripCardStyles = (C: ColorPalette) => StyleSheet.create({
  card: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  hero: {
    backgroundColor: '#150800',
    padding: 14, borderBottomWidth: 1, borderColor: C.border,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  name: { color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  states: { color: C.orange, fontSize: 10, fontFamily: mono, letterSpacing: 1 },
  shareBtn: { padding: 4, marginTop: -2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 100, borderWidth: 1 },
  tagText: { fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  stats: {
    flexDirection: 'row', backgroundColor: C.s2,
    borderBottomWidth: 1, borderColor: C.border,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statBorder: { borderLeftWidth: 1, borderColor: C.border },
  statVal: { color: C.orange, fontSize: 22, fontWeight: '800', fontFamily: mono },
  statLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 0.5, marginTop: 2 },
  overview: {
    color: C.text2, fontSize: 12.5, lineHeight: 19,
    padding: 12, backgroundColor: C.s2,
    borderBottomWidth: 1, borderColor: C.border,
  },
  actions: {
    flexDirection: 'row', gap: 8, padding: 12,
    backgroundColor: C.s2,
  },
  btnPrimary: {
    flex: 1, backgroundColor: C.orange, borderRadius: 10,
    paddingVertical: 11, alignItems: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 12, fontFamily: mono, letterSpacing: 0.5 },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.s3,
  },
  btnGhostText: { color: C.text2, fontSize: 11, fontFamily: mono },
});

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: C.border,
    backgroundColor: C.s1,
  },
  logoBadge: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
  },
  logoEmoji: { fontSize: 20 },
  logoName: { color: C.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  logoTag: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 1, letterSpacing: 0.8 },
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 14, flexGrow: 1 },
  welcome: { gap: 8 },
  welcomeText: { color: C.text2, fontSize: 13.5, lineHeight: 21, marginBottom: 4 },
  historySection: { marginBottom: 4 },
  historyLabel: { color: C.text3, fontSize: 9, fontFamily: mono, letterSpacing: 1, marginBottom: 8 },
  historyScroll: { gap: 8, paddingRight: 4 },
  historyCard: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, padding: 12, width: 148, gap: 4,
    borderLeftWidth: 3, borderLeftColor: C.orange,
  },
  historyCardName: { color: C.text, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  historyCardStates: { color: C.orange, fontSize: 9, fontFamily: mono, letterSpacing: 0.5 },
  historyCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  historyCardStat: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  historyCardDot: { color: C.border, fontSize: 9 },
  example: {
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  exampleBadge: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: C.orangeGlow,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  exampleBadgeText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  exampleText: { color: C.text, fontSize: 13, lineHeight: 19, flex: 1 },
  msg: { gap: 4 },
  msgUser: { alignItems: 'flex-end' },
  msgAi:  { alignItems: 'flex-start' },
  msgLabel: { color: C.text3, fontSize: 9, fontFamily: mono, paddingHorizontal: 4, letterSpacing: 1 },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '90%', flexDirection: 'row', alignItems: 'center' },
  bubbleUser: { backgroundColor: C.orange, borderBottomRightRadius: 4 },
  bubbleAi:   { backgroundColor: C.s2, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleText: { color: C.text, fontSize: 13.5, lineHeight: 20, flex: 1 },
  inputWrap: {
    flexDirection: 'row', gap: 10, padding: 14,
    borderTopWidth: 1, borderColor: C.border,
    alignItems: 'flex-end', backgroundColor: C.s1,
  },
  input: {
    flex: 1, backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.border,
    borderRadius: 14, padding: 12, color: C.text, fontSize: 14, maxHeight: 120,
  },
  sendBtn: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: C.orange,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.orange, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
  },
  sendBtnDisabled: { backgroundColor: C.s3, shadowOpacity: 0 },
});
